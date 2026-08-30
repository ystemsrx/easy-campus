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
const appStyles = read("app.wxss");
const homeTemplate = read("pages/home/index.wxml");
const homeStyles = read("pages/home/index.wxss");
const personalizationStyles = read(
  "features/pages/personalization/index.wxss",
);
const tabBarTemplate = read("custom-tab-bar/index.wxml");
const tabBarStyles = read("custom-tab-bar/index.wxss");
const navigationStyles = read("components/navigation-bar/navigation-bar.wxss");
const passRateStyles = read("components/pass-rate-card/pass-rate-card.wxss");
const geometricPetStyles = read("components/geometric-pet/geometric-pet.wxss");
const petPickerStyles = read("components/pet-picker-drawer/pet-picker-drawer.wxss");
const timetableTemplate = read("features/pages/timetable/index.wxml");
const appConfig = JSON.parse(read("app.json"));
const featurePackage = appConfig.subPackages.find(
  (subpackage) => subpackage.root === "features",
);
const pageTemplatePaths = [
  ...appConfig.pages.map((pagePath) => `${pagePath}.wxml`),
  ...(featurePackage?.pages || []).map(
    (pagePath) => `features/${pagePath}.wxml`,
  ),
];
const pageTemplates = pageTemplatePaths.map((pagePath) => ({
  pagePath,
  source: read(pagePath),
}));
const globallyThemedPageTemplates = pageTemplates.filter(
  ({ pagePath }) => pagePath !== "features/pages/timetable/index.wxml",
);
const minimalThemeTokenBlock =
  appStyles.match(/\.page\.theme-style-minimal \{([\s\S]*?)\n\}/)?.[1] || "";

assert(
  appTypes.includes('theme: "light"') &&
    appTypes.includes('visualTheme: "default"') &&
    preferencesStore.includes("isThemePreference(stored.theme)") &&
    preferencesStore.includes("isVisualTheme(stored.visualTheme)") &&
    preferencesStore.includes(": DEFAULT_PREFERENCES.theme"),
  "新用户必须默认使用浅色外观与默认主题，已有合法选择必须继续保留",
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
    personalizationTemplate.includes(">主题</text>") &&
    personalizationTemplate.includes(
      'class="theme-preview theme-preview--{{item.value}}"',
    ) &&
    personalizationTemplate.includes(">减少动态效果</text>") &&
    personalizationTemplate.includes(">触感反馈</text>") &&
    personalizationTemplate.includes('checked="{{reducedMotion}}"') &&
    personalizationTemplate.includes('checked="{{haptics}}"') &&
    personalizationScript.indexOf('{ value: "light", label: "浅色" }') <
      personalizationScript.indexOf('{ value: "system", label: "跟随系统" }') &&
    personalizationScript.includes('{ value: "soft", label: "淡色"') &&
    personalizationScript.includes('{ value: "minimal", label: "极简"') &&
    !personalizationScript.includes("caption:") &&
    !personalizationTemplate.includes("visual-theme-caption") &&
    personalizationScript.includes("updatePreferences({ theme });") &&
    personalizationScript.includes("updatePreferences({ visualTheme });") &&
    personalizationScript.includes(
      "updatePreferences({ reducedMotion: event.detail.value });",
    ) &&
    personalizationScript.includes("updatePreferences({ haptics: true });") &&
    personalizationScript.includes("syncWindowBackground(appearance);"),
  "个性化页面必须完整承接主题、动态效果和触感设置并即时应用",
);

assert(
  globallyThemedPageTemplates.every(({ source }) =>
    source.includes("{{visualThemeClass}}"),
  ) &&
    pageTemplates.every(
      ({ source }) =>
        !source.includes("<rate-limit-toast") ||
        source.includes('visual-theme="{{visualTheme}}"'),
    ) &&
    tabBarTemplate.includes("{{visualThemeClass}}") &&
    !timetableTemplate.includes("{{visualThemeClass}}"),
  "除拥有独立主题系统的课表外，所有页面、限流反馈与底部导航都必须接入全局主题样式",
);

assert(
  appStyles.includes(".page.theme-style-soft") &&
    appStyles.includes(".page.theme-style-minimal") &&
    !appStyles.includes(".page.timetable-page.theme-style-soft") &&
    !appStyles.includes(".page.timetable-page.theme-style-minimal") &&
    appStyles.includes(".page.assistant-page.theme-style-soft") &&
    appStyles.includes("--theme-decoration-display: none") &&
    !appStyles.includes(".page.theme-style-default") &&
    tabBarStyles.includes(".tabbar-shell.theme-style-soft") &&
    tabBarStyles.includes(".tabbar-shell.theme-style-minimal"),
  "淡色与极简主题必须覆盖全局令牌、复杂页面和底部导航，默认主题不得被重写",
);

assert(
  appStyles.includes("--color-bg: #f7fcf8;") &&
    appStyles.includes("--color-pastel-coral: #ffede7;") &&
    appStyles.includes("--world-coral-from: #f7beae;") &&
    appStyles.includes("--world-amber-from: #f4d995;") &&
    appStyles.includes("--world-sage-from: #b5dbc0;") &&
    appStyles.includes("--world-rose-from: #dcc8ed;") &&
    appStyles.includes(".page.theme-style-soft .ambient-blob {") &&
    appStyles.includes("opacity: 0.16;") &&
    homeTemplate.includes("'#f7beae'") &&
    homeTemplate.includes("'#f4d995'") &&
    homeTemplate.includes("'#b5dbc0'") &&
    personalizationStyles.includes("background-color: #f7cabc;") &&
    personalizationStyles.includes("background-color: #e6d7f2;") &&
    appStyles.includes("--theme-art-filter: saturate(0.9);") &&
    !/\n\s*filter:/.test(minimalThemeTokenBlock) &&
    appStyles.includes(".page.theme-style-minimal image {") &&
    !geometricPetStyles.includes("visual-component-art-filter") &&
    !/\n\s*filter:\s*grayscale\(1\)/.test(petPickerStyles) &&
    !appStyles.includes(".page.theme-style-minimal .publication-badge") &&
    timetableTemplate.includes('visual-theme="default"'),
  "淡色必须使用明亮清新的低饱和配色；极简必须保留伙伴、角标和课表自有配色",
);

assert(
  minimalThemeTokenBlock.includes("--color-bg: #f6f6f2;") &&
    minimalThemeTokenBlock.includes("--color-primary: #b6543e;") &&
    minimalThemeTokenBlock.includes("--color-success: #4f755e;") &&
    minimalThemeTokenBlock.includes("--color-accent-blue: #4b6f8d;") &&
    !/\.page\.theme-style-minimal[^\{]*\{[^}]*border-top-(?:width|color):/s.test(
      appStyles,
    ) &&
    appStyles.includes("background-color: var(--color-primary);") &&
    appStyles.includes("background-color: var(--color-accent-blue-soft);") &&
    appStyles.includes("background-color: var(--color-success-soft);") &&
    tabBarStyles.includes("--tab-pill: #b6543e;") &&
    tabBarStyles.includes("--tab-pill: #e0927e;") &&
    personalizationStyles.includes("background-color: #b6543e;") &&
    personalizationStyles.includes("background-color: #eaf2ed;"),
  "极简主题必须保留中性黑白骨架，并用克制的主色与语义色突出选中态、操作和状态",
);

assert(
  appStyles.includes(
    'font-family: Georgia, "Times New Roman", "Songti SC", "Noto Serif SC",',
  ) &&
    appStyles.includes("border: 0;\n  border-radius: 44rpx;") &&
    appStyles.includes(
      "color: #fff;\n  background: linear-gradient(135deg, #d97757, #eba97f);",
    ) &&
    homeStyles.includes("color: #c4552d;") &&
    homeStyles.includes("color: #fff; background: #c0452d;") &&
    tabBarStyles.includes("--tab-pill: #2b2620;") &&
    tabBarStyles.includes("--tab-pill: #f7f3e9;") &&
    navigationStyles.includes(
      'font-family: Georgia, "Times New Roman", "Songti SC", SimSun, serif;',
    ) &&
    passRateStyles.includes(
      "background: linear-gradient(180deg, #c98a2d, #e5b86e);",
    ),
  "默认主题的字体、主色、通知红点、底栏和图表必须保持原有样式",
);

console.log("Personalization settings checks passed.");
