const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const ts = require("typescript");

function loadTimetable() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
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
  return moduleRecord.exports;
}

function loadTimetableRender(timetableModule) {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable-render.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request === "./timetable") return timetableModule;
      return require(request);
    },
  );
  return moduleRecord.exports;
}

function loadMessageFormat() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "format.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request === "./date") {
        return { formatMessageWeekday: (weekday) => weekdays[weekday] || "" };
      }
      return require(request);
    },
  );
  return moduleRecord.exports;
}

function loadSemesterFormat() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "semester.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
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
  return moduleRecord.exports;
}

function loadCourseStatistics() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "course-statistics.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const timetable = loadTimetable();
const timetableRender = loadTimetableRender(timetable);
const messageFormat = loadMessageFormat();
const semesterFormat = loadSemesterFormat();
const courseStatistics = loadCourseStatistics();

for (const courseName of [
  "高等数学",
  "  大学 英语（四） ",
  "Software Engineering 🚀",
  "新时代中国特色社会主义理论与实践课程设计综合训练一二三四五六七八九十",
]) {
  const normalized = courseName
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255)
    .toLocaleLowerCase("zh-CN");
  assert(
    courseStatistics.courseStatisticsKey(courseName) ===
      crypto.createHash("sha256").update(normalized).digest("hex"),
    "课表课程的通过率键必须与服务端课程名规范化和 SHA-256 规则一致",
  );
}

const summerSemester = {
  id: "2025-3",
  academicYear: 2025,
  academicYearLabel: "2025-2026",
  term: 3,
  label: "2025-2026 · 第三学期",
};
assert(
  semesterFormat.shortAcademicSemesterLabel(summerSemester) === "25-26 夏",
  "第三学期的课表短名称必须映射为夏",
);
assert(
  semesterFormat.shortAcademicSemesterLabel(summerSemester, " · ") ===
    "25-26 · 夏",
  "学期短名称必须支持课程选择器使用的点分隔符",
);
assert(
  semesterFormat.timetableSemesterMenuLabel(summerSemester) ===
    "2025-2026 · 夏",
  "课表菜单中的第三学期必须映射为夏",
);

assert(
  messageFormat.formatScheduleDate({
    weekStart: 4,
    weekEnd: 13,
    weeks: [4, 7, 10, 13],
    weekday: 1,
    periodStart: 7,
    periodEnd: 8,
    location: "09-0402",
  }) === "第4、7、10、13周 周一",
  "离散多周教务消息不得在前端重新压缩成连续周次",
);

const periodTimes = [
  [1, "08:00", "08:45"],
  [2, "08:55", "09:40"],
  [3, "10:00", "10:45"],
  [4, "10:55", "11:40"],
  [7, "14:00", "14:45"],
  [8, "14:55", "15:40"],
].map(([period, startTime, endTime]) => ({ period, startTime, endTime }));

function arrangement(id, start, end, startTime, endTime) {
  return {
    id,
    weekday: 1,
    weekdayLabel: "星期一",
    periodStart: start,
    periodEnd: end,
    periods: [start, end],
    startTime,
    endTime,
    weekText: "1-16周",
    weeks: Array.from({ length: 16 }, (_, index) => index + 1),
    activityType: "lecture",
    activityTypeLabel: "讲课",
    teacherNames: ["教师"],
    location: {
      campus: "北碚校区",
      building: "31教",
      room: `31教${id}`,
      display: `31教${id}`,
    },
    teachingMethod: null,
    selectionStatus: "selected",
    adjusted: false,
  };
}

function course(id, name, schedule) {
  return {
    id,
    courseCode: id,
    courseName: name,
    teachingClass: "教学班",
    teacherNames: ["教师"],
    credits: 2,
    category: null,
    nature: null,
    assessmentMethod: null,
    examMethod: null,
    teachingClassComposition: [],
    retake: false,
    selectionStatus: "selected",
    arrangements: [schedule],
  };
}

const semester = {
  id: "2026-1",
  academicYear: 2026,
  academicYearLabel: "2026-2027",
  term: 1,
  label: "2026-2027 · 第一学期",
};
const data = {
  semester,
  semesters: [semester],
  currentSemester: {
    ...semester,
    startDate: "2026-08-10",
    endDate: "2026-11-29",
  },
  semesterCalendar: {
    semesterId: semester.id,
    startDate: "2026-08-10",
    endDate: "2026-11-29",
    totalWeeks: 16,
    weeks: Array.from({ length: 16 }, (_, index) => {
      const start = new Date(2026, 7, 10 + index * 7);
      const end = new Date(2026, 7, 16 + index * 7);
      const dateKey = (value) =>
        `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
      return {
        weekNumber: index + 1,
        startDate: dateKey(start),
        endDate: dateKey(end),
      };
    }),
  },
  dataSource: "teaching_system",
  sourceTimeZone: "Asia/Shanghai",
  periods: periodTimes,
  courses: [
    course(
      "data-structure",
      "数据结构",
      arrangement("data-structure", 1, 2, "08:00", "09:40"),
    ),
    course(
      "college-english",
      "大学英语",
      arrangement("college-english", 3, 4, "10:00", "11:40"),
    ),
    course(
      "database",
      "数据库原理",
      arrangement("database", 7, 8, "14:00", "15:40"),
    ),
    course(
      "practice",
      "创新实践",
      arrangement("practice", 12, 13, "19:20", "21:00"),
    ),
  ],
  additionalCourses: [],
  summary: { courseCount: 4, arrangementCount: 4, maxWeek: 16 },
};

const duringFirstCourse = new Date(2026, 7, 10, 8, 30);
const currentAndNext = timetable.coursePreview(data, duringFirstCourse);
assert(currentAndNext.courses.length === 3, "进行中时应预览三节课");
assert(
  currentAndNext.currentCourseId === "data-structure:w1",
  "第一节进行中时应将它置于首位",
);
assert(
  currentAndNext.courses[1].id === "college-english:w1" &&
    currentAndNext.courses[2].id === "database:w1",
  "进行中课程后应紧跟当天后两节课",
);

const betweenCourses = new Date(2026, 7, 10, 9, 50);
const nextThree = timetable.coursePreview(data, betweenCourses);
assert(nextThree.courses.length === 3, "课间应预览接下来的三节课");
assert(nextThree.currentCourseId === null, "课间不应误标课程为进行中");
assert(
  nextThree.courses.every(
    (course) =>
      timetable.timeToMinutes(course.startTime) >
      timetable.currentMinutes(betweenCourses),
  ),
  "课间预览中只能出现尚未开始的课程",
);

const atCourseEnd = new Date(2026, 7, 10, 9, 40);
const afterFirstCourse = timetable.coursePreview(data, atCourseEnd);
assert(
  afterFirstCourse.currentCourseId === null &&
    afterFirstCourse.courses[0].id === "college-english:w1",
  "到达下课时刻后不应继续显示上一节为进行中",
);

const afterClasses = new Date(2026, 7, 10, 22, 0);
assert(
  timetable.coursePreview(data, afterClasses).courses.length === 0,
  "当天课程结束后不应保留预览课程",
);

assert(
  timetable.teachingWeekForDate(data, duringFirstCourse) === 1,
  "应根据学校返回的结构化周次计算教学周",
);
assert(
  timetable.timetableWeekForDisplay(data, new Date(2026, 7, 1)) === 1,
  "学期开始前应预加载下一学期第一周",
);
assert(
  timetable.timetableWeekForDisplay(data, new Date(2026, 11, 10)) === 16,
  "学期结束后应预加载上一学期最后一周",
);
const vacationSelection = {
  ...data,
  currentSemester: {
    ...semester,
    id: "2025-2",
    startDate: "2026-03-02",
    endDate: "2026-08-09",
  },
};
assert(
  timetable.weekDateKeys(vacationSelection, 1)[0] === "2026-08-10",
  "假期选中下学期时应使用该学期自己的结构化周次，而不是当前学期",
);
assert(
  timetable.coursePreview(null, duringFirstCourse).courses.length === 0,
  "没有真实课表时不得回退到占位课程",
);
const cachedWeekDates = timetable.buildTimetableWeekDateCache(data);
assert(
  cachedWeekDates.length === 16 &&
    cachedWeekDates[0].weekNumber === 1 &&
    cachedWeekDates[0].dates.length === 7 &&
    cachedWeekDates[0].dates[0] === "2026-08-10",
  "本地课表快照必须包含全部周次及每周日期",
);
assert(
  timetableRender.buildTimetableWeekPlaceholder(data, 1, []).startDateLabel ===
    "8/10",
  "空的旧周次日期缓存不得覆盖可由当前校历重新计算出的日期",
);
const alignedGridMetrics = timetableRender.timetableGridLayoutMetrics(13, 64);
const alignedWeekPage = timetableRender.buildTimetableWeekPage(
  data,
  1,
  13,
  alignedGridMetrics,
);
const alignedCourse = alignedWeekPage.gridDays
  .flatMap((day) => day.courses)
  .find(Boolean);
const finalPeriodCourse = alignedWeekPage.gridDays
  .flatMap((day) => day.courses)
  .find((course) => course.periodEnd === 13);
const alignedPeriodLabelTopPx =
  (alignedGridMetrics.rowHeightPx - 67 * alignedGridMetrics.scale) / 2;
assert(
  alignedCourse &&
    Number(alignedCourse.topInsetPx) > 2 * alignedGridMetrics.scale &&
    Number(alignedCourse.heightPercent) >
      ((alignedCourse.periodEnd - alignedCourse.periodStart + 1) / 13) * 100 &&
    Math.abs(
      alignedPeriodLabelTopPx -
        alignedGridMetrics.courseTopInsetPx -
        3 * alignedGridMetrics.scale,
    ) < 0.001 &&
    Math.abs(
      alignedGridMetrics.courseHeightExtensionPx -
        (alignedGridMetrics.courseTopInsetPx - alignedGridMetrics.scale),
    ) < 0.001 &&
    Math.abs(
      alignedGridMetrics.contentInsetPx - 17 * alignedGridMetrics.scale,
    ) < 0.001 &&
    finalPeriodCourse &&
    Number(finalPeriodCourse.topPercent) +
      Number(finalPeriodCourse.heightPercent) <=
      100,
  "课程块顶部必须略高于节次数字，并保留约 3rpx 的相邻课程间距",
);

const textMetrics = {
  nameFontSizePx: 10,
  locationFontSizePx: 8,
  teacherFontSizePx: 8,
  contentWidthPx: 33,
  contentInsetPx: 4,
  scale: 0.5,
};
const longText = {
  name: "一二三四五六七八九十甲乙丙",
  location: "一二三四五六七八九十甲乙丙",
  teacher: "一二三四五六七",
};
const roomyLayout = timetable.layoutGridCourseText(longText, 80, textMetrics);
assert(roomyLayout.nameLines === 4, "高度充足时课程名应保留四行");
assert(
  JSON.stringify(roomyLayout.nameRows.map((row) => row.text)) ===
    JSON.stringify(["一二三", "四五六", "七八九", "十甲…"]),
  "课程名应严格每行三字，并在第四行第三个位置显示省略号",
);
assert(
  JSON.stringify(roomyLayout.locationRows.map((row) => row.text)) ===
    JSON.stringify(["@一二三", "四五六七", "八九十…"]),
  "地点应带 @ 前缀并严格每行四个字符、最多三行",
);
assert(
  JSON.stringify(roomyLayout.teacherRows.map((row) => row.text)) ===
    JSON.stringify(["一二三", "四五…"]),
  "教师应严格每行三字、最多两行",
);
assert(
  timetable
    .layoutGridCourseText(
      { ...longText, location: "@31教0503" },
      80,
      textMetrics,
    )
    .locationRows.map((row) => row.text)
    .join("") === "@31教0503",
  "已有 @ 前缀的地点不得重复添加前缀",
);
const compactAddressLayout = timetable.layoutGridCourseText(
  { ...longText, location: "31教0503" },
  90,
  {
    ...textMetrics,
    locationFontSizePx: 14,
    contentWidthPx: 40,
  },
);
const compactAddressFontSize = Number(
  compactAddressLayout.locationStyle.match(/font-size:([\d.]+)px/)?.[1],
);
assert(
  compactAddressFontSize > (40 - 1) / 4,
  "半角字符较多的地点应使用比四个全角字更大的字号",
);
const fullWidthAddressLayout = timetable.layoutGridCourseText(
  { ...longText, location: "天地玄黄宇宙洪荒" },
  90,
  {
    ...textMetrics,
    locationFontSizePx: 14,
    contentWidthPx: 40,
  },
);
const fullWidthAddressFontSize = Number(
  fullWidthAddressLayout.locationStyle.match(/font-size:([\d.]+)px/)?.[1],
);
assert(
  fullWidthAddressFontSize <= (40 - 1) / 4,
  "包含四个全角字的地点仍应完整落在课程卡片内",
);
assert(
  timetable.layoutGridCourseText(longText, 66, textMetrics).nameLines === 3,
  "只有地点将越过底边时才应把课程名降为三行",
);
assert(
  timetable.layoutGridCourseText(longText, 58, textMetrics).nameLines === 2,
  "地点仍会越界时应继续把课程名降为两行",
);
assert(
  timetable.layoutGridCourseText({ ...longText, location: "" }, 20, textMetrics)
    .nameLines === 4,
  "教师越界或没有地点时不得压缩课程名",
);

const timetablePageRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "pages",
  "timetable",
);
const timetablePageScript = fs.readFileSync(
  path.join(timetablePageRoot, "index.ts"),
  "utf8",
);
const timetablePageTemplate = fs.readFileSync(
  path.join(timetablePageRoot, "index.wxml"),
  "utf8",
);
const timetablePageStyles = fs.readFileSync(
  path.join(timetablePageRoot, "index.wxss"),
  "utf8",
);
const timetableStoreSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "timetable.ts"),
  "utf8",
);
const timetableRenderSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "data", "timetable-render.ts"),
  "utf8",
);
const appSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "app.ts"),
  "utf8",
);
const passRatePageTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "pages",
    "pass-rates",
    "index.wxml",
  ),
  "utf8",
);
const passRateCardTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "pass-rate-card",
    "pass-rate-card.wxml",
  ),
  "utf8",
);
const bottomSheetScript = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "bottom-sheet",
    "bottom-sheet.ts",
  ),
  "utf8",
);
const bottomSheetTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "bottom-sheet",
    "bottom-sheet.wxml",
  ),
  "utf8",
);
const dayColumnRule = timetablePageStyles.match(
  /\.grid-day-column\s*\{[^}]*\}/s,
)?.[0];
const periodLineRule = timetablePageStyles.match(
  /\.period-grid-line\s*\{[^}]*\}/s,
)?.[0];
assert(
  dayColumnRule && !dayColumnRule.includes("border"),
  "课表背景不应保留纵向浅色网格",
);
assert(
  periodLineRule && !periodLineRule.includes("border"),
  "课表背景不应保留横向浅色网格",
);
assert(
  timetablePageTemplate.includes('class="month-number tnum"') &&
    timetablePageTemplate.includes('class="month-unit"'),
  "月份数字和‘月’必须分成两行并分别对齐星期与日期",
);
assert(
  timetablePageTemplate.includes('bindtap="toggleWeekMenu"') &&
    timetablePageTemplate.includes('bindtap="selectWeek"'),
  "顶部周次必须提供可直接切换周次的弹出菜单",
);
assert(
  timetablePageTemplate.includes(
    '<view class="week-option-number tnum">{{week.weekNumber}}</view>',
  ) &&
    timetablePageTemplate.includes(
      '<view class="week-option-date tnum">{{week.startDateLabel}}</view>',
    ) &&
    !timetablePageTemplate.includes('class="week-option-content"'),
  "周次数字和日期必须作为胶囊内的两个直接块级节点纵向排列",
);
assert(
  timetablePageTemplate.includes('wx:for="{{weekMenuRows}}"') &&
    timetablePageTemplate.includes('id="{{weekRow.id}}"') &&
    !timetablePageTemplate.includes('class="week-options"') &&
    timetablePageScript.includes("function timetableWeekMenuRows(") &&
    timetablePageScript.includes("weekMenuRowId(this.data.weekNumber)") &&
    /\.week-option-row\s*\{[^}]*flex:\s*none[^}]*height:\s*86rpx/s.test(
      timetablePageStyles,
    ),
  "Skyline 周次选择器必须使用独立轻量数据和可直接虚拟化的固定高度行",
);
assert(
  /\.week-option-date\s*\{[^}]*display:\s*block[^}]*height:\s*22rpx[^}]*font-size:\s*17rpx[^}]*line-height:\s*22rpx[^}]*text-align:\s*center/s.test(
    timetablePageStyles,
  ),
  "周次日期必须使用 Skyline 可稳定渲染的显式块级高度与行高",
);
assert(
  /\.period-time\s*\{[^}]*margin-top:\s*5rpx[^}]*font-size:\s*16rpx/s.test(
    timetablePageStyles,
  ),
  "左侧节次时间必须保持清晰字号，并与节次数字留出间距",
);
assert(
  timetablePageTemplate.includes("padding-top: {{course.topInsetPx}}px;"),
  "课程块必须应用按屏幕行高计算的顶部对齐距离",
);
assert(
  timetablePageTemplate.includes("week-option--current") &&
    /\.week-option\s*\{[^}]*border-radius:\s*999rpx/s.test(
      timetablePageStyles,
    ) &&
    /\.week-option--current\s*\{[^}]*border-color:\s*#0862ad/s.test(
      timetablePageStyles,
    ),
  "周次选项必须使用胶囊形，并持续描边标识当前周",
);
assert(
  timetablePageScript.includes("timetableRequestsInFlight") &&
    timetablePageScript.includes("refresh || !semester") &&
    timetablePageScript.includes("result.meta.stale === true"),
  "静默刷新必须允许其他学期请求、识别旧服务端快照并保留当前周",
);
assert(
  appSource.includes("prewarmTimetableFirstScreen(account, timetable)") &&
    timetableStoreSource.includes(
      "prewarmTimetableFirstScreen(account, snapshot)",
    ) &&
    timetablePageScript.includes("getPrewarmedTimetableFirstScreen") &&
    timetablePageScript.includes("queueRemainingWeekPages") &&
    timetablePageTemplate.includes('wx:if="{{weekPage.ready}}"') &&
    !timetablePageTemplate.includes('class="week-page page-enter"') &&
    timetableRenderSource.includes("buildTimetableWeekPlaceholder"),
  "应用启动时必须只预渲染首屏周次，进入课表后再静默补齐其他周",
);
assert(
  timetableStoreSource.includes(
    "weekDates: buildTimetableWeekDateCache(cachedData)",
  ) &&
    timetableStoreSource.includes("SEMESTER_CATALOG_PREFIX") &&
    timetableStoreSource.includes("mergeTimetableSemesterCatalog"),
  "每个课表快照都必须在本地持久化周次日期和完整学期目录",
);
assert(
  timetablePageTemplate.includes("menu-glyph--open") &&
    timetablePageStyles.includes(".menu-glyph--open > view:nth-child(1)"),
  "课表菜单按钮必须在三横线和关闭图标之间平滑变形",
);
assert(
  timetablePageTemplate.includes(
    '<bottom-sheet visible="{{courseSheetVisible}}" expanded="{{true}}" scrollable="{{false}}"',
  ) &&
    timetablePageTemplate.includes('expanded-height="{{courseSheetHeight}}"') &&
    !timetablePageTemplate.includes("用户所在时区") &&
    timetablePageScript.includes("function courseSheetHeight(") &&
    timetablePageScript.includes("const detailValues = [") &&
    timetablePageScript.includes(
      "courseSheetHeight: courseSheetHeight(course)",
    ) &&
    timetablePageScript.includes("function viewportSheetHeight(") &&
    timetablePageScript.includes("contentHeightRpx,\n    44,\n    82,") &&
    bottomSheetScript.includes("expandedHeight: { type: Number, value: 86 }") &&
    bottomSheetTemplate.includes("'height:' + expandedHeight + 'vh;'") &&
    timetablePageTemplate.includes('bindtap="openCoursePassRate"') &&
    timetablePageTemplate.includes("查看通过率") &&
    timetablePageTemplate.includes(
      '<lucide-icon name="chevron-right" tone="white" size="{{28}}"',
    ) &&
    /\.course-sheet-hero-main\s*\{[^}]*align-items:\s*center/s.test(
      timetablePageStyles,
    ) &&
    /\.course-pass-rate-action\s*\{[^}]*align-self:\s*center[^}]*min-height:\s*64rpx[^}]*font-size:\s*22rpx/s.test(
      timetablePageStyles,
    ) &&
    timetablePageTemplate.includes(
      '<bottom-sheet visible="{{passRateSheetVisible}}" expanded="{{true}}"',
    ) &&
    timetablePageTemplate.includes(
      'expanded-height="{{passRateSheetHeight}}"',
    ) &&
    timetablePageScript.includes("function passRateSheetHeight(") &&
    timetablePageScript.includes('input.status === "ready"') &&
    timetablePageScript.includes(
      "passRateSheetHeight: passRateSheetHeight({",
    ) &&
    timetablePageTemplate.includes("<pass-rate-card") &&
    passRatePageTemplate.includes("<pass-rate-card") &&
    passRateCardTemplate.includes('id="pass-rate-ring-canvas"') &&
    timetablePageScript.includes("courseStatisticsKey(selectedCourse.name)") &&
    timetablePageScript.includes("await getPassRates(courseKey)"),
  "课程详情必须直接展开，并从课程卡片打开复用的当前课程通过率统计卡片",
);
assert(
  timetablePageTemplate.includes("refresh-confirmation--visible") &&
    /},\s*3000\);/.test(timetablePageScript) &&
    timetablePageScript.includes("const succeeded = await this.loadTimetable"),
  "手动刷新成功后必须显示三秒的非阻塞完成反馈",
);

console.log("Timetable preview checks passed.");
