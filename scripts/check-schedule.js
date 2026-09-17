const { readSource } = require("./read-source");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadScheduleData() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "schedule.ts",
  );
  const output = ts.transpileModule(readSource(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function loadScheduleRender(scheduleModule) {
  const timetablePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable.ts",
  );
  const renderPath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "schedule-render.ts",
  );
  const load = (sourcePath, resolve) => {
    const output = ts.transpileModule(readSource(sourcePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    const record = { exports: {} };
    new Function("module", "exports", "require", output)(
      record,
      record.exports,
      resolve,
    );
    return record.exports;
  };
  const timetableModule = load(timetablePath, require);
  return load(renderPath, (request) => {
    if (request === "./timetable") return timetableModule;
    if (request === "./schedule") return scheduleModule;
    if (request === "../utils/date") {
      return {
        formatFriendlyDate: (date) => date,
        toDateString: (date) => date.toISOString().slice(0, 10),
      };
    }
    return require(request);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const schedule = loadScheduleData();
const scheduleRender = loadScheduleRender(schedule);
const laidOut = schedule.layoutScheduleOverlaps([
  { id: "course", top: 0, height: 100 },
  { id: "plan", top: 50, height: 100 },
  { id: "later-course", top: 100, height: 40 },
  { id: "separate", top: 150, height: 40 },
]);
const byId = new Map(laidOut.map((entry) => [entry.id, entry]));
assert(
  byId.get("course").columnCount === 2 &&
    byId.get("plan").columnCount === 2 &&
    byId.get("later-course").columnCount === 2,
  "相互连接的课程和待办重叠组必须统一分成两列",
);
assert(
  byId.get("course").column === 0 &&
    byId.get("plan").column === 1 &&
    byId.get("later-course").column === 0,
  "重叠条目必须复用首个已经空闲的列",
);
assert(
  byId.get("separate").columnCount === 1 &&
    byId.get("separate").widthPercent === 100,
  "与上一组不再重叠的安排必须恢复为整行宽度",
);

assert(
  JSON.stringify(schedule.defaultPlanEnd("2026-08-19", "23:30")) ===
    JSON.stringify({ endDate: "2026-08-20", endTime: "00:30" }),
  "跨午夜的待办默认结束日期必须自动顺延一天",
);
assert(
  JSON.stringify(schedule.nextWholeHour(new Date(2026, 7, 19, 20, 0))) ===
    JSON.stringify({ startDate: "2026-08-19", startTime: "21:00" }) &&
    JSON.stringify(schedule.nextWholeHour(new Date(2026, 7, 19, 23, 15))) ===
      JSON.stringify({ startDate: "2026-08-20", startTime: "00:00" }),
  "添加待办的开始时间必须取下一个整点并正确跨日",
);

const summerTimetable = {
  semester: { id: "2026-1", term: 1 },
  semesterCalendar: {
    semesterId: "2026-1",
    startDate: "2026-08-31",
    endDate: "2027-01-17",
  },
  currentSemester: { term: 2, startDate: "2026-03-02", endDate: "2026-08-09" },
};
assert(
  schedule.vacationLabelForDate(summerTimetable, "2026-08-19") === "暑假",
  "第二学期结束到第一学期开始之间必须显示暑假",
);
const thirdTermTimetable = {
  semester: { id: "2025-2", term: 2 },
  semesterCalendar: {
    semesterId: "2025-2",
    startDate: "2026-02-23",
    endDate: "2026-07-12",
    weeks: [],
  },
  currentSemester: {
    id: "2025-3",
    term: 3,
    startDate: "2026-07-20",
    endDate: "2026-08-09",
  },
};
assert(
  schedule.vacationLabelForDate(thirdTermTimetable, "2026-07-15") === "暑假" &&
    schedule.vacationLabelForDate(thirdTermTimetable, "2026-07-20") === null &&
    schedule.vacationLabelForDate(thirdTermTimetable, "2026-08-09") === null &&
    schedule.vacationLabelForDate(thirdTermTimetable, "2026-08-10") === "暑假",
  "第二学期与第三学期之间保留暑假，第三学期内不得显示暑假",
);
const thirdTermDay = scheduleRender.buildScheduleDayView(
  { ...thirdTermTimetable, courses: [], additionalCourses: [] },
  [{ weekday: 1, date: "2026-07-20", isToday: true }],
  [],
  1,
);
assert(
  thirdTermDay.teachingWeekLabel === "第 1 教学周",
  "已进入第三学期时，即使保留第二学期课表也必须显示第三学期教学周",
);
const winterTimetable = {
  semester: { id: "2025-2", term: 2 },
  semesterCalendar: {
    semesterId: "2025-2",
    startDate: "2026-02-23",
    endDate: "2026-07-12",
  },
  currentSemester: { term: 1, startDate: "2025-09-01", endDate: "2026-01-18" },
};
assert(
  schedule.vacationLabelForDate(winterTimetable, "2026-02-02") === "寒假",
  "第一学期结束到第二学期开始之间必须显示寒假",
);
assert(
  schedule.vacationLabelForDate(null, "2026-08-19") === null,
  "缺少上游学期边界时不得按月份硬编码寒暑假",
);

const template = readSource(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "pages",
    "schedule",
    "index.wxml",
  ),
  "utf8",
);
const pageScript = readSource(
  path.resolve(__dirname, "..", "miniprogram", "pages", "schedule", "index.ts"),
  "utf8",
);
const renderScript = readSource(
  path.resolve(__dirname, "..", "miniprogram", "data", "schedule-render.ts"),
  "utf8",
);
const timetableScript = readSource(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "features",
    "pages",
    "timetable",
    "index.ts",
  ),
  "utf8",
);
const homeScript = readSource(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.ts"),
  "utf8",
);
const pageStyles = readSource(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "pages",
    "schedule",
    "index.wxss",
  ),
  "utf8",
).replace(/([^;{}])}/g, "$1;}");
assert(
  !/import\s+\w+\s*=\s*WechatMiniprogram/.test(pageScript),
  "日程页类型别名不得在开发者工具中生成动态 require",
);
const dashedCornerAssets = [24, 30].map((size) =>
  readSource(
    path.resolve(
      __dirname,
      "..",
      "miniprogram",
      "assets",
      "images",
      `schedule-dashed-corner-${size}.svg`,
    ),
    "utf8",
  ),
);
const tabTemplate = readSource(
  path.resolve(__dirname, "..", "miniprogram", "custom-tab-bar", "index.wxml"),
  "utf8",
);
assert(
  template.includes(
    'class="week-selection week-selection-slot-{{week.slot}}"',
  ) && template.includes('wx:if="{{item.hasPlan}}" class="week-day-dot"'),
  "日期选择器必须使用独立滑动圆形，并在有待办的日期下显示圆点",
);
assert(
  template.includes('scrollable="{{false}}"') &&
    template.includes('expanded-height="{{creatorSheetHeight}}"') &&
    template.includes('animate-height="{{true}}"') &&
    pageScript.includes('creatorSheetHeight: creatorMode === "course" ? 70 : 58'),
  "添加抽屉必须绕开 Skyline 插槽列表测量并平滑调整高度",
);
assert(
  renderScript.includes("const allEntries = [...courses, ...planEntries]") &&
    !template.includes("重叠安排并排显示"),
  "日程时间轴必须合并课程与待办后统一计算重叠分列",
);
assert(
  pageScript.includes("this.setTabBarHidden(true)") &&
    tabTemplate.includes('wx:if="{{!hidden}}"'),
  "添加待办抽屉打开时必须退出自定义底部导航层",
);
assert(
  template.includes('class="week-day-today-ring"') &&
    !template.includes("默认晚 1 小时") &&
    !template.includes('class="week-day pressable') &&
    !template.includes('hover-class="week-day--pressed"') &&
    !pageStyles.includes(".week-day--pressed") &&
    template.includes('class="primary-button creator-submit"') &&
    /\.primary-button\.creator-submit\s*\{[^}]*background:\s*#d97757;/.test(
      pageStyles,
    ),
  "今天必须有数字外轮廓，日期不得缩放反馈，表单文案与提交按钮必须保持精简实色",
);
assert(
  template.includes('bindtap="openPlanEditor"') &&
    template.includes('bindtap="deletePlan"') &&
    template.includes('bindtap="savePlan"') &&
    pageScript.includes("openPlanEditor(") &&
    pageScript.includes("deletePlan()") &&
    pageScript.includes("plan.id === editingPlanId"),
  "用户日程必须能够点击进入编辑，并支持保存或确认删除",
);
assert(
  template.includes('class="plan-dashed-border"') &&
    template.includes("plan-border-corner--top-left") &&
    template.includes("plan-border-corner--top-right") &&
    template.includes("plan-border-corner--bottom-right") &&
    template.includes("plan-border-corner--bottom-left") &&
    template.includes('src="{{item.cornerAsset}}"') &&
    renderScript.includes("/assets/images/schedule-dashed-corner-24.svg") &&
    renderScript.includes("/assets/images/schedule-dashed-corner-30.svg") &&
    template.includes("plan-check--checked") &&
    template.includes('name="check" tone="white" size="{{28}}"') &&
    /\.plan-dashed-border\s*\{[^}]*border:\s*3rpx dashed #c2767a;[^}]*border-radius:\s*30rpx;/s.test(
      pageStyles,
    ) &&
    /\.plan-border-corners\s*\{[^}]*pointer-events:\s*none;/s.test(
      pageStyles,
    ) &&
    /\.plan-border-corner--top-right\s*\{[^}]*transform:\s*rotate\(90deg\);/s.test(
      pageStyles,
    ) &&
    /\.plan-border-corner--bottom-right\s*\{[^}]*transform:\s*rotate\(180deg\);/s.test(
      pageStyles,
    ) &&
    /\.plan-border-corner--bottom-left\s*\{[^}]*transform:\s*rotate\(270deg\);/s.test(
      pageStyles,
    ) &&
    dashedCornerAssets.every(
      (asset) =>
        asset.includes('stroke-dasharray="6 3"') &&
        !asset.includes('stroke-linecap=') || asset.includes('stroke-linecap="butt"'),
    ) &&
    template.includes('class="entry-strike entry-strike--title"') &&
    template.includes('class="entry-strike entry-strike--meta"') &&
    /\.entry-copy\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s.test(
      pageStyles,
    ) &&
    /\.entry-line\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s.test(
      pageStyles,
    ) &&
    /\.entry-title\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s.test(
      pageStyles,
    ) &&
    /\.entry-meta\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s.test(
      pageStyles,
    ) &&
    /\.entry-strike\s*\{[^}]*height:\s*4rpx;[^}]*border-radius:\s*999rpx;/s.test(
      pageStyles,
    ) &&
    /\.plan-check--checked\s*\{[^}]*background:\s*#a55357;/s.test(pageStyles) &&
    /\.timeline-entry--done \.entry-copy\s*\{[^}]*opacity:\s*0\.55;/s.test(
      pageStyles,
    ) &&
    !/\.timeline-entry--done\s*\{[^}]*opacity:/.test(pageStyles) &&
    /\?\s*"日程"\s*:\s*`日程 · 延续至 \$\{plan.endDate\}`/.test(renderScript),
  "用户日程必须使用圆角虚线，完成后划除标题与时间，并显示日程类型",
);
assert(
  renderScript.includes("export function prewarmScheduleFirstScreen(") &&
    renderScript.includes("buildScheduleWeekView(") &&
    pageScript.includes("getWarmScreen(account)") &&
    /Object\.assign\(patch,\s*warm\.view\)/.test(pageScript) &&
    pageScript.includes("getPreloadedTimetable()") &&
    pageScript.includes("getPreloadedSchedule()"),
  "日程页必须复用启动时预构建的首屏与静默请求",
);
assert(
  pageScript.includes("getPreferencesRevision()") &&
    pageScript.includes("getTimetableRevision()") &&
    pageScript.includes("getScheduleRevision()") &&
    pageScript.includes("scheduleSourcesAreCurrent(account)") &&
    /onShow\(\)[\s\S]*?this\.hydrateCachedScheduleIfNeeded\(account\)[\s\S]*?this\.scheduleBackgroundRefresh\(REFRESH_DELAY\)/.test(
      pageScript,
    ) &&
    /const REFRESH_DELAY\s*=\s*520;/.test(pageScript) &&
    /scheduleBackgroundRefresh\(delay:\s*number\)[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?this\.loadTimetable\(\)[\s\S]*?this\.syncSchedule\(\)/.test(
      pageScript,
    ),
  "日程页返回时必须按数据版本复用页面状态，并在底栏动画结束后静默同步",
);
assert(
  /\.timeline-legend > view\s*\{[^}]*flex:\s*none;[^}]*white-space:\s*nowrap;/s.test(
    pageStyles,
  ) &&
    !pageStyles.includes(".legend-note") &&
    /\.schedule-page\.theme-style-minimal \.legend-square--course\s*\{[^}]*border:\s*2rpx solid var\(--color-text\);[^}]*background-color:\s*var\(--color-text\);/s.test(
      pageStyles,
    ) &&
    /\.schedule-page\.theme-style-minimal \.legend-square--plan\s*\{[^}]*border-color:\s*var\(--color-text\);[^}]*background-color:\s*var\(--color-bg\);/s.test(
      pageStyles,
    ),
  "图例项目必须保持独立宽度且不得被附加说明挤压重叠",
);
assert(
  !template.includes('bindtap="openTimetable"') &&
    !pageScript.includes("openTimetable()") &&
    timetableScript.includes('options.source === "schedule"') &&
    timetableScript.includes("MODAL_HEADER_EDGE_INSET_RPX") &&
    timetableScript.includes("backgroundMetrics(this.data.compactHeader)") &&
    homeScript.includes('navigateTo("/features/pages/timetable/index")'),
  "日程页不显示课表跳转按钮，课程详情和首页入口仍保持正确导航",
);
assert(
  template.includes(
    `name="plus" tone="{{liquidGlass?(theme==='dark'?'white':'ink'):(visualTheme==='minimal'?(theme==='dark'?'white':'ink'):'white')}}"`,
  ) && !template.includes('name="plus" tone="white"'),
  "极简主题浅色模式的日程新增按钮必须使用深色加号",
);
assert(
  /\.schedule-page\.theme-style-minimal \.week-day-today-ring\s*\{[^}]*border-color:\s*var\(--color-text\);[^}]*border-radius:\s*0;/s.test(
    pageStyles,
  ),
  "极简主题的今日日期轮廓必须使用黑白方框",
);

console.log("Schedule checks passed.");
