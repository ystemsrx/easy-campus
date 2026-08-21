const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function source(...segments) {
  return fs.readFileSync(
    path.resolve(__dirname, "..", "miniprogram", ...segments),
    "utf8",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadSessionStore(wx, getApp) {
  const output = ts.transpileModule(source("store", "session.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "wx", "getApp", output)(
    moduleRecord,
    moduleRecord.exports,
    wx,
    getApp,
  );
  return moduleRecord.exports;
}

const app = source("app.ts");
const preload = source("services", "primary-tab-preload.ts");
const scheduleRender = source("data", "schedule-render.ts");
const schedulePage = source("pages", "schedule", "index.ts");
const profilePage = source("pages", "profile", "index.ts");
const profileStyles = source("pages", "profile", "index.wxss");
const homePage = source("pages", "home", "index.ts");
const loginPage = source("features", "pages", "login", "index.ts");
const iconPreload = source("utils", "icon-preload.ts");
const sessionStore = source("store", "session.ts");

const storedSession = {
  token: "token",
  tokenType: "Bearer",
  sliding: true,
  loginMode: "campus",
  user: { id: "user", account: "account", name: "同学" },
  credential: { status: "verified", checkedAt: null, errorCode: null },
  signedInAt: 1,
};
const storage = new Map([["easy-swu:session", storedSession]]);
const sessionModule = loadSessionStore(
  {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
  },
  () => undefined,
);
assert(
  sessionModule.getSession()?.token === storedSession.token,
  "App 尚未注册时必须能够从本地存储恢复会话",
);

assert(
  /onShow\(\)\s*\{[\s\S]*foregroundEntryId \+= 1;[\s\S]*beginAutomaticRefreshCycle\(\);[\s\S]*const session = this\.globalData\.session;[\s\S]*setTimeout\(\(\) => preloadPrimaryTabs\(session\), 0\);/.test(
    app,
  ),
  "每次进入前台都必须在 App 注册完成后启动主 Tab 静默预加载",
);
assert(
  sessionStore.includes("return app?.globalData.session || loadSession()") &&
    sessionStore.includes("catch {") &&
    sessionStore.includes("return loadSession();"),
  "App 初始化早期读取会话时必须安全回退到本地存储",
);
assert(
  preload.includes(
    "const timetableSnapshot = loadTimetableSnapshot(account)",
  ) &&
    preload.includes("const timetable = timetableSnapshot?.data || null") &&
    preload.includes("loadScheduleData(account)") &&
    preload.includes("warmSchedule(state)") &&
    preload.includes("state.userPromise = getCurrentUser()") &&
    preload.includes("state.timetablePromise = preloadTimetable(state)") &&
    preload.includes("state.schedulePromise = preloadSchedule(state)"),
  "预加载器必须先准备本地首屏，再并行加载资料、课表和用户日程",
);
assert(
  scheduleRender.includes("prewarmScheduleFirstScreen(") &&
    scheduleRender.includes("buildScheduleWeekView(") &&
    schedulePage.includes("getPrewarmedScheduleFirstScreen(account)") &&
    schedulePage.includes("this.setData(prewarmed.view)") &&
    schedulePage.includes("getPreloadedTimetable()") &&
    schedulePage.includes("getPreloadedSchedule()"),
  "日程页必须直接消费启动阶段准备好的首屏和共享请求",
);
assert(
  profilePage.includes("getPreloadedCurrentUser(refresh)") &&
    homePage.includes("getPreloadedCurrentUser(refreshTeaching)") &&
    !profilePage.includes("getCurrentUser()") &&
    !homePage.includes("getCurrentUser()"),
  "首页与我的页面必须复用同一份个人资料请求",
);
assert(
  homePage.includes("getPreloadedTimetable()") &&
    loginPage.includes("preloadPrimaryTabs(session)") &&
    loginPage.includes("getPreloadedCurrentUser()"),
  "首页和登录完成后的流程必须接入同一预加载周期",
);
const profilePageSettle =
  profileStyles.match(/@keyframes profile-page-settle\s*\{[\s\S]*?\n\}/)?.[0] ||
  "";
const profileItemSettle =
  profileStyles.match(/@keyframes profile-item-settle\s*\{[\s\S]*?\n\}/)?.[0] ||
  "";
assert(
  homePage.includes("function preloadNextPrimaryTabFramework(): void") &&
    /activateHomeAfterFirstFrame\(\)[\s\S]*?preloadNextPrimaryTabFramework\(\);/.test(
      homePage,
    ) &&
    profilePage.includes(
      "const INITIAL_PROFILE_PREFERENCES = loadPreferences();",
    ) &&
    profilePage.includes("...INITIAL_PROFILE_APPEARANCE") &&
    profilePage.includes("syncWindowBackground(appearance.theme);") &&
    profileStyles.includes("animation-name: profile-page-settle;") &&
    profileStyles.includes("animation-name: profile-item-settle;") &&
    profilePageSettle.length > 0 &&
    profileItemSettle.length > 0 &&
    !profilePageSettle.includes("opacity") &&
    !profileItemSettle.includes("opacity"),
  "首页必须预热下一张 Skyline 页面，个人页首帧必须直接显示正确主题且不得透明入场",
);
assert(
  app.includes("preloadPrimaryTabAssets();") &&
    iconPreload.includes("export function preloadPrimaryTabAssets()") &&
    iconPreload.includes("schedule-dashed-corner-24.svg") &&
    iconPreload.includes("schedule-dashed-corner-30.svg") &&
    iconPreload.includes("log-out-danger.svg") &&
    iconPreload.includes("chevron-right-muted.svg") &&
    iconPreload.includes("user-round-muted.svg") &&
    iconPreload.includes("const PRELOAD_CONCURRENCY = 4;") &&
    !iconPreload.includes("ICON_NAMES") &&
    !iconPreload.includes("allIconPaths") &&
    !iconPreload.includes("wx.preloadSkylineView") &&
    !iconPreload.includes("wx.preloadAssets"),
  "主 Tab 首绘资源必须定向预热，不得在启动阶段遍历全部 SVG 或请求调试服务器路径",
);

console.log("Primary tab preload checks passed.");
