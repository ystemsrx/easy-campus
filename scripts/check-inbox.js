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
  "pages",
  "inbox",
);
const source = fs.readFileSync(path.join(pageRoot, "index.ts"), "utf8");
const homeRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "pages",
  "home",
);
const homeSource = fs.readFileSync(path.join(homeRoot, "index.ts"), "utf8");
const homeTemplate = fs.readFileSync(path.join(homeRoot, "index.wxml"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const stubs = {
  "../../services/teaching": {
    getMessages: async () => ({ data: { items: [] }, meta: {} }),
    getNotices: async () => ({ data: { items: [] }, meta: {} }),
  },
  "../../services/request": { getErrorMessage: () => "" },
  "../../store/session": {
    getSession: () => ({ user: { account: "test" } }),
  },
  "../../store/teaching-preview": {
    cleanupTeachingPreview: () => null,
    loadTeachingPreview: () => null,
    saveTeachingPreview: () => undefined,
  },
  "../../utils/appearance": { resolveAppearance: () => ({}) },
  "../../utils/date": { formatDateTime: (value) => value },
  "../../utils/format": { formatSchedule: () => "" },
  "../../utils/haptics": { haptic: () => undefined },
  "../../utils/navigation": {
    ensureAuthenticated: () => true,
    navigateTo: async () => undefined,
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
  page.data.messageTypes.join(",") ===
    "course_rescheduled,course_cancelled" &&
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

console.log("Inbox interaction checks passed.");
