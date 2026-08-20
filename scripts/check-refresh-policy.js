const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function source(...segments) {
  return fs.readFileSync(
    path.resolve(__dirname, "..", "miniprogram", ...segments),
    "utf8",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cachePolicySource = source("store", "cache-policy.ts");
const output = ts.transpileModule(cachePolicySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const cachePolicyModule = { exports: {} };
new Function("module", "exports", output)(
  cachePolicyModule,
  cachePolicyModule.exports,
);
const { DAY_MS, FIFTEEN_DAYS_MS, isCacheStale } = cachePolicyModule.exports;

assert(
  FIFTEEN_DAYS_MS === 15 * DAY_MS &&
    !isCacheStale(
      { serverFetchedAt: "", localStoredAt: 1_000 },
      FIFTEEN_DAYS_MS,
      1_000 + FIFTEEN_DAYS_MS - 1,
    ) &&
    isCacheStale(
      { serverFetchedAt: "", localStoredAt: 1_000 },
      FIFTEEN_DAYS_MS,
      1_000 + FIFTEEN_DAYS_MS,
    ),
  "成绩和课表自动刷新阈值必须是完整的 15 天",
);

const stableDataConsumers = [
  ["首页", source("pages", "home", "index.ts")],
  ["成绩页", source("pages", "grades", "index.ts")],
  ["日程页", source("pages", "schedule", "index.ts")],
  ["课表页", source("pages", "timetable", "index.ts")],
];
for (const [label, pageSource] of stableDataConsumers) {
  assert(
    pageSource.includes("FIFTEEN_DAYS_MS") &&
      !pageSource.includes("WEEK_MS"),
    `${label}必须统一使用 15 天成绩/课表刷新阈值`,
  );
}

const homeSource = stableDataConsumers[0][1];
const inboxSource = source("pages", "inbox", "index.ts");
assert(
  homeSource.includes("refresh: refreshTeaching") &&
    homeSource.includes("refresh: refreshStable") &&
    homeSource.includes("this.loadDashboard(false, false, false, false)") &&
    !homeSource.includes("this.loadDashboard(true, includeStableRefresh)") &&
    inboxSource.includes("this.loadMessages(false, true, false, false)") &&
    inboxSource.includes("this.loadNotices(false, true, false, false)") &&
    inboxSource.includes("this.loadMessages(true, true, true)") &&
    inboxSource.includes("this.loadNotices(true, true, true)"),
  "消息和通知后台回读不得伪装成手动刷新，用户主动刷新仍必须绕过缓存间隔",
);

console.log("Refresh policy checks passed.");
