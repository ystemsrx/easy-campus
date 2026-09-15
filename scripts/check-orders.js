const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const route = "features/pages/orders/index";
const flush = () => new Promise((r) => setImmediate(r));
function harness() {
  let account = "alice", definition, dorm = true, course = true;
  const requests = [], storage = new Map(), copies = [];
  const request = (category, page) => new Promise((resolve, reject) => requests.push({ category, page, resolve, reject }));
  const stubs = {
    "services/auto-dorm-check.ts": { getAutoDormCheckLocalStatus: async () => ({ entryEnabled: dorm, functionEnabled: dorm }), getAutoDormCheckPaymentOrders: (page) => request("dorm", page) },
    "services/course-grab.ts": { getCourseGrabStatus: async () => ({ entryEnabled: course }), getCourseGrabOrders: (page) => request("course", page) },
    "features/services/service-orders.ts": { getServiceOrders: (page) => request("other", page) },
    "services/request.ts": { getErrorMessage: (_e, fallback) => fallback },
    "store/session.ts": { captureSessionLease: () => ({ account }), isSessionLeaseCurrent: (lease) => lease.account === account, sessionLeaseKey: (lease) => lease.account },
    "utils/appearance.ts": { resolveAppearance: () => ({}), syncWindowBackground() {} },
    "utils/navigation.ts": { ensureAuthenticated: () => true, navigateTo() {} },
    "utils/app-share.ts": { buildAppShare() {} },
  };
  const wx = { getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key), setClipboardData: (input) => copies.push(input.data) };
  function load(file) {
    file = file.replaceAll("\\", "/"); if (stubs[file]) return stubs[file];
    const module = { exports: {} };
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    new Function("module", "exports", "require", "Page", "wx", code)(module, module.exports,
      (name) => load(path.relative(root, path.resolve(root, path.dirname(file), name)) + ".ts"), (value) => { definition = value; }, wx);
    return module.exports;
  }
  load(route + ".ts");
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, structuredClone(patch)); } };
  return { page, requests, copies, load, flags: (d, c) => { dorm = d; course = c; }, account: (a) => { account = a; } };
}
const order = (id) => ({ id, planId: "plan", planName: "服务", amountCents: 200, credited: true, status: "paid", refundedCents: 0, refunds: [], createdAt: "2026-09-01T00:00:00Z", paidAt: "2026-09-01T00:00:00Z", outTradeNo: id, refund: { refundable: true } });
const result = (items, page = 1, pages = 1) => ({ items, pagination: { page, totalPages: pages, total: items.length } });
async function run() {
  const modal = harness();
  assert.equal(modal.page.data.navigationReady, false);
  modal.page.onLoad({ category: "dorm", modal: "1" });
  assert.equal(modal.page.data.navigationReady, true);
  assert.equal(modal.page.data.insetBack, true);
  modal.page.onLoad({ category: "course" });
  assert.equal(modal.page.data.insetBack, false);
  assert.match(read(route + ".wxml"), /inset-back="\{\{insetBack\}\}"/);
  assert.match(read(route + ".wxml"), /<navigation-bar wx:if="\{\{navigationReady\}\}"/);
  assert.match(read(route + ".wxml"), /class="order-number-row">[\s\S]*?item.outTradeNo[\s\S]*?catchtap="copyOrder"[^>]*>复制<\/button>[\s\S]*?<\/view>/);
  assert.match(read("pages/profile/content.wxml"), /<view class="settings-card card">\s*<view[^>]*bindtap="openOrders"[\s\S]*?class="setting-caption">查看所有订单/);
  for (const file of ["auto-dorm-check/index.ts", "auto-dorm-check-payment/index.ts", "course-grab/payment.ts", "course-grab/index.ts"]) {
    assert.match(read("features/pages/" + file), /orders\/index\?category=(?:dorm|course)&modal=1",\s*"wx:\/\/cupertino-modal"/);
  }
  const h = harness(); h.page.onLoad({ category: "dorm" }); h.page.onShow(); await flush();
  assert.deepEqual(h.page.data.tabs.map((t) => t.id), ["dorm", "course", "other"]);
  assert.equal(h.page.data.selectedTabIndex, 0);
  h.requests.shift().resolve(result([order("1")], 1, 2)); await flush();
  assert.equal(h.page.data.orders[0].id, "1");
  h.page.more(); h.requests.shift().resolve(result([order("1"), order("2")], 2, 2)); await flush();
  assert.equal(h.page.data.orders.length, 2);
  h.page.copyOrder({ currentTarget: { dataset: { id: "1" } } }); assert.deepEqual(h.copies, ["1"]);
  h.page.refresh(); await flush(); h.requests.shift().reject(new Error("offline")); await flush();
  assert.equal(h.page.data.orders.length, 2, "refresh preserves existing orders");
  h.page.changeCategory({ currentTarget: { dataset: { id: "course" } } }); const stale = h.requests.shift();
  assert.equal(h.page.data.selectedTabIndex, 1);
  h.page.changeCategory({ currentTarget: { dataset: { id: "other" } } }); const fresh = h.requests.shift();
  assert.equal(h.page.data.selectedTabIndex, 2);
  stale.resolve(result([order("wrong-category")])); await flush(); assert.equal(h.page.data.orders.length, 0);
  fresh.resolve(result([order("other")])); await flush(); assert.equal(h.page.data.orders[0].id, "other");
  h.page.refresh(); await flush(); const oldAccount = h.requests.shift(); h.account("bob"); h.page.onShow(); await flush();
  oldAccount.resolve(result([order("alice-secret")])); await flush(); assert.equal(h.page.data.orders.length, 0);
  h.requests.shift().resolve(result([order("bob")])); await flush(); assert.equal(h.page.data.orders[0].id, "bob");
  h.flags(false, true); h.page.refresh(); await flush(); assert.deepEqual(h.page.data.tabs.map((t) => t.id), ["course", "other"]);
  assert.equal(h.page.data.selectedTabIndex, 1);
  h.requests.shift().resolve(result([])); await flush();
  h.flags(false, false); h.page.refresh(); await flush(); assert.deepEqual(h.page.data.tabs.map((t) => t.id), ["other"]);
  assert.equal(h.page.data.selectedTabIndex, 0);
  h.requests.shift().resolve(result([])); await flush();
  const pages = JSON.parse(read("app.json")).subPackages.flatMap((p) => p.pages);
  assert(pages.includes("pages/orders/index")); assert(!pages.some((p) => /auto-dorm-check-orders|course-grab-orders/.test(p)));
  assert.match(read(route + ".wxml"), /tabs.length > 1/);
  assert.match(read(route + ".wxml"), /order-tab-indicator--\{\{selectedTabIndex\}\}/);
  const styles = read(route + ".wxss");
  assert.match(styles, /width: calc\(\(100% - 14rpx\) \/ 3\)/);
  assert.match(styles, /\.order-tabs--2 \.order-tab-indicator \{ width: calc\(\(100% - 14rpx\) \/ 2\)/);
  assert.match(styles, /transition: transform 220ms/);
  assert.match(styles, /\.motion-reduced \.order-tab-indicator \{ transition: none/);
  assert.match(read("pages/profile/content.wxml"), /bindtap="openOrders"/);
  const views = h.load("features/utils/auto-dorm-check-orders.ts");
  assert.equal(views.orderViews([{ ...order("a"), refundedCents: 50 }])[0].statusLabel, "部分退款");
  console.log("Unified order checks passed: flags, cache, pagination, stale responses, account isolation, entry.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
