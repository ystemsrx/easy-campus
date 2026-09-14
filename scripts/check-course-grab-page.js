const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..", "miniprogram");
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function runtime(options = {}) {
  let clock = options.now ?? Date.now();
  class TestDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  }
  let lease = { account: "student-a", token: "session-a" };
  const pending = options.pending || new Map();
  const calls = {
    create: [],
    save: [],
    native: [],
    navigate: [],
    status: 0,
    cancel: 0,
  };
  const timers = new Map();
  const timerDelays = new Map();
  let timerId = 0;
  const entitlement = {
    time: {
      remainingSeconds: 0,
      remainingDays: 0,
      paused: false,
      resumesAt: null,
    },
    uses: { remaining: 1, reserved: 0 },
  };
  const payment = {
    paymentEnabled: true,
    accessMode: "count",
    entitlement,
    plans: [
      {
        id: "course_assistant",
        name: "抢课一次",
        billingType: "count",
        amountCents: 500,
        priceLabel: "¥5.00",
      },
    ],
  };
  const result = (status = "paid") => ({
    order: {
      id: "order-a",
      status,
      credited: status === "paid",
      amountCents: 500,
    },
    entitlement,
    paymentCheck: { canResume: true, remainingMs: 900000 },
  });
  const appearance = { theme: "light", motionClass: "motion-normal" };
  const mock = {
    "utils/app-share": { buildAppShare() {} },
    "utils/haptics": { haptic() {} },
    "utils/appearance": {
      resolveAppearance: () => appearance,
      syncWindowBackground() {},
    },
    "utils/navigation": {
      ensureAuthenticated: () => true,
      navigateTo: (url) => calls.navigate.push(url),
    },
    "store/session": {
      captureSessionLease: () => lease,
      isSessionLeaseCurrent: (captured) => captured === lease,
    },
    "services/request": {
      ApiClientError: class extends Error {},
      getErrorMessage: (error, fallback) => error?.message || fallback,
    },
    "features/store/course-grab-payment": {
      loadPendingAutoDormCheckPayment: (account) => pending.get(account),
      savePendingAutoDormCheckPayment: (account, value) => {
        pending.set(account, value);
        return true;
      },
      clearPendingAutoDormCheckPayment: (account) => pending.delete(account),
    },
    "features/services/course-grab-payment": {
      getCachedAutoDormCheckPayment: () => (options.noCache ? null : payment),
      getPendingAutoDormCheckPayment: () => null,
      getAutoDormCheckPayment: async () => {
        if (options.loadError) throw new Error("读取失败");
        return payment;
      },
      createAutoDormCheckPaymentOrder: async (plan, key) => {
        calls.create.push({ plan, key });
        return options.creation
          ? options.creation.promise
          : {
              ...result("pending"),
              payment: { signData: "signed-verbatim", paySig: "signature" },
            };
      },
      getAutoDormCheckPaymentOrder: async () =>
        result(options.nativeCancelled ? "pending" : "paid"),
      cancelAutoDormCheckPaymentOrder: async () => {
        calls.cancel++;
        return result("cancelled");
      },
      launchWechatPayment: async (value) => {
        calls.native.push(value);
        options.onNative?.(instance);
        return options.nativeCancelled ? "cancelled" : "success";
      },
    },
    "services/course-grab": {
      saveCourseGrab: async (input) => {
        calls.save.push(input);
        return {
          observedAt: new Date().toISOString(),
          entryEnabled: true,
          balance: { remaining: 0, reserved: 1 },
          tasks: [{ ...input, enabled: true, state: "pending" }],
        };
      },
      toggleCourseGrab: async () => {
        throw new Error(options.toggleError || "次数不足请先购买");
      },
      loadCourseGrabStatus: () => null,
      getCourseGrabStatus: async () => {
        calls.status++;
        return {
          observedAt: new Date().toISOString(),
          entryEnabled: true,
          balance: { remaining: 1, reserved: 0 },
          tasks: [],
        };
      },
    },
  };
  let definition;
  const cache = new Map();
  function load(relative) {
    if (mock[relative]) return mock[relative];
    if (cache.has(relative)) return cache.get(relative);
    const source = fs.readFileSync(path.join(root, relative + ".ts"), "utf8");
    const exports = {};
    cache.set(relative, exports);
    vm.runInNewContext(
      (options.missingIntl ? "delete globalThis.Intl;\n" : "") +
        ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
          },
        }).outputText,
      {
        exports,
        require: (specifier) =>
          load(
            path.posix.normalize(
              path.posix.join(path.posix.dirname(relative), specifier),
            ),
          ),
        Page: (value) => {
          definition = value;
        },
        wx: {
          nextTick: queueMicrotask,
          getWindowInfo: () => ({ windowHeight: options.windowHeight || 812 }),
          getRandomValues: async ({ length }) => ({
            randomValues: new Uint8Array(length).fill(7).buffer,
          }),
        },
        getApp: () => ({ globalData: { preferences: {} } }),
        setTimeout: (callback, delay) => {
          const id = ++timerId;
          timers.set(id, callback);
          timerDelays.set(id, delay);
          if (delay < 3000)
            queueMicrotask(() => {
              if (timers.delete(id)) callback();
            });
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
        Date: options.now === undefined ? Date : TestDate,
        Intl: Object.hasOwn(options, "intl") ? options.intl : Intl,
      },
    );
    return exports;
  }
  load("features/pages/course-grab/index");
  const instance = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
    createSelectorQuery() {
      const selectors = [];
      return {
        select(selector) {
          selectors.push(selector);
          return this;
        },
        boundingClientRect() {
          return this;
        },
        exec(callback) {
          const rects = selectors.map((selector) => ({
            height:
              selector === ".grab-sheet-head"
                ? 72
                : selector === ".grab-sheet-footer"
                  ? 80
                  : options.bodyHeight || 220,
          }));
          if (options.measurements)
            options.measurements.push(() => callback(rects));
          else callback(rects);
        },
      };
    },
  };
  instance.onLoad({});
  instance.onShow();
  return {
    instance,
    setNow(value) {
      clock = value;
    },
    calls,
    pending,
    result,
    fireTimer(delay) {
      const entry = [...timers].find(([id]) => timerDelays.get(id) === delay);
      assert.ok(entry, `Expected a timer for ${delay} ms`);
      timers.delete(entry[0]);
      entry[1]();
    },
    switchAccount() {
      lease = { account: "student-b", token: "session-b" };
    },
  };
}

async function main() {
  await require("./check-course-grab-refunds")();
  const event = { currentTarget: { dataset: { id: "course_assistant" } } };
  {
    const r = runtime({ now: new Date(2026, 8, 15, 0, 5, 30).getTime() });
    await settle();
    r.instance.configure({ currentTarget: { dataset: {} } });
    assert.equal(r.instance.data.timeRange[0].length, 24);
    assert.equal(r.instance.data.time, "00:06");
    r.instance.timeColumnChange({ detail: { column: 0, value: 9 } });
    assert.equal(
      r.instance.data.time,
      "00:06",
      "wheel motion must not commit the time",
    );
    assert.equal(r.instance.data.timeRange[1][0], "00分");
    r.instance.timeChange({ detail: { value: [9, 0] } });
    assert.equal(r.instance.data.time, "09:00");
    r.instance.timeColumnChange({ detail: { column: 0, value: 10 } });
    r.instance.cancelTimePicker();
    assert.equal(r.instance.data.time, "09:00");
    assert.equal(r.instance.data.timeIndices[0], 9);
    r.instance.dateChange({ detail: { value: "2026-09-16" } });
    r.instance.timeChange({ detail: { value: [0, 0] } });
    assert.equal(r.instance.data.time, "00:00");
    r.instance.dateChange({ detail: { value: "2026-09-15" } });
    assert.equal(
      r.instance.data.time,
      "00:06",
      "returning to today clamps an earlier time",
    );
    r.instance.onUnload();
  }
  {
    const r = runtime({ now: new Date(2026, 8, 15, 23, 58, 30).getTime() });
    await settle();
    r.instance.configure({ currentTarget: { dataset: {} } });
    assert.deepEqual(Array.from(r.instance.data.timeRange[0]), ["23时"]);
    assert.deepEqual(Array.from(r.instance.data.timeRange[1]), ["59分"]);
    r.instance.onHide();
    r.setNow(new Date(2026, 8, 15, 23, 59, 10).getTime());
    r.instance.onShow();
    assert.equal(r.instance.data.date, "2026-09-16");
    assert.equal(r.instance.data.time, "00:00");
    assert.equal(r.instance.data.timeRange[0].length, 24);
    r.setNow(new Date(2026, 8, 16, 0, 0, 0).getTime());
    r.instance.prepareTimePicker();
    assert.equal(r.instance.data.time, "00:01");
    r.instance.onUnload();
  }
  for (const options of [
    {},
    { missingIntl: true },
    { intl: undefined },
    { intl: {} },
    {
      intl: {
        DateTimeFormat() {
          throw new Error("unsupported Intl");
        },
      },
    },
    { intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) } },
  ]) {
    const r = runtime(options);
    await settle();
    r.instance.configure({ currentTarget: { dataset: {} } });
    await settle();
    r.instance.setData({
      search: "英\u200b语，体育、ＡＢ",
      positive: "体\u200b育馆、户外",
      negative: "李\u2060老师､王老师",
    });
    const expectedInstant = new Date(
      `${r.instance.data.date}T${r.instance.data.time}:00`,
    ).toISOString();
    await r.instance.save();
    assert.equal(r.instance.data.draftError, "");
    assert.equal(r.calls.save.length, 1);
    assert.deepEqual(Array.from(r.calls.save[0].searchKeywords), [
      "英语",
      "体育",
      "ab",
    ]);
    assert.deepEqual(Array.from(r.calls.save[0].negativeKeywords), [
      "李老师",
      "王老师",
    ]);
    assert.deepEqual(Array.from(r.calls.save[0].positiveKeywords), [
      "体育馆",
      "户外",
    ]);
    assert.equal(
      r.calls.save[0].scheduledAt,
      expectedInstant,
      "Intl support must not change the selected instant",
    );
    assert.equal(
      r.calls.save[0].sourceTimezone,
      Object.keys(options).length
        ? "UTC"
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    assert.equal(r.instance.data.tasks[0].negativeLabel, "李老师、王老师");
    assert.equal(r.instance.data.tasks[0].positiveLabel, "体育馆、户外");
    r.instance.onUnload();
  }
  for (const toggleError of ["次数不足请先购买", "使用人数过多，请稍后重试"]) {
    const r = runtime({ toggleError });
    await settle();
    r.instance.setData({ tasks: [{ id: "task-a", enabled: false }] });
    await r.instance.toggle({ currentTarget: { dataset: { id: "task-a" } } });
    await settle();
    assert.equal(r.instance.data.capsuleToastMessage, toggleError);
    assert.equal(r.instance.data.capsuleToastVisible, true);
    assert.equal(r.instance.data.tasks[0].enabled, false);
    r.fireTimer(3000);
    assert.equal(r.instance.data.capsuleToastVisible, false);
    await settle();
    assert.equal(r.instance.data.capsuleToastMounted, false);
    r.instance.onUnload();
  }
  {
    const creation = deferred();
    const r = runtime({
      creation,
      onNative(page) {
        page.onHide();
        page.onShow();
      },
    });
    await settle();
    const purchase = r.instance.buy(event);
    await settle();
    await r.instance.buy(event);
    assert.equal(
      r.calls.create.length,
      1,
      "Rapid taps must create only one order",
    );
    assert.equal(r.calls.create[0].plan, "course_assistant");
    assert.equal(
      r.calls.navigate.length,
      0,
      "Buy must not navigate to another page",
    );
    creation.resolve({
      ...r.result("pending"),
      payment: { signData: "signed-verbatim", paySig: "signature" },
    });
    await purchase;
    await settle();
    assert.equal(r.calls.native.length, 1);
    assert.equal(r.calls.native[0].signData, "signed-verbatim");
    assert.equal(r.pending.size, 0);
    assert.equal(r.instance.data.remaining, 1);
    assert.ok(
      r.calls.status >= 2,
      "Balance must refresh after payment returns",
    );
    assert.equal(r.instance.data.statusLoaded, true);
    r.instance.onUnload();
  }
  {
    const r = runtime({ nativeCancelled: true });
    await settle();
    await r.instance.buy(event);
    assert.equal(
      r.instance.data.canResumePayment,
      true,
      "Dismissed checkout must expose the verified recovery action on the same page",
    );
    await r.instance.buy(event);
    assert.equal(r.calls.create.length, 1);
    assert.equal(r.calls.native.length, 1);
    r.instance.cancelPurchase();
    await settle();
    assert.equal(r.calls.cancel, 1);
    assert.equal(r.pending.size, 0);
    r.instance.onUnload();
  }
  {
    const pending = new Map([
      [
        "student-a",
        {
          idempotencyKey: "existing-key",
          orderId: "order-a",
          planId: "course_assistant",
          paymentInvoked: true,
        },
      ],
    ]);
    const r = runtime({ pending });
    await settle();
    assert.equal(
      r.pending.size,
      0,
      "Reentering the task page must reconcile saved payment",
    );
    assert.equal(r.calls.create.length, 0);
    assert.equal(
      r.calls.native.length,
      0,
      "Restoring paid orders must never reopen the cashier",
    );
    r.instance.onUnload();
  }
  {
    const creation = deferred();
    const r = runtime({ creation });
    await settle();
    const purchase = r.instance.buy(event);
    await settle();
    r.instance.onHide();
    r.switchAccount();
    r.instance.onShow();
    creation.resolve({
      ...r.result("pending"),
      payment: { signData: "old-account" },
    });
    await purchase;
    await settle();
    assert.equal(
      r.calls.native.length,
      0,
      "A delayed signature must not open checkout after changing accounts",
    );
    assert.equal(r.instance.data.account, "student-b");
    assert.equal(r.pending.has("student-a"), true);
    r.instance.onUnload();
  }
  {
    const r = runtime({ noCache: true, loadError: true });
    await settle();
    assert.equal(
      r.instance.data.statusLoaded,
      true,
      "Payment loading cannot hide task data",
    );
    assert.equal(r.instance.data.loaded, false);
    r.instance.configure({ currentTarget: { dataset: {} } });
    assert.equal(r.instance.data.draftMounted, true);
    assert.equal(
      r.instance.data.draftActive,
      false,
      "Render the initial sheet state before entering",
    );
    await settle();
    assert.equal(r.instance.data.draftActive, true);
    r.instance.closeDraft();
    assert.equal(
      r.instance.data.draftMounted,
      true,
      "Keep the sheet mounted while exiting",
    );
    assert.equal(r.instance.data.draftActive, false);
    await settle();
    assert.equal(r.instance.data.draftMounted, false);
    r.instance.configure({ currentTarget: { dataset: {} } });
    r.instance.onHide();
    await settle();
    assert.equal(
      r.instance.data.draftMounted,
      false,
      "Late animation callbacks cannot reopen a hidden sheet",
    );
    r.instance.onShow();
    await settle();
    assert.equal(
      r.instance.data.draftActive,
      true,
      "Returning from the background preserves the draft",
    );
    r.instance.onUnload();
  }
  for (const [windowHeight, bodyHeight] of [
    [812, 240],
    [568, 900],
    [932, 360],
  ]) {
    const r = runtime({ windowHeight, bodyHeight });
    await settle();
    r.instance.configure({ currentTarget: { dataset: {} } });
    await settle();
    assert.equal(
      r.instance.data.draftBodyHeight,
      Math.min(bodyHeight, Math.floor(windowHeight * 0.86) - 152),
      "The drawer must fit the measured form, reserving header, footer and safe area on short screens",
    );
    assert.equal(r.instance.data.draftActive, true);
    r.instance.onUnload();
  }
  {
    const measurements = [];
    const r = runtime({ measurements });
    await settle();
    r.instance.configure({ currentTarget: { dataset: {} } });
    await settle();
    r.instance.closeDraft();
    measurements.splice(0).forEach((measure) => measure());
    await settle();
    assert.equal(
      r.instance.data.draftMounted,
      false,
      "A late layout measurement cannot reopen a closed drawer",
    );
    r.instance.onUnload();
  }
  console.log(
    "Course grab page checks passed: direct checkout, duplicate taps, native return, cancellation, recovery, account isolation and sheet lifecycle.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
