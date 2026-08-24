const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");

function read(relativePath) {
  return fs.readFileSync(path.join(miniprogramRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypeScriptModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const { identityCardTone } = loadTypeScriptModule("utils/profile.ts");
const profileScript = read("pages/profile/index.ts");
const profileTemplate = read("pages/profile/index.wxml");
const profileStyles = read("pages/profile/index.wxss");

for (const gender of ["男", "男性", "男生", "male", "M", "1"]) {
  assert(
    identityCardTone(gender) === "male",
    `男性值 ${gender} 必须使用淡蓝卡片`,
  );
}
for (const gender of ["女", "女性", "女生", "female", "F", "2"]) {
  assert(
    identityCardTone(gender) === "female",
    `女性值 ${gender} 必须使用淡紫卡片`,
  );
}
assert(
  identityCardTone("") === "neutral" && identityCardTone("未知") === "neutral",
  "缺失或未知性别必须使用中性卡片，不能猜测用户性别",
);

assert(
  profileScript.includes("identityCardTone(user.profile.gender)") &&
    profileScript.includes('identityCardTone: "neutral"') &&
    profileTemplate.includes(
      "identity-card identity-card--{{identityCardTone}}",
    ),
  "我的页面必须根据当前用户资料切换身份卡片色调，并在账号切换时清空旧色调",
);

assert(
  /\.identity-card--male\s*\{[^}]*background:\s*linear-gradient\(140deg,\s*#f5f9fd,\s*#e9f3fb\)/.test(
    profileStyles,
  ) &&
    /\.identity-card--female\s*\{[^}]*background:\s*linear-gradient\(140deg,\s*#faf7fd,\s*#f1ebf8\)/.test(
      profileStyles,
    ) &&
    /\.identity-card\s*\{[^}]*color:\s*var\(--identity-ink\)/.test(
      profileStyles,
    ) &&
    !/\.identity-account\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255/.test(
      profileStyles,
    ),
  "男女身份卡必须使用非常淡的蓝紫背景，并为浅色卡片保留清晰的深色文字",
);

console.log("Profile identity card checks passed.");
