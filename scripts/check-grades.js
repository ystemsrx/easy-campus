const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "grades.ts"),
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
  require,
);

const {
  gradeComponentWidths,
  gradePointRingValue,
  isMakeupOrDeferredGrade,
  isUnsuccessfulGrade,
  latestGradedSemester,
  latestSemesterGrades,
  withoutUnsuccessfulGrades,
} = moduleRecord.exports;

const regularGrade = {
  gradeNatureCode: "01",
  gradeNature: "正常考试",
  finalScore: 88,
  gradeRemark: null,
};
assert(
  !isMakeupOrDeferredGrade(regularGrade) &&
    isMakeupOrDeferredGrade({
      ...regularGrade,
      gradeNatureCode: "11",
      gradeNature: "补考",
    }) &&
    isMakeupOrDeferredGrade({
      ...regularGrade,
      gradeNatureCode: "12",
      gradeNature: "缓考",
    }) &&
    isMakeupOrDeferredGrade({
      ...regularGrade,
      gradeNature: null,
      finalScore: "补/缓考",
    }),
  "补考和缓考必须统一识别为仅展示总评的成绩",
);

const tapGuardSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "tap-guard.ts"),
  "utf8",
);
const tapGuardOutput = ts.transpileModule(tapGuardSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const tapGuardModule = { exports: {} };
new Function("module", "exports", "require", tapGuardOutput)(
  tapGuardModule,
  tapGuardModule.exports,
  require,
);
const { canActivateTap, movementExceedsTapThreshold, SCROLL_TAP_SETTLE_MS } =
  tapGuardModule.exports;

assert(
  !movementExceedsTapThreshold({ x: 10, y: 10 }, { x: 15, y: 15 }) &&
    movementExceedsTapThreshold({ x: 10, y: 10 }, { x: 10, y: 18 }) &&
    !canActivateTap(true, 0, 1_000) &&
    !canActivateTap(false, 900, 900 + SCROLL_TAP_SETTLE_MS - 1) &&
    canActivateTap(false, 900, 900 + SCROLL_TAP_SETTLE_MS),
  "成绩卡片必须区分轻触、拖动和刚结束的滚动",
);

const latestCourses = [
  {
    id: "latest-required",
    academicYear: "2025-2026",
    term: 2,
    credits: 4,
    finalScore: 90,
    calculationScore: 90,
    gradePoint: 4.3,
    countsTowardGradePointAverage: true,
  },
  {
    id: "latest-elective",
    academicYear: "2025-2026",
    term: 2,
    credits: 2,
    finalScore: 80,
    calculationScore: 80,
    gradePoint: 3,
    countsTowardGradePointAverage: false,
  },
];
const data = {
  items: [
    {
      id: "newer-empty",
      academicYear: "2026-2027",
      term: 1,
      credits: 2,
      finalScore: null,
      calculationScore: null,
      gradePoint: null,
      countsTowardGradePointAverage: true,
    },
    ...latestCourses,
    {
      id: "older",
      academicYear: "2024-2025",
      term: 2,
      credits: 3,
      finalScore: 70,
      calculationScore: 70,
      gradePoint: 2,
      countsTowardGradePointAverage: true,
    },
  ],
  pagination: { page: 1, pageSize: 200, total: 4, totalPages: 1 },
  summary: {
    courseCount: 4,
    totalCredits: 11,
    weightedAverage: 80.91,
    gradePointAverage: 3.31,
  },
  semesters: [
    {
      id: "2026-1",
      academicYear: 2026,
      academicYearLabel: "2026-2027",
      term: 1,
      label: "2026-2027 · 第一学期",
    },
    {
      id: "2025-2",
      academicYear: 2025,
      academicYearLabel: "2025-2026",
      term: 2,
      label: "2025-2026 · 第二学期",
    },
    {
      id: "2024-2",
      academicYear: 2024,
      academicYearLabel: "2024-2025",
      term: 2,
      label: "2024-2025 · 第二学期",
    },
  ],
};

assert(
  latestGradedSemester(data).id === "2025-2",
  "默认学期必须跳过尚无成绩的更新学期",
);
const latest = latestSemesterGrades(data);
assert(
  latest.items.map((course) => course.id).join(",") ===
    "latest-required,latest-elective",
  "首页预览与成绩页默认视图只能包含最新有成绩学期",
);
assert(
  latest.summary.courseCount === 2 &&
    latest.summary.totalCredits === 6 &&
    latest.summary.weightedAverage === 86.67 &&
    latest.summary.gradePointAverage === 4.3,
  "最新学期的均分、绩点、课程与学分必须独立汇总",
);
assert(
  gradePointRingValue(4) === 80 && gradePointRingValue(5) === 100,
  "首页绩点圆环必须以 5.0 为满环",
);
assert(
  gradeComponentWidths([{ weightPercent: 30 }, { weightPercent: 70 }]).join(
    ",",
  ) === "30,70" &&
    gradeComponentWidths([{ weightPercent: 30 }, { weightPercent: null }]).join(
      ",",
    ) === "30,70" &&
    gradeComponentWidths([{ weightPercent: 100 }, { weightPercent: 0 }]).join(
      ",",
    ) === "100,0",
  "成绩组成线段必须按真实占比绘制并保留零占比",
);

const fiveLevelSummary = latestSemesterGrades({
  ...data,
  items: [
    {
      ...latestCourses[0],
      id: "level-a",
      finalScore: "A",
      calculationScore: 95,
      gradePoint: 4.6,
      credits: 1,
    },
    {
      ...latestCourses[0],
      id: "level-e",
      finalScore: "不及格",
      calculationScore: 55,
      gradePoint: 0,
      credits: 1,
    },
  ],
  pagination: { page: 1, pageSize: 200, total: 2, totalPages: 1 },
}).summary;
assert(
  fiveLevelSummary.weightedAverage === 75 &&
    fiveLevelSummary.gradePointAverage === 2.3,
  "五级制换算后的分数和零绩点课程必须按学分进入最新学期汇总",
);

assert(
  isUnsuccessfulGrade({ finalScore: 59 }) &&
    !isUnsuccessfulGrade({ finalScore: 60 }) &&
    !isUnsuccessfulGrade({ finalScore: "A" }) &&
    !isUnsuccessfulGrade({ finalScore: "及格" }) &&
    isUnsuccessfulGrade({ finalScore: "E" }) &&
    isUnsuccessfulGrade({ finalScore: "不及格" }) &&
    isUnsuccessfulGrade({ finalScore: "作弊" }) &&
    !isUnsuccessfulGrade({ finalScore: "缓考" }),
  "低分隐藏必须识别百分制、不及格等级与异常状态，且不得误伤及格五级制",
);

const visibilityFiltered = withoutUnsuccessfulGrades({
  ...data,
  items: [
    {
      ...latestCourses[0],
      id: "numeric-fail",
      finalScore: 59,
      calculationScore: 59,
      gradePoint: 0,
      credits: 2,
    },
    {
      ...latestCourses[0],
      id: "numeric-pass",
      finalScore: 60,
      calculationScore: 60,
      gradePoint: 1,
      credits: 2,
    },
    {
      ...latestCourses[0],
      id: "level-a",
      finalScore: "A",
      calculationScore: 95,
      gradePoint: 4.6,
      credits: 1,
    },
    {
      ...latestCourses[0],
      id: "level-e",
      finalScore: "E",
      calculationScore: 55,
      gradePoint: 0,
      credits: 1,
    },
    {
      ...latestCourses[0],
      id: "cheating",
      finalScore: "作弊",
      calculationScore: null,
      gradePoint: null,
      credits: 3,
    },
  ],
  pagination: { page: 1, pageSize: 200, total: 5, totalPages: 1 },
});
assert(
  visibilityFiltered.items.map((course) => course.id).join(",") ===
    "numeric-pass,level-a" &&
    visibilityFiltered.summary.courseCount === 2 &&
    visibilityFiltered.summary.totalCredits === 3 &&
    visibilityFiltered.summary.weightedAverage === 71.67 &&
    visibilityFiltered.summary.gradePointAverage === 2.2 &&
    visibilityFiltered.semesters.map((semester) => semester.id).join(",") ===
      data.semesters.map((semester) => semester.id).join(","),
  "隐藏成绩后只能过滤成绩并重算统计，完整历史学期选项必须保留",
);

const gradesPageScript = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grades",
    "index.ts",
  ),
  "utf8",
);
const gradesPageTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grades",
    "index.wxml",
  ),
  "utf8",
);
const gradesPageStyles = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grades",
    "index.wxss",
  ),
  "utf8",
);
const refreshSpinnerInk = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "assets",
    "icons",
    "refresh-spinner-ink.svg",
  ),
  "utf8",
);
const refreshSpinnerWhite = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "assets",
    "icons",
    "refresh-spinner-white.svg",
  ),
  "utf8",
);
const gradeDetailScript = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grade-detail",
    "index.ts",
  ),
  "utf8",
);
const gradeDetailTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grade-detail",
    "index.wxml",
  ),
  "utf8",
);
const gradesStore = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "grades.ts"),
  "utf8",
);
const preferencesStore = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "preferences.ts"),
  "utf8",
);
const appTypes = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "types", "app.ts"),
  "utf8",
);
const profileScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "profile", "index.ts"),
  "utf8",
);
const profileTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "pages",
    "profile",
    "index.wxml",
  ),
  "utf8",
);
const gradeSettingsTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "grade-settings",
    "index.wxml",
  ),
  "utf8",
);
const teachingService = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "services", "teaching.ts"),
  "utf8",
);
assert(
  gradesPageScript.includes(
    "const displayScore = formatScore(course.finalScore)",
  ) &&
    gradesPageScript.includes("displayScore,") &&
    !gradesPageScript.includes("formatScore(course.calculationScore)") &&
    gradesPageTemplate.includes("{{item.displayScore}}") &&
    !gradesPageTemplate.includes("calculationScore"),
  "五级制课程必须显示教务原始等级，换算分数只能参与内部计算",
);
assert(
  teachingService.includes(
    'sort: query.sort === "default" ? undefined : query.sort',
  ),
  "默认成绩排序不得显式发送 sort=default，以兼容尚未重启的旧服务进程",
);
assert(
  gradesPageScript.includes(
    "const displayScore = formatScore(course.finalScore)",
  ) &&
    gradeDetailScript.includes(
      '{ label: "教师", value: course.teacherName || "—" }',
    ) &&
    gradeDetailScript.includes(
      '{ label: "成绩性质", value: course.gradeNature || "—" }',
    ),
  "课程成绩详情必须显示成绩接口返回的教师原文",
);
assert(
  !gradesPageTemplate.includes('data-id="all"') &&
    !gradesPageTemplate.includes("<text>全部成绩</text>"),
  "成绩学期栏不得提供全部成绩选项",
);
assert(
  gradesPageTemplate.includes("item.compactScore") &&
    gradesPageStyles.includes(".score-tile--compact .score-value") &&
    !gradesPageStyles.includes(".score-tile--text .score-value"),
  "等级字母和低于 60 分的数字必须保持正常字号，只有长文字成绩才能缩小",
);
assert(
  gradesPageScript.includes(
    "const components = isMakeupOrDeferredGrade(course) ? [] : course.components;",
  ) &&
    gradeDetailScript.includes(
      "const showComponentsSection = !isMakeupOrDeferredGrade(course);",
    ) &&
    gradeDetailScript.includes(
      "const sourceComponents = showComponentsSection ? course.components : [];",
    ) &&
    gradeDetailScript.includes(
      'detailTitle: showComponentsSection ? "课程成绩与组成" : "课程成绩"',
    ) &&
    gradeDetailTemplate.includes('title="{{detailTitle}}"') &&
    gradeDetailTemplate.includes('<block wx:if="{{showComponentsSection}}">') &&
    gradesStore.includes("const SCHEMA_VERSION = 7;"),
  "补考和缓考不得在列表或详情中展示成绩组成，旧分项缓存必须失效",
);
assert(
  gradesPageTemplate.includes(
    '<image wx:if="{{refreshing}}" class="nav-refresh-spinner"',
  ) &&
    gradesPageTemplate.includes("refresh-spinner-white.svg") &&
    gradesPageTemplate.includes("refresh-spinner-ink.svg") &&
    gradesPageTemplate.includes('<lucide-icon wx:else name="refresh-cw"') &&
    gradesPageStyles.includes(".nav-refresh-spinner") &&
    /\.nav-refresh\s*\{[^}]*width:\s*76rpx;[^}]*height:\s*76rpx;[^}]*border-radius:\s*999rpx;/.test(
      gradesPageStyles,
    ) &&
    /\.nav-refresh-spinner\s*\{[^}]*width:\s*34rpx;[^}]*height:\s*34rpx;[^}]*border-radius:\s*999rpx;/.test(
      gradesPageStyles,
    ) &&
    refreshSpinnerInk.includes('<circle cx="16" cy="16" r="11.5"') &&
    refreshSpinnerInk.includes("<path") &&
    refreshSpinnerWhite.includes('<circle cx="16" cy="16" r="11.5"') &&
    refreshSpinnerWhite.includes("<path") &&
    gradesPageStyles.includes("@keyframes grade-refresh-spin") &&
    gradesPageScript.includes("if (this.data.refreshing) return;") &&
    gradesPageScript.includes("showRefreshConfirmation(this)"),
  "成绩刷新期间必须用固定圆形按钮与真实圆形 SVG 加载环替换刷新图标",
);
assert(
  appTypes.includes("showGradesBelow60: boolean;") &&
    appTypes.includes("showGradesBelow60: true,") &&
    preferencesStore.includes("typeof stored.showGradesBelow60") &&
    profileTemplate.includes("成绩展示设置") &&
    profileScript.includes(
      'void navigateTo("/features/pages/grade-settings/index")',
    ) &&
    !profileTemplate.includes('bindchange="onShowGradesOnHomeChange"') &&
    gradeSettingsTemplate.includes('checked="{{showGradesOnHome}}"') &&
    gradeSettingsTemplate.includes('checked="{{showGradesBelow60}}"') &&
    gradesPageScript.includes(
      "includeUnsuccessful: this.data.includeUnsuccessful",
    ) &&
    teachingService.includes("query.includeUnsuccessful === false") &&
    teachingService.includes("withoutUnsuccessfulGrades(result.data)") &&
    gradesStore.includes("loadGradesSnapshotForPreference"),
  "成绩展示选项必须位于独立设置页，默认展示低分，并在网络与缓存两条路径本地兜底过滤",
);
assert(
  gradesPageTemplate.includes('bindscroll="onGradeScroll"') &&
    gradesPageTemplate.includes('bindtouchstart="onGradeTouchStart"') &&
    gradesPageTemplate.includes('bindtouchmove="onGradeTouchMove"') &&
    gradesPageTemplate.includes('bindtouchend="onGradeTouchEnd"') &&
    gradesPageTemplate.includes('bindtouchcancel="onGradeTouchCancel"') &&
    gradesPageScript.includes(
      "movementExceedsTapThreshold(gradeTouchStart, current)",
    ) &&
    gradesPageScript.includes(
      "canActivateTap(gradeTouchMoved, lastGradeScrollAt)",
    ),
  "成绩列表滑动及惯性滚动结束前不得打开课程详情",
);
assert(
  gradesPageTemplate.includes(
    "class=\"grade-card-motion {{item.animateEntry ? 'stagger-item' : ''}}\"",
  ) &&
    gradesPageTemplate.includes(
      'style="animation-delay: {{item.animationDelay}}ms;"',
    ) &&
    gradesPageScript.includes("let gradeListAnimationRequested = true;") &&
    gradesPageScript.includes(
      "const animateEntries = gradeListAnimationRequested;",
    ) &&
    gradesPageScript.includes("`${gradeRenderBatch}:${course.id}`") &&
    gradesPageScript.includes("animateEntries || animatedIds.has(course.id)") &&
    (gradesPageScript.match(/^\s+gradeListAnimationRequested = true;/gm) || [])
      .length === 2 &&
    !gradesPageScript.includes("gradeAnimationTimer"),
  "成绩卡片只应在首次进入和切换排序时整批播放逐步进入动效",
);

console.log("Grade preview checks passed.");
