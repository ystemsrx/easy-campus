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
const {
  DAY_MS,
  FIFTEEN_DAYS_MS,
  isCacheStale,
  isUpstreamRefreshResult,
  shouldStoreServerSnapshot,
} = cachePolicyModule.exports;

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

const localSnapshot = {
  serverFetchedAt: "2026-08-30T00:00:00.000Z",
  localStoredAt: 1_000,
};
assert(
  !isUpstreamRefreshResult({ cached: true }) &&
    !isUpstreamRefreshResult({ cached: false, stale: true }) &&
    isUpstreamRefreshResult({ cached: false }) &&
    !shouldStoreServerSnapshot(
      localSnapshot,
      { cached: true, fetchedAt: "2026-08-31T00:00:00.000Z" },
      true,
    ) &&
    !shouldStoreServerSnapshot(localSnapshot, {
      cached: true,
      stale: true,
      fetchedAt: "2026-08-31T00:00:00.000Z",
    }) &&
    shouldStoreServerSnapshot(localSnapshot, {
      cached: true,
      fetchedAt: "2026-08-31T00:00:00.000Z",
    }) &&
    shouldStoreServerSnapshot(
      localSnapshot,
      { cached: false, fetchedAt: "2026-08-31T00:00:00.000Z" },
      true,
    ),
  "限流缓存和失败兜底不得覆盖本地快照，普通新快照和真实刷新仍应写入",
);

const stableDataConsumers = [
  ["首页", source("pages", "home", "index.ts")],
  ["成绩页", source("features", "pages", "grades", "index.ts")],
  ["日程页", source("pages", "schedule", "index.ts")],
  ["课表页", source("features", "pages", "timetable", "index.ts")],
];
for (const [label, pageSource] of stableDataConsumers) {
  assert(
    pageSource.includes("FIFTEEN_DAYS_MS") && !pageSource.includes("WEEK_MS"),
    `${label}必须统一使用 15 天成绩/课表刷新阈值`,
  );
}

const homeSource = stableDataConsumers[0][1];
const inboxSource = source("features", "pages", "inbox", "index.ts");
const cacheRefreshSource = source("services", "cache-refresh.ts");
const electricityServiceSource = source("services", "electricity.ts");
const refreshFeedbackSource = source(
  "features",
  "utils",
  "refresh-feedback.ts",
);
const refreshConfirmationSource = source(
  "components",
  "refresh-confirmation",
  "refresh-confirmation.ts",
);
const refreshConfirmationTemplate = source(
  "components",
  "refresh-confirmation",
  "refresh-confirmation.wxml",
);
assert(
  refreshFeedbackSource.includes('component?.show?.("刷新失败，请稍后重试")') &&
    refreshConfirmationSource.includes('message: "已刷新"') &&
    refreshConfirmationTemplate.includes("{{message}}"),
  "统一刷新胶囊必须同时支持成功和失败文案",
);
assert(
  homeSource.includes("refreshElectricityOnForeground()") &&
    cacheRefreshSource.includes("getElectricityAccount()") &&
    cacheRefreshSource.includes("queryElectricity({") &&
    cacheRefreshSource.includes('from "./electricity"') &&
    !cacheRefreshSource.includes("features/services") &&
    electricityServiceSource.includes('"/utilities/electricity/account"') &&
    electricityServiceSource.includes('"/utilities/electricity/query"') &&
    cacheRefreshSource.includes("isCacheStale(current, DAY_MS)") &&
    !isCacheStale(
      { serverFetchedAt: "", localStoredAt: 1_000 },
      DAY_MS,
      1_000 + DAY_MS - 1,
    ) &&
    isCacheStale(
      { serverFetchedAt: "", localStoredAt: 1_000 },
      DAY_MS,
      1_000 + DAY_MS,
    ),
  "首页进入前台时必须读取电费绑定，并在快照满一天后静默刷新余额",
);
assert(
  homeSource.includes("refresh: refreshTeaching") &&
    homeSource.includes("refresh: refreshStable") &&
    homeSource.includes("this.loadDashboard(false, false, false, false)") &&
    !homeSource.includes("this.loadDashboard(true, includeStableRefresh)") &&
    inboxSource.includes("this.loadMessages(false, true, false, false)") &&
    inboxSource.includes("this.loadNotices(false, true, false, false)") &&
    inboxSource.includes("refreshInboxMessages") &&
    inboxSource.includes("refreshInboxNotices"),
  "消息和通知后台回读不得伪装成手动刷新，用户主动刷新仍必须绕过缓存间隔",
);

const manualRefreshPages = [
  ["calendar", "features", "pages", "calendar"],
  ["electricity", "features", "pages", "electricity"],
  ["exams", "features", "pages", "exams"],
  ["grades", "features", "pages", "grades"],
  ["inbox", "features", "pages", "inbox"],
  ["timetable", "features", "pages", "timetable"],
];
const refreshResumeMethods = {
  calendar: ["syncActiveCalendarRefresh"],
  electricity: ["syncActiveElectricityRefresh"],
  exams: ["syncActiveExamsRefresh"],
  grades: ["syncActiveGradesRefresh"],
  inbox: ["syncActiveMessageRefresh", "syncActiveNoticeRefresh"],
  timetable: ["syncActiveTimetableRefresh"],
};
for (const [page, ...pageSegments] of manualRefreshPages) {
  const pageSource = source(...pageSegments, "index.ts");
  assert(
    source(...pageSegments, "index.wxml").includes(
      '<refresh-confirmation id="refresh-confirmation"',
    ) && pageSource.includes("showRefreshConfirmation(this)"),
    `${page} 手动刷新成功后必须显示统一的完成反馈`,
  );
  assert(
    pageSource.includes("showRefreshFailure(this)"),
    `${page} 手动刷新失败后必须显示统一的失败反馈`,
  );
  assert(
    pageSource.includes("startRefreshFlight(") &&
      pageSource.includes("findRefreshFlight<") &&
      pageSource.includes("markRefreshPageVisible(") &&
      pageSource.includes("markRefreshPageHidden(") &&
      pageSource.includes("isRefreshPageVisible("),
    `${page} 手动刷新必须跨页面生命周期复用同一任务并按前台状态反馈`,
  );
  const onLoadStart = pageSource.indexOf("  onLoad(");
  const onShowStart = pageSource.indexOf("\n  onShow(", onLoadStart);
  const onLoadSource = pageSource.slice(onLoadStart, onShowStart);
  assert(
    onLoadStart >= 0 &&
      onShowStart > onLoadStart &&
      refreshResumeMethods[page].every((method) =>
        onLoadSource.includes(`this.${method}()`),
      ),
    `${page} 页面重建时必须立即恢复未完成刷新任务的加载态`,
  );
}

const calendarTemplate = source("features", "pages", "calendar", "index.wxml");
assert(
  !calendarTemplate.includes("refresher-") &&
    !calendarTemplate.includes("bindrefresherrefresh") &&
    calendarTemplate.includes('bindtap="onRefresh"'),
  "教学日历必须使用明确的刷新按钮，避免 Skyline 报 Cannot find refresher",
);

async function checkRefreshFlights() {
  const refreshFlightSource = source("features", "utils", "refresh-flight.ts");
  const refreshFlightOutput = ts.transpileModule(refreshFlightSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const refreshFlightModule = { exports: {} };
  new Function("module", "exports", refreshFlightOutput)(
    refreshFlightModule,
    refreshFlightModule.exports,
  );
  const {
    createRefreshPageToken,
    findRefreshFlight,
    isRefreshPageVisible,
    markRefreshPageHidden,
    markRefreshPageVisible,
    startRefreshFlight,
  } = refreshFlightModule.exports;

  let release = () => undefined;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requestCount = 0;
  const first = startRefreshFlight("same-resource", async () => {
    requestCount += 1;
    await gate;
    return "done";
  });
  const second = startRefreshFlight("same-resource", async () => {
    requestCount += 1;
    return "duplicate";
  });
  assert(
    first.started &&
      !second.started &&
      first.flight === second.flight &&
      findRefreshFlight("same-resource") === first.flight,
    "同一刷新键在完成前必须返回同一个任务",
  );
  await Promise.resolve();
  assert(requestCount === 1, "重复刷新不得再次执行请求函数");

  const pageToken = createRefreshPageToken();
  markRefreshPageVisible(pageToken);
  assert(isRefreshPageVisible(pageToken), "刷新页面进入前台后必须可被识别");
  markRefreshPageHidden(pageToken);
  assert(!isRefreshPageVisible(pageToken), "刷新页面离开前台后必须静默");

  release();
  assert((await first.flight.completion) === "done", "原刷新任务必须继续完成");
  assert(
    findRefreshFlight("same-resource") === null,
    "刷新完成后必须释放单飞键以允许下次刷新",
  );
}

void checkRefreshFlights()
  .then(() => console.log("Refresh policy checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
