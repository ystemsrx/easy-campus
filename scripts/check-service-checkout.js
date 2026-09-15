const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const source = read("features/pages/service-order/index.ts");
const compile = (s) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
function order(status = "UNPAID") {
  return { order_id: "service-1", platform_name: "头歌", amount_fen: 250, unit_price_fen: 50,
    billable_units: 5, code_status: "ACTIVE", code_expires_at: Date.now() + 300000,
    payment_status: status, service_items: [{ id: "a", name: "练习一", billable_units: 2 }, { id: "b", name: "练习二", billable_units: 3 }], refunds: [], fulfillment: {} };
}
function harness() {
  let definition, account = "alice", launches = 0, outcome = "success", handler;
  const requests = [], storage = new Map(), timers = [], notices = [];
  const stubs = {
    "../../../services/request": { apiRequest: async (url, options) => { requests.push({ url, options }); return handler(url, options); }, getErrorMessage: (e, fallback) => e.message || fallback },
    "../../../services/auto-dorm-check": { launchWechatPayment: async () => { launches++; if (outcome instanceof Error) throw outcome; return outcome; } },
    "../../../store/session": { captureSessionLease: () => ({ account }), isSessionLeaseCurrent: (lease) => lease.account === account, sessionLeaseKey: (lease) => lease.account },
    "../../../utils/navigation": { ensureAuthenticated() {}, navigateTo() {} },
    "../../../utils/appearance": { resolveAppearance: () => ({}), syncWindowBackground() {} },
    "../../../utils/app-share": { buildAppShare() {} },
    "../../services/service-orders": { serviceStatus: (o) => o.payment_status },
    "../../utils/course-grab": { uuid: () => String(requests.length) },
    "../../../utils/service-order-return": { rememberServiceOrder() {} },
  };
  const wx = { login: async () => ({ code: "login" }), setStorageSync: (k, v) => storage.set(k, v), getStorageSync: (k) => storage.get(k), removeStorageSync: (k) => storage.delete(k), showToast: (v) => notices.push(v) };
  function timeout(fn, ms) { const timer = { fn, ms, cancelled: false }; timers.push(timer); if (ms < 1000) setImmediate(() => { if (!timer.cancelled) fn(); }); return timer; }
  new Function("exports", "require", "Page", "wx", "setTimeout", "clearTimeout", compile(source))(
    {}, (name) => { assert(stubs[name], name); return stubs[name]; }, (value) => { definition = value; }, wx,
    timeout, (timer) => { timer.cancelled = true; });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, structuredClone(patch)); callback?.(); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(callback) { callback([{ height: 220 }]); } }; },
  };
  page.onLoad({ id: "service-1", code: "order-code" }); page._visible = true; page._accountKey = account; page.apply(order());
  handler = (url) => url.endsWith("payment-attempts") ? { order: order("PROCESSING"), payment: {} } : { order: order("PAID") };
  return { page, requests, storage, timers, notices, launches: () => launches,
    handle: (fn) => { handler = fn; }, outcome: (value) => { outcome = value; }, account: (value) => { account = value; } };
}
async function run() {
  const dorm = read("features/pages/auto-dorm-check-payment/index.ts");
  const method = (s, start, end) => s.slice(s.indexOf(start), s.indexOf(end));
  assert.equal(method(source, "  setPaymentView(", "  inputCode(" ).trim(), method(dorm, "  setPaymentView(", "  applyAppearance()" ).trim());
  const poll = method(dorm, "  async pollPaymentOrder(", "  async finishPaymentFlow(")
    .replaceAll("AutoDormCheckPaymentOrderResult", "ServiceOrderResult")
    .replaceAll("getAutoDormCheckPaymentOrder(current.order.id)", "queryServicePayment(current.order.order_id)");
  assert.equal(method(source, "  async pollPaymentOrder(", "  showAwaitingPayment()" ).trim(), poll.trim());
  for (const constant of ["ORDER_POLL_INTERVAL_MILLISECONDS", "ORDER_POLL_ATTEMPTS", "PAYMENT_PROGRESS_TRANSITION_MS"]) {
    const pattern = new RegExp(`const ${constant} = \\d+;`);
    assert.equal(source.match(pattern)[0], dorm.match(pattern)[0]);
  }
  const template = read("features/pages/service-order/index.wxml");
  assert(!/showModal|afterSales|appleRefund/.test(source));
  assert(!/billable_units|0\.50|×|订单码有效|申请售后|付费单元|计费单位/.test(template));
  assert.match(template, /<text>总计<\/text>/);
  assert.match(template, /¥\{\{item.price\}\}/);
  assert.match(template, /class="service-items">\s*<view wx:for="\{\{items\}\}"[\s\S]*?\{\{item.name\}\}[\s\S]*?¥\{\{item.price\}\}/);
  assert.match(read("features/pages/service-order/index.wxss"), /justify-content: center;\s*width: auto;/);
  assert.match(read("features/pages/service-order/index.wxss"), /@import "\.\.\/auto-dorm-check-payment\/index.wxss"/);
  assert.equal(JSON.parse(fs.readFileSync(path.resolve(root, "../project.config.json"))).appid, "wxcdfc32ad2fd7931c");
  assert.match(source, /onShareAppMessage: buildAppShare/);

  const success = harness();
  assert.deepEqual(success.page.data.items.map((i) => i.price), ["1.00", "1.50"]);
  assert.deepEqual(success.page.data.items.map((i) => i.name), ["练习一", "练习二"]);
  for (const invalid of [{ ...order(), service_items: [] }, { ...order(), amount_fen: 300 }]) {
    assert.throws(() => success.page.apply(invalid), /订单明细/);
    assert.equal(success.page.data.items.length, 2, "bad refresh must not erase known item details");
  }
  const payment = success.page.pay();
  await success.page.pay();
  await payment;
  assert.equal(success.launches(), 1);
  assert.equal(success.page.data.order.payment_status, "PAID");
  assert.equal(success.page.data.progressExpanded, false);
  assert.equal(success.page.data.busy, false);
  assert.equal(success.storage.size, 0);
  assert(success.timers.some((t) => t.ms === 900));
  assert.equal(success.requests.filter((r) => r.url.endsWith("payment-attempts")).length, 1);

  const cancelled = harness(); cancelled.outcome("cancelled");
  cancelled.handle((url) => ({ order: order("PROCESSING"), ...(url.endsWith("payment-attempts") ? { payment: {} } : {}) }));
  await cancelled.page.pay();
  assert.equal(cancelled.page.data.order.payment_status, "PROCESSING");
  assert.equal(cancelled.page.data.checkingPayment, true);
  assert.equal(cancelled.storage.size, 1);
  assert(cancelled.timers.some((t) => t.ms === 3000));
  await cancelled.page.check();
  assert(cancelled.timers.some((t) => t.ms === 6000));
  assert.equal(cancelled.launches(), 1);
  cancelled.page.onHide();
  assert(cancelled.timers.filter((t) => t.ms >= 3000).every((t) => t.cancelled));

  const failure = harness(); failure.outcome(new Error("native failure"));
  await failure.page.pay();
  assert.equal(failure.page.data.order.payment_status, "PAID", "native errors must still reconcile");

  const lost = harness();
  lost.handle((url) => { if (url.endsWith("payment-attempts")) throw new Error("timeout"); return { order: order("RECONCILING") }; });
  await lost.page.pay();
  assert.equal(lost.launches(), 0);
  assert.equal(lost.storage.size, 1);
  assert.equal(lost.page.data.checkingPayment, true);

  const unresolved = harness();
  unresolved.handle((url) => ({ order: order("RECONCILING"), ...(url.endsWith("payment-attempts") ? { payment: {} } : {}) }));
  await unresolved.page.pay();
  assert.equal(unresolved.requests.filter((r) => r.url.endsWith("payment-checks")).length, 45);
  assert.equal(unresolved.launches(), 1);
  assert.equal(unresolved.page.data.checkingPayment, true);
  assert(unresolved.timers.some((t) => t.ms === 3000));
  unresolved.page._unconfirmedChecks = 10;
  unresolved.page.showAwaitingPayment();
  assert(unresolved.timers.some((t) => t.ms === 30000));

  const restored = harness();
  for (const [key, value] of lost.storage) restored.storage.set(key, value);
  restored.handle((url) => url.endsWith("resolve") ? order("RECONCILING") : { order: order("PAID") });
  await restored.page.load();
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(restored.page.data.order.payment_status, "PAID");
  assert.equal(restored.launches(), 0);
  assert.equal(restored.storage.size, 0);

  const loaded = harness();
  loaded.page.setData({ order: null, items: [] });
  loaded.handle(() => order());
  await loaded.page.load();
  assert.equal(loaded.page.data.items.length, 2, "resolve populates all charge items before checkout");
  assert.equal(loaded.page.data.items[1].price, "1.50");
  const missing = harness();
  missing.page.setData({ order: null, items: [], canPay: false });
  missing.handle(() => ({ ...order(), service_items: [] }));
  await missing.page.load();
  assert.equal(missing.page.data.order, null, "never display a total-only order without its breakdown");
  assert.equal(missing.page.data.canPay, false);
  assert.match(missing.page.data.error, /订单明细/);

  const leave = harness(); let reply;
  leave.handle((url) => url.endsWith("payment-attempts") ? new Promise((resolve) => { reply = resolve; }) : {});
  const leaving = leave.page.pay(); await flush();
  leave.page.onUnload(); reply({ order: order("PROCESSING"), payment: {} }); await leaving;
  assert.equal(leave.launches(), 0);

  const switched = harness(); let purchased;
  switched.handle(() => new Promise((resolve) => { purchased = resolve; }));
  const switching = switched.page.pay(); await flush(); switched.account("bob"); purchased({}); await switching;
  assert.equal(switched.requests.length, 1);
  assert.equal(switched.launches(), 0);
  for (const h of [success, cancelled, failure, lost, switched, unresolved, restored, loaded, missing]) h.page.onUnload();
  console.log("Service checkout checks passed: dorm animation/polling parity, item pricing, AppID, duplicate taps, cancellation, uncertain results, unload and account isolation.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
