const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const app = JSON.parse(read("miniprogram/app.json"));
const featurePackage = app.subPackages.find((item) => item.root === "features");
assert.ok(featurePackage, "features subpackage must exist");
assert.ok(
  featurePackage.pages.includes("pages/course-assistant/index"),
  "course assistant page must be registered",
);
assert.ok(
  featurePackage.pages.includes("pages/course-assistant-detail/index"),
  "course assistant detail page must be registered",
);

const profile = read("miniprogram/pages/profile/index.wxml");
assert.match(profile, />选课助手</);
assert.match(profile, /bindtap="openCourseAssistant"/);

const page = read("miniprogram/features/pages/course-assistant/index.wxml");
assert.doesNotMatch(page, /授权|同意并进入|不可撤销/);
assert.match(page, /发布一条想法后查看课程想法/);
assert.match(page, /reviewAccess\.requiresContribution/);
assert.doesNotMatch(page, /COURSE GUIDE · EASY SWU/);
assert.doesNotMatch(page, /inset-back/);
assert.match(page, /filter-panel-shell--open/);
assert.doesNotMatch(page, /wx:if="\{\{filterOpen\}\}" class="filter-panel/);
assert.doesNotMatch(page, /semester-badge">匿名互助/);
assert.match(page, /segment-indicator--physical/);
assert.match(page, /至少 8 个字/);
assert.match(page, /wx:if="\{\{!reviewVisible\}\}" class="assistant-tabbar"/);
assert.match(page, /safe-area="\{\{false\}\}"/);
assert.match(page, /<button slot="footer" class="review-submit/);
assert.match(page, /item\.visibleKeywords/);
assert.match(
  page,
  /review-keyword--more">\+\{\{item\.remainingKeywordCount\}\}/,
);
assert.match(page, /arrow-up-down-coral\.svg/);
assert.match(page, /arrow-up-down-muted\.svg/);
assert.match(page, /data-sort="average_score"/);
assert.match(page, /data-sort="rating"/);
assert.match(page, /reviewAccess\.ownReviewCount === 0/);
assert.match(page, /course-sort-option--locked/);
assert.match(page, /name="lock-keyhole" tone="muted"/);
assert.match(page, /bindscroll="onCourseScroll"/);
assert.match(page, /bindtouchstart="onCourseTouchStart"/);
assert.match(page, /bindtouchmove="onCourseTouchMove"/);
assert.match(page, /bindtouchend="onCourseTouchEnd"/);
assert.match(page, /bindtouchcancel="onCourseTouchCancel"/);
assert.match(page, /审核中，仅自己可见/);
assert.match(page, /item\.reviewUnderReview/);
assert.match(page, /item\.underReview/);
assert.match(page, /name="lock-keyhole" tone="danger"/);

const controller = read("miniprogram/features/pages/course-assistant/index.ts");
assert.doesNotMatch(
  controller,
  /authorizeCourseAssistant|getCourseAssistantStatus/,
);
assert.match(controller, /result\.reviewAccess/);
assert.match(controller, /publishCourseAssistantReview\(/);
assert.match(controller, /positive: \[[^\]]*"任务少"/s);
assert.match(controller, /negative: \[[^\]]*"任务多"/s);
assert.match(controller, /function reviewContentLength\(value: string\)/);
assert.match(controller, /reviewContentLength\(content\) >= 8/);
assert.match(controller, /review\.keywords\.slice\(0, 3\)/);
assert.match(controller, /review\.keywords\.length - 3/);
assert.match(controller, /sort: this\.data\.catalogSort/);
assert.match(
  controller,
  /sort === "rating" && this\.data\.reviewAccess\.ownReviewCount === 0/,
);
assert.match(controller, /formatCourseTeacherNames\(course\.teacherNames\)/);
assert.doesNotMatch(controller, /教师信息待补充/);
assert.match(controller, /course\.type !== "physical_education"/);
assert.match(controller, /Boolean\(course\.sportName\?\.trim\(\)\)/);
assert.match(controller, /movementExceedsTapThreshold\(/);
assert.match(
  controller,
  /canActivateTap\(courseTouchMoved, lastCourseScrollAt\)/,
);
assert.match(controller, /if \(!canActivateCourse\(\)\) return;/);
assert.match(controller, /grade\.reviewUnderReview/);
assert.doesNotMatch(
  controller,
  /setStorageSync\([^)]*(?:consent|authoriz)/i,
  "authorization must remain server-owned",
);

const service = read("miniprogram/features/services/course-assistant.ts");
assert.match(service, /const ROOT = "\/course-assistant"/);
assert.match(
  service,
  /method: "POST",\s*data: \{\},\s*retry: false,\s*credentialReauthFeedback: true/,
);
assert.doesNotMatch(service, /\/status|\/authorize|CourseAssistantStatus/);
assert.doesNotMatch(service, /\/api\/v1\/api\/v1\//);

const styles = read("miniprogram/features/pages/course-assistant/index.wxss");
const detailStyles = read(
  "miniprogram/features/pages/course-assistant-detail/index.wxss",
);
const navigationStyles = read(
  "miniprogram/components/navigation-bar/navigation-bar.wxss",
);
const navigationSurface = navigationStyles.match(
  /\.nav-cover\s*\{[^}]*background-color:\s*(?:var\(\s*--[^,]+,\s*)?(#[0-9a-f]{6})/s,
)?.[1];
const navigationDarkSurface = navigationStyles.match(
  /\.nav-cover--dark\s*\{[^}]*background-color:\s*(?:var\(\s*--[^,]+,\s*)?(#[0-9a-f]{6})/s,
)?.[1];
const assistantSurface = styles.match(
  /\.assistant-page\s*\{[^}]*--guide-paper:\s*(#[0-9a-f]{6})/s,
)?.[1];
const assistantDarkSurface = styles.match(
  /\.assistant-page\.theme-dark\s*\{[^}]*--guide-paper:\s*(#[0-9a-f]{6})/s,
)?.[1];
const detailSurface = detailStyles.match(
  /\.detail-page\s*\{[^}]*--guide-paper:\s*(#[0-9a-f]{6})/s,
)?.[1];
const detailDarkSurface = detailStyles.match(
  /\.detail-page\.theme-dark\s*\{[^}]*--guide-paper:\s*(#[0-9a-f]{6})/s,
)?.[1];
assert.ok(navigationSurface);
assert.ok(navigationDarkSurface);
assert.equal(assistantSurface, navigationSurface);
assert.equal(detailSurface, navigationSurface);
assert.equal(assistantDarkSurface, navigationDarkSurface);
assert.equal(detailDarkSurface, navigationDarkSurface);
assert.match(
  styles,
  /\.assistant-tabbar\s*\{[^}]*background-color:\s*rgba\(247, 245, 239, 0\.94\)/s,
);
assert.match(styles, /\.filter-panel-shell\s*\{[^}]*max-height:\s*0/s);
assert.match(
  styles,
  /\.filter-panel-shell--open\s*\{[^}]*max-height:\s*260rpx/s,
);
assert.match(styles, /transform:\s*translateY\(-18rpx\)/);
assert.match(styles, /\.course-search\s*\{[^}]*border-radius:\s*999rpx/s);
assert.match(styles, /\.segment-indicator\s*\{[^}]*transition:\s*transform/s);
assert.match(styles, /\.review-textarea\s*\{[^}]*box-sizing:\s*border-box/s);
assert.match(
  styles,
  /\.review-submit\.review-submit--disabled[^}]*background-color:\s*#aaa69c/s,
);
assert.match(styles, /\.assistant-tabbar\s*\{[^}]*height:\s*100rpx/s);
assert.doesNotMatch(
  styles.match(/\.assistant-tabbar\s*\{[^}]*\}/s)?.[0] || "",
  /safe-area-inset-bottom/,
);
assert.match(styles, /\.assistant-tab\s*\{[^}]*flex-direction:\s*row/s);
assert.match(styles, /\.assistant-tab\s*\{[^}]*font-size:\s*27rpx/s);
assert.match(styles, /\.course-sort-layer\s*\{[^}]*position:\s*fixed/s);
assert.match(styles, /\.course-sort-popover\s*\{[^}]*position:\s*absolute/s);
assert.match(
  styles,
  /\.course-sort-layer--open \.course-sort-popover\s*\{[^}]*opacity:\s*1/s,
);
assert.match(page, /wx:if="\{\{sortMenuMounted\}\}"/);
assert.match(page, /course-sort-trigger[^>]*hover-class="none"/);
assert.match(page, /data-sort="average_score"[^>]*hover-class="none"/);
assert.match(page, /data-sort="rating"[^>]*hover-class="none"/);
assert.match(styles, /\.course-sort-option--locked\s*\{[^}]*opacity:\s*0\.58/s);
assert.match(
  styles,
  /\.my-review-moderation text\s*\{[^}]*color:\s*var\(--guide-brick\)/s,
);
assert.match(
  styles,
  /\.done-badge--reviewing\s*\{[^}]*color:\s*var\(--guide-brick\)/s,
);
assert.doesNotMatch(styles, /\.consent-/);

const detailPage = read(
  "miniprogram/features/pages/course-assistant-detail/index.wxml",
);
assert.match(detailPage, /近 8 学期均分走势/);
assert.match(detailPage, /class="history-segment"/);
assert.match(detailPage, /class="history-y-axis"/);
assert.match(detailPage, /item\.peak/);
assert.match(detailPage, /title="暂无数据"/);
assert.match(detailPage, /detail\.reviewAccess\.requiresContribution/);
assert.match(detailPage, /\{\{item\.studyLabel\}\}/);
assert.match(detailPage, /审核中，仅自己可见/);
assert.match(detailPage, /wx:if="\{\{item\.underReview\}\}"/);
assert.match(detailPage, /wx:if="\{\{!item\.underReview\}\}"/);
assert.match(detailPage, /detail\.ownReviewUnderReview/);
assert.match(detailPage, /name="lock-keyhole" tone="danger"/);
assert.doesNotMatch(detailPage, /还没有课程想法|item\.latest/);

const detailController = read(
  "miniprogram/features/pages/course-assistant-detail/index.ts",
);
assert.match(detailController, /const bottom = 180/);
assert.match(detailController, /const axisSegments = 4/);
assert.doesNotMatch(detailPage, /<canvas/);
assert.doesNotMatch(detailPage, /historyChartSource/);
assert.match(detailPage, /class="detail-title-row"/);
assert.doesNotMatch(detailPage, /slot="right"/);
assert.doesNotMatch(
  detailPage,
  /匿名贡献者|课程想法<\/text><text class="info-value/,
);
assert.doesNotMatch(detailPage, /历史平均分数 · 匿名成绩/);
assert.doesNotMatch(detailPage, /教务课程名/);
assert.match(
  detailController,
  /formatCourseTeacherNames\(detail\.teacherNames\)/,
);
assert.match(detailController, /detail\.reviewRows\[rowIndex\]\.underReview/);
assert.match(detailController, /review\.own && review\.underReview/);
assert.match(
  detailStyles,
  /\.review-moderation text\s*\{[^}]*color:\s*var\(--guide-brick\)/s,
);
assert.match(
  detailStyles,
  /\.published-note--reviewing\s*\{[^}]*background-color:\s*var\(--guide-brick-soft\)/s,
);
assert.doesNotMatch(detailController, /教师信息待补充/);

const courseAssistantFormat = read(
  "miniprogram/features/utils/course-assistant.ts",
);
assert.match(courseAssistantFormat, /teachers\.length <= 3/);
assert.match(courseAssistantFormat, /"多名教师"/);
assert.match(courseAssistantFormat, /formatReviewTeacherNames/);

console.log("Course assistant frontend checks passed.");
