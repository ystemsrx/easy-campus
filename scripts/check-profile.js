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

const { identityCardTone, singleSelectionOptions } =
  loadTypeScriptModule("utils/profile.ts");
const profileScript = read("pages/profile/index.ts");
const profileTemplate = read("pages/profile/index.wxml");
const profileStyles = read("pages/profile/index.wxss");
const profilePageConfig = JSON.parse(read("app.json"));
const autoDormCheckPage = read("features/pages/auto-dorm-check/index.wxml");
const autoDormCheckScript = read("features/pages/auto-dorm-check/index.ts");
const autoDormCheckStyles = read("features/pages/auto-dorm-check/index.wxss");
const autoDormCheckService = read("services/auto-dorm-check.ts");
const autoDormCheckStore = read("store/auto-dorm-check.ts");
const feedbackService = read("services/feedback.ts");
const homeScript = read("pages/home/index.ts");

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

const feedbackOptions = [
  { value: "bug" },
  { value: "feature" },
  { value: "experience" },
  { value: "other" },
];
for (const selected of feedbackOptions.map((option) => option.value)) {
  const options = singleSelectionOptions(feedbackOptions, selected);
  assert(
    options.filter((option) => option.selected).length === 1 &&
      options.find((option) => option.value === selected)?.selected === true,
    `连续切换到 ${selected} 时必须只保留当前反馈类型的选中态`,
  );
}

assert(
  profileScript.includes("identityCardTone(user.profile.gender)") &&
    profileScript.includes('identityCardTone: "neutral"') &&
    profileTemplate.includes(
      "identity-card identity-card--{{identityCardTone}}",
    ),
  "我的页面必须根据当前用户资料切换身份卡片色调，并在账号切换时清空旧色调",
);

assert(
  /\.identity-card--male\s*\{[^}]*background:\s*#e3eff8/.test(profileStyles) &&
    /\.identity-card--female\s*\{[^}]*background:\s*#ece4f5/.test(
      profileStyles,
    ) &&
    !/\.identity-card--(?:male|female)\s*\{[^}]*linear-gradient/.test(
      profileStyles,
    ) &&
    /\.identity-card\s*\{[^}]*color:\s*var\(--identity-ink\)/.test(
      profileStyles,
    ) &&
    !/\.identity-account\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255/.test(
      profileStyles,
    ),
  "男女身份卡必须使用纯色的浅蓝紫背景，并为浅色卡片保留清晰的深色文字",
);

const featurePages = profilePageConfig.subPackages.flatMap(
  (subPackage) => subPackage.pages,
);
assert(
  homeScript.includes("preloadAutoDormCheckStatus()") &&
    profileScript.includes("hydrateAutoDormCheckAvailability") &&
    profileScript.includes("loadAutoDormCheckSnapshot(account)") &&
    profileScript.includes("getPendingAutoDormCheckStatus()") &&
    !profileScript.includes("getAutoDormCheckStatus()") &&
    autoDormCheckStore.includes(
      "encodeURIComponent(account.trim().toLowerCase())",
    ) &&
    autoDormCheckService.includes("saveAutoDormCheckSnapshot") &&
    autoDormCheckStore.includes('"failed"') &&
    profileScript.includes("AUTO_DORM_CHECK_STATUS[status.checkInStatus]") &&
    profileScript.includes('failed: { label: "已失败"') &&
    profileTemplate.includes('wx:if="{{autoDormCheckVisible}}"') &&
    profileTemplate.includes("{{autoDormCheckStatusLabel}}") &&
    profileTemplate.includes(
      "auto-dorm-check-setting-dot--{{autoDormCheckStatusTone}}",
    ) &&
    !profileTemplate.includes(
      '<view class="auto-dorm-check-setting-value"><text>设置</text>',
    ) &&
    profileTemplate.includes("openAutoDormCheck") &&
    featurePages.includes("pages/auto-dorm-check/index"),
  "自动查寝入口必须由主页按账号预取并缓存服务端状态，个人页不得重复请求",
);
assert(
  autoDormCheckPage.includes('aria-checked="{{effectiveEnabled}}"') &&
    autoDormCheckPage.includes('aria-disabled="{{saving || !available}}"') &&
    autoDormCheckPage.includes("auto-dorm-check-status-dot--{{statusTone}}") &&
    autoDormCheckPage.includes("auto-dorm-check-detail-card") &&
    autoDormCheckPage.includes("目标时间") &&
    autoDormCheckPage.includes("{{targetTimeLabel}}") &&
    autoDormCheckScript.includes("status.plannedCheckInAt") &&
    autoDormCheckScript.includes("status.plannedCheckInDate") &&
    autoDormCheckScript.includes("status.checkInLocation?.locationName") &&
    autoDormCheckScript.includes('failed: { label: "已失败"') &&
    autoDormCheckScript.includes("scheduleTaskStatusRefresh(status)") &&
    autoDormCheckScript.includes("getAutoDormCheckLocalStatus") &&
    autoDormCheckScript.includes(
      "TASK_STATUS_REFRESH_INTERVAL_MILLISECONDS = 30_000",
    ) &&
    autoDormCheckScript.includes("scheduleChinaDayRefresh") &&
    autoDormCheckPage.includes("打卡地点") &&
    autoDormCheckPage.includes("再手动完成一次正常打卡") &&
    autoDormCheckPage.includes('bindtap="onEnabledTap"') &&
    autoDormCheckPage.includes("auto-dorm-check-switch-spinner") &&
    autoDormCheckPage.includes("/assets/icons/refresh-spinner-ink.svg") &&
    autoDormCheckPage.includes("auto-dorm-check-switch--checking") &&
    autoDormCheckPage.includes("{{capsuleToastMessage}}") &&
    autoDormCheckScript.includes("checkingCapability: true") &&
    autoDormCheckScript.includes("AUTO_DORM_CHECK_NO_TASK") &&
    autoDormCheckScript.includes('return "暂无打卡任务"') &&
    autoDormCheckScript.includes("AUTO_DORM_CHECK_LOCATION_REQUIRED") &&
    autoDormCheckScript.includes('this.showCapsuleToast("已开启自动打卡")') &&
    autoDormCheckScript.includes("CAPSULE_TOAST_HOLD_MILLISECONDS = 3000") &&
    autoDormCheckStyles.includes("animation-name: auto-dorm-check-spin") &&
    autoDormCheckStyles.includes("animation-duration: 720ms") &&
    autoDormCheckStyles.includes("border-radius: 999rpx") &&
    autoDormCheckStyles.includes(".auto-dorm-check-switch--checking") &&
    autoDormCheckStyles.includes(".auto-dorm-check-toast--visible") &&
    autoDormCheckService.includes('const ROOT = "/auto-dorm-check"') &&
    autoDormCheckService.includes("`${ROOT}/status?refresh=true`") &&
    autoDormCheckService.includes('method: "PUT"'),
  "自动查寝页面必须读取服务端状态并持久化学生个人开关",
);

assert(
  profileTemplate.includes('bindtap="openFeedback"') &&
    profileTemplate.includes('visible="{{feedbackVisible}}"') &&
    profileTemplate.includes('bindinput="onFeedbackContentInput"') &&
    profileTemplate.includes('bindtap="submitFeedback"') &&
    profileTemplate.includes("{{feedbackCharacterCount}}/500") &&
    profileScript.includes("FEEDBACK_TYPES") &&
    profileScript.includes("captureSessionLease()") &&
    profileScript.includes("isSessionLeaseCurrent(lease)") &&
    profileScript.includes("this.setFeedbackTabBarHidden(true)") &&
    profileScript.includes(
      'const feedbackType = this.data.feedbackType === type ? "" : type',
    ) &&
    profileScript.includes(
      "feedbackTypes: feedbackTypeOptions(feedbackType)",
    ) &&
    profileTemplate.includes(
      "{{item.selected ? 'feedback-type-option--active' : 'feedback-type-option--inactive'}}",
    ) &&
    profileStyles.includes(".feedback-type-option--inactive") &&
    !profileStyles.includes("var(--color-surface)") &&
    !profileTemplate.includes('hover-class="feedback-type-option--pressed"') &&
    (profileTemplate.match(/class="feedback-required"/g) || []).length === 2 &&
    profileStyles.includes(".feedback-required") &&
    profileScript.includes("isFeedbackDailyLimitError(error)") &&
    feedbackService.includes('apiRequest<FeedbackSubmission>("/feedback"') &&
    feedbackService.includes('method: "POST"'),
  "我的页面反馈弹层必须收集类型和具体内容，并通过认证接口安全提交",
);

console.log("Profile identity card checks passed.");
