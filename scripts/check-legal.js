const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");
const legalRoot = path.join(miniprogramRoot, "pages", "legal");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, "app.json"), "utf8"),
);
const content = fs.readFileSync(path.join(legalRoot, "content.ts"), "utf8");
const script = fs.readFileSync(path.join(legalRoot, "index.ts"), "utf8");
const template = fs.readFileSync(path.join(legalRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(legalRoot, "index.wxss"), "utf8");
const loginTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "login", "index.wxml"),
  "utf8",
);
const profileTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "profile", "index.wxml"),
  "utf8",
);
const profileScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "profile", "index.ts"),
  "utf8",
);
const failures = [];

if (!(appConfig.pages || []).includes("pages/legal/index")) {
  failures.push("协议页必须注册在主包，确保登录前可访问");
}

for (const expected of [
  'data-document="terms" catchtap="openLegalDocument"',
  'data-document="privacy" catchtap="openLegalDocument"',
  "我已阅读并同意",
]) {
  if (!loginTemplate.includes(expected)) {
    failures.push(`登录页缺少协议明示同意或独立入口：${expected}`);
  }
}

if (
  !profileTemplate.includes("协议与隐私") ||
  !profileTemplate.includes(
    'data-document="terms" bindtap="openLegalDocument"',
  ) ||
  !profileTemplate.includes(
    'data-document="privacy" bindtap="openLegalDocument"',
  ) ||
  !profileScript.includes("openLegalDocument(event:")
) {
  failures.push("个人中心必须提供用户协议和隐私政策的长期查阅入口");
}

for (const disclosure of [
  "统一身份认证密码",
  "90 天滑动有效期",
  "百度地图开放平台",
  "相册仅写入权限",
  "查阅、复制、更正、补充、删除",
  "未满十四周岁",
  "15 个工作日",
  "support@lazycampus.com",
]) {
  if (!content.includes(disclosure)) {
    failures.push(`隐私政策缺少实际数据处理披露：${disclosure}`);
  }
}

if (/@qq\.com\b/i.test(content)) {
  failures.push("协议页面只能使用支持邮箱，不得披露旧联系邮箱");
}

for (const prohibited of [
  "不可逆摘要",
  "服务器保存可",
  "保存可再次",
  "本机持久缓存",
]) {
  if (content.includes(prohibited)) {
    failures.push(`协议页面不得描述密码存储方式：${prohibited}`);
  }
}

if (
  script.includes("openPrivacyContract") ||
  script.includes("openPlatformPrivacy") ||
  template.includes("platform-privacy") ||
  styles.includes("platform-privacy")
) {
  failures.push("协议页不得显示微信平台隐私保护指引按钮");
}

if (
  !content.includes(
    'import { MINIPROGRAM_NAME } from "../../config/env";',
  ) ||
  !content.includes("${MINIPROGRAM_NAME}")
) {
  failures.push("用户协议和隐私政策必须使用运行时小程序名称");
}

if (
  !template.includes(
    '<navigation-bar title="{{document.title}}" back transparent theme="{{theme}}">',
  ) ||
  template.includes("inset-back") ||
  template.includes("legal-directory") ||
  script.includes("jumpToSection") ||
  !template.includes('class="legal-article card"') ||
  !styles.includes("white-space: nowrap;") ||
  !styles.includes("min-width: 0;")
) {
  failures.push("协议页必须保持简洁，并让返回按钮与微信原生胶囊对齐");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Legal document checks passed.");
}
