const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypeScriptModule(relativePath, dependencies = {}) {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "miniprogram", relativePath),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => dependencies[request] || require(request),
  );
  return moduleRecord.exports;
}

function examOn(date) {
  return {
    time: {
      date,
      startTime: "09:00",
      endTime: "11:00",
      startAt: null,
      endAt: null,
      raw: "",
    },
  };
}

const dateUtilities = loadTypeScriptModule("utils/date.ts");
const examUtilities = loadTypeScriptModule("utils/exams.ts", {
  "./date": dateUtilities,
});
const semesterUtilities = loadTypeScriptModule("utils/semester.ts");
const examRefreshPolicy = loadTypeScriptModule("services/cache-refresh.ts", {
  "../store/exams": {},
  "../store/session": {},
  "./teaching": {},
});
const referenceDate = "2026-08-18";

const automaticRefreshAt = Date.parse("2026-08-18T01:00:00.000Z");
const refreshInterval = examRefreshPolicy.EXAMS_AUTO_REFRESH_INTERVAL_MS;
assert(
  refreshInterval === 24 * 60 * 60 * 1000 &&
    examRefreshPolicy.isExamAutomaticRefreshDue(0, automaticRefreshAt) &&
    !examRefreshPolicy.isExamAutomaticRefreshDue(
      automaticRefreshAt,
      automaticRefreshAt + refreshInterval,
    ) &&
    examRefreshPolicy.isExamAutomaticRefreshDue(
      automaticRefreshAt,
      automaticRefreshAt + refreshInterval + 1,
    ),
  "考试自动刷新必须仅在距上次成功自动刷新超过 24 小时后触发",
);

const countdownCases = [
  ["2026-08-17", "past", "过"],
  ["2026-08-18", "current", "逢考必过"],
  ["2026-08-21", "urgent", "3"],
  ["2026-08-22", "soon", "4"],
  ["2026-08-23", "soon", "5"],
  ["2026-08-24", "week", "6"],
  ["2026-08-25", "week", "7"],
  ["2026-08-26", "later", "8"],
];

for (const [date, tone, label] of countdownCases) {
  const countdown = examUtilities.examCountdown(examOn(date), referenceDate);
  assert(
    countdown.tone === tone && countdown.label === label,
    `${date} 应映射为 ${tone}/${label}`,
  );
}

assert(
  examUtilities.examCountdown(examOn(""), referenceDate).tone === "pending",
  "日期待定的考试必须使用待定状态",
);

const progress = examUtilities.summarizeExamProgress(
  [
    examOn("2026-08-17"),
    examOn("2026-08-18"),
    examOn("2026-08-21"),
    examOn(""),
  ],
  4,
  referenceDate,
);
assert(
  progress.total === 4 && progress.pending === 3 && progress.past === 1,
  "考试汇总必须按总数、待考和已过统计",
);

assert(
  examUtilities.examBatchLabel({ examName: "2025-2026-2期末考试", retake: false }) ===
    "正常考试" &&
    examUtilities.examBatchLabel({ examName: "2025-2026-2期末考试", retake: true }) ===
      "重修" &&
    examUtilities.examBatchLabel({ examName: "2025-2026-2补缓考名单", retake: true }) ===
      "补/缓考",
  "考试批次必须按补缓考、重修、正常考试的优先级统一显示",
);

assert(
  semesterUtilities.numberedAcademicSemesterLabel({
    academicYear: 2025,
    academicYearLabel: "2025-2026",
    term: 2,
  }) === "2025-2026 · 2",
  "学期胶囊必须只显示数字学期",
);

const examsPage = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "exams", "index.wxml"),
  "utf8",
);
const examsStyles = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "exams", "index.wxss"),
  "utf8",
);
const examsScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "exams", "index.ts"),
  "utf8",
);
const apiTypes = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "types", "api.ts"),
  "utf8",
);
const examsStore = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "exams.ts"),
  "utf8",
);
const cacheRefreshScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "services", "cache-refresh.ts"),
  "utf8",
);
const appScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "app.ts"),
  "utf8",
);
const gradesPage = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "grades", "index.wxml"),
  "utf8",
);
const gradesScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "grades", "index.ts"),
  "utf8",
);
const gradesStyles = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "grades", "index.wxss"),
  "utf8",
);
const homePage = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.wxml"),
  "utf8",
);
const homeStyles = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.wxss"),
  "utf8",
);

assert(
  examsPage.includes('slot="after-left"') &&
    !examsPage.includes("按学期实时查询"),
  "考试页刷新按钮必须紧邻返回按钮且不显示顶部说明",
);
assert(
  examsPage.includes("semester-chip") &&
    !examsPage.includes('title="选择学期"') &&
    !examsPage.includes('data-id="all"') &&
    !examsPage.includes("<text>全部</text>"),
  "考试学期必须使用卡片上方的横向胶囊而不是底部抽屉",
);
assert(
  gradesPage.includes("semesterChips") &&
    gradesScript.includes("numberedAcademicSemesterLabel(semester)"),
  "成绩学期胶囊必须使用数字学期",
);
assert(
  gradesStyles.includes("height: 96rpx") &&
    gradesStyles.includes("z-index: 2") &&
    /\.semester-chip\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*height:\s*60rpx[^}]*padding:\s*0 25rpx/s.test(
      gradesStyles,
    ) &&
    gradesStyles.includes(".semester-chip > text") &&
    examsStyles.includes("height: 96rpx") &&
    examsStyles.includes("z-index: 2") &&
    /\.semester-chip\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*height:\s*60rpx[^}]*padding:\s*0 25rpx/s.test(
      examsStyles,
    ) &&
    examsStyles.includes(".semester-chip > text"),
  "成绩与考试学期栏必须保留明确高度、绘制层级和垂直居中的胶囊",
);
assert(
  examsPage.includes("statusSummary.total") &&
    examsPage.includes("statusSummary.pending") &&
    examsPage.includes("statusSummary.past"),
  "顶部卡片必须展示总数、待考和已过",
);
assert(
  !examsPage.includes("item.arrangementTypeLabel") &&
    !examsPage.includes("item.method") &&
    !examsPage.includes("item.seatLabel") &&
    !examsPage.includes("座位号") &&
    !examsScript.includes("seatLabel") &&
    !examsScript.includes("seatNumber") &&
    !apiTypes.includes("seatNumber") &&
    examsStore.includes("const SCHEMA_VERSION = 3;"),
  "考试条目不得显示考试类型、方式或座位标签",
);
assert(
  /onShow\(\)\s*\{[\s\S]*?refreshExamsOnForeground\(session\)/.test(
    appScript,
  ) &&
    !appScript
      .slice(appScript.indexOf("onLaunch()"), appScript.indexOf("onShow()"))
      .includes("refreshExamsOnForeground") &&
    cacheRefreshScript.includes("lastAutomaticRefreshAt: Date.now()") &&
    examsScript.includes("lastAutomaticRefreshAt,") &&
    !examsScript.includes("lastAutomaticRefreshAt: Date.now()"),
  "考试应在每次进入前台检查自动刷新，且手动刷新不得被 24 小时间隔拦截或重置自动刷新时间",
);
assert(
  examsScript.includes('{ label: "考试批次", value: exam.batchLabel }') &&
    !examsScript.includes('label: "考试类型"') &&
    !examsScript.includes('label: "教务批次"') &&
    !examsScript.includes('label: "重修标记"'),
  "考试详情必须把考试类型、教务批次和重修标记合并为考试批次",
);
assert(
  examsPage.includes("item.retakeMarker") &&
    examsPage.includes("（重修）") &&
    examsPage.includes("item.makeupDeferredMarker") &&
    examsPage.includes("（补缓考）") &&
    examsStyles.includes(".exam-course-marker"),
  "考试课程名后必须使用浅色小字显示教务重修和补缓考标记",
);
assert(
  examsPage.includes('scrollable="{{false}}"') &&
    examsPage.includes('class="exam-detail-scroll"') &&
    examsPage.includes('type="custom"') &&
    examsPage.includes("scroll-y enhanced") &&
    !examsPage.includes('class="exam-detail-scroll" type="list"') &&
    examsPage.includes('id="exam-detail-content"') &&
    examsPage.includes("selectedExamDetailHeight") &&
    examsScript.includes("measureExamDetailHeight") &&
    examsScript.includes("windowHeight * 0.86 - sheetChromeHeight") &&
    examsStyles.includes("height: 58vh"),
  "考试详情必须使用独立滚动区并按内容高度自适应，超出安全高度后滚动",
);
assert(
  examsPage.includes("exam-countdown-current") &&
    examsPage.includes("exam-schedule"),
  "考试条目必须使用左侧倒计时和右侧时间布局",
);
assert(
  examsStyles.includes("width: 104rpx; height: 104rpx") &&
    examsStyles.includes("exam-countdown--urgent") &&
    examsStyles.includes("exam-countdown--soon") &&
    examsStyles.includes("exam-countdown--week") &&
    examsStyles.includes("exam-countdown--later"),
  "倒计时色块必须保持正方形并覆盖四档未来配色",
);
assert(
  homePage.includes('class="exam-open-container"') &&
    homePage.includes('bind:tap="openExams"'),
  "首页考试卡片必须使用放大转场打开",
);
assert(
  homeStyles.includes("exam-badge--urgent") &&
    homeStyles.includes("exam-badge--soon") &&
    homeStyles.includes("exam-badge--week") &&
    homeStyles.includes("exam-badge--later") &&
    homeStyles.includes("background: #efede6"),
  "首页考试预览必须与考试页共用分档配色和已过颜色",
);

console.log("Exam page checks passed.");
