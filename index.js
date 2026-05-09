// ── STROKE PREVIEW ──
const strokeImage = document.getElementById("stroke-image");
const drillSelect = document.getElementById("drill-select");

const strokeImages = {
  "upstroke":      "images/upstroke.png",
  "downstroke":    "images/downstroke.png",
  "ovals":         "images/ovals.png"
};

drillSelect.addEventListener("change", () => {
  const selected = drillSelect.value;
  strokeImage.src = strokeImages[selected] || "";
});

// ── CAMERA VISION ──
const video      = document.getElementById("camera");
const canvas     = document.getElementById("overlay");
const ctx        = canvas.getContext("2d");
const status     = document.getElementById("status");
const startBtn   = document.getElementById("start-session");

const angleFB    = document.getElementById("angle-feedback");
const pressureFB = document.getElementById("pressure-feedback");
const tempoFB    = document.getElementById("temple-feedback");

let isRunning      = false;
let animFrame      = null;
let prevBrightness = null;
let lastMotionTime = Date.now();

// Position overlay canvas on top of the video
const cameraSection = document.querySelector(".camera-panel");
cameraSection.style.position = "relative";

function syncCanvas() {
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.style.width    = video.offsetWidth  + "px";
  canvas.style.height   = video.offsetHeight + "px";
  canvas.style.position = "absolute";
  canvas.style.top      = video.offsetTop  + "px";
  canvas.style.left     = video.offsetLeft + "px";
  canvas.style.pointerEvents = "none";
}

// ── START CAMERA ──
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    syncCanvas();
    status.textContent = "Hold your pen in front of the camera";
    analyseLoop();
  } catch (e) {
    status.textContent = "Camera access denied — check browser permissions";
  }
}

// ── STOP CAMERA ──
function stopCamera() {
  if (animFrame) cancelAnimationFrame(animFrame);
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  status.textContent     = "Session stopped";
  angleFB.textContent    = "Pen angle: —";
  pressureFB.textContent = "Pressure: —";
  tempoFB.textContent    = "Tempo: —";
}

// ── START / STOP BUTTON ──
startBtn.addEventListener("click", async () => {
  if (!isRunning) {
    isRunning = true;
    startBtn.textContent = "Stop Session";
    startBtn.style.background = "#5c2010";
    await startCamera();
  } else {
    isRunning = false;
    startBtn.textContent = "Start Session";
    startBtn.style.background = "";
    stopCamera();
  }
});

// ── MAIN ANALYSIS LOOP ──
function analyseLoop() {
  if (!isRunning) return;
  syncCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width;
  const h = canvas.height;

  // Read pixels from video into an offscreen canvas
  const offscreen = document.createElement("canvas");
  offscreen.width = w; offscreen.height = h;
  const oct = offscreen.getContext("2d");
  oct.drawImage(video, 0, 0, w, h);
  const px = oct.getImageData(0, 0, w, h).data;

  // ── 1. DETECT PEN (darkest vertical region) ──
  const rowStart = Math.floor(h * 0.15);
  const rowEnd   = Math.floor(h * 0.90);
  const numCols  = 50;
  const colStep  = Math.floor(w / numCols);

  const colDark = [];
  for (let ci = 0; ci < numCols; ci++) {
    const x = ci * colStep;
    let sum = 0, count = 0;
    for (let y = rowStart; y < rowEnd; y += 5) {
      const i = (y * w + x) * 4;
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      count++;
    }
    colDark.push(sum / count);
  }

  const threshold = 75;
  const penCols = colDark
    .map((d, i) => ({ d, i }))
    .filter(c => c.d < threshold)
    .map(c => c.i);

  let estimatedAngle = null;

  if (penCols.length >= 2) {
    const minCI = Math.min(...penCols);
    const maxCI = Math.max(...penCols);
    const midX  = ((minCI + maxCI) / 2) * colStep;
    const penW  = (maxCI - minCI) * colStep;

    // Find vertical extent of pen
    let topEdge = null, bottomEdge = null;
    for (let y = rowStart; y < rowEnd; y += 2) {
      const i = (y * w + Math.round(midX)) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < 80) {
        if (topEdge === null) topEdge = y;
        bottomEdge = y;
      }
    }

    if (topEdge !== null && bottomEdge - topEdge > 20) {
      const penH = bottomEdge - topEdge;
      const rawAngle = Math.atan2(penW * 0.5, penH) * 180 / Math.PI;
      estimatedAngle = Math.round(Math.min(90, Math.max(10, 90 - rawAngle)));

      // Draw bounding box around pen
      ctx.strokeStyle = "rgba(200,149,42,0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(midX - penW / 2, topEdge, penW, penH);
      ctx.setLineDash([]);

      // Draw angle arc at base of pen
      ctx.save();
      ctx.translate(midX, bottomEdge + 10);
      ctx.strokeStyle = "rgba(200,149,42,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 36, -Math.PI / 2, -Math.PI / 2 + (estimatedAngle / 90) * (Math.PI / 2));
      ctx.stroke();
      ctx.fillStyle = "rgba(200,149,42,1)";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(estimatedAngle + "°", 10, -36);
      ctx.restore();
    }
  }

  // ── 2. PRESSURE (brightness shift at nib area) ──
  const nibY1 = Math.floor(h * 0.65), nibY2 = Math.floor(h * 0.85);
  const nibX1 = Math.floor(w * 0.35), nibX2 = Math.floor(w * 0.65);
  let nibSum = 0, nibCount = 0;
  for (let y = nibY1; y < nibY2; y += 3) {
    for (let x = nibX1; x < nibX2; x += 3) {
      const i = (y * w + x) * 4;
      nibSum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      nibCount++;
    }
  }
  const nibBrightness = nibCount > 0 ? nibSum / nibCount : 128;

  let pressureLabel = "Medium — great pressure";
  if (prevBrightness !== null) {
    const delta = prevBrightness - nibBrightness;
    if (delta > 8)       pressureLabel = "Heavy — ease up slightly";
    else if (delta < -5) pressureLabel = "Light — press a little more";
  }
  prevBrightness = nibBrightness;

  // ── 3. TEMPO ──
  let tempo = "Paused";
  if (penCols.length > 0) {
    lastMotionTime = Date.now();
    tempo = "Active";
  } else if (Date.now() - lastMotionTime < 3000) {
    tempo = "Steady";
  }

  // ── UPDATE FEEDBACK ──
  if (estimatedAngle !== null) {
    let hint = "";
    if (estimatedAngle >= 35 && estimatedAngle <= 55) hint = "Perfect for copperplate";
    else if (estimatedAngle >= 60)                    hint = "Good for gothic / upright";
    else if (estimatedAngle < 25)                     hint = "Too flat — tilt up";
    else                                              hint = "Adjust slightly";
    angleFB.textContent = `Pen angle: ${estimatedAngle}° — ${hint}`;
  } else {
    angleFB.textContent = "Pen angle: No pen detected";
  }

  pressureFB.textContent = `Pressure: ${pressureLabel}`;
  tempoFB.textContent    = `Tempo: ${tempo}`;

  animFrame = requestAnimationFrame(analyseLoop);
}

