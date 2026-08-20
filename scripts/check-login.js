const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const loginRoot = path.join(projectRoot, "miniprogram", "pages", "login");
const script = fs.readFileSync(path.join(loginRoot, "index.ts"), "utf8");
const motionScript = fs.readFileSync(path.join(loginRoot, "motion.ts"), "utf8");
const template = fs.readFileSync(path.join(loginRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(loginRoot, "index.wxss"), "utf8");
const envExample = fs.readFileSync(
  path.join(projectRoot, ".env.example"),
  "utf8",
);
const failures = [];

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
  !envExample.includes("MINIPROGRAM_NAME=") ||
  !script.includes('import { MINIPROGRAM_NAME } from "../../config/env";') ||
  !script.includes("appName: MINIPROGRAM_NAME") ||
  !template.includes("欢迎来到{{appName}}")
) {
  failures.push("小程序名称必须从 frontend/.env 生成并注入登录页");
}

const passwordIndex = template.indexOf('placeholder="密码"');
const agreementIndex = template.indexOf('class="agreement-row"');
const buttonIndex = template.indexOf('class="login-button');
const headingIndex = template.indexOf('class="login-heading"');
const panelIndex = template.indexOf('class="login-panel"');
if (
  passwordIndex < 0 ||
  agreementIndex <= passwordIndex ||
  buttonIndex <= agreementIndex ||
  !template.includes('class="agreement-link">《用户协议》') ||
  !template.includes('class="agreement-link">《隐私政策》') ||
  !script.includes("if (!this.data.agreementAccepted)")
) {
  failures.push("协议勾选必须位于密码框与登录按钮之间并参与提交校验");
}

const buttonStyles = styles.match(/\.login-button\s*\{([\s\S]*?)\}/)?.[1] || "";
const fieldStyles = styles.match(/\.field\s*\{([\s\S]*?)\}/)?.[1] || "";
const agreementStyles =
  styles.match(/\.agreement-row\s*\{([\s\S]*?)\}/)?.[1] || "";
const fieldFocusStyles =
  styles.match(/\.field--focus\s*\{([\s\S]*?)\}/)?.[1] || "";
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
  !template.includes(
    'class="login-toast login-toast--{{errorToastPhase}}"',
  ) ||
  template.includes('class="inline-error"') ||
  !template.includes(
    '<navigation-bar cover="{{false}}" transparent theme="{{theme}}">',
  ) ||
  !script.includes("const ERROR_TOAST_HOLD_MS = 3000;") ||
  !script.includes("const ERROR_TOAST_EXIT_MS = 320;") ||
  !script.includes('return "账号或密码错误";') ||
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
  failures.push("登录页所有错误必须以屏幕中央的半透明黑色胶囊提示，停留 3 秒后渐出");
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

const midpointElapsed =
  CRABWALKING_LEG_MS * (0.199 + (1 - 0.199) * 0.5);
const fastHandoffDelay = resolveLoginHandoffDelay(0, 100, false);
const slowHandoffDelay = resolveLoginHandoffDelay(0, 2000, false);
const reducedHandoffDelay = resolveLoginHandoffDelay(0, 100, true);
if (
  Math.abs(resolveWalkingPositionRpx(-380, 0) + 380) > 0.001 ||
  Math.abs(
    resolveWalkingPositionRpx(-380, CRABWALKING_LEG_MS * 0.199) + 380,
  ) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(-380, midpointElapsed) + 190) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(-380, CRABWALKING_LEG_MS)) > 0.001 ||
  Math.abs(resolveWalkingPositionRpx(0, CRABWALKING_LEG_MS) - 380) > 0.001 ||
  fastHandoffDelay !== 1210 ||
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
  !script.includes("async beginHomeTransition(): Promise<boolean>") ||
  !script.includes("routingToHome = true;") ||
  !script.includes("if (pageActive && !routingToHome)") ||
  !script.includes("await this.beginHomeTransition()") ||
  !script.includes(
    "const INITIAL_LOGIN_APPEARANCE = resolveAppearance(loadPreferences());",
  ) ||
  !script.includes("syncWindowBackground(appearance.theme);") ||
  template.includes("login-transition-surface") ||
  styles.includes("login-transition-surface") ||
  script.includes("leaving: false")
) {
  failures.push("登录成功后必须保持提交态，并在目标动画结束前直接切换到同色首页");
}

if (
  !script.includes("function preloadHomeFramework(): void") ||
  !script.includes('typeof wx.preloadSkylineView !== "function"') ||
  !script.includes("wx.preloadSkylineView();") ||
  !/onLoad\(\)[\s\S]*?this\.applyAppearance\(\);[\s\S]*?if \(isAuthenticated\(\)\) \{\s*preloadHomeFramework\(\);/.test(
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
