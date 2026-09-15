const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

module.exports = async function checkRefunds() {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../miniprogram/features/pages/orders/index.ts",
    ),
    "utf8",
  );
  const storage = new Map();
  let lease = { account: "student-a" };
  let definition;
  let serial = 0;
  let failed = false;
  const calls = [];
  const quote = { refundable: true, amountCents: 350, requiresApple: false };
  const order = {
    id: "order-a",
    amountCents: 500,
    refundedCents: 0,
    createdAt: "2026-09-14T00:00:00Z",
    refunds: [],
    refund: quote,
  };
  const request = {
    apiRequest: async () => structuredClone(quote),
    getErrorMessage: (error) => error.message,
  };
  const services = {
    getCourseGrabOrders: async () => ({
      items: [structuredClone(order)],
      pagination: { page: 1, totalPages: 1 },
    }),
    refundCourseGrab: async (...args) => {
      calls.push(args);
      if (failed) throw new Error("Result unknown");
      return { status: "processing" };
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      exports: {},
      Page: (value) => {
        definition = value;
      },
      require: (name) => {
        if (name.endsWith("utils/auto-dorm-check-orders")) return { orderViews: (items) => items.map((item) => ({ ...item, statusLabel: "已支付" })) };
        if (name.endsWith("services/course-grab")) return services;
        if (name.endsWith("services/request")) return request;
        if (name.endsWith("store/session"))
          return {
            captureSessionLease: () => lease,
            isSessionLeaseCurrent: (value) => value === lease,
            sessionLeaseKey: (value) => value.account,
          };
        if (name.endsWith("utils/appearance"))
          return { resolveAppearance: () => ({}) };
        if (name.endsWith("utils/course-grab"))
          return { timeLabel: (value) => value, uuid: () => `key-${++serial}` };
        return {};
      },
      wx: {
        getStorageSync: (key) => storage.get(key),
        setStorageSync: (key, value) => storage.set(key, value),
        removeStorageSync: (key) => storage.delete(key),
        showModal: async () => ({ confirm: true }),
        setClipboardData() {},
      },
    },
  );
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const key = "easy-swu:course-grab-refund:v1:student-a:order-a";
  page.data.category = "course";
  const event = { currentTarget: { dataset: { id: order.id } } };
  await page.load(false);
  failed = true;
  await page.refund(event);
  const original = storage.get(key);
  assert.ok(original, "Unknown refund results retain the request key");
  await page.refund(event);
  assert.equal(
    calls[1][2],
    original,
    "Retrying an unknown result must reuse the same key",
  );
  assert.equal(calls[0][1], 350, "Use the freshly quoted actual paid amount");

  order.refunds = [{ status: "processing" }];
  quote.refundable = false;
  await page.load(false);
  assert.equal(storage.get(key), original);
  const before = calls.length;
  await page.refund(event);
  assert.equal(
    calls.length,
    before,
    "Unavailable refunds cannot call the refund API",
  );

  order.refunds = [{ status: "closed" }];
  quote.refundable = true;
  await page.load(false);
  assert.equal(
    storage.has(key),
    false,
    "A confirmed closed refund permits a new request",
  );
  failed = false;
  await page.refund(event);
  assert.notEqual(calls.at(-1)[2], original);

  quote.requiresApple = true;
  const beforeApple = calls.length;
  await page.refund(event);
  assert.equal(
    calls.length,
    beforeApple,
    "Apple refunds never use merchant refund submission",
  );

  request.apiRequest = async () => {
    lease = { account: "student-b" };
    return structuredClone(quote);
  };
  await page.refund(event);
  assert.equal(
    calls.length,
    beforeApple,
    "A stale quote cannot refund after an account switch",
  );
  console.log(
    "Course refund checks passed: confirmed quotes, unknown-result retries, closed retries, Apple routing and account isolation.",
  );
};
