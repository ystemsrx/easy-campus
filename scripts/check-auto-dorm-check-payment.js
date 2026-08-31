const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");
const read = (relativePath) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const appConfig = JSON.parse(read("miniprogram/app.json"));
const featurePackage = appConfig.subPackages.find(
  (subpackage) => subpackage.root === "features",
);
const statusTypes = read("miniprogram/types/api.ts");
const service = read("miniprogram/services/auto-dorm-check.ts");
const request = read("miniprogram/services/request.ts");
const store = read("miniprogram/store/auto-dorm-check.ts");
const profile = read("miniprogram/pages/profile/index.ts");
const autoScript = read("miniprogram/features/pages/auto-dorm-check/index.ts");
const autoTemplate = read(
  "miniprogram/features/pages/auto-dorm-check/index.wxml",
);
const agreementScript = read(
  "miniprogram/features/pages/auto-dorm-check-agreement/index.ts",
);
const agreementTemplate = read(
  "miniprogram/features/pages/auto-dorm-check-agreement/index.wxml",
);
const agreementStyles = read(
  "miniprogram/features/pages/auto-dorm-check-agreement/index.wxss",
);
const paymentScript = read(
  "miniprogram/features/pages/auto-dorm-check-payment/index.ts",
);
const paymentTemplate = read(
  "miniprogram/features/pages/auto-dorm-check-payment/index.wxml",
);
const autoStyles = read(
  "miniprogram/features/pages/auto-dorm-check/index.wxss",
);
const paymentStyles = read(
  "miniprogram/features/pages/auto-dorm-check-payment/index.wxss",
);

assert(
  featurePackage?.pages?.includes("pages/auto-dorm-check-payment/index"),
  "app.json: 独立打卡套餐页必须注册在 features 分包",
);
assert(
  featurePackage?.pages?.includes("pages/auto-dorm-check-agreement/index"),
  "app.json: 自动查寝使用须知必须注册为独立页面",
);
assert(
  autoStyles.includes("border: 3rpx solid var(--color-text-tertiary)") &&
    autoStyles.includes("background-color: var(--color-text-tertiary)"),
  "自动查寝使用须知未勾选时必须显示为灰色",
);
assert(
  !paymentScript.includes("paymentPlanDisplayName(") &&
    paymentTemplate.includes("{{item.name}}") &&
    !paymentTemplate.includes('class="payment-plan-quota"') &&
    !paymentStyles.includes(".payment-plan-quota"),
  "套餐卡片须直接展示服务端名称，并保持无中间额度行的简洁布局",
);
assert(
  paymentTemplate.includes("限有效期内使用，学期结束将从下学期继续") &&
    paymentTemplate.includes("{{item.description}}") &&
    !paymentScript.includes("paymentPlanDescription("),
  "按时间分组保留有效期说明，套餐说明必须由服务端配置驱动",
);
assert(
  autoTemplate.includes(
    "openingPayment ? 'auto-dorm-check-package-card--opening' : ''",
  ) &&
    autoStyles.includes(".auto-dorm-check-package-card--opening") &&
    autoStyles.includes("background-color: var(--color-bg-subtle)"),
  "进入打卡套餐页前须沿用“我的”页面的背景按压反馈",
);
assert(
  autoTemplate.includes(
    '<scroll-view class="page-scroll" type="list" scroll-y enhanced',
  ) && autoTemplate.indexOf("打卡地点") < autoTemplate.indexOf("打卡套餐"),
  "自动查寝页必须可纵向滚动，套餐入口须紧跟打卡地点",
);
assert(
  autoTemplate.includes('wx:if="{{paymentEnabled}}"') &&
    autoScript.includes("paymentEnabled: Boolean(status.paymentEnabled)") &&
    autoScript.includes(
      "...entitlementViewData(status.entitlement || EMPTY_ENTITLEMENT)",
    ) &&
    autoScript.includes("entitlementRemainingDays: remainingDays") &&
    autoScript.includes("entitlementRemainingUses: remainingUses"),
  "付款关闭时必须隐藏整个套餐入口，但仍保留服务端返回的时间和次数余额",
);
assert(
  autoScript.includes("loadAutoDormCheckSnapshot") &&
    autoScript.indexOf("this.hydrateCachedStatus(lease.account);") <
      autoScript.indexOf("void this.loadStatus();") &&
    autoScript.includes("loading: false") &&
    autoScript.includes("loaded: true") &&
    store.includes("status: AutoDormCheckStatus | null") &&
    store.includes("const status = cachedStatus(value.status)") &&
    store.includes("status: cachedStatus,"),
  "自动查寝页必须先展示账号隔离的完整缓存，再静默刷新服务端状态",
);
assert(
  service.includes("getAutoDormCheckLocation") &&
    service.includes("pendingLocationRequest") &&
    service.includes("`${ROOT}/location`") &&
    store.includes("LOCATION_PREFIX") &&
    store.includes("withCachedAutoDormCheckLocation") &&
    autoScript.includes("async loadCheckInLocation()") &&
    autoScript.includes(
      "if (!this.data.hasCheckInLocation) void this.loadCheckInLocation();",
    ) &&
    autoScript.indexOf("void this.loadCheckInLocation();") <
      autoScript.indexOf("void this.loadStatus();") &&
    !autoScript.includes("地点读取中"),
  "无缓存地点时必须在进入页面后立即静默补取，并独立缓存以避免状态响应覆盖",
);
assert(
  autoScript.includes("preloadAutoDormCheckPayment") &&
    autoScript.indexOf("void preloadAutoDormCheckPayment()") <
      autoScript.indexOf("void this.loadStatus();") &&
    service.includes("pendingPaymentRequest") &&
    service.includes("cachedPayment") &&
    service.includes("PAYMENT_PREFETCH_MAX_AGE_MILLISECONDS") &&
    paymentScript.includes("getCachedAutoDormCheckPayment") &&
    paymentScript.includes("getPendingAutoDormCheckPayment") &&
    paymentScript.includes("void this.loadPayment(pendingPreload)") &&
    paymentScript.includes("} else if (!cachedPayment) {") &&
    paymentScript.includes("preloaded || getAutoDormCheckPayment()"),
  "进入自动查寝页时必须后台预取套餐，套餐页复用账号隔离的缓存或在途请求",
);
assert(
  autoScript.includes("loadedAccount !== lease.account") &&
    autoScript.includes("loadedStatusAccounts.delete(instance)") &&
    autoScript.includes('checkInLocationName: ""') &&
    autoScript.includes("paymentEnabled: false") &&
    autoScript.includes("...entitlementViewData(EMPTY_ENTITLEMENT)"),
  "自动查寝页切换账号时必须先清空旧地点、开关和额度，再读取新账号",
);
assert(
  autoTemplate.includes(
    "effectiveEnabled || (enabled && (!agreementAccepted || (paymentEnabled && !accessGranted)))",
  ) && autoScript.includes('payment_required: { label: "额度不足"'),
  "额度不足且偏好仍开启时，开关必须显示为已开启但暂停",
);
assert(
  autoTemplate.includes('aria-role="checkbox"') &&
    autoTemplate.includes('bindtap="onAgreementTap"') &&
    autoTemplate.includes('catchtap="openAgreement"') &&
    autoTemplate.includes("《自动查寝使用须知》") &&
    autoScript.includes(
      'navigateTo("/features/pages/auto-dorm-check-agreement/index")',
    ) &&
    autoScript.includes("async onAgreementTap()") &&
    autoScript.indexOf("!this.data.agreementAccepted") <
      autoScript.indexOf("setAutoDormCheckEnabled(enabled)"),
  "自动查寝页底部必须沿用登录页式手动勾选，并可进入独立须知页面",
);
assert(
  agreementTemplate.includes("功能用途") &&
    agreementTemplate.includes("使用条件") &&
    agreementTemplate.includes("自动执行与结果确认") &&
    agreementTemplate.includes("责任说明") &&
    agreementTemplate.includes("启停与须知更新") &&
    agreementTemplate.includes("不读取或校验执行时的实际位置") &&
    agreementTemplate.includes("无论你当时实际身处何处") &&
    agreementTemplate.includes("即使技术上可以在任意实际位置") &&
    !agreementTemplate.includes("agreement-reminder") &&
    agreementTemplate.includes("由你自行承担") &&
    !agreementTemplate.includes('aria-role="checkbox"') &&
    !agreementScript.includes("acceptAutoDormCheckAgreement") &&
    agreementStyles.includes(".agreement-document") &&
    agreementStyles.includes("white-space: normal") &&
    agreementStyles.includes("word-break: normal"),
  "独立使用须知页必须完整说明使用条件、执行风险和用户责任，且不重复放置勾选控件",
);
assert(
  autoTemplate.includes("entitlementPaused && entitlementResumesAt") &&
    !autoTemplate.includes('wx:if="{{entitlementPaused}}"'),
  "只有服务端提供恢复日期时才能展示下学期继续提示",
);
assert(
  statusTypes.includes('| "payment_required"') &&
    statusTypes.includes('| "agreement_required"') &&
    statusTypes.includes("agreementAcceptedAt: string | null") &&
    statusTypes.includes("remainingSeconds: number") &&
    statusTypes.includes("credited: boolean") &&
    store.includes('"payment_required"') &&
    store.includes('"agreement_required"') &&
    profile.includes('payment_required: { label: "额度不足"'),
  "协议、额度与入账状态必须贯穿类型、缓存和我的页",
);
assert(
  service.includes("setAutoDormCheckAgreement(") &&
    service.includes("data: { accepted, version }") &&
    store.includes('typeof status.agreementAccepted !== "boolean"') &&
    autoScript.includes('agreement_required: { label: "待同意"') &&
    profile.includes('agreement_required: { label: "待同意"') &&
    autoScript.includes("const accepted = !this.data.agreementAccepted") &&
    autoScript.indexOf("agreementAccepted: accepted") <
      autoScript.indexOf("await setAutoDormCheckAgreement(") &&
    autoScript.includes(
      "const enabled = accepted ? this.data.enabled : false",
    ) &&
    autoScript.includes("this.setData(previous)") &&
    !autoTemplate.includes("auto-dorm-check-agreement-spinner"),
  "协议同意与撤回应乐观更新、失败回滚，撤回时同时关闭自动查寝",
);
assert(
  service.includes('headers: { "Idempotency-Key": idempotencyKey }') &&
    service.includes("data: { planId }") &&
    !service.includes("data: { planId, price") &&
    paymentScript.includes("pending.planId") &&
    paymentTemplate.includes('data-id="{{item.id}}"') &&
    store.includes("planId: string") &&
    store.includes("planCode?: unknown") &&
    request.includes("...options.headers"),
  "订单请求必须只提交套餐 ID、兼容迁移旧 pending，并通过 Idempotency-Key 防重复购买",
);
const startPurchaseSource = paymentScript.slice(
  paymentScript.indexOf("async startPurchase("),
  paymentScript.indexOf("async runPaymentFlow("),
);
assert(
  startPurchaseSource.indexOf("savePendingAutoDormCheckPayment(") >= 0 &&
    startPurchaseSource.includes(
      "if (!savePendingAutoDormCheckPayment(lease.account, pending))",
    ) &&
    startPurchaseSource.indexOf("savePendingAutoDormCheckPayment(") <
      startPurchaseSource.indexOf("await this.runPaymentFlow("),
  "支付 pending 必须先可靠落盘，保存失败不得发起订单请求",
);
assert(
  store.includes("): boolean {") &&
    store.includes("stored.idempotencyKey === payment.idempotencyKey") &&
    store.includes("stored.orderId === payment.orderId"),
  "pending 写入后必须读回核对幂等键和订单号",
);
assert(
  paymentTemplate.indexOf('wx:if="{{processing}}"') <
    paymentTemplate.indexOf("<scroll-view") &&
    paymentTemplate.includes('class="payment-processing-spinner"') &&
    paymentScript.includes("wx.showModal({") &&
    paymentTemplate.includes('bindaction="retryPendingPayment"'),
  "确认购买须使用弹窗，付款处理中须用整页超大加载状态替换内容",
);
assert(
  paymentScript.includes("this.data.loading ||") &&
    paymentTemplate.includes('aria-disabled="{{loading}}"') &&
    paymentTemplate.includes("{{loading ? 'none'"),
  "静默刷新付费开关期间必须禁止点击旧套餐",
);
assert(
  paymentScript.includes("activePendingPayment(instance, lease.account)") &&
    paymentScript.includes("pendingResult: true") &&
    paymentScript.includes("retryPendingPayment()"),
  "未终态 pending 必须锁住新购买，并提供继续确认原订单的路径",
);
assert(
  paymentScript.includes(
    "activeFlowAccounts.get(instance) === lease.account",
  ) &&
    paymentScript.includes(
      "flowRevisions.get(instance) === preparationRevision",
    ) &&
    paymentScript.includes(
      "rememberActivePendingPayment(instance, lease.account, pending)",
    ),
  "内存中的支付流程与 pending 必须绑定当前账号和修订号，切号时取消旧流程",
);
assert(
  paymentScript.includes("loadedAccount !== lease.account") &&
    paymentScript.includes("loadedPaymentAccounts.delete(instance)") &&
    paymentScript.includes("...entitlementViewData(EMPTY_ENTITLEMENT)") &&
    paymentScript.includes("if (!isSessionLeaseCurrent(lease))"),
  "切换账号时必须立即清空旧额度，旧账号打开的确认弹窗不得替新账号购买",
);
assert(
  !paymentScript.includes("UNCREATED_PAYMENT_MAX_AGE_MILLISECONDS") &&
    !paymentScript.includes("Date.now() - pending.createdAt"),
  "未知结果的订单创建请求不得按本地时间过期，必须保留原幂等键继续确认",
);
assert(
  paymentScript.includes("if (!keepPending || !this.data.loaded)") &&
    paymentScript.includes("void this.loadPayment()"),
  "确定性创建失败后必须重读付费开关和套餐，避免继续展示已关闭入口",
);
assert(
  paymentScript.includes('"AUTO_DORM_CHECK_ACADEMIC_PERIOD_UNAVAILABLE"') &&
    paymentScript.includes("SAFE_ORDER_CREATION_FAILURE_CODES.has(error.code)"),
  "服务端明确表示校历暂缺时尚未创建订单，必须清除 pending 以允许改选套餐",
);
assert(
  paymentScript.includes(
    'order.status === "paid" && order.credited === true',
  ) &&
    paymentScript.includes("getAutoDormCheckPaymentOrder(current.order.id)") &&
    paymentScript.includes('this.showCapsuleToast("购买成功")') &&
    paymentScript.includes("CAPSULE_TOAST_HOLD_MILLISECONDS = 3000"),
  "只有 paid 且 credited 的订单可以显示三秒购买成功胶囊",
);

function entitlement(remainingDays = 0, remainingUses = 0) {
  return {
    time: {
      remainingSeconds: remainingDays * 86400,
      remainingDays,
      paused: false,
      resumesAt: null,
    },
    uses: { remaining: remainingUses },
  };
}

function order(status, credited, id = "order-1") {
  return {
    id,
    planId: "time-7-days",
    status,
    credited,
    amountCents: 188,
    createdAt: "2026-09-01T00:00:00.000Z",
    paidAt: status === "paid" ? "2026-09-01T00:00:01.000Z" : null,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadPaymentServiceRuntime() {
  let lease = {
    token: "token-1",
    userId: "user-1",
    account: "20260001",
    signedInAt: 1,
  };
  const requests = [];
  const output = ts.transpileModule(service, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (specifier) => {
      if (specifier === "../store/auto-dorm-check") {
        return { saveAutoDormCheckSnapshot: () => undefined };
      }
      if (specifier === "../store/session") {
        return {
          captureSessionLease: () => lease,
          isSessionLeaseCurrent: (candidate) =>
            candidate.token === lease.token &&
            candidate.account === lease.account &&
            candidate.signedInAt === lease.signedInAt,
          sessionLeaseKey: (candidate) =>
            `${candidate.token}:${candidate.account}:${candidate.signedInAt}`,
        };
      }
      if (specifier === "./request") {
        return {
          apiRequest: () => {
            const request = deferred();
            requests.push(request);
            return request.promise;
          },
        };
      }
      throw new Error(`Unexpected payment service dependency: ${specifier}`);
    },
  );
  return {
    api: moduleRecord.exports,
    requests,
    setLease(nextLease) {
      lease = nextLease;
    },
  };
}

async function checkPaymentPrefetch() {
  const runtime = loadPaymentServiceRuntime();
  const first = runtime.api.preloadAutoDormCheckPayment();
  const reused = runtime.api.preloadAutoDormCheckPayment();
  assert(
    runtime.requests.length === 1 &&
      first === reused &&
      runtime.api.getPendingAutoDormCheckPayment() === first,
    "同一账号重复预取必须复用一条在途套餐请求",
  );

  const firstPayment = {
    paymentEnabled: true,
    accessGranted: true,
    accessMode: "time",
    plans: [],
    entitlement: entitlement(7, 0),
  };
  runtime.requests[0].resolve(firstPayment);
  await first;
  assert(
    runtime.api.getPendingAutoDormCheckPayment() === null &&
      runtime.api.getCachedAutoDormCheckPayment() === firstPayment,
    "预取完成后必须留下当前账号可直接复用的套餐结果",
  );

  const refreshed = runtime.api.getAutoDormCheckPayment();
  assert(
    runtime.requests.length === 2,
    "购买完成或手动重试必须能够强制读取最新套餐",
  );
  runtime.requests[1].resolve(firstPayment);
  await refreshed;

  runtime.setLease({
    token: "token-2",
    userId: "user-2",
    account: "20260002",
    signedInAt: 2,
  });
  assert(
    runtime.api.getCachedAutoDormCheckPayment() === null &&
      runtime.api.getPendingAutoDormCheckPayment() === null,
    "套餐缓存和在途请求不得跨账号复用",
  );
}

function loadPaymentPageRuntime(options) {
  let pageDefinition;
  let timerId = 0;
  const calls = {
    create: 0,
    get: 0,
    clear: 0,
    modal: 0,
    resumed: null,
    saved: [],
    toasts: [],
  };
  let storedPending = options.storedPending || null;
  const orderQueue = [...(options.orderQueue || [])];
  const api = {
    createAutoDormCheckPaymentOrder: async () => {
      calls.create += 1;
      if (!options.createResult) {
        throw new Error("Unexpected order creation");
      }
      return options.createResult;
    },
    getAutoDormCheckPaymentOrder: async () => {
      calls.get += 1;
      return orderQueue.length
        ? orderQueue.shift()
        : options.repeatedOrderResult;
    },
    getAutoDormCheckPayment: async () => ({
      paymentEnabled: options.paymentEnabled !== false,
      accessGranted: true,
      accessMode: "time",
      plans: [],
      entitlement: options.freshEntitlement || entitlement(7, 0),
    }),
  };
  class ApiClientError extends Error {}
  const lease = {
    token: "token",
    userId: "user-1",
    account: "20260001",
    signedInAt: 1,
  };
  const output = ts.transpileModule(paymentScript, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function(
    "module",
    "exports",
    "require",
    "Page",
    "wx",
    "getApp",
    "setTimeout",
    "clearTimeout",
    output,
  )(
    moduleRecord,
    moduleRecord.exports,
    (specifier) => {
      if (specifier === "../../../services/auto-dorm-check") return api;
      if (specifier === "../../../services/request") {
        return {
          ApiClientError,
          getErrorMessage: (error, fallback) => error?.message || fallback,
        };
      }
      if (specifier === "../../../store/auto-dorm-check") {
        return {
          clearPendingAutoDormCheckPayment: () => {
            calls.clear += 1;
            storedPending = null;
          },
          loadPendingAutoDormCheckPayment: () => storedPending,
          savePendingAutoDormCheckPayment: (_account, value) => {
            calls.saved.push(value);
            storedPending = value;
          },
        };
      }
      if (specifier === "../../../store/session") {
        return {
          captureSessionLease: () => lease,
          isSessionLeaseCurrent: () => true,
        };
      }
      if (specifier === "../../../utils/appearance") {
        return {
          resolveAppearance: () => ({}),
          syncWindowBackground: () => undefined,
        };
      }
      if (specifier === "../../../utils/haptics") {
        return { haptic: () => undefined };
      }
      if (specifier === "../../../utils/navigation") {
        return { ensureAuthenticated: () => true };
      }
      throw new Error(`Unexpected payment dependency: ${specifier}`);
    },
    (definition) => {
      pageDefinition = definition;
    },
    {
      getRandomValues: async ({ length }) => ({
        randomValues: new Uint8Array(length).fill(7).buffer,
      }),
      navigateBack: () => undefined,
      showModal: () => {
        calls.modal += 1;
      },
    },
    () => ({ globalData: { preferences: {} } }),
    (callback) => {
      const id = ++timerId;
      callback();
      return id;
    },
    () => undefined,
  );
  const instance = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
  instance.onLoad();
  instance.data.loaded = true;
  instance.data.loading = false;
  instance.data.paymentEnabled = true;
  instance.showCapsuleToast = (message) => calls.toasts.push(message);
  instance.dismissCapsuleToast = () => undefined;
  return { instance, calls, lease };
}

async function checkStateMachine() {
  {
    const paid = { order: order("paid", true), entitlement: entitlement(7, 3) };
    const runtime = loadPaymentPageRuntime({
      createResult: paid,
      freshEntitlement: paid.entitlement,
    });
    await runtime.instance.runPaymentFlow(runtime.lease, {
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      orderId: null,
      planId: "time-7-days",
      createdAt: Date.now(),
    });
    assert(
      runtime.calls.create === 1 &&
        runtime.calls.get === 0 &&
        runtime.calls.clear === 1 &&
        runtime.calls.toasts.includes("购买成功") &&
        runtime.instance.data.processing === false &&
        runtime.instance.data.remainingDays === 7,
      "paid 且 credited 的订单必须立即入账、清 pending 并恢复页面",
    );
  }

  {
    const awaitingCredit = {
      order: order("paid", false, "order-crediting"),
      entitlement: entitlement(0, 0),
    };
    const credited = {
      order: order("paid", true, "order-crediting"),
      entitlement: entitlement(7, 0),
    };
    const runtime = loadPaymentPageRuntime({
      createResult: awaitingCredit,
      orderQueue: [credited],
      freshEntitlement: credited.entitlement,
    });
    await runtime.instance.runPaymentFlow(runtime.lease, {
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      orderId: null,
      planId: "time-7-days",
      createdAt: Date.now(),
    });
    assert(
      runtime.calls.get === 1 && runtime.calls.toasts.includes("购买成功"),
      "paid 但未 credited 时必须继续轮询，不能提前显示购买成功",
    );
  }

  for (const [status, expectedToast] of [
    ["failed", "购买失败"],
    ["cancelled", "已取消购买"],
  ]) {
    const terminal = {
      order: order(status, false, `order-${status}`),
      entitlement: entitlement(0, 5),
    };
    const runtime = loadPaymentPageRuntime({
      createResult: terminal,
      freshEntitlement: terminal.entitlement,
    });
    await runtime.instance.runPaymentFlow(runtime.lease, {
      idempotencyKey: `00000000-0000-4000-8000-00000000000${
        status === "failed" ? "3" : "4"
      }`,
      orderId: null,
      planId: "count-10",
      createdAt: Date.now(),
    });
    assert(
      runtime.calls.clear === 1 &&
        runtime.calls.toasts.includes(expectedToast) &&
        !runtime.calls.toasts.includes("购买成功"),
      `${status} 终态必须清 pending，且不得显示购买成功`,
    );
  }

  {
    const pendingPayment = {
      idempotencyKey: "00000000-0000-4000-8000-000000000005",
      orderId: "order-pending",
      planId: "time-7-days",
      createdAt: Date.now(),
    };
    const pending = {
      order: order("pending", false, "order-pending"),
      entitlement: entitlement(0, 0),
    };
    const runtime = loadPaymentPageRuntime({
      createResult: pending,
      repeatedOrderResult: pending,
      storedPending: pendingPayment,
    });
    await runtime.instance.runPaymentFlow(runtime.lease, pendingPayment);
    assert(
      runtime.calls.get === 46 &&
        runtime.calls.clear === 0 &&
        runtime.calls.toasts.includes("支付结果确认中") &&
        runtime.instance.data.processing === false &&
        runtime.instance.data.pendingResult === true,
      "pending 超时后必须保留 pending、恢复页面并提示继续确认",
    );
    runtime.instance.runPaymentFlow = (_lease, resumed) => {
      runtime.calls.resumed = resumed;
      return Promise.resolve();
    };
    runtime.instance.onPlanTap({ currentTarget: { dataset: {} } });
    assert(
      runtime.calls.modal === 0 &&
        runtime.calls.resumed?.orderId === "order-pending",
      "存在 pending 时点击其他套餐必须继续原订单，不能打开新购买弹窗",
    );
    runtime.calls.resumed = null;
    runtime.instance.retryPendingPayment();
    assert(
      runtime.calls.resumed?.idempotencyKey ===
        "00000000-0000-4000-8000-000000000005",
      "重新确认必须复用原 orderId 与 idempotencyKey",
    );
  }

  {
    const recovered = {
      order: order("paid", true, "order-recovered"),
      entitlement: entitlement(30, 0),
    };
    const runtime = loadPaymentPageRuntime({
      orderQueue: [recovered],
      freshEntitlement: recovered.entitlement,
    });
    await runtime.instance.runPaymentFlow(runtime.lease, {
      idempotencyKey: "00000000-0000-4000-8000-000000000006",
      orderId: "order-recovered",
      planId: "time-30-days",
      createdAt: Date.now(),
    });
    assert(
      runtime.calls.create === 0 &&
        runtime.calls.get === 1 &&
        runtime.calls.toasts.includes("购买成功"),
      "已有 orderId 的 pending 恢复必须查询原订单，不能重复创建订单",
    );
  }
}

async function main() {
  await checkPaymentPrefetch();
  await checkStateMachine();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Auto dorm check payment checks passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
