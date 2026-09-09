const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const route = "features/pages/auto-dorm-check-orders/index";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function harness() {
  const storage = new Map();
  const modules = new Map();
  const requests = [];
  const copies = [];
  let account = "alice";
  let definition;
  const wx = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    setClipboardData: (input) => copies.push(input.data),
  };
  const session = {
    captureSessionLease: () => ({ account, token: account }),
    isSessionLeaseCurrent: (lease) => lease.account === account,
    sessionLeaseKey: (lease) => lease.account,
  };
  const stubs = {
    "services/auto-dorm-check.ts": {
      getAutoDormCheckPaymentOrders: (page) =>
        new Promise((resolve, reject) =>
          requests.push({ page, resolve, reject }),
        ),
    },
    "services/request.ts": { getErrorMessage: (_error, fallback) => fallback },
    "store/session.ts": session,
    "utils/appearance.ts": {
      resolveAppearance: () => ({}),
      syncWindowBackground() {},
    },
    "utils/navigation.ts": { ensureAuthenticated: () => true },
    "utils/app-share.ts": { buildAppShare() {} },
    "utils/haptics.ts": { haptic() {} },
  };
  function load(relative) {
    relative = relative.replace(/\\/g, "/");
    if (stubs[relative]) return stubs[relative];
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} };
    modules.set(relative, module);
    const code = ts.transpileModule(read(relative), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    new Function("module", "exports", "require", "Page", "wx", code)(
      module,
      module.exports,
      (request) =>
        load(
          path.relative(
            root,
            path.resolve(root, path.dirname(relative), request),
          ) + ".ts",
        ),
      (value) => {
        definition = value;
      },
      wx,
    );
    return module.exports;
  }
  load(`${route}.ts`);
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = (patch) => Object.assign(page.data, structuredClone(patch));
  return {
    page,
    load,
    requests,
    copies,
    storage,
    switchAccount: (value) => {
      account = value;
    },
  };
}

function order(id, overrides = {}) {
  return {
    id,
    planId: "monthly",
    planName: "30 天套餐",
    status: "paid",
    credited: true,
    amountCents: 600,
    refundedCents: 0,
    createdAt: "2026-09-07T22:30:00Z",
    paidAt: "2026-09-07T22:30:00Z",
    outTradeNo: `ORDER-${id}`,
    refunds: [],
    ...overrides,
  };
}
const result = (items, page = 1, total = items.length) => ({
  items,
  pagination: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
});
const tick = () => new Promise(setImmediate);

async function main() {
  const cancelled = harness();
  cancelled.storage.set(
    "easy-swu:auto-dorm-check-orders:v1:alice",
    result(
      Array.from({ length: 4 }, (_, index) =>
        order(`cancelled-${index}`, {
          status: "cancelled",
          credited: false,
          paidAt: null,
        }),
      ),
    ),
  );
  cancelled.page.onLoad();
  cancelled.page.onShow();
  assert.equal(
    cancelled.page.data.total,
    0,
    "Do not reuse the old count including cancelled orders",
  );
  assert.equal(
    cancelled.page.data.orders.length,
    0,
    "Do not flash cancelled rows from the old cache",
  );
  cancelled.requests[0].resolve(result([]));
  await tick();
  assert.equal(cancelled.page.data.total, 0);
  assert.equal(
    cancelled.page.data.orders.length,
    0,
    "A history containing only cancelled orders is empty after the server filters it",
  );
  assert.equal(cancelled.page.data.hasMore, false);
  cancelled.page.onUnload();
  const env = harness();
  const { page, requests } = env;
  const cache = env.load("features/store/auto-dorm-check-orders.ts");
  cache.saveOrderHistory("alice", result([order("cached")], 1, 22));
  page.onLoad();
  page.onShow();
  assert.equal(
    page.data.orders[0].id,
    "cached",
    "Display cached data while refreshing",
  );
  assert.equal(page.data.refreshing, true);
  page.refresh();
  assert.equal(requests.length, 1, "Deduplicate refresh taps");
  requests[0].resolve(
    result(
      Array.from({ length: 20 }, (_, i) => order(String(i))),
      1,
      22,
    ),
  );
  await tick();
  assert.equal(page.data.orders.length, 20);
  assert.equal(page.data.orders[0].id, "0");
  assert.equal(page.data.hasMore, true);
  page.loadMore();
  page.loadMore();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].page, 2);
  requests[1].reject(new Error("offline"));
  await tick();
  assert.equal(page.data.orders.length, 20);
  assert.ok(page.data.moreError);
  page.loadMore();
  assert.equal(requests.length, 2, "Scroll does not loop on a failed request");
  page.retryMore();
  requests[2].resolve(result([order("19"), order("20"), order("21")], 2, 22));
  await tick();
  assert.equal(
    page.data.orders.length,
    22,
    "Keep all pages and deduplicate overlapping rows",
  );
  assert.equal(page.data.hasMore, false);
  assert.equal(
    cache.loadOrderHistory("alice").items.length,
    20,
    "Persist only the first page",
  );
  page.copyOrder({ currentTarget: { dataset: { id: "21" } } });
  assert.deepEqual(env.copies, ["ORDER-21"]);
  page.refresh();
  requests[3].reject(new Error("offline"));
  await tick();
  assert.equal(
    page.data.orders.length,
    22,
    "Failed refresh retains visible orders",
  );
  page.refresh();
  requests[4].resolve(result([]));
  await tick();
  assert.deepEqual(
    page.data.orders,
    [],
    "Empty server state replaces old cache",
  );
  assert.equal(cache.loadOrderHistory("alice").items.length, 0);
  page.refresh();
  env.switchAccount("bob");
  page.onShow();
  requests[5].resolve(result([order("alice-private")]));
  await tick();
  assert.deepEqual(
    page.data.orders,
    [],
    "A previous session cannot populate the page",
  );
  requests[6].resolve(result([order("bob-order")]));
  await tick();
  assert.equal(page.data.orders[0].id, "bob-order");
  assert.equal(cache.loadOrderHistory("alice").items.length, 0);
  assert.equal(cache.loadOrderHistory("bob").items[0].id, "bob-order");
  env.switchAccount("alice");
  page.copyOrder({ currentTarget: { dataset: { id: "bob-order" } } });
  assert.equal(
    env.copies.length,
    1,
    "Do not copy another account's cached order",
  );
  page.onShow();
  page.onUnload();
  requests[7].resolve(result([order("after-close")]));
  await tick();
  assert.deepEqual(
    page.data.orders,
    [],
    "Ignore responses after closing the drawer",
  );

  const view = env.load("features/utils/auto-dorm-check-orders.ts");
  const channels = view.orderViews([
    order("apple", { paymentChannel: "apple_iap" }),
    order("wechat", { paymentChannel: "wechat" }),
    order("unknown", { paymentChannel: null }),
  ]);
  assert.deepEqual(
    channels.map((item) => item.paymentLabel),
    ["Apple 支付", "微信支付", "虚拟支付"],
  );
  assert.ok(channels.every((item) => item.statusLabel === "已支付"));
  const rows = view.orderViews([
    order("paid"),
    order("full", { refundedCents: 600 }),
    order("partial", { refundedCents: 200 }),
    order("refund", {
      refunds: [{ id: "refund", status: "processing", amountCents: 600 }],
    }),
    order("credit", { credited: false }),
    order("pending", { status: "pending", credited: false, paidAt: null }),
    order("cancelled", { status: "cancelled", credited: false, paidAt: null }),
    order("failed", { status: "failed", credited: false, paidAt: null }),
  ]);
  assert.deepEqual(
    rows.map((item) => item.statusLabel),
    [
      "已支付",
      "已退款",
      "部分退款",
      "退款中",
      "额度到账中",
      "待支付",
      "已取消",
      "支付失败",
    ],
  );
  assert.equal(rows[2].refundLabel, "已退 ¥2.00");
  assert.ok(rows[0].monthLabel);
  assert.equal(rows[1].monthLabel, "");
  assert.equal(
    rows[0].paidLabel,
    env.load("utils/date.ts").formatDateTime(order("paid").paidAt),
  );
  const template = read(`${route}.wxml`);
  const css = read(`${route}.wxss`);
  assert.match(
    read("features/pages/auto-dorm-check-payment/index.ts"),
    /auto-dorm-check-orders\/index"\s*,\s*"wx:\/\/cupertino-modal"/,
  );
  assert.match(
    read("features/pages/auto-dorm-check-payment/index.wxml"),
    /bindtap="openOrders">订单<\/button>/,
  );
  assert.match(
    read("services/auto-dorm-check.ts"),
    /payment\/orders\?page=\$\{page\}&pageSize=20`/,
  );
  assert.doesNotMatch(read("services/auto-dorm-check.ts"), /status=paid/);
  assert.match(template, /<navigation-bar\b[^>]*inset-back="{{true}}"/);
  assert.match(template, /slot="after-left" class="nav-refresh/);
  assert.match(
    css,
    /\.nav-refresh\s*\{[^}]*width:\s*76rpx;[^}]*height:\s*76rpx;[^}]*border-radius:\s*999rpx;/s,
  );
  assert.match(
    template,
    /title-suffix="{{loaded \? '（' \+ total \+ '）' : ''}}"/,
  );
  assert.doesNotMatch(template, /orders-heading|orders-caption|笔购买记录/);
  assert.match(
    read("features/pages/auto-dorm-check-payment/index.wxss"),
    /\.payment-orders-button\s*\{[^}]*margin:\s*0 0 0 auto;[^}]*width:\s*84rpx;[^}]*height:\s*52rpx;/s,
  );
  assert.match(template, /bindscrolltolower="loadMore"/);
  assert.doesNotMatch(template, /catchtouchmove|refresher-|<bottom-sheet/);
  assert.match(
    template,
    /<view wx:if="{{!orders.length}}" class="orders-state">[\s\S]*title="暂无购买记录"[\s\S]*<\/view>\s*<view wx:else class="orders-scroll-shell">/,
  );
  assert.match(
    css,
    /\.orders-state\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-height:\s*0;/s,
  );
  assert.match(
    template,
    /<view class="orders-bottom-space"><\/view>\s*<\/scroll-view>/,
  );
  assert.match(
    css,
    /\.orders-scroll-shell\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/s,
  );
  assert.match(
    css,
    /\.orders-scroll\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s,
  );
  for (const selector of [
    "order-status",
    "order-amount",
    "order-date",
    "order-number",
  ]) {
    assert.match(
      css,
      new RegExp(`\\.${selector}\\s*\\{[^}]*white-space:\\s*nowrap;`, "s"),
    );
  }
  console.log(
    "Order history checks passed: cache, pagination, refunds, session isolation, native modal routing and scroll layout.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
