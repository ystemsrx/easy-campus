const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "progress-ring.ts"),
  "utf8",
);
const appStyles = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "app.wxss"),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleRecord = { exports: {} };
new Function("module", "exports", "require", output)(
  moduleRecord,
  moduleRecord.exports,
  require,
);

const { progressRingSource } = moduleRecord.exports;

function decodeSource(value) {
  return decodeURIComponent(value.replace("data:image/svg+xml,", ""));
}

const partialRing = decodeSource(progressRingSource(75));
assert(
  partialRing.includes('fill="none"') &&
    !partialRing.includes("pathLength") &&
    partialRing.includes('stroke-dasharray="197.92 65.97"'),
  "进度必须使用透明中心的 SVG 圆环，并按真实圆周计算单段弧长",
);

const decimalRing = decodeSource(progressRingSource(87.9));
const decimalDash = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(decimalRing);
assert(decimalDash, "小数平均分必须生成圆环长度");
const filledLength = Number(decimalDash[1]);
const gapLength = Number(decimalDash[2]);
assert(
  Math.abs(filledLength / (filledLength + gapLength) - 0.879) < 0.0001,
  "小数平均分只能生成一段连续进度弧和一个剩余缺口",
);
assert(
  decimalRing.includes(
    '<animate attributeName="stroke-dasharray" from="0 263.89" to="231.96 31.93"',
  ) && decimalRing.includes('dur=".72s"'),
  "圆环必须沿轨迹从零平滑绘制到当前成绩",
);
assert(
  !decodeSource(progressRingSource(87.9, false)).includes("<animate"),
  "减少动态效果时不得播放圆环绘制动画",
);

assert(
  decodeSource(progressRingSource(120)).includes(
    'stroke-dasharray="263.89 0"',
  ),
  "超过 100 分时进度弧不得超过满环",
);

assert(
  decodeSource(progressRingSource(null)).includes('stroke-opacity="0"'),
  "无平均分时只能显示空轨道",
);

assert(
  /\.page\.theme-light\.theme-style-minimal \.score-ring-image,[\s\S]*?\.page\.theme-light\.theme-style-minimal \.average-ring-image \{[\s\S]*?filter:\s*brightness\(0\);/.test(
    appStyles,
  ) &&
    /\.page\.theme-dark\.theme-style-minimal \.score-ring-image,[\s\S]*?\.page\.theme-dark\.theme-style-minimal \.average-ring-image \{[\s\S]*?filter:\s*none;/.test(
      appStyles,
    ),
  "极简模式必须完整保留主页与成绩页圆环，并在浅色下显示黑色、深色下显示白色",
);

console.log("Progress ring checks passed.");
