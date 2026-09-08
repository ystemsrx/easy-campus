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
const profile =
  read("miniprogram/pages/profile/index.ts") +
  "\n" +
  read("miniprogram/data/profile-render.ts");
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
    service.includes("data: { planId, code }") &&
    !service.includes("data: { planId, price") &&
    paymentScript.includes("pending.planId") &&
    paymentTemplate.includes('data-id="{{item.id}}"') &&
    store.includes("planId: string") &&
    store.includes("planCode?: unknown") &&
    request.includes("...options.headers"),
  "订单请求必须只提交套餐 ID 和微信临时登录码、兼容迁移旧 pending，并通过 Idempotency-Key 防重复购买",
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
      startPurchaseSource.lastIndexOf("await this.runPaymentFlow("),
  "支付 pending 必须先可靠落盘，保存失败不得发起订单请求",
);
assert(
  store.includes("): boolean {") &&
    store.includes("stored.idempotencyKey === payment.idempotencyKey") &&
    store.includes("stored.orderId === payment.orderId"),
  "pending 写入后必须读回核对幂等键和订单号",
);
assert(
  paymentTemplate.indexOf("<navigation-bar") <
    paymentTemplate.indexOf('class="payment-progress-region"') &&
    !paymentTemplate.includes("<scroll-view wx:else") &&
    paymentTemplate.includes('class="payment-processing-spinner"') &&
    paymentTemplate.includes("{{progressPlanName}} {{progressPriceLabel}}") &&
    !paymentTemplate.includes("{{pendingOrderId}}") &&
    !paymentTemplate.includes("可以先返回，稍后继续确认") &&
    paymentTemplate.includes('bindtap="cancelPendingPayment"') &&
    paymentScript.includes("wx.showModal({") &&
    paymentTemplate.includes('bindtap="retryPendingPayment"'),
  "付款确认只展示套餐和金额，保留导航、取消及重试入口，不展示订单号和冗余说明",
);
assert(
  paymentScript.includes("this.data.loading ||") &&
    paymentTemplate.includes(
      'aria-disabled="{{loading || processing || pendingResult}}"',
    ) &&
    paymentTemplate.includes(
      "{{loading || processing || pendingResult ? 'none'",
    ),
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
      if (specifier === "../demo/identity")
        return { isDemoAccount: () => false };
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
          apiRequest: (url, options) => {
            const request = deferred();
            request.url = url;
            request.options = options;
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
  const renders = [];
  const measurements = [];
  const timers = new Map();
  let panelHeight = 320;
  const calls = {
    create: 0,
    get: 0,
    clear: 0,
    modal: 0,
    resumed: null,
    saved: [],
    toasts: [],
    views: [],
    creations: [],
  };
  let storedPending = options.storedPending || null;
  const orderQueue = [...(options.orderQueue || [])];
  const createQueue = [...(options.createQueue || [])];
  const api = {
    getCachedAutoDormCheckPayment: () => null,
    getPendingAutoDormCheckPayment: () => null,
    resumeAutoDormCheckPaymentOrder: async () => {
      calls.resume = (calls.resume || 0) + 1;
      return (
        options.resumeResult ||
        options.createResult ||
        options.repeatedOrderResult
      );
    },
    launchWechatPayment: async () => {
      calls.native = (calls.native || 0) + 1;
      options.onNative?.();
      return options.nativeResult || "success";
    },
    cancelAutoDormCheckPaymentOrder: async (id) => {
      calls.cancel = (calls.cancel || 0) + 1;
      calls.cancelledOrderId = id;
      if (options.cancelError) throw options.cancelError;
      return options.cancelResult;
    },
    createAutoDormCheckPaymentOrder: async (planId, key) => {
      calls.create += 1;
      calls.creations.push({ planId, key });
      if (options.createError)
        throw Object.assign(
          new ApiClientError(options.createError.message),
          options.createError,
        );
      if (createQueue.length) return createQueue.shift();
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
      if (specifier === "../../../utils/app-share")
        return { buildAppShare() {} };
      if (specifier === "../../../utils/date")
        return { formatDateTime: (value) => value };
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
            return true;
          },
        };
      }
      if (specifier === "../../../store/session") {
        return {
          captureSessionLease: () => lease,
          isSessionLeaseCurrent: () => options.isCurrent?.() ?? true,
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
      if (options.deferMotion) timers.set(id, callback);
      else callback();
      return id;
    },
    (id) => timers.delete(id),
  );
  const instance = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    renderedData: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      calls.views.push(structuredClone(this.data));
      const submitted = structuredClone(patch);
      const render = () => {
        Object.assign(this.renderedData, submitted);
        callback?.();
      };
      if (options.deferMotion) renders.push(render);
      else render();
    },
    createSelectorQuery() {
      return {
        select() {
          return this;
        },
        boundingClientRect() {
          return this;
        },
        exec(callback) {
          const height = instance.renderedData.progressMounted
            ? panelHeight
            : 0;
          if (options.deferMotion)
            measurements.push(() => callback([{ height }]));
          else callback([{ height }]);
        },
      };
    },
  };
  instance.onLoad();
  instance.data.loaded = true;
  instance.data.loading = false;
  instance.data.paymentEnabled = true;
  instance.showCapsuleToast = (message) => calls.toasts.push(message);
  instance.dismissCapsuleToast = () => undefined;
  return {
    instance,
    calls,
    lease,
    flushRenders() {
      while (renders.length) renders.shift()();
    },
    flushMeasurements() {
      while (measurements.length) measurements.shift()();
    },
    flushTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    setPanelHeight(height) {
      panelHeight = height;
    },
  };
}

function checkProgressTransition() {
  const runtime = loadPaymentPageRuntime({ deferMotion: true });
  const page = runtime.instance;
  runtime.flushRenders();
  page.setPaymentView({
    processing: true,
    pendingPlanName: "测试套餐",
    pendingPriceLabel: "¥1.00",
  });
  assert(
    page.data.progressMounted && page.data.progressHeight === 0,
    "加载内容先在零高度区域挂载，不能直接挤开下方卡片",
  );
  runtime.flushRenders();
  runtime.flushMeasurements();
  runtime.flushRenders();
  assert(
    page.data.progressHeight === 320 && page.data.progressExpanded,
    "渲染完成后按实际内容高度展开",
  );
  page.setPaymentView({ processing: false });
  runtime.flushRenders();
  assert(
    page.data.progressHeight === 0 &&
      page.data.progressMounted &&
      page.data.progressBusy,
    "结束时收起高度，但保留原加载内容直到退出动画完成",
  );
  page.setPaymentView({ processing: true });
  runtime.flushRenders();
  runtime.flushMeasurements();
  runtime.flushTimers();
  runtime.flushRenders();
  assert(
    page.data.progressMounted && page.data.progressHeight === 320,
    "收起中重新加载时，旧卸载回调不能移除新加载区域",
  );
  runtime.setPanelHeight(284);
  page.setPaymentView({ processing: false, pendingResult: true });
  runtime.flushRenders();
  runtime.flushMeasurements();
  runtime.flushRenders();
  assert(
    page.data.progressHeight === 284 && !page.data.progressBusy,
    "待确认状态按重试按钮实际高度调整占位",
  );
  runtime.setPanelHeight(400);
  page.onResize();
  runtime.flushRenders();
  runtime.flushMeasurements();
  assert(page.data.progressHeight === 400, "窄屏或文字换行后重新测量");
  page.setPaymentView({ processing: true, pendingResult: false });
  runtime.flushRenders();
  page.setPaymentView({ processing: false });
  runtime.flushRenders();
  runtime.flushMeasurements();
  assert(page.data.progressHeight === 0, "快速完成后晚到的测量不得重新展开");
  runtime.flushTimers();
  runtime.flushRenders();
  assert(!page.data.progressMounted, "收起完成后卸载加载内容");
  page.setPaymentView({ processing: true });
  runtime.flushRenders();
  runtime.flushMeasurements();
  page.setPaymentView({ motionClass: "motion-reduced", processing: false });
  runtime.flushRenders();
  assert(
    !page.data.progressMounted && page.data.progressHeight === 0,
    "减少动态效果时立即完成布局变化",
  );
  page.setPaymentView({ processing: true });
  runtime.flushRenders();
  page.onUnload();
  runtime.flushMeasurements();
  assert(page.data.progressHeight === 0, "页面退出后忽略未完成的测量回调");
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
      runtime.instance.data.pendingOrderId === "order-pending" &&
        runtime.instance.data.pendingPlanName &&
        runtime.instance.data.pendingPriceLabel,
      "订单超时后仍须保留订单号、套餐与金额上下文",
    );
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
        runtime.calls.resumed === null &&
        !runtime.instance.data.processing &&
        runtime.instance.data.pendingResult &&
        runtime.calls.toasts.includes("有未结束订单"),
      "存在 pending 时点击其他套餐保持待完成并提示，不能重启轮询或购买",
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

async function checkNativePayment() {
  const pending = {
    order: order("pending", false, "native-order"),
    entitlement: entitlement(0, 0),
    payment: { signType: "RSA", package: "prepay_id=test" },
  };
  const paid = {
    order: order("paid", true, "native-order"),
    entitlement: entitlement(7, 0),
  };
  const saved = {
    idempotencyKey: "00000000-0000-4000-8000-000000000011",
    orderId: null,
    planId: "time-7-days",
    createdAt: Date.now(),
  };
  for (const nativeResult of ["success", "unknown"]) {
    const r = loadPaymentPageRuntime({
      createResult: pending,
      nativeResult,
      orderQueue: [paid],
    });
    await r.instance.runPaymentFlow(r.lease, saved);
    assert(
      r.calls.native === 1 &&
        r.calls.get === 1 &&
        r.calls.toasts.includes("购买成功"),
      "原生成功或未知结果都必须经服务端查单确认入账",
    );
    assert(
      r.calls.saved.some((item) => item.orderId === "native-order"),
      "调起原生支付前必须保存可恢复的订单 ID",
    );
  }
  const cancelled = {
    order: order("cancelled", false, "native-order"),
    entitlement: entitlement(0, 0),
  };
  const r = loadPaymentPageRuntime({
    createResult: pending,
    nativeResult: "cancelled",
    cancelResult: cancelled,
  });
  await r.instance.runPaymentFlow(r.lease, saved);
  assert(
    r.calls.cancel === 1 &&
      r.calls.clear === 1 &&
      !r.calls.toasts.includes("购买成功"),
    "用户取消后须由服务端关单确认，不能误报成功",
  );
  const reopened = loadPaymentPageRuntime({ repeatedOrderResult: pending });
  await reopened.instance.runPaymentFlow(
    reopened.lease,
    { ...saved, orderId: "native-order" },
    "restore",
  );
  assert(
    !reopened.calls.native &&
      reopened.calls.get === 1 &&
      reopened.instance.data.pendingResult,
    "页面恢复只查单，不自动弹出付款界面",
  );
  let current = true;
  const switched = loadPaymentPageRuntime({
    createResult: pending,
    isCurrent: () => current,
    onNative: () => {
      current = false;
    },
  });
  await switched.instance.runPaymentFlow(switched.lease, saved);
  assert(
    !switched.calls.get &&
      !switched.calls.clear &&
      !switched.calls.toasts.includes("购买成功"),
    "原生支付期间切换账号不得污染新账号状态或清除原订单",
  );
}

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

async function checkPendingControls() {
  const saved = {
    idempotencyKey: "00000000-0000-4000-8000-000000000021",
    orderId: "pending-controls",
    planId: "count_10",
    createdAt: Date.now(),
  };
  const pending = {
    order: order("pending", false, saved.orderId),
    entitlement: entitlement(0, 0),
  };
  const paid = {
    order: order("paid", true, saved.orderId),
    entitlement: entitlement(0, 10),
  };
  const cancelled = {
    order: order("cancelled", false, saved.orderId),
    entitlement: entitlement(0, 0),
  };
  {
    const lookup = deferred();
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [lookup.promise],
    });
    r.instance.onShow();
    r.instance.onPaymentScroll({ detail: { scrollTop: 640 } });
    assert(
      r.instance.data.pendingResult &&
        !r.instance.data.progressBusy &&
        !r.instance.data.processing,
      "重新进入时，查单尚未返回也必须立即显示订单待完成",
    );
    r.instance.onPlanTap({ currentTarget: { dataset: { id: "count_1" } } });
    lookup.resolve(pending);
    await settle();
    r.instance.onPaymentScroll({ detail: { scrollTop: 820 } });
    r.instance.data.loading = true;
    r.instance.onPlanTap({ currentTarget: { dataset: { id: "count_1" } } });
    assert(
      r.calls.views.some((v) => v.paymentScrollTop === 640) &&
        r.calls.views.some((v) => v.paymentScrollTop === 820) &&
        r.instance.data.paymentScrollTop === 0,
      "待付款时每次从下方点击套餐都应从当前滚动位置回到顶部",
    );
    assert(
      paymentTemplate.includes('scroll-top="{{paymentScrollTop}}"') &&
        paymentTemplate.includes(
          "scroll-with-animation=\"{{motionClass !== 'motion-reduced'}}\"",
        ),
      "回到待付款卡片使用滚动动画并遵循减少动态效果设置",
    );
    assert(
      r.calls.get === 1 &&
        !r.calls.native &&
        !r.calls.create &&
        !r.calls.modal &&
        !r.instance.data.paymentActionPending,
      "恢复订单只静默查一次，下方购买按钮不得创建或继续支付",
    );
    assert(
      r.calls.views.every((v) => !v.processing && !v.progressBusy) &&
        r.instance.data.pendingResult,
      "恢复和重复点击套餐的整个过程中都不能出现转圈",
    );
    assert(
      r.calls.toasts.includes("有未结束订单"),
      "已有订单时购买提示必须使用有未结束订单",
    );
  }
  {
    const r = loadPaymentPageRuntime({
      repeatedOrderResult: {
        ...paid,
        order: { ...paid.order, credited: false },
      },
    });
    await r.instance.runPaymentFlow(r.lease, saved, "restore");
    assert(
      r.calls.get === 1 &&
        !r.instance.data.processing &&
        r.instance.data.pendingResult,
      "重新进入已付款待入账订单也不能自动启动长轮询",
    );
  }
  {
    const prepay = deferred();
    const confirmation = deferred();
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [pending, confirmation.promise],
      resumeResult: prepay.promise,
      freshEntitlement: paid.entitlement,
    });
    r.instance.showAwaitingPayment(saved);
    r.instance.retryPendingPayment();
    await settle();
    r.instance.retryPendingPayment();
    assert(
      r.calls.resume === 1 &&
        !r.instance.data.processing &&
        r.instance.data.pendingResult,
      "继续支付准备期间保留待完成卡片并阻止重复点击",
    );
    prepay.resolve({
      ...pending,
      payment: { package: "prepay_id=test", signType: "RSA" },
    });
    await settle();
    assert(
      r.calls.native === 1 &&
        r.instance.data.processing &&
        r.instance.data.progressBusy,
      "只有一次新的微信付款尝试返回后才显示确认转圈",
    );
    confirmation.resolve(paid);
    await settle();
    assert(
      r.calls.clear === 1 &&
        !r.instance.data.paymentActionPending &&
        r.calls.toasts.includes("购买成功"),
      "继续支付成功后必须恢复操作并更新额度",
    );
  }
  for (const [result, error, keep] of [
    [cancelled, null, false],
    [pending, null, true],
    [null, new Error("取消失败，请重试"), true],
    [paid, null, false],
  ]) {
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      cancelResult: result,
      cancelError: error,
      freshEntitlement: result?.entitlement,
    });
    r.instance.showAwaitingPayment(saved);
    await r.instance.cancelPendingPayment();
    assert(
      r.calls.cancel === 1 &&
        r.calls.cancelledOrderId === saved.orderId &&
        !r.instance.data.processing &&
        !r.instance.data.paymentActionPending &&
        !r.instance.data.cancellingPayment,
      "取消支付必须关闭原订单并恢复按钮，不能持续转圈",
    );
    assert(
      r.instance.data.pendingResult === keep &&
        r.calls.clear === (keep ? 0 : 1),
      "关单未确认时保留原订单，终态才清除",
    );
    assert(
      r.calls.toasts.includes("购买成功") === (result === paid),
      "关单与付款竞态以服务端实际终态为准",
    );
  }
  {
    const creation = deferred();
    const closing = deferred();
    const r = loadPaymentPageRuntime({
      createQueue: [creation.promise, pending],
      cancelResult: closing.promise,
    });
    const purchase = r.instance.startPurchase(saved.planId);
    await settle();
    assert(
      r.calls.create === 1 && r.instance.data.processing,
      "首次购买自动创建订单时显示转圈",
    );
    const cancel = r.instance.cancelPendingPayment();
    await settle();
    r.instance.cancelPendingPayment();
    assert(
      r.calls.create === 2 &&
        r.calls.creations[0].key === r.calls.creations[1].key &&
        r.calls.cancel === 1,
      "创建响应丢失时取消必须复用原幂等键找回订单，重复取消不能再发请求",
    );
    closing.resolve(cancelled);
    await cancel;
    creation.resolve({
      ...pending,
      payment: { package: "prepay_id=test", signType: "RSA" },
    });
    await purchase;
    assert(
      !r.calls.native &&
        !r.instance.data.pendingResult &&
        !r.instance.data.paymentActionPending,
      "取消完成后迟到的创建响应不得再拉起微信支付或恢复待付款状态",
    );
  }
  {
    const lookup = deferred();
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [lookup.promise],
      cancelResult: cancelled,
    });
    r.instance.onShow();
    await r.instance.cancelPendingPayment();
    lookup.resolve(pending);
    await settle();
    assert(
      !r.instance.data.pendingResult && r.calls.clear === 1,
      "恢复查单与取消竞态中，迟到查询不得复活已取消订单",
    );
  }
  {
    const r = loadPaymentPageRuntime({
      createResult: {
        ...pending,
        payment: { package: "prepay_id=test", signType: "RSA" },
      },
      nativeResult: "cancelled",
      cancelResult: pending,
    });
    await r.instance.runPaymentFlow(r.lease, { ...saved, orderId: null });
    assert(
      !r.calls.get &&
        !r.instance.data.processing &&
        r.instance.data.pendingResult,
      "微信收银台取消但关单尚未确认时应保持待完成，不启动长轮询",
    );
  }
  {
    const r = loadPaymentPageRuntime({
      createError: {
        statusCode: 409,
        code: "AUTO_DORM_CHECK_UNFINISHED_ORDER",
        message: "有未结束订单",
      },
    });
    await r.instance.startPurchase(saved.planId);
    assert(
      r.calls.toasts.includes("有未结束订单") &&
        r.calls.clear === 1 &&
        !r.instance.data.pendingResult &&
        !r.instance.data.processing &&
        !r.instance.data.paymentActionPending &&
        !r.calls.native,
      "其他设备已有订单时显示服务端提示并清理本机未创建的订单，不滞留转圈",
    );
  }
}

async function main() {
  checkProgressTransition();
  await checkPaymentPrefetch();
  await checkStateMachine();
  await checkNativePayment();
  await checkPendingControls();
  const transport = loadPaymentServiceRuntime();
  const cancellation =
    transport.api.cancelAutoDormCheckPaymentOrder("order/with space");
  const request = transport.requests[0];
  assert(
    request.url.endsWith("/payment/orders/order%2Fwith%20space/cancel") &&
      request.options.method === "POST" &&
      JSON.stringify(request.options.data) === "{}",
    "取消订单必须发送有效的空 JSON 对象并编码订单号，不能只带 application/json 头而省略请求体",
  );
  request.resolve({
    order: order("cancelled", false),
    entitlement: entitlement(),
  });
  assert(
    (await cancellation).order.status === "cancelled",
    "取消接口应返回服务端确认的订单终态",
  );
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
