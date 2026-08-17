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

const template = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
assert(
  template.includes('<root-portal enable="{{messageFilterMounted}}">') &&
    template.includes('<button class="message-type-option"'),
  "筛选选项必须提升到 root-portal 并使用独立原生按钮",
);
assert(
  /\.message-filter-popover\s*\{[^}]*width:\s*212rpx/s.test(styles),
  "筛选浮窗宽度必须与两字标签和勾选图标相匹配",
);

console.log("Inbox interaction checks passed.");
