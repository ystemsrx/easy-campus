const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pageRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "features",
  "pages",
  "inbox",
);
const source = fs.readFileSync(path.join(pageRoot, "index.ts"), "utf8");
const homeRoot = path.resolve(__dirname, "..", "miniprogram", "pages", "home");
const homeSource = fs.readFileSync(path.join(homeRoot, "index.ts"), "utf8");
const homeTemplate = fs.readFileSync(path.join(homeRoot, "index.wxml"), "utf8");
const noticeDetailRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "features",
  "pages",
  "browser",
);
const noticeDetailSource = fs.readFileSync(
  path.join(noticeDetailRoot, "index.ts"),
  "utf8",
);
const noticeDetailTemplate = fs.readFileSync(
  path.join(noticeDetailRoot, "index.wxml"),
  "utf8",
);
const noticeDetailStyles = fs.readFileSync(
  path.join(noticeDetailRoot, "index.wxss"),
  "utf8",
);
const semesterSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "semester.ts"),
  "utf8",
);
const teachingPreviewSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "teaching-preview.ts"),
  "utf8",
);
const semesterOutput = ts.transpileModule(semesterSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const semesterModule = { exports: {} };
new Function("module", "exports", "require", semesterOutput)(
  semesterModule,
  semesterModule.exports,
  require,
);
const { isLatestSchoolNoticeSemesterAssignment, latestSchoolNoticeSemesterId } =
  semesterModule.exports;
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

let cachedPreview = null;
let cachedTimetable = null;
const navigationCalls = [];
const stubs = {
  "../../../services/teaching": {
    getMessages: async () => ({ data: { items: [] }, meta: {} }),
    getNotices: async () => ({ data: { items: [] }, meta: {} }),
  },
  "../../../services/request": { getErrorMessage: () => "" },
  "../../../store/session": {
    getSession: () => ({ user: { account: "test" } }),
    captureSessionLease: () => ({
      token: "test-token",
      userId: "test-user",
      account: "test",
      signedInAt: 1,
    }),
    isSessionLeaseCurrent: () => true,
    sessionLeaseKey: () => "test-session",
  },
  "../../../store/teaching-preview": {
    cleanupTeachingPreview: () => null,
    loadTeachingPreview: () => cachedPreview,
    saveTeachingPreview: () => undefined,
  },
  "../../../store/timetable": {
    loadTimetableSnapshot: () => cachedTimetable,
  },
  "../../../utils/appearance": { resolveAppearance: () => ({}) },
  "../../../utils/date": { formatDateTime: (value) => value },
  "../../../utils/format": { formatSchedule: () => "" },
  "../../../utils/haptics": { haptic: () => undefined },
  "../../../utils/navigation": {
    ensureAuthenticated: () => true,
    navigateTo: async (...args) => {
      navigationCalls.push(args);
      return true;
    },
  },
  "../../utils/refresh-feedback": {
    showRefreshConfirmation: () => undefined,
  },
  "../../utils/refresh-flight": {
    createRefreshPageToken: () => 1,
    findRefreshFlight: () => null,
    isRefreshPageVisible: () => true,
    markRefreshPageHidden: () => undefined,
    markRefreshPageVisible: () => undefined,
    startRefreshFlight: () => ({
      started: true,
      flight: { id: 1, key: "test", completion: Promise.resolve(null) },
    }),
  },
  "../../../utils/semester": {
    ...semesterModule.exports,
    startedCurrentSemester: (timetable) =>
      semesterModule.exports.startedCurrentSemester(timetable, "2026-08-31"),
  },
};

let pageDefinition;
const moduleRecord = { exports: {} };
new Function("module", "exports", "require", "Page", output)(
  moduleRecord,
  moduleRecord.exports,
  (request) => {
    if (stubs[request]) return stubs[request];
    throw new Error(`Unexpected inbox dependency: ${request}`);
  },
  (definition) => {
    pageDefinition = definition;
  },
);

assert(pageDefinition, "消息页应当成功注册 Page 定义");
assert(
  source.includes("const MESSAGE_PAGE_SIZE = 15;") &&
    source.includes("const NOTICE_PAGE_SIZE = 50;") &&
    /getNotices\(\{[\s\S]*?page:\s*1,[\s\S]*?pageSize:\s*50,[\s\S]*?refresh:\s*refreshTeaching/.test(
      homeSource,
    ) &&
    teachingPreviewSource.includes("const MESSAGE_ITEM_LIMIT = 15;") &&
    teachingPreviewSource.includes("const NOTICE_ITEM_LIMIT = 50;") &&
    teachingPreviewSource.includes("const NOTICE_SCHEMA_VERSION = 3;"),
  "教务消息必须继续保留十五条，学校通知列表和本地缓存必须保留最多五十条",
);
let loadCount = 0;
const page = {
  ...pageDefinition,
  data: structuredClone(pageDefinition.data),
  setData(patch, callback) {
    this.data = { ...this.data, ...patch };
    callback?.();
  },
  loadMessages() {
    loadCount += 1;
  },
};

function select(index) {
  page.selectMessageType({ currentTarget: { dataset: { index } } });
}

select(1);
assert(
  page.data.messageTypes.join(",") === "course_rescheduled" &&
    page.data.messageTypeOptions[1].selected === true &&
    page.data.messageTypeOptions[0].selected === false,
  "点击调课后必须立即显示勾选并取消全部状态",
);
select(3);
assert(
  page.data.messageTypes.join(",") === "course_rescheduled,course_cancelled" &&
    page.data.messageTypeOptions[3].selected === true,
  "消息筛选必须支持同时勾选多个类型",
);
select(1);
assert(
  page.data.messageTypes.join(",") === "course_cancelled" &&
    page.data.messageTypeOptions[1].selected === false,
  "再次点击已选类型必须取消勾选",
);
select(0);
assert(
  page.data.messageTypes.length === 0 &&
    page.data.messageTypeOptions[0].selected === true &&
    page.data.messageTypeOptions.slice(1).every((item) => !item.selected),
  "点击全部必须清除其他筛选并恢复全部勾选",
);
assert(loadCount === 4, "每次筛选变化都必须重新读取对应消息");

page.openNotice({
  currentTarget: {
    dataset: {
      id: "notice-id",
      link: "https://example.test/notice",
      title: "测试通知",
      publishedAt: "2026-08-23 12:00:00",
    },
  },
});
assert(
  navigationCalls.length === 1 &&
    navigationCalls[0].length === 1 &&
    navigationCalls[0][0].startsWith("/features/pages/browser/index?"),
  "通知详情必须使用微信标准右侧页面转场",
);

cachedTimetable = {
  data: {
    semester: { id: "2026-1" },
    currentSemester: {
      id: "2026-1",
      startDate: "2026-08-31",
      endDate: "2027-01-17",
    },
    semesterCalendar: null,
  },
};
cachedPreview = {
  messages: [
    {
      id: "historical-message-newer",
      type: "other",
      title: "较新的历史消息",
      content: "历史内容",
      createdAt: "2026-08-30 08:00:00",
    },
    {
      id: "historical-message-older",
      type: "other",
      title: "较早的历史消息",
      content: "历史内容",
      createdAt: "2026-08-29 08:00:00",
    },
  ],
  notices: [
    {
      id: "historical-notice-newer",
      title: "较新的历史通知",
      link: "https://example.test/history-newer",
      publishedAt: "2026-08-30 09:00:00",
    },
    {
      id: "historical-notice-older",
      title: "较早的历史通知",
      link: "https://example.test/history-older",
      publishedAt: "2026-08-29 09:00:00",
    },
  ],
};
page.hydrateCachedPreview();
assert(
  page.data.messageItems.length === 2 &&
    page.data.messageItems[0].showHistoryDivider === true &&
    page.data.messageItems[1].showHistoryDivider === false &&
    page.data.noticeItems.length === 2 &&
    page.data.noticeItems[0].showHistoryDivider === true &&
    page.data.noticeItems[1].showHistoryDivider === false,
  "没有本学期数据时，校园消息页必须保留两类旧数据并只在首条前标记历史分界",
);

const schoolNoticeSegments = [
  { semesterId: "2026-1", publishedAt: "2026-07-10" },
  { semesterId: "2025-3", publishedAt: "2026-06-25" },
  { semesterId: "2025-3", publishedAt: "2026-06-24" },
  { semesterId: "2025-2", publishedAt: "2026-06-20" },
];
const latestSchoolNoticeSemester =
  latestSchoolNoticeSemesterId(schoolNoticeSegments);
assert(
  latestSchoolNoticeSemester === "2026-1" &&
    isLatestSchoolNoticeSemesterAssignment(
      schoolNoticeSegments[0].semesterId,
      latestSchoolNoticeSemester,
      schoolNoticeSegments[0].publishedAt,
      null,
    ) &&
    !isLatestSchoolNoticeSemesterAssignment(
      schoolNoticeSegments[1].semesterId,
      latestSchoolNoticeSemester,
      schoolNoticeSegments[1].publishedAt,
      null,
    ) &&
    source.includes(
      "const showHistoryDivider = historical && !historyStarted",
    ) &&
    source.includes("latestSchoolNoticeSemesterId(items)"),
  "学校通知必须在夏季学期及下一学年首条有效通知处依次切换历史分界",
);

assert(
  /case "other":[\s\S]*?dateLabel: formatDateTime\(message\.createdAt\),[\s\S]*?label: "消息"/.test(
    homeSource,
  ) &&
    (homeSource.match(/dateLabel: formatScheduleDate\(/g) || []).length === 3 &&
    homeTemplate.includes(
      '<text wx:if="{{item.dateLabel}}" class="campus-line-schedule">{{item.dateLabel}}</text>',
    ),
  "主页普通消息必须显示消息时间，课程消息必须继续显示课程安排日期",
);

page.data.messageFilterMounted = true;
page.data.messageFilterOpen = true;
page.onPageTap();
assert(
  page.data.messageFilterOpen === false,
  "点击筛选浮窗外的页面区域必须立即开始收起浮窗",
);

const template = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
assert(
  template.includes('<navigation-bar title="校园通知"') &&
    !template.includes('title="学校通知与教务安排"'),
  "校园通知页顶部必须使用精简标题",
);
assert(
  noticeDetailTemplate.includes('<navigation-bar title="通知详情" back') &&
    !noticeDetailTemplate.includes("已整理为易读正文") &&
    !noticeDetailTemplate.includes("正文已在服务端清理危险标签") &&
    !noticeDetailTemplate.includes("共享缓存") &&
    !noticeDetailTemplate.includes("notice-footnote") &&
    !noticeDetailTemplate.includes("cache-label") &&
    !noticeDetailStyles.includes(".notice-footnote") &&
    !noticeDetailStyles.includes(".cache-label") &&
    !noticeDetailSource.includes("cached: result.meta.cached"),
  "通知详情不得展示正文处理或共享缓存等内部实现标签",
);
assert(
  noticeDetailTemplate.includes('class="notice-native-list-row"') &&
    noticeDetailTemplate.includes('class="notice-native-list-marker"') &&
    noticeDetailTemplate.includes('class="notice-native-list-spacer"') &&
    noticeDetailTemplate.includes('class="notice-native-list-body"') &&
    /\.notice-native-list-row\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap;/s.test(
      noticeDetailStyles,
    ) &&
    /\.notice-native-list-marker\s*\{[^}]*flex:\s*none;/s.test(
      noticeDetailStyles,
    ) &&
    /\.notice-native-list-spacer\s*\{[^}]*flex:\s*none;[^}]*width:\s*0\.5em;/s.test(
      noticeDetailStyles,
    ) &&
    /\.notice-native-list-body\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;/s.test(
      noticeDetailStyles,
    ),
  "通知详情序号列表必须使用独立原生行、固定序号列和可换行正文列",
);
assert(
  source.includes('return value.trim().replace(/老师/g, "").trim();') &&
    !source.includes("`${normalized}老师`"),
  "课程消息教师名称不得额外添加老师后缀",
);
assert(
  /\.inbox-content\s*\{[^}]*padding:\s*22rpx 40rpx 0/s.test(styles) &&
    /\.inbox-bottom-space\s*\{[^}]*height:\s*calc\(48rpx \+ env\(safe-area-inset-bottom\)\)/s.test(
      styles,
    ) &&
    !styles.includes("height: calc(104rpx + env(safe-area-inset-bottom));"),
  "校园通知列表底部只能保留一处紧凑的安全区占位",
);
assert(
  !template.includes("<root-portal") &&
    template.includes('bindtap="onPageTap"') &&
    template.includes('catchtap="openMessageFilter"') &&
    template.includes('<view class="message-filter-anchor">') &&
    template.includes('catchtap="selectMessageType"') &&
    template.includes('catchtap="keepMessageFilterOpen"'),
  "筛选浮窗必须在同一 Skyline 交互层，并支持点击外部收起",
);
assert(
  /\.message-filter-popover\s*\{[^}]*position:\s*absolute[^}]*width:\s*132rpx/s.test(
    styles,
  ) &&
    /\.message-filter-popover\s*\{[^}]*padding:\s*20rpx 19rpx 14rpx/s.test(
      styles,
    ),
  "筛选浮窗宽度必须与两字标签和勾选图标相匹配",
);
assert(
  /\.filter-button\s*\{[^}]*min-width:\s*140rpx[^}]*padding:\s*13rpx 26rpx/s.test(
    styles,
  ) &&
    /\.message-filter-heading\s*\{[^}]*width:\s*92rpx/s.test(styles) &&
    /\.message-type-option\s*\{[^}]*justify-content:\s*space-between[^}]*width:\s*92rpx/s.test(
      styles,
    ) &&
    /\.message-type-separator\s*\{[^}]*align-self:\s*center[^}]*width:\s*92rpx/s.test(
      styles,
    ) &&
    !styles.includes(".filter-button--active"),
  "筛选按钮必须保留充足内边距，并且筛选生效时只能显示角标",
);
assert(
  (template.match(/以下为历史消息/g) || []).length === 4 &&
    template.includes("item.showHistoryDivider") &&
    /\.history-divider\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s.test(
      styles,
    ) &&
    /\.history-divider-line\s*\{[^}]*height:\s*1rpx[^}]*background-color:\s*var\(--color-separator\)/s.test(
      styles,
    ),
  "教务消息和学校通知的历史分界必须使用居中文字与两侧灰线",
);
assert(
  template.includes("{{visualThemeClass}}") &&
    template.includes('visual-theme="{{visualTheme}}"') &&
    !template.includes("inbox-scroll-frame") &&
    !styles.includes("inbox-scroll-frame") &&
    (template.match(/<swiper-item>\s*<scroll-view class="inbox-list"/g) || [])
      .length === 2 &&
    /\.inbox-page\.theme-style-minimal \.segmented-control\s*\{[^}]*border:\s*2rpx solid var\(--color-text\);/s.test(
      styles,
    ) &&
    /\.inbox-page\.theme-style-minimal \.segment-indicator\s*\{[^}]*border-radius:\s*999rpx;[^}]*background-color:\s*var\(--color-primary\);/s.test(
      styles,
    ) &&
    /\.inbox-page\.theme-style-minimal \.message-card,[\s\S]*?\.inbox-page\.theme-style-minimal \.notice-item\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1rpx solid var\(--color-separator\);/s.test(
      styles,
    ),
  "校园通知页必须保留原始滚动结构，并仅在极简主题下使用带点睛色的极简视觉",
);

console.log("Inbox interaction checks passed.");
