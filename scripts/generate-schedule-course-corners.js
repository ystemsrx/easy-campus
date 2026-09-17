const fs = require("node:fs");
const path = require("node:path");

// Match the plan corner path exactly; only the stroke follows each course tone.
const colors = {
  blue: "#c8896c",
  cyan: "#77aaa2",
  purple: "#a895c5",
  green: "#9daf84",
  orange: "#d5a65d",
  rose: "#d397a7",
  yellow: "#c7b463",
  mint: "#8dbba0",
};
const output = path.resolve(__dirname, "../miniprogram/assets/images");
for (const size of [24, 30]) {
  for (const [tone, color] of Object.entries(colors)) {
    const radius = size - 1.5;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">\n  <path d="M1.5 ${size}A${radius} ${radius} 0 0 1 ${size} 1.5" stroke="${color}" stroke-width="3" stroke-dasharray="6 3" stroke-linecap="butt" />\n</svg>\n`;
    fs.writeFileSync(path.join(output, `schedule-course-corner-${tone}-${size}.svg`), svg);
  }
}
