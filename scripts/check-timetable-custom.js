const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const cache = new Map();
global.wx = {
  getStorageSync(key) { return key === "easy-swu:timetable-course-color:v1" ? "#f1c9c1" : null; },
};
function load(relative) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const filename = path.resolve(root, relative);
  const source = fs.readFileSync(filename, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  cache.set(relative, module);
  new Function("module", "exports", "require", js)(module, module.exports, (id) => {
    if (id === "../store/session") return { getSession: () => ({ user: { id: 7 } }) };
    return load(path.relative(root, path.resolve(path.dirname(filename), id + ".ts")));
  });
  return module.exports;
}

const { dominantEdgeColor, imageEdgeColors, customFillIsVertical, readableBackgroundText, loadCustomColor, CUSTOM_COLORS } = load("data/timetable-custom.ts");
const { timetableThemePatch } = load("data/timetable-theme.ts");
assert.equal(CUSTOM_COLORS.length, 15, "five colors should fit on each of three rows");
assert.deepEqual(CUSTOM_COLORS.slice(10), ["#f6d9d2", "#f5e7c9", "#dcebdc", "#d8eaf0", "#e7ddf0"]);
global.wx.getStorageSync = () => null;
assert.equal(loadCustomColor(), "#0862ad", "reordering must not change the default course color");
const pixels = new Uint8ClampedArray(5 * 5 * 4);
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
  const color = y === 0 ? [240, 16, 16] : y === 4 ? [16, 16, 240]
    : x === 0 ? [16, 240, 16] : x === 4 ? [240, 240, 240] : [0, 0, 0];
  pixels.set([...color, 255], (y * 5 + x) * 4);
}
assert.equal(dominantEdgeColor(pixels, 5, 5, "top"), "#f01010");
assert.equal(dominantEdgeColor(pixels, 5, 5, "bottom"), "#1010f0");
assert.equal(dominantEdgeColor(pixels, 5, 5, "left"), "#10f010");
assert.equal(dominantEdgeColor(pixels, 5, 5, "right"), "#f0f0f0");
global.wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 800 });
assert.equal(customFillIsVertical({ width: 1200, height: 500 }), true);
assert.equal(customFillIsVertical({ width: 300, height: 1200 }), false);
global.wx.createOffscreenCanvas = ({ width, height }) => {
  let sourceX = 0, sourceY = 0;
  return {
    createImage: () => ({ width: 5, height: 5,
      set src(_path) { setImmediate(() => this.onload()); },
    }),
    getContext: () => ({
      drawImage(_image, x, y, sourceWidth, sourceHeight, _dx, _dy, destinationWidth, destinationHeight) {
        assert.equal(sourceWidth, width);
        assert.equal(sourceHeight, height);
        assert.equal(destinationWidth, width);
        assert.equal(destinationHeight, height);
        sourceX = x; sourceY = y;
      },
      getImageData(x, y, w, h) {
        assert.equal(w, width);
        assert.equal(h, height);
        const strip = new Uint8ClampedArray(w * h * 4);
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++)
          strip.set(pixels.slice(((sourceY + y + dy) * 5 + sourceX + x + dx) * 4, ((sourceY + y + dy) * 5 + sourceX + x + dx + 1) * 4), (dy * w + dx) * 4);
        return { data: strip };
      },
    }),
  };
};

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  return channels.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
for (const color of CUSTOM_COLORS) {
  global.wx.getStorageSync = (key) => key === "easy-swu:timetable-course-color:v1" ? color : null;
  const patch = timetableThemePatch("custom", "#111214");
  assert.equal(patch.timetableThemeId, "custom");
  const text = patch.themeStyle.match(/--timetable-course-blue-text:(#[0-9a-f]{6})/)[1];
  const a = luminance(color), b = luminance(text);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, color);
}
for (const color of ["#000000", "#ffffff", "#f01010", "#1010f0", "#10f010", "#f0f0f0", ...CUSTOM_COLORS]) {
  const text = readableBackgroundText(color);
  assert.ok(text === "#000000" || text === "#ffffff");
  const a = luminance(color), b = luminance(text);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `background text on ${color}`);
}
const pageScript = fs.readFileSync(path.join(root, "features/pages/timetable/index.ts"), "utf8");
const pageMarkup = fs.readFileSync(path.join(root, "features/pages/timetable/index.wxml"), "utf8");
const pageStyle = fs.readFileSync(path.join(root, "features/pages/timetable/index.wxss"), "utf8");
assert.ok(pageScript.includes("--timetable-custom-header-text") && pageScript.includes("--timetable-custom-scale-text"));
assert.ok(pageStyle.includes(".timetable-theme--custom .period-time") && pageStyle.includes(".timetable-theme--custom .grid-day-head"));
assert.match(pageMarkup, /wx:if="\{\{customImagePath\}\}"[^>]*bindtap="activateSavedBackground"/);
assert.match(pageMarkup, /class="custom-saved-background-image" src="\{\{customImagePath\}\}"/);
assert.match(pageScript, /activateSavedBackground\(\)\s*\{[^}]*activateCustomTheme\(\)/);
assert.match(pageScript, /customMenuHeight\(!!this\.data\.customImagePath\)/);
assert.match(pageScript, /CUSTOM_MENU_WITH_IMAGE_HEIGHT = 558/);
assert.match(pageMarkup, /wx:for="\{\{customColors\}\}"[^>]*class="custom-color-slot"/);
assert.match(pageStyle, /\.custom-color-slot\s*\{[^}]*flex:\s*0 0 20%/);
const warmed = [];
let backgroundVersion = "v1";
global.wx.getStorageSync = (key) => key === "easy-swu:timetable-custom:v2:7" ? {
  version: backgroundVersion,
  filePath: `wxfile://${backgroundVersion}.jpg`,
  width: 1200, height: 500,
  edges: { top: "#f01010", bottom: "#1010f0", left: "#10f010", right: "#f0f0f0" },
} : null;
global.wx.getImageInfo = ({ src, complete }) => { warmed.push(src); complete(); };
const { preloadTimetableThemeAssets } = load("utils/icon-preload.ts");
preloadTimetableThemeAssets("custom");
preloadTimetableThemeAssets("custom");
backgroundVersion = "v2";
preloadTimetableThemeAssets("custom");
assert.deepEqual(warmed, ["wxfile://v1.jpg", "wxfile://v2.jpg"]);
imageEdgeColors("test.jpg").then((image) => {
  assert.deepEqual(image, { width: 5, height: 5, edges: {
    top: "#f01010", bottom: "#1010f0", left: "#10f010", right: "#f0f0f0",
  } });
  console.log("Custom timetable edge color and course contrast checks passed.");
}).catch((error) => { console.error(error); process.exitCode = 1; });
