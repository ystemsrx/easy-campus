const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const assert = require("node:assert/strict");
const source = fs.readFileSync(
  path.join(__dirname, "../miniprogram/services/auto-dorm-check.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
let current = true;
let loginCalls = 0;
let apiCalls = 0;
let paymentOptions;
let platform = "android";
let system = "Android 14";
let wechatVersion = "8.0.68";
let timerId = 0;
const timers = new Map();
const warnings = [];
const lease = { account: "test" };
class ApiClientError extends Error {
  constructor(options) {
    super(options.message);
    Object.assign(this, options);
  }
}
const wx = {
  getDeviceInfo: () => ({ platform, system }),
  getAppBaseInfo: () => ({ version: wechatVersion }),
  canIUse: () => true,
  login: (options) => {
    loginCalls++;
    options.success({ code: "fresh-code" });
  },
  requestVirtualPayment(options) {
    assert.equal(this, wx, "native payment must retain the wx receiver");
    paymentOptions = options;
    options.success();
  },
  requestPayment: () => {
    throw new Error("ordinary payment must never be called");
  },
};
const imports = {
  "../store/auto-dorm-check": {},
  "../store/session": {
    captureSessionLease: () => lease,
    isSessionLeaseCurrent: () => current,
  },
  "./request": {
    ApiClientError,
    apiRequest: async (url, options) => {
      apiCalls++;
      return { url, options };
    },
  },
  "../demo/identity": { isDemoAccount: () => false },
};
const moduleValue = { exports: {} };
new Function(
  "exports",
  "require",
  "wx",
  "setTimeout",
  "clearTimeout",
  "console",
  compiled,
)(
  moduleValue.exports,
  (name) => {
    if (!imports[name]) throw new Error(name);
    return imports[name];
  },
  wx,
  (callback, milliseconds) => {
    assert.equal(milliseconds, 60_000);
    const id = ++timerId;
    timers.set(id, callback);
    return id;
  },
  (id) => timers.delete(id),
  { warn: (...args) => warnings.push(args) },
);
const service = moduleValue.exports;
async function main() {
  const payment = {
    mode: "short_series_goods",
    signData:
      '{ "offerId": "123", "productId": "count_2", "env": 0, "goodsPrice": 100 }',
    paySig: "pay-sig",
    signature: "user-sig",
  };
  assert.equal(await service.launchWechatPayment(payment), "success");
  assert.equal(paymentOptions.signData, payment.signData);
  assert.equal(timers.size, 0);
  platform = "ios";
  system = "iOS 15.0";
  assert.equal(await service.launchWechatPayment(payment), "success");
  assert.equal(paymentOptions.signData, payment.signData);
  for (const bad of [
    { env: 1, goodsPrice: 100 },
    { env: 0, goodsPrice: 50 },
    { env: 0, goodsPrice: "100" },
  ]) {
    assert.throws(
      () =>
        service.launchWechatPayment({
          ...payment,
          signData: JSON.stringify(bad),
        }),
      { code: "WECHAT_APPLE_PAY_UNAVAILABLE" },
    );
  }
  for (const [deviceSystem, version] of [
    ["iOS 14.8", "8.0.68"],
    ["iOS 15.0", "8.0.67"],
  ]) {
    system = deviceSystem;
    wechatVersion = version;
    assert.throws(() => service.launchWechatPayment(payment), {
      code: "WECHAT_APPLE_PAY_UNSUPPORTED",
    });
  }
  system = "iPadOS 18.0";
  wechatVersion = "8.1.0";
  assert.equal(await service.launchWechatPayment(payment), "success");
  for (platform of ["android", "ios"]) {
    wx.requestVirtualPayment = (options) => options.fail({ errCode: -2 });
    assert.equal(await service.launchWechatPayment(payment), "cancelled");
  }
  platform = "android";
  wx.requestVirtualPayment = (options) =>
    options.fail({ errCode: -2, errMsg: "用户取消" });
  assert.equal(await service.launchWechatPayment(payment), "cancelled");
  wx.requestVirtualPayment = (options) =>
    options.fail({ errMsg: "requestVirtualPayment:fail cancel" });
  assert.equal(await service.launchWechatPayment(payment), "cancelled");
  assert.equal(warnings.length, 0);
  wx.requestVirtualPayment = (options) =>
    options.fail({
      errCode: -15006,
      errMsg: `private native message cancel ${payment.signData} ${payment.paySig}`,
    });
  await assert.rejects(service.launchWechatPayment(payment), {
    code: "WECHAT_VIRTUAL_PAY_FAILED",
    message: "未能打开支付，请重试",
    details: { wechatCode: -15006 },
  });
  assert.deepEqual(warnings[0], [
    "[virtual-payment]",
    "WECHAT_VIRTUAL_PAY_FAILED",
    { wechatCode: -15006 },
  ]);
  assert.equal(timers.size, 0);
  wx.requestVirtualPayment = (options) => options.fail({ errCode: -15010 });
  await assert.rejects(service.launchWechatPayment(payment), {
    code: "WECHAT_VIRTUAL_PAY_FAILED",
    message: "该套餐暂不可购买",
    details: { wechatCode: -15010 },
  });
  assert.equal(timers.size, 0);
  wx.requestVirtualPayment = () => {
    throw new Error("private native message");
  };
  await assert.rejects(service.launchWechatPayment(payment), {
    code: "WECHAT_VIRTUAL_PAY_FAILED",
    message: "未能打开支付，请重试",
  });
  assert.equal(timers.size, 0);
  wx.requestVirtualPayment = (options) => {
    paymentOptions = options;
  };
  const timedOut = service.launchWechatPayment(payment);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await assert.rejects(timedOut, { code: "WECHAT_VIRTUAL_PAY_TIMEOUT" });
  assert.equal(timers.size, 0);
  const warningCount = warnings.length;
  paymentOptions.success();
  paymentOptions.fail({ errCode: -15006 });
  assert.equal(
    warnings.length,
    warningCount,
    "late callbacks must not change the settled result",
  );
  assert(!JSON.stringify(warnings).includes("private"));
  assert(!JSON.stringify(warnings).includes(payment.signData));
  assert(!JSON.stringify(warnings).includes(payment.paySig));
  const result = await service.createAutoDormCheckPaymentOrder(
    "count_1",
    "key",
  );
  assert.deepEqual(result.options.data, {
    planId: "count_1",
    code: "fresh-code",
  });
  assert.equal(loginCalls, 1);
  current = false;
  await assert.rejects(service.resumeAutoDormCheckPaymentOrder("order"), {
    code: "STALE_SESSION",
  });
  assert.equal(apiCalls, 1);
  current = true;
  wx.canIUse = () => false;
  await assert.rejects(
    service.createAutoDormCheckPaymentOrder("count_1", "key"),
    { code: "WECHAT_VIRTUAL_PAY_UNSUPPORTED" },
  );
  assert.equal(apiCalls, 1);
  console.log(
    "Virtual payment string, native callbacks, capability and login isolation checks passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
