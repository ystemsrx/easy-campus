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
const sessionStore = fs.readFileSync(
  path.join(miniprogramRoot, "store", "session.ts"),
  "utf8",
);
const loginScript = fs.readFileSync(
  path.join(miniprogramRoot, "features", "pages", "login", "index.ts"),
  "utf8",
);
const failures = [];

if (!/const VISIBLE_DURATION_MS = 3000;/.test(componentScript)) {
  failures.push("429 胶囊必须在渐入完成后完整显示 3 秒");
}
if (!/访问速度太快了/.test(componentTemplate)) {
  failures.push("429 胶囊文案必须为“访问速度太快了”");
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
  !/showRateLimitToast\(\)/.test(requestScript) ||
  !/if \(isRateLimitError\(error\)\) return "";/.test(requestScript)
) {
  failures.push("429 必须统一触发胶囊并阻止服务端英文文案进入页面错误态");
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
  if (!/<rate-limit-toast id="rate-limit-toast">/.test(template)) {
    failures.push(`${page}.wxml: 缺少全局 429 胶囊`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Rate-limit feedback checks passed.");
