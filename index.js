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