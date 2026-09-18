const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(__dirname, "../miniprogram/services/session-device-info.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function collect(wx) {
  const module = { exports: {} };
  const requireStub = () => ({});
  new Function("require", "module", "exports", "wx", compiled)(
    requireStub,
    module,
    module.exports,
    wx,
  );
  return module.exports.collectSessionDeviceInfo();
}

const info = collect({
  getDeviceInfo: () => ({
    brand: " Apple ",
    model: "iPhone",
    system: "iOS 18",
    cpuType: null,
    memorySize: 8192,
  }),
  getWindowInfo: () => ({
    screenWidth: 393,
    screenHeight: 852,
    pixelRatio: 3,
    safeArea: { top: 59, right: 393, bottom: 818, left: 0 },
  }),
  getAppBaseInfo: () => ({ version: "8.0.60", language: "zh_CN" }),
});
assert.equal(info.brand, "Apple");
assert.equal(info.memorySize, "8192");
assert.equal(info.screenWidth, 1179);
assert.equal(info.screenHeight, 2556);
assert.equal(info.cpuType, null);
assert.equal(info.wechatLanguage, "zh_CN");

const unavailable = collect({
  getDeviceInfo: () => ({ brand: { unexpected: true }, memorySize: false }),
  getWindowInfo: () => null,
  getAppBaseInfo: () => {
    throw new Error("unavailable");
  },
});
assert.equal(unavailable.brand, null);
assert.equal(unavailable.memorySize, null);
assert.equal(unavailable.pixelRatio, null);
assert.equal(unavailable.wechatVersion, null);

console.log("Session device information checks passed.");
