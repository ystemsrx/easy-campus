const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const storage = new Map();
const wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
};
const transpile = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
const cache = {};
new Function("require", "exports", "wx", transpile("features/store/notice-details.ts"))(
  (name) => {
    if (name === "../../store/cache-policy")
      return {
        DAY_MS: 86_400_000,
        timestampValue: (value) => (value ? Date.parse(value) || 0 : 0),
      };
    throw new Error(`Unexpected cache dependency ${name}`);
  },
  cache,
  wx,
);

const id = (number) => `ugs:1012:${number}`;
const detail = (number, body = `正文 ${number}`) => ({
  id: id(number),
  title: `通知 ${number}`,
  link: `https://ugs.swu.edu.cn/info/1012/${number}.htm`,
  publishedAt: "2026-09-01",
  publisher: "本科生院",
  contentHtml: `<p>${body}</p>`,
});
const fetchedAt = (number) =>
  new Date(Date.parse("2026-09-01T00:00:00Z") + number * 60_000).toISOString();

async function run() {
  const now = Date.now();
  for (let number = 1; number <= 15; number += 1)
    cache.saveNoticeDetailSnapshot("account-a", id(number), detail(number), {
      fetchedAt: fetchedAt(number),
    }, now);
  assert.equal(storage.get("easy-swu:notice-details:v1").items.length, 15);
  cache.loadNoticeDetailSnapshot("account-a", id(1));
  cache.saveNoticeDetailSnapshot("account-b", id(16), detail(16), {
    fetchedAt: fetchedAt(16),
  }, now);
  assert.equal(storage.get("easy-swu:notice-details:v1").items.length, 15);
  assert.equal(cache.loadNoticeDetailSnapshot("account-a", id(2)), null);
  assert(cache.loadNoticeDetailSnapshot("account-a", id(1)));
  assert.equal(cache.loadNoticeDetailSnapshot("account-a", id(16)), null);
  assert(cache.loadNoticeDetailSnapshot("account-b", id(16)));

  const current = cache.loadNoticeDetailSnapshot("account-a", id(1));
  assert.equal(cache.isNoticeDetailDue(current, now + 86_400_000 - 1), false);
  assert.equal(cache.isNoticeDetailDue(current, now + 86_400_000), true);
  const older = cache.saveNoticeDetailSnapshot(
    "account-a",
    id(1),
    detail(1, "旧正文"),
    { fetchedAt: fetchedAt(0) },
    now + 1,
  );
  assert.equal(older.detail.contentHtml, current.detail.contentHtml);
  const refreshing = cache.saveNoticeDetailSnapshot(
    "account-a",
    id(17),
    detail(17),
    { fetchedAt: fetchedAt(17), refreshing: true },
    now,
  );
  assert.equal(cache.isNoticeDetailDue(refreshing, now), true);

  storage.clear();
  let pageDefinition;
  const requests = [];
  const stubs = {
    "../../../utils/app-share": { buildAppShare() {} },
    "../../../services/teaching": {
      getNoticeDetail: (noticeId, refresh, automatic) =>
        new Promise((resolve, reject) =>
          requests.push({ id: noticeId, refresh, automatic, resolve, reject }),
        ),
    },
    "../../../services/request": { getErrorMessage: () => "读取失败" },
    "../../../utils/appearance": { resolveAppearance: () => ({}) },
    "../../../utils/date": { formatDateTime: (value) => value },
    "../../../utils/haptics": { haptic() {} },
    "../../../utils/navigation": { ensureAuthenticated: () => true },
    "../../../store/session": {
      captureSessionLease: () => ({ account: "account-a" }),
      isSessionLeaseCurrent: () => true,
    },
    "../../store/notice-details": cache,
    "../../utils/notice-attachments": {
      canPreviewAttachment: () => false,
      downloadNoticeAttachment() {},
      removeAttachmentFile() {},
    },
  };
  new Function(
    "require",
    "Page",
    "wx",
    "exports",
    transpile("features/pages/browser/index.ts"),
  )(
    (name) => {
      if (!(name in stubs)) throw new Error(`Unexpected page dependency ${name}`);
      return stubs[name];
    },
    (definition) => (pageDefinition = definition),
    wx,
    {},
  );
  const createPage = () => ({
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  });
  const fresh = detail(21, "本地正文");
  cache.saveNoticeDetailSnapshot("account-a", id(21), fresh, {
    fetchedAt: fetchedAt(21),
  }, Date.now());
  const freshPage = createPage();
  freshPage.onLoad({ id: id(21), title: "列表标题" });
  assert.equal(freshPage.data.contentHtml, fresh.contentHtml);
  assert.equal(requests.length, 1, "Opening cached detail still records the view");
  requests[0].resolve({
    data: fresh,
    meta: { cached: true, fetchedAt: fetchedAt(21), refreshing: false },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(freshPage.data.contentHtml, fresh.contentHtml);

  const stale = detail(22, "旧正文");
  cache.saveNoticeDetailSnapshot("account-a", id(22), stale, {
    fetchedAt: fetchedAt(22),
  }, Date.now() - 86_400_001);
  const stalePage = createPage();
  stalePage.onLoad({ id: id(22) });
  assert.equal(stalePage.data.contentHtml, stale.contentHtml);
  assert.equal(stalePage.data.loading, false);
  assert.equal(requests.length, 2);
  requests[1].resolve({
    data: detail(22, "新正文"),
    meta: { cached: false, fetchedAt: fetchedAt(23), refreshing: false },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stalePage.data.contentHtml, "<p>新正文</p>");
  assert.equal(cache.isNoticeDetailDue(cache.loadNoticeDetailSnapshot("account-a", id(22))), false);

  cache.saveNoticeDetailSnapshot("account-a", id(24), detail(24, "服务端旧正文"), {
    fetchedAt: fetchedAt(24),
  }, Date.now() - 86_400_001);
  const refreshingPage = createPage();
  refreshingPage.onLoad({ id: id(24) });
  assert.equal(refreshingPage.data.contentHtml, "<p>服务端旧正文</p>");
  requests[2].resolve({
    data: detail(24, "服务端旧正文"),
    meta: { cached: true, fetchedAt: fetchedAt(24), refreshing: true },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 4);
  assert.equal(requests[3].refresh, true);
  assert.equal(requests[3].automatic, true);
  assert.equal(refreshingPage.data.contentHtml, "<p>服务端旧正文</p>");
  requests[3].resolve({
    data: detail(24, "学校新正文"),
    meta: { cached: false, fetchedAt: fetchedAt(25), refreshing: false },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshingPage.data.contentHtml, "<p>学校新正文</p>");

  const failedPage = createPage();
  cache.saveNoticeDetailSnapshot("account-a", id(23), detail(23, "保留正文"), {
    fetchedAt: fetchedAt(23),
  }, Date.now() - 86_400_001);
  failedPage.onLoad({ id: id(23) });
  requests[4].reject(new Error("offline"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedPage.data.contentHtml, "<p>保留正文</p>");
  assert.equal(failedPage.data.errorMessage, "");
  console.log("Notice detail local cache checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
