const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, "app.json"), "utf8"),
);
const componentRoot = path.join(
  miniprogramRoot,
  "components",
  "rate-limit-toast",
);
const componentScript = fs.readFileSync(
  path.join(componentRoot, "rate-limit-toast.ts"),
  "utf8",
);
const componentTemplate = fs.readFileSync(
  path.join(componentRoot, "rate-limit-toast.wxml"),
  "utf8",
);
const componentStyles = fs.readFileSync(
  path.join(componentRoot, "rate-limit-toast.wxss"),
  "utf8",
);
const requestScript = fs.readFileSync(
  path.join(miniprogramRoot, "services", "request.ts"),
  "utf8",
);
const authService = fs.readFileSync(
  path.join(miniprogramRoot, "services", "auth.ts"),
  "utf8",
);
const heartbeatService = fs.readFileSync(
  path.join(miniprogramRoot, "services", "heartbeat.ts"),
  "utf8",
);
const teachingService = fs.readFileSync(
  path.join(miniprogramRoot, "services", "teaching.ts"),
  "utf8",
);
const homeScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "home", "index.ts"),
  "utf8",
);
const sessionStore = fs.readFileSync(
  path.join(miniprogramRoot, "store", "session.ts"),
  "utf8",
);
const loginScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "login", "index.ts"),
  "utf8",
);
const failures = [];

if (!/const VISIBLE_DURATION_MS = 3000;/.test(componentScript)) {
  failures.push("429 胶囊必须在渐入完成后完整显示 3 秒");
}
if (
  !/message:\s*"访问速度太快了"/.test(componentScript) ||
  !/\{\{message\}\}/.test(componentTemplate)
) {
  failures.push("429 胶囊必须支持传入文案，并保留默认提示");
}

if (
  !requestScript.includes(
    'export const ACCOUNT_DEACTIVATED_MESSAGE = "账户已停用";',
  ) ||
  !requestScript.includes("return ACCOUNT_DEACTIVATED_MESSAGE;") ||
  !requestScript.includes("redirectAfterAccountDeactivation(") ||
  !sessionStore.includes("queueAccountDeactivatedNotice") ||
  !sessionStore.includes("consumeAccountDeactivatedNotice") ||
  !loginScript.includes("consumeAccountDeactivatedNotice()") ||
  !loginScript.includes("this.showErrorToast(ACCOUNT_DEACTIVATED_MESSAGE)")
) {
  failures.push("账户停用必须退出登录，并复用登录页的统一错误胶囊");
}
if (
  !/top:\s*50%/.test(componentStyles) ||
  !/left:\s*50%/.test(componentStyles) ||
  !/background:\s*rgba\(8, 10, 14, 0\.58\)/.test(componentStyles) ||
  !/opacity 220ms/.test(componentStyles)
) {
  failures.push("429 胶囊必须在屏幕正中以半透明黑色渐入渐出");
}
if (
  !/isRateLimitError\(apiError\)/.test(requestScript) ||
  !/showRateLimitToast\(/.test(requestScript) ||
  !/FEEDBACK_DAILY_LIMITED_MESSAGE/.test(requestScript) ||
  !/if \(isRateLimitError\(error\)\) return "";/.test(requestScript)
) {
  failures.push("429 必须统一触发胶囊并阻止服务端英文文案进入页面错误态");
}

if (
  !requestScript.includes('"SWU_CREDENTIAL_REAUTH_REQUIRED"') ||
  !requestScript.includes('"验证失败，请重新登录小程序"') ||
  !requestScript.includes("credentialReauthFeedback?: boolean") ||
  !requestScript.includes('getSession()?.credential.status === "invalid"') ||
  !requestScript.includes("if (showFeedback)") ||
  !requestScript.includes('if (isCredentialReauthError(error)) return "";') ||
  !authService.includes("allowInvalidCredential: true") ||
  !heartbeatService.includes("allowInvalidCredential: true")
) {
  failures.push("校园凭据失效必须保留本地会话并复用三秒胶囊提示");
}

if (
  !teachingService.includes(
    "query.refresh === true && query.automatic !== true",
  ) ||
  !teachingService.includes("credentialReauthFeedback: refresh") ||
  !homeScript.includes("automatic: true")
) {
  failures.push("自动刷新必须静默拦截，只有手动刷新才提示重新登录");
}

const declaredPages = [
  ...(appConfig.pages || []),
  ...(appConfig.subPackages || []).flatMap((subpackage) =>
    (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`),
  ),
];
for (const page of declaredPages) {
  const template = fs.readFileSync(
    path.join(miniprogramRoot, `${page}.wxml`),
    "utf8",
  );
  if (
    !/<rate-limit-toast\s+id="rate-limit-toast"\s+theme="\{\{theme\}\}"\s+visual-theme="\{\{visualTheme\}\}"\s*>/.test(
      template,
    )
  ) {
    failures.push(`${page}.wxml: 缺少带主题参数的全局 429 胶囊`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Rate-limit feedback checks passed.");
