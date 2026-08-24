const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");

function read(relativePath) {
  return fs.readFileSync(path.join(miniprogramRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const appTypes = read("types/app.ts");
const preferencesStore = read("store/preferences.ts");
const profileScript = read("pages/profile/index.ts");
const profileTemplate = read("pages/profile/index.wxml");
const personalizationScript = read("features/pages/personalization/index.ts");
const personalizationTemplate = read(
  "features/pages/personalization/index.wxml",
);
const appConfig = JSON.parse(read("app.json"));
const featurePackage = appConfig.subPackages.find(
  (subpackage) => subpackage.root === "features",
);

assert(
  appTypes.includes('theme: "light"') &&
    preferencesStore.includes("isThemePreference(stored.theme)") &&
    preferencesStore.includes(": DEFAULT_PREFERENCES.theme"),
  "新用户必须默认使用浅色主题，已有合法主题选择必须继续保留",
);

assert(
  profileTemplate.includes(">个性化</text>") &&
    profileTemplate.includes('bindtap="openPersonalizationSettings"') &&
    profileScript.includes("this.openProfileRoute(") &&
    profileScript.includes('"/features/pages/personalization/index",') &&
    !profileTemplate.includes('class="appearance-control"') &&
    !profileTemplate.includes('bindchange="onReducedMotionChange"') &&
    !profileTemplate.includes('bindchange="onHapticsChange"'),
  "我的页面必须只保留个性化入口，不得继续内嵌外观与交互控件",
);

assert(
  featurePackage?.pages.includes("pages/personalization/index") &&
    personalizationTemplate.includes('title="个性化"') &&
    personalizationTemplate.includes(">外观</text>") &&
    personalizationTemplate.includes(">减少动态效果</text>") &&
    personalizationTemplate.includes(">触感反馈</text>") &&
    personalizationTemplate.includes('checked="{{reducedMotion}}"') &&
    personalizationTemplate.includes('checked="{{haptics}}"') &&
    personalizationScript.indexOf('{ value: "light", label: "浅色" }') <
      personalizationScript.indexOf('{ value: "system", label: "跟随系统" }') &&
    personalizationScript.includes("updatePreferences({ theme });") &&
    personalizationScript.includes(
      "updatePreferences({ reducedMotion: event.detail.value });",
    ) &&
    personalizationScript.includes("updatePreferences({ haptics: true });") &&
    personalizationScript.includes("syncWindowBackground(appearance.theme);"),
  "个性化页面必须完整承接主题、动态效果和触感设置并即时应用",
);

console.log("Personalization settings checks passed.");
