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
    !paymentScript.includes("wx.showModal({") &&
    paymentTemplate.includes('bindtap="retryPendingPayment"'),
  "付款页展示套餐和金额，保留导航、取消及重试入口，不额外弹出购买确认框",
);
assert(
  paymentScript.includes("this.data.loading ||") &&
    paymentTemplate.includes("'payment-plan-card--disabled'") &&
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
  "切换账号时必须立即清空旧额度，旧账号的购买流程不得替新账号购买",
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
    delays: [],
  };
  let storedPending = options.storedPending || null;
  const orderQueue = [...(options.orderQueue || [])];
  const createQueue = [...(options.createQueue || [])];
  const api = {
    getCachedAutoDormCheckPayment: () => options.cachedPayment || null,
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
      if (options.nativeError) throw options.nativeError;
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
    getAutoDormCheckPaymentOrder: async (id, query) => {
      calls.get += 1;
      (calls.lookups ||= []).push({ id, refresh: query?.refresh === true });
      if (options.getError) throw options.getError;
      const result = await (orderQueue.length
        ? orderQueue.shift()
        : options.repeatedOrderResult);
      return query?.refresh && result && !options.unverified
        ? {
            ...result,
            paymentCheck: result.paymentCheck || {
              canResume: result.order.status === "pending",
              remainingMs: 900000,
            },
          }
        : result;
    },
    getAutoDormCheckPayment: async () => ({
      paymentEnabled: options.paymentEnabled !== false,
      accessGranted: true,
      accessMode: "time",
      plans: options.plans || [],
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
            if (options.pendingStore) options.pendingStore.value = null;
          },
          loadPendingAutoDormCheckPayment: () =>
            options.pendingStore ? options.pendingStore.value : storedPending,
          savePendingAutoDormCheckPayment: (_account, value) => {
            calls.saved.push(value);
            if (options.failSave?.(value)) return false;
            storedPending = value;
            if (options.pendingStore) options.pendingStore.value = value;
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
      getRandomValues: async ({ length }) =>
        options.randomResult || {
          randomValues: new Uint8Array(length).fill(7).buffer,
        },
      navigateBack: () => undefined,
      showModal: () => {
        calls.modal += 1;
      },
    },
    () => ({ globalData: { preferences: {} } }),
    (callback, milliseconds) => {
      const id = ++timerId;
      if (options.deferMotion || milliseconds >= 3000) {
        calls.delays.push(milliseconds);
        timers.set(id, callback);
      } else callback();
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
  page.setPaymentView({
    processing: false,
    pendingResult: true,
    canResumePayment: true,
  });
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
  page.setPaymentView({
    processing: true,
    pendingResult: false,
    canResumePayment: false,
  });
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
    ["cancelled", "订单已关闭"],
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
      planName: "7天",
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
        runtime.calls.resumed?.orderId === pendingPayment.orderId &&
        !runtime.instance.data.processing &&
        runtime.instance.data.pendingResult,
      "未确认支付资格时点击套餐只重新查询原订单，不能创建或拉起付款",
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
    payment: {
      mode: "short_series_goods",
      signData: "{}",
      paySig: "test",
      signature: "test",
    },
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
  for (const nativeResult of ["success"]) {
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
      "原生成功必须经服务端查单确认入账",
    );
    assert(
      r.calls.saved.some((item) => item.orderId === "native-order"),
      "调起原生支付前必须保存可恢复的订单 ID",
    );
  }
  for (const getError of [undefined, new Error("network unavailable")]) {
    const failed = loadPaymentPageRuntime({
      createResult: pending,
      nativeError: new Error("未能打开支付，请重试"),
      repeatedOrderResult: pending,
      getError,
    });
    await failed.instance.runPaymentFlow(failed.lease, saved);
    assert(
      failed.calls.get === 1 &&
        !failed.calls.cancel &&
        !failed.calls.clear &&
        failed.instance.data.pendingResult &&
        !failed.instance.data.processing &&
        failed.instance.data.progressBusy === Boolean(getError) &&
        !failed.instance.data.paymentActionPending &&
        failed.calls.toasts.includes("未能打开支付，请重试"),
      "调起失败后确认可付才展示付款按钮；查单失败保留加载、自动复查和取消入口",
    );
    assert(
      failed.calls.saved.some((item) => item.orderId === "native-order"),
      "调起失败后必须保留已创建的订单 ID",
    );
  }
  const paidDespiteFailure = loadPaymentPageRuntime({
    createResult: pending,
    nativeError: new Error("未能打开支付，请重试"),
    orderQueue: [paid],
  });
  await paidDespiteFailure.instance.runPaymentFlow(
    paidDespiteFailure.lease,
    saved,
  );
  assert(
    paidDespiteFailure.calls.get === 1 &&
      paidDespiteFailure.calls.clear === 1 &&
      paidDespiteFailure.calls.toasts.includes("购买成功") &&
      !paidDespiteFailure.calls.toasts.includes("未能打开支付，请重试") &&
      !paidDespiteFailure.calls.cancel,
    "即使原生回调失败，服务端确认已到账仍须显示成功，不得误关已支付订单",
  );
  let errorLeaseCurrent = true;
  const staleFailure = loadPaymentPageRuntime({
    createResult: pending,
    nativeError: new Error("未能打开支付，请重试"),
    isCurrent: () => errorLeaseCurrent,
    onNative: () => {
      errorLeaseCurrent = false;
    },
  });
  await staleFailure.instance.runPaymentFlow(staleFailure.lease, saved);
  assert(
    !staleFailure.calls.get &&
      !staleFailure.calls.clear &&
      !staleFailure.calls.toasts.length,
    "原生失败期间切换账号不得查询或修改新账号状态",
  );
  const cancelled = {
    order: order("cancelled", false, "native-order"),
    entitlement: entitlement(0, 0),
  };
  for (const getError of [undefined, new Error("network unavailable")]) {
    const r = loadPaymentPageRuntime({
      createResult: pending,
      nativeResult: "cancelled",
      repeatedOrderResult: pending,
      getError,
    });
    await r.instance.runPaymentFlow(r.lease, saved);
    assert(
      r.calls.get === 1 &&
        !r.calls.cancel &&
        !r.calls.clear &&
        r.instance.data.pendingResult &&
        !r.instance.data.processing &&
        r.instance.data.progressBusy === Boolean(getError) &&
        !r.instance.data.paymentActionPending &&
        !r.calls.toasts.length &&
        r.calls.saved.some((item) => item.orderId === "native-order"),
      "退出收银台先查单，未知结果保持加载并安排复查，不自动关单或放出付款按钮",
    );
  }
  for (const result of [paid, cancelled]) {
    const r = loadPaymentPageRuntime({
      createResult: pending,
      nativeResult: "cancelled",
      orderQueue: [result],
    });
    await r.instance.runPaymentFlow(r.lease, saved);
    assert(
      r.calls.get === 1 &&
        !r.calls.cancel &&
        r.calls.clear === 1 &&
        !r.instance.data.pendingResult &&
        r.calls.toasts.includes("购买成功") === (result === paid),
      "退出收银台后以服务端实际终态为准，已到账必须确认成功，已关闭不能继续支付",
    );
  }
  const resumed = loadPaymentPageRuntime({
    resumeResult: pending,
    orderQueue: [{ ...pending, payment: null }, paid],
  });
  await resumed.instance.runPaymentFlow(
    resumed.lease,
    { ...saved, orderId: "native-order" },
    "resume",
  );
  assert(
    resumed.calls.create === 0 &&
      resumed.calls.resume === 1 &&
      resumed.calls.native === 1 &&
      resumed.calls.get === 2 &&
      !resumed.calls.cancel &&
      resumed.calls.toasts.includes("购买成功"),
    "退出后继续支付必须重新签发原订单参数并确认到账，不能创建另一笔订单",
  );
  for (const [initial, resumeCalls] of [
    [cancelled, 0],
    [{ ...pending, payment: null }, 1],
  ]) {
    const closed = loadPaymentPageRuntime({
      orderQueue: [initial],
      resumeResult: cancelled,
    });
    await closed.instance.runPaymentFlow(
      closed.lease,
      { ...saved, orderId: "native-order" },
      "resume",
    );
    assert(
      closed.calls.get === 1 &&
        (closed.calls.resume || 0) === resumeCalls &&
        !closed.calls.create &&
        !closed.calls.native &&
        !closed.calls.cancel &&
        closed.calls.clear === 1 &&
        !closed.instance.data.pendingResult &&
        !closed.instance.data.paymentActionPending &&
        closed.calls.toasts.includes("订单已关闭") &&
        !closed.calls.toasts.includes("已取消购买"),
      "继续支付发现原订单已关闭时应提示重新选择，不能误报用户取消或再次调起旧订单",
    );
  }
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
        r.instance.data.progressBusy &&
        r.instance.data.checkingPayment &&
        !r.instance.data.canResumePayment &&
        !r.instance.data.processing,
      "重新进入时查单完成前必须转圈，不得显示继续付款",
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
      r.calls.views.some(
        (v) => v.checkingPayment && v.progressBusy && !v.canResumePayment,
      ) &&
        r.instance.data.pendingResult &&
        r.instance.data.canResumePayment &&
        !r.instance.data.progressBusy,
      "查单期间始终转圈，完成后才按最新结果显示继续付款",
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
    r.instance.showAwaitingPayment(saved, {
      ...pending,
      paymentCheck: { canResume: true, remainingMs: 900000 },
    });
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
      payment: {
        mode: "short_series_goods",
        signData: "{}",
        paySig: "test",
        signature: "test",
      },
    });
    await settle();
    assert(
      r.calls.native === 1 &&
        r.instance.data.processing &&
        r.instance.data.progressBusy,
      "一次新的微信付款尝试返回后继续显示支付结果确认转圈",
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
      "主动取消订单必须关闭原订单并恢复按钮，不能持续转圈",
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
    if (result === cancelled)
      assert(
        r.calls.toasts.includes("订单已关闭") &&
          !r.instance.data.progressMounted &&
          r.instance.data.progressHeight === 0 &&
          !r.instance.data.canResumePayment,
        "主动取消订单成功后只显示订单已关闭胶囊，并收起顶部区域",
      );
  }
  {
    const creation = deferred();
    const closing = deferred();
    const r = loadPaymentPageRuntime({
      createQueue: [creation.promise, pending],
      cancelResult: closing.promise,
    });
    r.instance.data.plans = [
      { id: saved.planId, name: "单次", priceLabel: "¥0.50" },
    ];
    const tap = { currentTarget: { dataset: { id: saved.planId } } };
    const purchase = r.instance.onPlanTap(tap);
    r.instance.onPlanTap(tap);
    await settle();
    assert(
      r.calls.create === 1 && r.instance.data.processing && !r.calls.modal,
      "点击套餐直接创建订单并转圈，不弹购买确认框；连续点击只创建一笔订单",
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
      payment: {
        mode: "short_series_goods",
        signData: "{}",
        paySig: "test",
        signature: "test",
      },
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
        payment: {
          mode: "short_series_goods",
          signData: "{}",
          paySig: "test",
          signature: "test",
        },
      },
      nativeResult: "cancelled",
      repeatedOrderResult: pending,
    });
    await r.instance.runPaymentFlow(r.lease, { ...saved, orderId: null });
    assert(
      r.calls.get === 1 &&
        !r.calls.cancel &&
        !r.instance.data.processing &&
        r.instance.data.pendingResult,
      "微信收银台取消后应保持待完成，只查询一次，不发起关单或长轮询",
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

async function checkVerifiedPaymentActions() {
  const saved = {
    idempotencyKey: "00000000-0000-4000-8000-000000000088",
    orderId: "verified-order",
    planId: "count_1",
    createdAt: Date.now(),
  };
  const pending = {
    order: order("pending", false, saved.orderId),
    entitlement: entitlement(),
    paymentCheck: { canResume: true, remainingMs: 60000 },
  };
  const closed = {
    order: order("cancelled", false, saved.orderId),
    entitlement: entitlement(),
    paymentCheck: { canResume: false, remainingMs: 0 },
  };
  for (const result of [pending, closed]) {
    const lookup = deferred();
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [lookup.promise],
    });
    const work = r.instance.runPaymentFlow(r.lease, saved, "restore");
    assert(
      r.instance.data.checkingPayment &&
        r.instance.data.progressBusy &&
        !r.instance.data.canResumePayment,
      "查单等待期间始终转圈并隐藏付款按钮",
    );
    lookup.resolve(result);
    await work;
    assert(
      !r.instance.data.checkingPayment &&
        (result === closed || !r.instance.data.progressBusy),
      "查单返回后结束查询，关闭订单仅在收起动画中保留原加载内容",
    );
    assert(
      r.instance.data.canResumePayment === (result === pending),
      "仅微信确认可用且未超时的订单可以继续付款",
    );
    if (result === closed)
      assert(
        !r.instance.data.progressMounted &&
          r.instance.data.progressHeight === 0 &&
          !r.instance.data.pendingResult &&
          r.calls.toasts.filter((text) => text === "订单已关闭").length === 1,
        "已关闭仅提示一次胶囊并收起顶部区域，不阻止新购买",
      );
    assert(
      r.calls.lookups[0].refresh && !r.calls.native && !r.calls.cancel,
      "查单必须跳过后端旧状态，不能拉起收银台或关单",
    );
  }
  for (const options of [
    { getError: new Error("network") },
    {
      unverified: true,
      repeatedOrderResult: { ...pending, paymentCheck: undefined },
    },
  ]) {
    const r = loadPaymentPageRuntime({ storedPending: saved, ...options });
    await r.instance.runPaymentFlow(r.lease, saved, "restore");
    assert(
      !r.instance.data.canResumePayment &&
        r.instance.data.progressMounted &&
        r.instance.data.progressBusy &&
        r.instance.data.checkingPayment &&
        !r.calls.clear,
      "查单失败或缺少最新验证结果时保留加载与取消入口，不得隐藏订单或误判已关闭",
    );
  }
  const expiry = deferred();
  const r = loadPaymentPageRuntime({
    storedPending: saved,
    orderQueue: [pending, expiry.promise],
  });
  await r.instance.runPaymentFlow(r.lease, saved, "restore");
  r.flushTimers();
  assert(
    !r.instance.data.canResumePayment &&
      r.instance.data.checkingPayment &&
      r.instance.data.progressBusy,
    "有效期到达时立即隐藏付款按钮并重新查单",
  );
  expiry.resolve(closed);
  await settle();
  assert(
    !r.instance.data.progressMounted &&
      r.calls.toasts.includes("订单已关闭") &&
      !r.instance.data.canResumePayment &&
      !r.calls.native,
    "到期查单确认关闭后只弹出胶囊并收起顶部区域",
  );
  const hidden = loadPaymentPageRuntime({
    storedPending: saved,
    orderQueue: [pending, closed],
  });
  await hidden.instance.runPaymentFlow(hidden.lease, saved, "restore");
  hidden.instance.onHide();
  hidden.flushTimers();
  assert(
    hidden.calls.get === 1 && !hidden.instance.data.canResumePayment,
    "页面隐藏必须停止旧订单定时器并撤销可付款状态",
  );
  hidden.instance.onShow();
  await settle();
  assert(
    hidden.calls.toasts.includes("订单已关闭") &&
      !hidden.instance.data.progressMounted &&
      hidden.calls.get === 2,
    "重新进入时必须查微信最新状态，不能恢复过期按钮",
  );
  const lateLookup = deferred();
  const returnLookup = deferred();
  const late = loadPaymentPageRuntime({
    storedPending: saved,
    orderQueue: [lateLookup.promise, returnLookup.promise],
  });
  late.instance.onShow();
  await settle();
  late.instance.onHide();
  lateLookup.resolve(pending);
  await settle();
  assert(
    !late.instance.data.canResumePayment && late.instance.data.progressBusy,
    "离开页面后才返回的查询结果不能恢复旧付款按钮，需保留返回时的加载态",
  );
  late.instance.onShow();
  await settle();
  assert(
    late.calls.get === 2 &&
      late.instance.data.progressBusy &&
      !late.instance.data.canResumePayment,
    "返回页面不能复用隐藏期间的付款资格，必须等待新查询",
  );
  returnLookup.resolve(pending);
  await settle();
  assert(
    late.instance.data.canResumePayment,
    "返回后的新查询成功才恢复付款按钮",
  );
  late.instance.onUnload();
  assert(
    paymentTemplate.includes(
      "canResumePayment && !progressBusy && !paymentActionPending",
    ) &&
      !paymentTemplate.includes("订单已关闭") &&
      !paymentTemplate.includes("刷新状态") &&
      !paymentTemplate.includes("订单待确认") &&
      paymentTemplate.includes("'正在查询订单'"),
    "顶部只显示查单加载或已验证的付款操作，关闭结果仅使用胶囊",
  );
}

async function checkPaymentEntryRendering() {
  const saved = {
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
    orderId: "entry-order",
    planId: "count_1",
    createdAt: Date.now(),
  };
  const pending = {
    order: order("pending", false, saved.orderId),
    entitlement: entitlement(),
    paymentCheck: { canResume: true, remainingMs: 60000 },
  };
  for (const status of ["pending", "cancelled"]) {
    const result = { ...pending, order: order(status, false, saved.orderId) };
    const r = loadPaymentPageRuntime({
      deferMotion: true,
      storedPending: saved,
      repeatedOrderResult: result,
    });
    const page = r.instance;
    assert(
      page.data.checkingPayment && !page.data.canResumePayment,
      "有待支付订单的首次加载即进入查单态，不能等待 onShow 才撤销付款资格",
    );
    page.onShow();
    await settle();
    assert(r.calls.get === 0, "加载区域尚未渲染时不能让快速查询跳过加载圈");
    r.flushRenders();
    await settle();
    assert(r.calls.get === 0, "加载区域高度测量完成前继续保持加载态");
    r.flushMeasurements();
    r.flushRenders();
    await settle();
    assert(
      r.calls.get === 1 &&
        page.renderedData.progressBusy &&
        page.renderedData.progressExpanded &&
        page.renderedData.progressHeight > 0 &&
        !page.data.canResumePayment,
      "快速查单响应也必须等加载区域展开后才能显示付款按钮",
    );
    r.flushTimers();
    await settle();
    r.flushRenders();
    r.flushMeasurements();
    r.flushRenders();
    assert(
      page.data.canResumePayment === (status === "pending"),
      "展开完成后根据最新结果显示付款操作或收起区域",
    );
    if (status === "cancelled") {
      r.flushTimers();
      r.flushRenders();
      assert(
        !page.renderedData.progressMounted &&
          page.renderedData.progressHeight === 0 &&
          r.calls.toasts.filter((text) => text === "订单已关闭").length === 1,
        "关闭结果仅弹出一次胶囊，完成收起后顶部不保留任何状态卡片",
      );
    } else {
      page.onHide();
      r.flushRenders();
      r.flushMeasurements();
      r.flushRenders();
      assert(
        page.renderedData.progressBusy && !page.renderedData.canResumePayment,
        "离开页面先撤销付款按钮并准备加载态，返回首帧不能沿用旧按钮",
      );
      page.onShow();
      r.flushRenders();
      r.flushMeasurements();
      r.flushRenders();
      await settle();
      assert(
        r.calls.get === 2 &&
          page.renderedData.progressBusy &&
          !page.data.canResumePayment,
        "返回页面再次查询期间始终显示加载圈",
      );
      r.flushTimers();
      await settle();
      r.flushRenders();
      r.flushMeasurements();
      r.flushRenders();
      assert(
        page.renderedData.canResumePayment,
        "返回页面查单完成后才能恢复付款按钮",
      );
    }
    page.onUnload();
  }
}

async function checkInterruptedPurchaseRecovery() {
  const saved = {
    idempotencyKey: "00000000-0000-4000-8000-000000000109",
    orderId: "interrupted-order",
    planId: "count_1",
    createdAt: Date.now(),
  };
  const unknown = {
    order: order("pending", false, saved.orderId),
    entitlement: entitlement(),
    paymentCheck: { canResume: false, remainingMs: 60000 },
  };
  const eligible = {
    ...unknown,
    paymentCheck: { canResume: true, remainingMs: 60000 },
  };
  const closed = {
    ...unknown,
    order: order("cancelled", false, saved.orderId),
  };
  const paid = {
    ...unknown,
    order: order("paid", true, saved.orderId),
    entitlement: entitlement(0, 1),
  };
  const draft = {
    ...unknown,
    payment: {
      mode: "short_series_goods",
      signData: "{}",
      paySig: "test",
      signature: "test",
    },
  };
  {
    const pendingStore = { value: null };
    const creation = deferred();
    const old = loadPaymentPageRuntime({
      pendingStore,
      createResult: creation.promise,
    });
    old.instance.data.plans = [
      { id: saved.planId, name: "单次", priceLabel: "¥0.50" },
    ];
    const purchase = old.instance.startPurchase(saved.planId);
    await settle();
    const key = pendingStore.value.idempotencyKey;
    assert(
      old.calls.create === 1 &&
        !pendingStore.value.orderId &&
        pendingStore.value.paymentInvoked === false &&
        pendingStore.value.planName === "单次",
      "离开前创建请求在途且幂等键已经落盘",
    );
    old.instance.onHide();
    old.instance.onUnload();
    const current = loadPaymentPageRuntime({
      pendingStore,
      createResult: draft,
      repeatedOrderResult: unknown,
      cancelResult: closed,
    });
    current.instance.onShow();
    await settle();
    assert(
      current.calls.creations[0].key === key &&
        current.calls.get === 1 &&
        current.instance.data.progressMounted &&
        !current.instance.data.progressBusy &&
        current.instance.data.canResumePayment &&
        current.instance.data.progressPlanName === "单次" &&
        !current.instance.data.paymentActionPending &&
        !current.instance.data.cancellingPayment &&
        !current.calls.native &&
        !current.calls.toasts.includes("支付结果确认中"),
      "快速返回新页面先查原单；从未调用微信的草稿允许继续付款并保留具体套餐名称，不无限查单",
    );
    await current.instance.cancelPendingPayment();
    creation.resolve(draft);
    await purchase;
    current.flushTimers();
    await settle();
    assert(
      pendingStore.value === null &&
        !old.calls.native &&
        !current.calls.native &&
        current.calls.cancel === 1 &&
        !current.instance.data.pendingResult &&
        !current.instance.data.paymentActionPending &&
        !current.instance.data.progressMounted &&
        current.calls.toasts.includes("订单已关闭") &&
        current.calls.get === 1,
      "未知订单可主动取消；已离开页面的创建响应及旧复查定时器不能复活订单或阻塞新购买",
    );
    current.instance.onUnload();
  }
  for (const final of [eligible, closed, paid]) {
    const lookup = deferred();
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [unknown, lookup.promise],
    });
    await r.instance.runPaymentFlow(r.lease, saved, "restore");
    assert(
      r.instance.data.progressBusy && r.calls.delays.at(-1) === 3000,
      "未知状态保留转圈并安排首次自动复查",
    );
    r.flushTimers();
    await settle();
    r.flushTimers();
    assert(
      r.calls.get === 2 &&
        r.instance.data.progressBusy &&
        !r.instance.data.canResumePayment,
      "自动复查在途时不重叠请求、不提前显示付款按钮",
    );
    lookup.resolve(final);
    await settle();
    assert(
      r.instance.data.canResumePayment === (final === eligible),
      "自动复查结果决定付款资格，不能沿用未知状态",
    );
    if (final !== eligible)
      assert(
        !r.instance.data.progressMounted && !r.instance.data.pendingResult,
        "关闭或到账后自动结束加载并解除订单阻塞",
      );
    assert(
      !r.calls.native && !r.calls.create && !r.calls.cancel,
      "自动复查只能读取原单，不创建订单、拉起付款或自动关单",
    );
    r.instance.onUnload();
  }
  {
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      repeatedOrderResult: unknown,
      cancelError: new Error("取消失败，请重试"),
    });
    await r.instance.runPaymentFlow(r.lease, saved, "restore");
    r.flushTimers();
    await settle();
    assert(
      r.calls.get === 2 && r.calls.delays.at(-1) === 6000,
      "持续未知时增大复查间隔，避免密集查询",
    );
    r.instance.onHide();
    r.flushTimers();
    await settle();
    assert(r.calls.get === 2, "页面隐藏时停止未知订单的自动复查");
    r.instance.onShow();
    await settle();
    await r.instance.cancelPendingPayment();
    assert(
      r.instance.data.progressBusy &&
        !r.instance.data.cancellingPayment &&
        !r.instance.data.paymentActionPending,
      "取消失败不能收起加载或锁住再次取消的入口",
    );
    r.instance.onUnload();
  }
  for (const phase of ["create", "sign"]) {
    const response = deferred();
    const r = loadPaymentPageRuntime({
      createResult: response.promise,
      resumeResult: response.promise,
      repeatedOrderResult: eligible,
    });
    const work = r.instance.runPaymentFlow(
      r.lease,
      phase === "create" ? { ...saved, orderId: null } : saved,
      phase === "create" ? "purchase" : "resume",
    );
    await settle();
    r.instance.onHide();
    r.instance.onShow();
    response.resolve(draft);
    await work;
    assert(
      !r.calls.native &&
        r.instance.data.canResumePayment &&
        !r.instance.data.progressBusy &&
        !r.instance.data.paymentActionPending,
      "离开再返回撤销旧支付尝试，迟到创建或签名响应重新查单后才能恢复继续付款",
    );
    r.instance.onUnload();
  }
  {
    const random = deferred();
    const r = loadPaymentPageRuntime({ randomResult: random.promise });
    const work = r.instance.startPurchase(saved.planId);
    r.instance.onHide();
    r.instance.onShow();
    random.resolve({ randomValues: new Uint8Array(16).fill(7).buffer });
    await work;
    assert(
      !r.calls.create &&
        !r.instance.data.processing &&
        !r.instance.data.paymentActionPending,
      "创建订单前离开页面应结束准备流程，不在返回后补发旧购买请求",
    );
    r.instance.onUnload();
  }
  {
    const r = loadPaymentPageRuntime({
      createResult: draft,
      orderQueue: [paid],
      onNative: () => {
        r.instance.onHide();
        r.instance.onShow();
      },
    });
    await r.instance.runPaymentFlow(r.lease, { ...saved, orderId: null });
    assert(
      r.calls.native === 1 && r.calls.toasts.includes("购买成功"),
      "已打开收银台后的正常隐藏和返回不能丢失实际付款成功结果",
    );
    r.instance.onUnload();
  }
  assert(
    paymentTemplate.includes(
      'wx:elif="{{processing || checkingPayment || canResumePayment}}"',
    ) &&
      paymentTemplate.includes(
        '<view wx:if="{{cancellingPayment}}" class="payment-cancel" aria-role="status">取消中</view>',
      ) &&
      !paymentTemplate.includes('disabled="{{cancellingPayment}}"'),
    "查询期间保留取消入口；取消请求中使用不可点击的透明状态文字，避免原生禁用按钮白底",
  );
}

function checkPendingStorage() {
  const values = new Map();
  let ignoreWrites = false;
  const api = {};
  new Function(
    "exports",
    "wx",
    ts.transpileModule(store, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
  )(api, {
    getStorageSync: (key) =>
      values.has(key) ? structuredClone(values.get(key)) : undefined,
    setStorageSync: (key, value) => {
      if (!ignoreWrites) values.set(key, structuredClone(value));
    },
    removeStorageSync: (key) => values.delete(key),
  });
  const draft = {
    idempotencyKey: "storage-draft",
    orderId: null,
    planId: "configured-plan",
    createdAt: Date.now(),
    planName: "单次",
    priceLabel: "¥0.50",
    paymentInvoked: false,
  };
  assert(
    api.savePendingAutoDormCheckPayment("first", draft),
    "未发起草稿和套餐名称必须成功落盘",
  );
  const restored = api.loadPendingAutoDormCheckPayment("first");
  assert(
    restored.paymentInvoked === false &&
      restored.planName === "单次" &&
      restored.priceLabel === "¥0.50",
    "真实存储加载不能丢失未发起标记或套餐名称金额",
  );
  ignoreWrites = true;
  assert(
    !api.savePendingAutoDormCheckPayment("first", {
      ...draft,
      paymentInvoked: true,
    }),
    "原生调用标记写入失败时必须报告失败",
  );
  ignoreWrites = false;
  assert(
    api.savePendingAutoDormCheckPayment("first", {
      ...draft,
      paymentInvoked: true,
    }),
    "原生调用前可以持久化已发起标记",
  );
  assert(
    !api.savePendingAutoDormCheckPayment("first", draft) &&
      api.loadPendingAutoDormCheckPayment("first").paymentInvoked,
    "迟到的草稿写入不能把已调用微信的订单退回未发起状态",
  );
  assert(
    api.loadPendingAutoDormCheckPayment("second") === null,
    "订单标记不可跨账号复用",
  );
  values.set("easy-swu:auto-dorm-check-payment:v3:legacy", {
    ...draft,
    planId: undefined,
    planCode: draft.planId,
    paymentInvoked: undefined,
  });
  assert(
    api.loadPendingAutoDormCheckPayment("legacy").paymentInvoked === true,
    "旧版本没有标记的订单必须保守地按已发起处理",
  );
}

async function checkUnlaunchedDraftRecovery() {
  const saved = {
    idempotencyKey: "new-draft",
    orderId: "new-draft-order",
    planId: "configured-plan",
    createdAt: Date.now(),
    planName: "单次",
    priceLabel: "¥0.50",
    paymentInvoked: false,
  };
  const unknown = {
    order: order("pending", false, saved.orderId),
    entitlement: entitlement(),
    paymentCheck: { canResume: false, remainingMs: 60000 },
  };
  const closed = {
    ...unknown,
    order: order("cancelled", false, saved.orderId),
  };
  const paid = {
    ...unknown,
    order: order("paid", true, saved.orderId),
    entitlement: entitlement(0, 1),
  };
  const draft = {
    ...unknown,
    payment: {
      mode: "short_series_goods",
      signData: "{}",
      paySig: "test",
      signature: "test",
    },
  };
  for (const phase of ["create", "sign"]) {
    const response = deferred();
    const pendingStore = {
      value: { ...saved, orderId: phase === "create" ? null : saved.orderId },
    };
    const old = loadPaymentPageRuntime({
      pendingStore,
      createResult: response.promise,
      resumeResult: response.promise,
      repeatedOrderResult: unknown,
    });
    const previous = old.instance.runPaymentFlow(
      old.lease,
      pendingStore.value,
      phase === "create" ? "purchase" : "resume",
    );
    await settle();
    old.instance.onHide();
    old.instance.onUnload();
    const query = deferred();
    let persistedBeforeNative = false;
    const current = loadPaymentPageRuntime({
      pendingStore,
      createResult: draft,
      resumeResult: draft,
      orderQueue: [query.promise, unknown, closed],
      nativeResult: "cancelled",
      onNative: () => {
        persistedBeforeNative = pendingStore.value.paymentInvoked === true;
      },
    });
    current.instance.onShow();
    await settle();
    assert(
      current.instance.data.progressBusy &&
        !current.instance.data.canResumePayment &&
        current.instance.data.progressPlanName === "单次",
      "创建或签名在途退出再进入，最新查询完成前始终转圈且显示具体套餐",
    );
    query.resolve(unknown);
    await settle();
    assert(
      current.instance.data.canResumePayment &&
        !current.instance.data.progressBusy &&
        !current.calls.native &&
        current.calls.delays.at(-1) > 30000,
      "从未发起支付的草稿查单后允许首次付款，不继续轮询不存在的微信记录，也不自动拉起收银台",
    );
    current.instance.retryPendingPayment();
    await settle();
    response.resolve(draft);
    await previous;
    assert(
      current.calls.native === 1 &&
        persistedBeforeNative &&
        !old.calls.native &&
        pendingStore.value === null &&
        current.calls.toasts.includes("订单已关闭"),
      "恢复付款使用原订单，调用前持久化标记，微信关闭后清除订单且旧页面迟到响应不能复活订单",
    );
    assert(
      current.calls.create === (phase === "create" ? 1 : 0) &&
        current.calls.resume === 1 &&
        !current.calls.cancel,
      "仅丢失创建响应时通过原幂等键恢复，继续付款不创建第二笔订单，也不自动取消",
    );
    current.instance.onUnload();
  }
  for (const result of [closed, paid]) {
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      orderQueue: [unknown, result],
      resumeResult: draft,
    });
    await r.instance.runPaymentFlow(r.lease, saved, "restore");
    r.instance.retryPendingPayment();
    await settle();
    assert(
      !r.calls.native &&
        !r.calls.resume &&
        !r.instance.data.canResumePayment &&
        !r.instance.data.pendingResult,
      "草稿继续付款前发现已关闭或已到账时，必须结束订单，不能签发或调用付款",
    );
    r.instance.onUnload();
  }
  for (const options of [
    {
      repeatedOrderResult: {
        ...unknown,
        paymentCheck: { canResume: false, remainingMs: 0 },
      },
    },
    {
      repeatedOrderResult: { ...unknown, paymentCheck: undefined },
      unverified: true,
    },
    { getError: new Error("offline") },
    {
      storedPending: { ...saved, paymentInvoked: true },
      repeatedOrderResult: unknown,
    },
  ]) {
    const r = loadPaymentPageRuntime({ storedPending: saved, ...options });
    await r.instance.runPaymentFlow(
      r.lease,
      options.storedPending || saved,
      "restore",
    );
    assert(
      !r.instance.data.canResumePayment &&
        r.instance.data.progressBusy &&
        !r.calls.native,
      "未发起标记不能绕过超时、缺少新鲜查单结果、网络失败或已发起支付状态",
    );
    r.instance.onUnload();
  }
  {
    const pendingStore = { value: { ...saved } };
    const native = deferred();
    const old = loadPaymentPageRuntime({
      pendingStore,
      repeatedOrderResult: unknown,
      resumeResult: draft,
      nativeResult: native.promise,
    });
    const previous = old.instance.runPaymentFlow(
      old.lease,
      pendingStore.value,
      "resume",
    );
    await settle();
    assert(
      pendingStore.value.paymentInvoked === true && old.calls.native === 1,
      "收银台回调前已持久化已发起标记",
    );
    old.instance.onHide();
    old.instance.onUnload();
    const current = loadPaymentPageRuntime({
      pendingStore,
      orderQueue: [unknown, paid],
    });
    current.instance.onShow();
    await settle();
    assert(
      !current.instance.data.canResumePayment &&
        current.instance.data.progressBusy,
      "收银台已调用但结果未知时不能误判成未发起草稿",
    );
    current.flushTimers();
    await settle();
    native.resolve("success");
    await previous;
    assert(
      current.calls.toasts.filter((text) => text === "购买成功").length === 1 &&
        pendingStore.value === null &&
        !current.calls.native,
      "收银台中卸载后新页面按服务端到账结束，旧原生回调不能重复处理或开启第二次付款",
    );
    current.instance.onUnload();
  }
  {
    const r = loadPaymentPageRuntime({
      storedPending: saved,
      repeatedOrderResult: unknown,
      resumeResult: draft,
      failSave: (value) => value.paymentInvoked === true,
    });
    await r.instance.runPaymentFlow(r.lease, saved, "resume");
    assert(
      !r.calls.native && !r.instance.data.canResumePayment,
      "调用标记落盘失败时不能启动无法安全恢复的付款",
    );
    r.instance.onUnload();
  }
  const plan = {
    id: saved.planId,
    name: "后台配置名称",
    priceLabel: "¥0.50",
    type: "count",
  };
  for (const cached of [false, true]) {
    const pending = { ...saved, planName: undefined, priceLabel: undefined };
    const r = loadPaymentPageRuntime({
      storedPending: pending,
      plans: [plan],
      cachedPayment: cached
        ? { paymentEnabled: true, plans: [plan], entitlement: entitlement() }
        : null,
    });
    if (!cached) await r.instance.loadPayment();
    assert(
      r.instance.data.progressPlanName === plan.name &&
        r.instance.data.progressPriceLabel === plan.priceLabel,
      "旧订单无套餐快照时可从进入时的缓存或稍后加载的套餐中恢复具体名称，不能锁定通用占位名称",
    );
    r.instance.onUnload();
  }
}

async function main() {
  checkPendingStorage();
  checkProgressTransition();
  await checkPaymentPrefetch();
  await checkStateMachine();
  await checkNativePayment();
  await checkPendingControls();
  await checkVerifiedPaymentActions();
  await checkPaymentEntryRendering();
  await checkInterruptedPurchaseRecovery();
  await checkUnlaunchedDraftRecovery();
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
  const fresh = transport.api.getAutoDormCheckPaymentOrder("order/with space", {
    refresh: true,
  });
  assert(
    transport.requests[1].url.endsWith(
      "/payment/orders/order%2Fwith%20space?refresh=true",
    ),
    "付款资格查单必须请求最新微信状态",
  );
  transport.requests[1].resolve({
    order: order("cancelled", false),
    entitlement: entitlement(),
  });
  await fresh;
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
