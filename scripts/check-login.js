const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const loginRoot = path.join(projectRoot, "miniprogram", "pages", "login");
const script = fs.readFileSync(path.join(loginRoot, "index.ts"), "utf8");
const motionScript = fs.readFileSync(path.join(loginRoot, "motion.ts"), "utf8");
const template = fs.readFileSync(path.join(loginRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(loginRoot, "index.wxss"), "utf8");
const loginConfig = fs.readFileSync(path.join(loginRoot, "index.json"), "utf8");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "miniprogram", "app.json"), "utf8"),
);
const appScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "app.ts"),
  "utf8",
);
const companionService = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "services", "companion.ts"),
  "utf8",
);
const authService = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "services", "auth.ts"),
  "utf8",
);
const navigationScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "utils", "navigation.ts"),
  "utf8",
);
const homeScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "home", "index.ts"),
  "utf8",
);
const homeTemplate = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "home", "index.wxml"),
  "utf8",
);
const homeStyles = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "home", "index.wxss"),
  "utf8",
);
const profileScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.ts"),
  "utf8",
);
const profileTemplate = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.wxml"),
  "utf8",
);
const profileStyles = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.wxss"),
  "utf8",
);
const requestScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "services", "request.ts"),
  "utf8",
);
const sessionStore = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "store", "session.ts"),
  "utf8",
);
const appConfigScript = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "config", "app.ts"),
  "utf8",
);
const failures = [];

const loginRoute = "pages/login/index";
const loginInFeaturePackage = (
  appConfig.subPackages ||
  appConfig.subpackages ||
  []
).some(
  (subpackage) =>
    subpackage.root === "features" &&
    (subpackage.pages || []).includes(loginRoute),
);
if (!(appConfig.pages || []).includes(loginRoute) || loginInFeaturePackage) {
  failures.push("登录页必须保留在主包，避免首次认证跳转时分包页面无法渲染");
}

function loadNavigationRuntime({ pages, session, calls }) {
  const output = ts.transpileModule(navigationScript, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  let timerId = 0;
  const wx = {
    navigateTo(options) {
      calls.push(["navigateTo", options.url, options.routeType || ""]);
      options.success?.();
    },
    switchTab(options) {
      calls.push(["switchTab", options.url]);
      pages.splice(0, pages.length, {
        route: "pages/home/index",
        prepareForAuthenticationRequired(onReady) {
          calls.push(["guard", "home"]);
          onReady?.();
        },
      });
      options.success?.();
    },
    reLaunch(options) {
      calls.push(["reLaunch", options.url]);
      pages.splice(0, pages.length, {
        route: "pages/home/index",
        prepareForAuthenticationRequired(onReady) {
          calls.push(["guard", "home"]);
          onReady?.();
        },
      });
      options.success?.();
    },
  };
  const fakeSetTimeout = (callback, delay) => {
    timerId += 1;
    if (delay === 0) callback();
    return timerId;
  };
  new Function(
    "module",
    "exports",
    "require",
    "wx",
    "getCurrentPages",
    "setTimeout",
    "clearTimeout",
    output,
  )(
    moduleRecord,
    moduleRecord.exports,
    (specifier) => {
      if (specifier === "../store/session") {
        return { getSession: () => session };
      }
      throw new Error(`Unexpected navigation dependency: ${specifier}`);
    },
    wx,
    () => pages,
    fakeSetTimeout,
    () => undefined,
  );
  return moduleRecord.exports;
}

{
  const calls = [];
  const pages = [
    {
      route: "pages/home/index",
      prepareForAuthenticationRequired(onReady) {
        calls.push(["guard", "home"]);
        onReady?.();
      },
    },
  ];
  loadNavigationRuntime({ pages, session: null, calls }).goToLogin();
  if (
    JSON.stringify(calls) !==
    JSON.stringify([
      ["guard", "home"],
      ["navigateTo", "/pages/login/index", "easy-swu-auth-fade"],
    ])
  ) {
    failures.push("首页进入登录态前必须先提交匿名保护层，再覆盖打开登录页");
  }
}

{
  const calls = [];
  const pages = [
    {
      route: "pages/profile/index",
      prepareForAuthenticationRequired(onReady) {
        calls.push(["exit", "profile"]);
        onReady?.();
      },
    },
  ];
  const navigation = loadNavigationRuntime({ pages, session: null, calls });
  let releaseCachedHome;
  navigation.registerHomeAuthenticationHost({
    route: "pages/home/index",
    prepareForAuthenticationRequired(onReady) {
      calls.push(["guard", "cached-home"]);
      releaseCachedHome = onReady;
    },
  });
  navigation.goToLogin();
  if (
    JSON.stringify(calls) !==
    JSON.stringify([
      ["guard", "cached-home"],
      ["exit", "profile"],
    ])
  ) {
    failures.push("缓存首页保护层提交前不得开始切换 Tab");
  }
  releaseCachedHome?.();
  if (
    JSON.stringify(calls) !==
    JSON.stringify([
      ["guard", "cached-home"],
      ["exit", "profile"],
      ["switchTab", "/pages/home/index"],
      ["guard", "home"],
      ["navigateTo", "/pages/login/index", "easy-swu-auth-fade"],
    ])
  ) {
    failures.push("退出登录必须先封住缓存首页，不能让首页内容暴露一帧");
  }
}

{
  const calls = [];
  const pages = [
    {
      route: "pages/profile/index",
      prepareForAuthenticationRequired(onReady) {
        calls.push(["exit", "profile"]);
        onReady?.();
      },
    },
  ];
  loadNavigationRuntime({ pages, session: null, calls }).goToLogin();
  if (
    JSON.stringify(calls) !==
    JSON.stringify([
      ["exit", "profile"],
      ["switchTab", "/pages/home/index"],
      ["guard", "home"],
      ["navigateTo", "/pages/login/index", "easy-swu-auth-fade"],
    ])
  ) {
    failures.push("其他页面失效时必须先重建受保护首页，再覆盖打开登录页");
  }
}

const motionOutput = ts.transpileModule(motionScript, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const motionModule = { exports: {} };
new Function("module", "exports", motionOutput)(
  motionModule,
  motionModule.exports,
);
const {
  CRABWALKING_LEG_MS,
  MAX_LOGIN_HANDOFF_DELAY_MS,
  resolveLoginHandoffDelay,
  resolveWalkingPositionRpx,
} = motionModule.exports;

const removedCopy = [
  "账号与密码会按约定",
  "登录会话 90 天滑动有效",
  "登录即代表你已了解",
];
for (const copy of removedCopy) {
  if (template.includes(copy) || script.includes(copy)) {
    failures.push("登录页仍包含已删除文案：" + copy);
  }
}

if (
  !appConfigScript.includes('export const APP_NAME = "西小易";') ||
  !script.includes('import { APP_NAME } from "../../config/app";') ||
  !script.includes("appName: APP_NAME") ||
  !template.includes("欢迎来到{{appName}}")
) {
  failures.push("小程序名称必须使用固定配置并注入登录页");
}

if (
  !template.includes('placeholder="学号"') ||
  template.includes('placeholder="学号 / 用户名"')
) {
  failures.push("登录页账号输入框必须仅提示学号");
}

if (
  !template.includes('placeholder="办事大厅密码"') ||
  !template.includes('aria-label="办事大厅密码"') ||
  template.includes('placeholder="密码"')
) {
  failures.push("登录页密码输入框必须提示办事大厅密码");
}

const passwordIndex = template.indexOf('placeholder="办事大厅密码"');
const agreementIndex = template.indexOf('class="agreement-row"');
const buttonIndex = template.indexOf('class="login-button');
const clawdMarkIndex = template.indexOf('class="login-clawd-mark"');
const headingIndex = template.indexOf('class="login-heading"');
const panelIndex = template.indexOf('class="login-panel"');
if (
  passwordIndex < 0 ||
  agreementIndex <= passwordIndex ||
  buttonIndex <= agreementIndex ||
  !template.includes('data-document="terms" catchtap="openLegalDocument"') ||
  !template.includes('data-document="privacy" catchtap="openLegalDocument"') ||
  !template.includes("我已阅读并同意") ||
  template.includes("登录即代表同意") ||
  !script.includes("openLegalDocument(event:") ||
  !script.includes("/pages/legal/index?document=${document}") ||
  !script.includes("if (!this.data.agreementAccepted)")
) {
  failures.push("协议勾选必须明示同意、链接可独立查阅，并在提交前校验");
}

const buttonStyles = styles.match(/\.login-button\s*\{([\s\S]*?)\}/)?.[1] || "";
const fieldStyles = styles.match(/\.field\s*\{([\s\S]*?)\}/)?.[1] || "";
const heroStyles =
  styles.match(/(?:^|\n)\.login-hero\s*\{([\s\S]*?)\}/)?.[1] || "";
const loginPageStyles =
  styles.match(/(?:^|\n)\.page\.login-page\s*\{([\s\S]*?)\}/)?.[1] || "";
const agreementStyles =
  styles.match(/\.agreement-row\s*\{([\s\S]*?)\}/)?.[1] || "";
const agreementCopyStyles =
  styles.match(/\.agreement-copy\s*\{([\s\S]*?)\}/)?.[1] || "";
const agreementChildStyles =
  styles.match(/\.agreement-copy > text\s*\{([\s\S]*?)\}/)?.[1] || "";
const clawdMarkRowStyles =
  styles.match(/\.login-clawd-mark-row\s*\{([\s\S]*?)\}/)?.[1] || "";
const clawdMarkStyles =
  styles.match(/\.login-clawd-mark\s*\{([\s\S]*?)\}/)?.[1] || "";
const fieldFocusStyles =
  styles.match(/\.field--focus\s*\{([\s\S]*?)\}/)?.[1] || "";
const loginBackgroundExitStyles =
  styles.match(
    /\.login-page--leaving \.login-background,[\s\S]*?\.login-page--leaving \.login-hero\s*\{([\s\S]*?)\}/,
  )?.[1] || "";
const loginPanelExitStyles =
  styles.match(/\.login-page--leaving \.login-panel\s*\{([\s\S]*?)\}/)?.[1] ||
  "";
const loginPanelLeaveKeyframes =
  styles.match(/@keyframes login-panel-leave\s*\{([\s\S]*?)\n\}/)?.[1] || "";
const playMascotStart = script.indexOf("  playMascot(");
const playMascotEnd = script.indexOf(
  "  scheduleMascotTransition(",
  playMascotStart,
);
const playMascotBody = script.slice(playMascotStart, playMascotEnd);
const directSwitchIndex = playMascotBody.indexOf("if (!shouldRestart)");
const blankRestartIndex = playMascotBody.indexOf('mascotSrc: ""');
const startSubmitStart = script.indexOf("  startSubmitMascot() {");
const startSubmitEnd = script.indexOf(
  "  resumeMascotAfterSubmit()",
  startSubmitStart,
);
const startSubmitBody = script.slice(startSubmitStart, startSubmitEnd);
const companionSyncStart = companionService.indexOf(
  "export async function synchronizeCompanionPreferences(",
);
const companionSyncEnd = companionService.indexOf(
  "/** 将刚写入本地的最新设置",
  companionSyncStart,
);
const companionSyncBody = companionService.slice(
  companionSyncStart,
  companionSyncEnd,
);
const loginServiceStart = authService.indexOf("export async function login(");
const loginServiceEnd = authService.indexOf(
  "export async function getCurrentUser(",
  loginServiceStart,
);
const loginServiceBody = authService.slice(loginServiceStart, loginServiceEnd);
if (
  !agreementStyles.includes("flex-wrap: nowrap;") ||
  !agreementStyles.includes("align-items: center;") ||
  !agreementCopyStyles.includes("display: flex;") ||
  !agreementCopyStyles.includes("flex-direction: row;") ||
  !agreementCopyStyles.includes("flex-wrap: nowrap;") ||
  !agreementCopyStyles.includes("white-space: nowrap;") ||
  !agreementChildStyles.includes("flex: none;") ||
  !agreementChildStyles.includes("white-space: nowrap;")
) {
  failures.push("登录页用户协议与隐私政策必须保持单行布局");
}

if (
  headingIndex < 0 ||
  headingIndex >= panelIndex ||
  !styles.includes("min-height: calc(100vh + 80rpx);") ||
  !styles.includes("border-radius: 72rpx 72rpx 0 0;") ||
  !styles.includes("min-height: 550rpx;") ||
  !styles.includes(
    "padding: 78rpx 48rpx calc(64rpx + env(safe-area-inset-bottom));",
  ) ||
  !styles.includes("background: #fff;") ||
  !template.includes('class="login-panel-extension"') ||
  !heroStyles.includes("flex: 1;") ||
  heroStyles.includes("height: calc(") ||
  !styles.includes(".login-page .page-scroll {") ||
  !styles.includes("height: 100vh;") ||
  !fieldFocusStyles.includes("background: #f5e7df;") ||
  !template.includes('class="login-title display-title">Hello!</text>') ||
  !buttonStyles.includes("background: #d97757;") ||
  buttonStyles.includes("linear-gradient")
) {
  failures.push("登录面板必须左右贴边、仅上方圆角，且登录按钮必须使用纯色");
}

if (
  !template.includes('class="login-toast login-toast--{{errorToastPhase}}"') ||
  template.includes('class="inline-error"') ||
  !template.includes(
    '<navigation-bar cover="{{false}}" transparent theme="{{theme}}">',
  ) ||
  !script.includes("const ERROR_TOAST_HOLD_MS = 3000;") ||
  !script.includes("const ERROR_TOAST_EXIT_MS = 320;") ||
  !script.includes('return "账号或密码错误";') ||
  !script.includes("consumeSessionInvalidNotice") ||
  !script.includes('this.showErrorToast("会话已失效")') ||
  !requestScript.includes("CREDENTIAL_INVALIDATION_CODES") ||
  !requestScript.includes("queueSessionInvalidNotice()") ||
  !sessionStore.includes("SESSION_INVALID_NOTICE_TTL_MS = 15_000") ||
  (script.match(/this\.showErrorToast\(/g) || []).length < 3 ||
  !styles.includes("position: fixed;") ||
  !styles.includes("top: 50%;") ||
  !styles.includes("left: 50%;") ||
  !styles.includes("border-radius: 999rpx;") ||
  !styles.includes("background: rgba(10, 12, 16, 0.62);") ||
  !styles.includes("transform: translate(-50%, -50%) scale(0.94);") ||
  !styles.includes("@keyframes login-toast-in") ||
  !styles.includes("@keyframes login-toast-out")
) {
  failures.push(
    "登录页所有错误必须以屏幕中央的半透明黑色胶囊提示，停留 3 秒后渐出",
  );
}

if (
  !script.includes('Math.random() < 0.5 ? "laptop" : "lurking"') ||
  !script.includes("elapsed % LAPTOP_DURATION_MS") ||
  !script.includes('"mascot-motion--walk-leg"') ||
  !script.includes('this.playMascot("magnifier"') ||
  !script.includes('this.playMascot("waving"') ||
  !script.includes('this.playMascot("dancing"') ||
  !motionScript.includes("export const LURKING_DURATION_MS = 5580;") ||
  !script.includes("elapsed % LURKING_DURATION_MS") ||
  !script.includes("LURKING_DURATION_MS - lurkingCycleTime") ||
  !script.includes("this.startCrabwalkingMascot();") ||
  !script.includes('this.playMascot("waving", "mascot-position--middle")') ||
  !script.includes("const shouldRestart = currentMascot === mascot;") ||
  directSwitchIndex < 0 ||
  blankRestartIndex < 0 ||
  directSwitchIndex >= blankRestartIndex ||
  !motionScript.includes("export const CRABWALKING_LEG_MS = 1660;") ||
  !styles.includes("bottom: calc(100% - 2rpx);") ||
  !styles.includes("width: 380rpx;") ||
  !styles.includes("left: -28rpx;") ||
  !styles.includes(".mascot-position--middle {") ||
  !styles.includes("animation-duration: 1660ms;") ||
  !styles.includes("animation-timing-function: linear;") ||
  !styles.includes("bottom: 164rpx;") ||
  !fieldStyles.includes("margin-top: 30rpx;") ||
  !agreementStyles.includes("margin-top: 36rpx;") ||
  !buttonStyles.includes("margin-top: 46rpx;") ||
  !styles.includes("font-size: 30rpx;") ||
  !styles.includes("19.9% {")
) {
  failures.push("登录页必须保留两组随机动画及其输入、提交衔接状态");
}

const clawdMarkPath = path.join(
  projectRoot,
  "miniprogram",
  "assets",
  "login",
  "clawd-mark.svg",
);
const clawdMarkSource = fs.existsSync(clawdMarkPath)
  ? fs.readFileSync(clawdMarkPath, "utf8")
  : "";
if (
  !template.includes('class="login-clawd-mark-row"') ||
  !template.includes('src="/assets/login/clawd-mark.svg"') ||
  clawdMarkIndex <= buttonIndex ||
  !clawdMarkSource.includes('viewBox="0 0 68 67"') ||
  !clawdMarkRowStyles.includes("min-height: 134rpx;") ||
  !clawdMarkRowStyles.includes("margin-top: 64rpx;") ||
  !agreementStyles.includes("width: 100%;") ||
  !clawdMarkStyles.includes("right: -48rpx;") ||
  !clawdMarkStyles.includes("width: 136rpx;") ||
  !clawdMarkStyles.includes("height: 134rpx;") ||
  !clawdMarkStyles.includes("transform: translateX(25%);") ||
  !clawdMarkStyles.includes("pointer-events: none;")
) {
  failures.push("Clawd 标志必须位于登录按钮下方，且四分之一越过右侧边缘");
}

const midpointElapsed = CRABWALKING_LEG_MS * (0.199 + (1 - 0.199) * 0.5);
const fastHandoffDelay = resolveLoginHandoffDelay(0, 100, false);
const slowHandoffDelay = resolveLoginHandoffDelay(0, 2000, false);
const reducedHandoffDelay = resolveLoginHandoffDelay(0, 100, true);
if (
  Math.abs(resolveWalkingPositionRpx(-380, 0) + 380) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(-380, CRABWALKING_LEG_MS * 0.199) + 380) >
    0.001 ||
  Math.abs(resolveWalkingPositionRpx(-380, midpointElapsed) + 190) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(-380, CRABWALKING_LEG_MS)) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(0, CRABWALKING_LEG_MS) - 380) > 0.001 ||
  MAX_LOGIN_HANDOFF_DELAY_MS !== 120 ||
  fastHandoffDelay !== MAX_LOGIN_HANDOFF_DELAY_MS ||
  slowHandoffDelay !== 0 ||
  reducedHandoffDelay !== 0 ||
  !startSubmitBody.includes('currentMascot === "crabwalking"') ||
  !startSubmitBody.includes("resolveWalkingPositionRpx(") ||
  !startSubmitBody.includes('currentMascot === "waving"') ||
  startSubmitBody.includes(
    'this.playMascot("waving", "mascot-position--right")',
  ) ||
  !template.includes('style="{{mascotPositionStyle}}"')
) {
  failures.push("提交动画必须冻结点击瞬间的位置，再原地切换到挥手动画");
}

if (
  !motionScript.includes("export const LOGIN_ROUTE_LEAD_MS = 100;") ||
  !motionScript.includes("export const MAX_LOGIN_HANDOFF_DELAY_MS = 120;") ||
  !script.includes("async beginHomeTransition(): Promise<boolean>") ||
  !script.includes("routingToHome = true;") ||
  !script.includes("if (pageActive && !routingToHome)") ||
  !script.includes("await this.beginHomeTransition()") ||
  !script.includes(
    "const INITIAL_LOGIN_APPEARANCE = resolveAppearance(loadPreferences());",
  ) ||
  !script.includes("syncWindowBackground(appearance);") ||
  !script.includes("function dismissLoginKeyboard(): void") ||
  !script.includes("dismissLoginKeyboard();") ||
  !script.includes('loginScrollAnchor: "login-stage"') ||
  !template.includes('id="login-stage"') ||
  !template.includes('scroll-into-view="{{loginScrollAnchor}}"') ||
  !styles.includes("background-color: var(--color-bg);") ||
  !script.includes("playAuthenticatedExit(onReady: () => void)") ||
  !script.includes("const LOGIN_EXIT_ROUTE_LEAD_MS = 360;") ||
  !script.includes("const LOGIN_REDUCED_EXIT_ROUTE_LEAD_MS = 16;") ||
  !script.includes("const LOGIN_EXIT_COMMIT_TIMEOUT_MS = 800;") ||
  !script.includes("const routeLead =") ||
  !script.includes('loginHandoffClass: "login-page--leaving"') ||
  !template.includes("{{loginHandoffClass}}") ||
  !template.includes('class="login-background"') ||
  !template.includes('class="login-navigation"') ||
  !styles.includes(".login-page--leaving .page-scroll {") ||
  !styles.includes(".login-page--leaving .login-background,") ||
  !styles.includes(".login-page--leaving .login-panel {") ||
  !styles.includes("animation-name: login-background-leave;") ||
  !styles.includes("animation-name: login-panel-leave;") ||
  !loginPageStyles.includes("background-color: transparent;") ||
  !loginBackgroundExitStyles.includes("animation-duration: 300ms;") ||
  !loginBackgroundExitStyles.includes(
    "animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);",
  ) ||
  !loginPanelExitStyles.includes("animation-duration: 320ms;") ||
  !loginPanelExitStyles.includes("animation-delay: 20ms;") ||
  !loginPanelExitStyles.includes(
    "animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);",
  ) ||
  !loginPanelLeaveKeyframes.includes("transform: translateY(150rpx);") ||
  !loginPanelLeaveKeyframes.includes("opacity: 0;") ||
  styles.includes("animation-name: login-page-leave;") ||
  !styles.includes("transform: translateY(150rpx);") ||
  !styles.includes("page {") ||
  !styles.includes("background-color: transparent;") ||
  !loginConfig.includes('"backgroundColorContent": "#ffffff00"') ||
  !companionSyncBody.includes(
    "await queueLocalCompanionPreferences(account, true)",
  ) ||
  !loginServiceBody.includes("void synchronizeCompanionPreferences(") ||
  loginServiceBody.includes(
    "data.user.companion = await synchronizeCompanionPreferences(",
  ) ||
  template.includes("login-transition-surface") ||
  styles.includes("login-transition-surface") ||
  script.includes("leaving: false")
) {
  failures.push(
    "登录成功后必须收起键盘、保持同色提交态，并让可选同步在后台执行",
  );
}

if (
  !script.includes("function homePageBelowLogin(): PreparedHomePage | null") ||
  !script.includes("preparedHome.prepareForAuthenticatedReveal(startExit)") ||
  !script.includes("switchToHome(onFailure);") ||
  script.includes("wx.navigateBack({") ||
  !/query\?\.standalone !== "1" && !homePageBelowLogin\(\)[\s\S]*?wx\.reLaunch\(\{[\s\S]*?url: "\/pages\/home\/index"/.test(
    script,
  ) ||
  !navigationScript.includes('const HOME_ROUTE = "pages/home/index";') ||
  !navigationScript.includes(
    'export const LOGIN_ROUTE_TYPE = "easy-swu-auth-fade";',
  ) ||
  !navigationScript.includes("registerAuthenticationRoute(): void") ||
  !navigationScript.includes("handlePrimaryAnimation") ||
  !navigationScript.includes("opacity: primaryAnimation.value") ||
  !navigationScript.includes("opaque: false") ||
  !appScript.includes("registerAuthenticationRoute();") ||
  !navigationScript.includes("function navigateToLogin(): void") ||
  !navigationScript.includes("routeType: LOGIN_ROUTE_TYPE") ||
  !navigationScript.includes("function switchToGuardedHome(): void") ||
  !navigationScript.includes("wx.switchTab({") ||
  !navigationScript.includes("registerHomeAuthenticationHost(") ||
  !navigationScript.includes("unregisterHomeAuthenticationHost(") ||
  !navigationScript.includes("prepareCachedHomeForAuthenticationRequired(") ||
  !navigationScript.includes("function openLoginOverHome(): void") ||
  !navigationScript.includes(
    "page.prepareForAuthenticationRequired(navigate)",
  ) ||
  !navigationScript.includes("wx.navigateTo({") ||
  !navigationScript.includes("url: LOGIN_URL") ||
  !homeScript.includes(
    "prepareForAuthenticationRequired(onReady?: () => void)",
  ) ||
  !homeScript.includes("registerHomeAuthenticationHost(this);") ||
  !homeScript.includes("unregisterHomeAuthenticationHost(this);") ||
  !homeScript.includes("wx.nextTick(() => onReady?.());") ||
  !homeScript.includes("prepareForAuthenticatedReveal(onReady?: () => void)") ||
  !homeScript.includes("authenticationRevealPrepared = true;") ||
  !homeTemplate.includes("home-framework--guarded") ||
  !homeTemplate.includes(
    'wx:if="{{!authenticated}}" class="home-auth-guard"',
  ) ||
  !homeTemplate.includes('class="home-auth-login-stage"') ||
  !homeTemplate.includes("欢迎来到{{appName}}") ||
  !homeStyles.includes(".home-framework--guarded {") ||
  !homeStyles.includes("visibility: hidden;") ||
  !homeStyles.includes("animation-name: home-auth-login-backdrop-in;") ||
  !profileScript.includes(".finally(() => {") ||
  !profileScript.includes(
    "if (!getSession() || isSessionLeaseCurrent(lease)) goToLogin();",
  ) ||
  !profileScript.includes(
    "prepareForAuthenticationRequired(onReady?: () => void)",
  ) ||
  !profileScript.includes('authenticationExitClass: "profile-page--leaving"') ||
  !profileTemplate.includes("{{authenticationExitClass}}") ||
  !profileTemplate.includes('class="profile-auth-login-backdrop"') ||
  !profileTemplate.includes("欢迎来到{{appName}}") ||
  !profileTemplate.includes("{{loggingOut ? '退出中' : '退出登录'}}") ||
  !profileStyles.includes(".profile-page--leaving .page-scroll {") ||
  !profileStyles.includes("animation-name: profile-auth-exit;") ||
  !profileStyles.includes("animation-name: profile-auth-login-backdrop-in;")
) {
  failures.push(
    "退出时必须先显示静止渐入的登录背景与标题，仅让表单面板从底部进入",
  );
}

if (
  !script.includes("function preloadHomeFramework(): void") ||
  !script.includes('typeof wx.preloadSkylineView !== "function"') ||
  !script.includes("wx.preloadSkylineView();") ||
  !/onLoad\([^)]*\)[\s\S]*?this\.applyAppearance\(\);[\s\S]*?if \(isAuthenticated\(\)\) \{\s*preloadHomeFramework\(\);/.test(
    script,
  ) ||
  !/onReady\(\)\s*\{\s*preloadHomeFramework\(\);\s*\}/.test(script)
) {
  failures.push("登录页和已有会话直达路径都必须预加载首页 Skyline 运行环境");
}

const animationRoot = path.join(projectRoot, "miniprogram", "assets", "login");
let animationBytes = 0;
for (const name of [
  "laptop",
  "magnifier",
  "lurking",
  "crabwalking",
  "waving",
  "dancing",
]) {
  const filePath = path.join(animationRoot, name + ".gif");
  if (!fs.existsSync(filePath)) {
    failures.push("缺少登录动画：" + name + ".gif");
    continue;
  }
  const source = fs.readFileSync(filePath);
  animationBytes += source.length;
  if (
    source.length < 10 ||
    source.readUInt16LE(6) !== 275 ||
    source.readUInt16LE(8) !== 185
  ) {
    failures.push(name + ".gif 必须是优化后的 275×185 动画");
  }
  if (
    name === "lurking" &&
    !source.includes(Buffer.from("NETSCAPE2.0", "ascii"))
  ) {
    failures.push("lurking.gif 必须在用户尚未输入时持续循环");
  }
}

if (animationBytes > 250 * 1024) {
  failures.push("登录动画总大小必须控制在 250 KiB 内，避免挤占小程序主包");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Login page checks passed.");
}
