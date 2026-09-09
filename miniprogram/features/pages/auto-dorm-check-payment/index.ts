import { buildAppShare } from "../../../utils/app-share";
import {
  createAutoDormCheckPaymentOrder,
  getCachedAutoDormCheckPayment,
  getAutoDormCheckPayment,
  getAutoDormCheckPaymentOrder,
  getPendingAutoDormCheckPayment,
  resumeAutoDormCheckPaymentOrder,
  cancelAutoDormCheckPaymentOrder,
  launchWechatPayment,
} from "../../../services/auto-dorm-check";
import { ApiClientError, getErrorMessage } from "../../../services/request";
import {
  clearPendingAutoDormCheckPayment,
  loadPendingAutoDormCheckPayment,
  savePendingAutoDormCheckPayment,
  type PendingAutoDormCheckPayment,
} from "../../../store/auto-dorm-check";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  type SessionLease,
} from "../../../store/session";
import type {
  AutoDormCheckAccessMode,
  AutoDormCheckEntitlement,
  AutoDormCheckPaymentData,
  AutoDormCheckPaymentOrder,
  AutoDormCheckPaymentOrderResult,
  AutoDormCheckPaymentPlan,
} from "../../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";

type PaymentFlowMode = "purchase" | "resume" | "restore";

const ORDER_POLL_INTERVAL_MILLISECONDS = 900;
const ORDER_POLL_ATTEMPTS = 45;
const CAPSULE_TOAST_HOLD_MILLISECONDS = 3000;
const CAPSULE_TOAST_EXIT_MILLISECONDS = 180;
const PAYMENT_PROGRESS_TRANSITION_MS = 260;
const SAFE_ORDER_CREATION_FAILURE_CODES = new Set([
  "AUTO_DORM_CHECK_ACADEMIC_PERIOD_UNAVAILABLE",
]);

const EMPTY_ENTITLEMENT: AutoDormCheckEntitlement = {
  time: {
    remainingSeconds: 0,
    remainingDays: 0,
    paused: false,
    resumesAt: null,
  },
  uses: { remaining: 0, reserved: 0 },
};

interface CapsuleToastTimers {
  reveal?: ReturnType<typeof setTimeout>;
  hide?: ReturnType<typeof setTimeout>;
  unmount?: ReturnType<typeof setTimeout>;
}

interface AccountPendingPayment {
  account: string;
  payment: PendingAutoDormCheckPayment;
}

const activePages = new WeakSet<object>();
const visiblePages = new WeakSet<object>();
const flowRevisions = new WeakMap<object, number>();
const activeFlowAccounts = new WeakMap<object, string>();
const activePendingPayments = new WeakMap<object, AccountPendingPayment>();
const loadedPaymentAccounts = new WeakMap<object, string>();
const paymentScrollPositions = new WeakMap<object, number>();
const resumeTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const unconfirmedChecks = new WeakMap<object, number>();
const paymentLaunchRevisions = new WeakMap<object, number>();
const capsuleToastTimers = new WeakMap<object, CapsuleToastTimers>();
const progressTransitions = new WeakMap<
  object,
  { close?: ReturnType<typeof setTimeout> }
>();

function activePendingPayment(
  instance: object,
  account: string,
): PendingAutoDormCheckPayment | null {
  const active = activePendingPayments.get(instance);
  return active?.account === account ? active.payment : null;
}

function rememberActivePendingPayment(
  instance: object,
  account: string,
  payment: PendingAutoDormCheckPayment,
): void {
  activePendingPayments.set(instance, { account, payment });
}

function clearCapsuleToastTimers(instance: object): void {
  const timers = capsuleToastTimers.get(instance);
  if (!timers) return;
  if (timers.reveal !== undefined) clearTimeout(timers.reveal);
  if (timers.hide !== undefined) clearTimeout(timers.hide);
  if (timers.unmount !== undefined) clearTimeout(timers.unmount);
  capsuleToastTimers.delete(instance);
}

function nextFlowRevision(instance: object): number {
  const timer = resumeTimers.get(instance);
  if (timer !== undefined) clearTimeout(timer);
  resumeTimers.delete(instance);
  paymentLaunchRevisions.delete(instance);
  const revision = (flowRevisions.get(instance) || 0) + 1;
  flowRevisions.set(instance, revision);
  return revision;
}

function isFlowCurrent(
  instance: object,
  revision: number,
  lease: SessionLease,
): boolean {
  return (
    activePages.has(instance) &&
    flowRevisions.get(instance) === revision &&
    isSessionLeaseCurrent(lease)
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeEntitlement(
  entitlement: AutoDormCheckEntitlement | null | undefined,
): AutoDormCheckEntitlement {
  const source = entitlement || EMPTY_ENTITLEMENT;
  return {
    time: {
      remainingSeconds: Math.max(
        0,
        Math.floor(Number(source.time?.remainingSeconds) || 0),
      ),
      remainingDays: Math.max(
        0,
        Math.floor(Number(source.time?.remainingDays) || 0),
      ),
      paused: Boolean(source.time?.paused),
      resumesAt: source.time?.resumesAt || null,
    },
    uses: {
      remaining: Math.max(0, Math.floor(Number(source.uses?.remaining) || 0)),
      reserved: Math.max(0, Math.floor(Number(source.uses?.reserved) || 0)),
    },
  };
}

function entitlementViewData(
  entitlement: AutoDormCheckEntitlement | null | undefined,
) {
  const normalized = normalizeEntitlement(entitlement);
  return {
    entitlement: normalized,
    remainingDays: normalized.time.remainingDays,
    remainingUses: normalized.uses.remaining,
    reservedUses: normalized.uses.reserved,
    hasTimeEntitlement: normalized.time.remainingSeconds > 0,
    hasUseEntitlement:
      normalized.uses.remaining > 0 || normalized.uses.reserved > 0,
    timeEntitlementPaused:
      normalized.time.paused && normalized.time.remainingSeconds > 0,
    entitlementResumesAt: normalized.time.resumesAt || "",
  };
}

function paymentDataViewData(data: AutoDormCheckPaymentData) {
  const plans = (Array.isArray(data.plans) ? data.plans : [])
    .map((plan) => ({
      ...plan,
      id: String(plan.id || plan.code || ""),
    }))
    .filter((plan) => Boolean(plan.id));
  return {
    paymentEnabled: Boolean(data.paymentEnabled),
    accessGranted:
      data.paymentEnabled === true ? Boolean(data.accessGranted) : true,
    accessMode: (data.accessMode || "free") as AutoDormCheckAccessMode,
    plans,
    timePlans: plans.filter((plan) => plan.billingType === "time"),
    countPlans: plans.filter((plan) => plan.billingType === "count"),
    ...entitlementViewData(data.entitlement),
  };
}

function isSuccessfulOrder(order: AutoDormCheckPaymentOrder): boolean {
  return order.status === "paid" && order.credited === true;
}

function shouldPollOrder(order: AutoDormCheckPaymentOrder): boolean {
  return (
    order.status === "pending" || (order.status === "paid" && !order.credited)
  );
}

function keepPendingAfterError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return true;
  if (SAFE_ORDER_CREATION_FAILURE_CODES.has(error.code)) return false;
  return (
    error.statusCode === 0 ||
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    error.code === "NETWORK_ERROR"
  );
}

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function fallbackIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}

async function createIdempotencyKey(): Promise<string> {
  try {
    const random = await wx.getRandomValues({ length: 16 });
    const bytes = new Uint8Array(random.randomValues);
    return uuidFromBytes(bytes);
  } catch {
    return fallbackIdempotencyKey();
  }
}

Page({
  openOrders() {
    haptic("light");
    void navigateTo(
      "/features/pages/auto-dorm-check-orders/index",
      "wx://cupertino-modal",
    );
  },
  onShareAppMessage: buildAppShare,
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    loading: false,
    loaded: false,
    processing: false,
    checkingPayment: false,
    canResumePayment: false,
    resumeDeadline: 0,
    pendingResult: false,
    pendingPlanName: "",
    pendingPriceLabel: "",
    pendingOrderId: "",
    paymentActionPending: false,
    cancellingPayment: false,
    progressMounted: false,
    progressExpanded: false,
    progressHeight: 0,
    progressBusy: false,
    progressPlanName: "",
    progressPriceLabel: "",
    paymentScrollTop: 0,
    paymentEnabled: false,
    accessGranted: true,
    accessMode: "free" as AutoDormCheckAccessMode,
    plans: [] as AutoDormCheckPaymentPlan[],
    timePlans: [] as AutoDormCheckPaymentPlan[],
    countPlans: [] as AutoDormCheckPaymentPlan[],
    entitlement: EMPTY_ENTITLEMENT,
    remainingDays: 0,
    remainingUses: 0,
    reservedUses: 0,
    hasTimeEntitlement: false,
    hasUseEntitlement: false,
    timeEntitlementPaused: false,
    entitlementResumesAt: "",
    errorMessage: "",
    capsuleToastMounted: false,
    capsuleToastVisible: false,
    capsuleToastMessage: "",
  },
  onLoad() {
    const instance = this as unknown as object;
    activePages.add(instance);
    visiblePages.add(instance);
    flowRevisions.set(instance, 0);
    this.applyAppearance();
    const lease = captureSessionLease();
    const pending = lease && loadPendingAutoDormCheckPayment(lease.account);
    if (pending) {
      this.showPendingOrder(pending.planId, pending.orderId || "", pending);
      this.setPaymentView({ checkingPayment: true, pendingResult: true });
    }
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    visiblePages.add(this as unknown as object);
    this.applyAppearance();
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    if (this.data.paymentActionPending || this.data.processing) {
      if (activeFlowAccounts.get(instance) === lease.account) return;
      nextFlowRevision(instance);
      activeFlowAccounts.delete(instance);
      activePendingPayments.delete(instance);
      this.setPaymentView({
        processing: false,
        checkingPayment: false,
        canResumePayment: false,
        paymentActionPending: false,
        cancellingPayment: false,
        pendingResult: false,
      });
    }
    const loadedAccount = loadedPaymentAccounts.get(instance);
    if (loadedAccount && loadedAccount !== lease.account) {
      loadedPaymentAccounts.delete(instance);
      this.dismissCapsuleToast();
      this.setPaymentView({
        loaded: false,
        loading: false,
        paymentEnabled: false,
        accessGranted: true,
        accessMode: "free",
        plans: [],
        timePlans: [],
        countPlans: [],
        paymentActionPending: false,
        cancellingPayment: false,
        pendingOrderId: "",
        canResumePayment: false,
        checkingPayment: false,
        pendingPlanName: "",
        pendingPriceLabel: "",
        ...entitlementViewData(EMPTY_ENTITLEMENT),
        pendingResult: false,
        errorMessage: "",
      });
    }
    const cachedPayment = getCachedAutoDormCheckPayment();
    if (cachedPayment) {
      loadedPaymentAccounts.set(instance, lease.account);
      this.setPaymentView({
        ...paymentDataViewData(cachedPayment),
        loaded: true,
        loading: false,
        errorMessage: "",
      });
    }
    const pending = loadPendingAutoDormCheckPayment(lease.account);
    if (pending) {
      unconfirmedChecks.delete(instance);
      rememberActivePendingPayment(instance, lease.account, pending);
      void this.runPaymentFlow(lease, pending, "restore");
      return;
    }
    activePendingPayments.delete(instance);
    const pendingPreload = getPendingAutoDormCheckPayment();
    if (pendingPreload) {
      void this.loadPayment(pendingPreload);
    } else if (!cachedPayment) {
      void this.loadPayment();
    }
  },
  onHide() {
    const instance = this as unknown as object;
    visiblePages.delete(instance);
    paymentLaunchRevisions.delete(instance);
    const timer = resumeTimers.get(instance);
    if (timer !== undefined) clearTimeout(timer);
    resumeTimers.delete(instance);
    this.setPaymentView({
      canResumePayment: false,
      checkingPayment: this.data.checkingPayment || this.data.pendingResult,
    });
    this.dismissCapsuleToast();
  },
  onUnload() {
    const instance = this as unknown as object;
    activePages.delete(instance);
    visiblePages.delete(instance);
    activeFlowAccounts.delete(instance);
    activePendingPayments.delete(instance);
    loadedPaymentAccounts.delete(instance);
    unconfirmedChecks.delete(instance);
    paymentScrollPositions.delete(instance);
    nextFlowRevision(instance);
    clearCapsuleToastTimers(instance);
    const transition = progressTransitions.get(instance);
    if (transition?.close !== undefined) clearTimeout(transition.close);
    progressTransitions.delete(instance);
  },
  onResize() {
    if (
      this.data.processing ||
      this.data.pendingResult ||
      this.data.checkingPayment
    )
      this.setPaymentView({ processing: this.data.processing });
  },
  setPaymentView(patch: Record<string, unknown>, callback?: () => void) {
    const changesProgress = [
      "processing",
      "checkingPayment",
      "canResumePayment",
      "paymentActionPending",
      "pendingResult",
      "pendingPlanName",
      "pendingPriceLabel",
    ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    if (!changesProgress) {
      this.setData(patch, callback);
      return;
    }
    const instance = this as unknown as object;
    const previous = progressTransitions.get(instance);
    if (previous?.close !== undefined) clearTimeout(previous.close);
    const transition: { close?: ReturnType<typeof setTimeout> } = {};
    progressTransitions.set(instance, transition);
    const current = () =>
      activePages.has(instance) &&
      progressTransitions.get(instance) === transition;
    const busy = Boolean(
      (patch.processing ?? this.data.processing) ||
      (patch.checkingPayment ?? this.data.checkingPayment),
    );
    const visible =
      busy || Boolean(patch.canResumePayment ?? this.data.canResumePayment);
    if (visible) {
      // Mount into a zero-height region first. Measuring after this render
      // accounts for actual wrapping, font size and the pending-result actions.
      this.setData(
        {
          ...patch,
          progressMounted: true,
          progressBusy: busy,
          progressPlanName: String(
            patch.pendingPlanName ?? this.data.pendingPlanName,
          ),
          progressPriceLabel: String(
            patch.pendingPriceLabel ?? this.data.pendingPriceLabel,
          ),
        },
        () => {
          if (current()) {
            this.createSelectorQuery()
              .select(".payment-progress-inner")
              .boundingClientRect()
              .exec(
                (
                  rects: WechatMiniprogram.BoundingClientRectCallbackResult[],
                ) => {
                  if (!current() || !rects[0]?.height) {
                    callback?.();
                    return;
                  }
                  this.setData(
                    {
                      progressHeight: rects[0].height,
                      progressExpanded: true,
                    },
                    callback,
                  );
                },
              );
          } else callback?.();
        },
      );
      return;
    }
    // Keep the last visible content throughout collapse. A fast success must
    // not replace the spinner with pending-result copy just before removing it.
    this.setData(
      { ...patch, progressHeight: 0, progressExpanded: false },
      () => {
        if (current() && this.data.progressMounted) {
          const unmount = () => {
            if (current())
              this.setData({ progressMounted: false, progressBusy: false });
          };
          if (this.data.motionClass === "motion-reduced") unmount();
          else
            transition.close = setTimeout(
              unmount,
              PAYMENT_PROGRESS_TRANSITION_MS,
            );
        }
        callback?.();
      },
    );
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setPaymentView({ ...appearance });
  },
  async loadPayment(preloaded?: Promise<AutoDormCheckPaymentData>) {
    if (this.data.processing || (this.data.loading && !this.data.loaded))
      return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setPaymentView({ loading: true, errorMessage: "" });
    try {
      const payment = await (preloaded || getAutoDormCheckPayment());
      if (!isSessionLeaseCurrent(lease)) return;
      loadedPaymentAccounts.set(this as unknown as object, lease.account);
      this.setPaymentView({
        ...paymentDataViewData(payment),
        loaded: true,
      });
      const pending = loadPendingAutoDormCheckPayment(lease.account);
      if (pending)
        this.showPendingOrder(pending.planId, pending.orderId || "", pending);
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setPaymentView({
        errorMessage: getErrorMessage(error, "打卡套餐读取失败。"),
      });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setPaymentView({ loading: false });
    }
  },
  retryPayment() {
    haptic("light");
    void this.loadPayment();
  },
  returnToAutoDormCheck() {
    haptic("light");
    wx.navigateBack();
  },
  onPlanTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processing || this.data.paymentActionPending) {
      this.scrollToPayment();
      if (this.data.pendingResult) this.showCapsuleToast("有未结束订单");
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    if (pending) {
      this.scrollToPayment();
      if (!this.data.canResumePayment) {
        void this.runPaymentFlow(lease, pending, "restore");
        return;
      }
      this.showCapsuleToast("有未结束订单");
      return;
    }
    if (this.data.loading || !this.data.paymentEnabled) return;
    const planId = String(event.currentTarget.dataset.id || "");
    const plan = this.data.plans.find((item) => item.id === planId);
    if (!plan) return;
    haptic("light");
    return this.startPurchase(plan.id);
  },
  onPaymentScroll(event: WechatMiniprogram.CustomEvent<{ scrollTop: number }>) {
    paymentScrollPositions.set(
      this as unknown as object,
      Math.max(0, event.detail.scrollTop),
    );
  },
  scrollToPayment() {
    const instance = this as unknown as object;
    // Sync the actual scroll position first so every tap can animate to zero,
    // including after the user scrolls down again without changing page data.
    this.setData(
      { paymentScrollTop: paymentScrollPositions.get(instance) || 0 },
      () => {
        if (activePages.has(instance)) this.setData({ paymentScrollTop: 0 });
      },
    );
  },
  async startPurchase(planId: string) {
    if (this.data.processing || this.data.paymentActionPending) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.dismissCapsuleToast();
    const instance = this as unknown as object;
    const existing =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    if (existing) {
      void this.runPaymentFlow(lease, existing, "restore");
      return;
    }
    this.showPendingOrder(planId);
    const preparationRevision = nextFlowRevision(instance);
    paymentLaunchRevisions.set(instance, preparationRevision);
    activeFlowAccounts.set(instance, lease.account);
    this.setPaymentView({
      processing: true,
      checkingPayment: false,
      canResumePayment: false,
      paymentActionPending: true,
      loading: false,
      pendingResult: false,
      errorMessage: "",
    });
    const idempotencyKey = await createIdempotencyKey();
    const preparationStillActive =
      activePages.has(instance) &&
      flowRevisions.get(instance) === preparationRevision &&
      activeFlowAccounts.get(instance) === lease.account;
    if (
      !preparationStillActive ||
      !isSessionLeaseCurrent(lease) ||
      paymentLaunchRevisions.get(instance) !== preparationRevision
    ) {
      if (preparationStillActive) {
        activeFlowAccounts.delete(instance);
        this.setPaymentView({
          processing: false,
          paymentActionPending: false,
        });
      }
      return;
    }
    const pending: PendingAutoDormCheckPayment = {
      idempotencyKey,
      orderId: null,
      planId,
      createdAt: Date.now(),
      planName: this.data.pendingPlanName,
      priceLabel: this.data.pendingPriceLabel,
      paymentInvoked: false,
    };
    if (!savePendingAutoDormCheckPayment(lease.account, pending)) {
      activeFlowAccounts.delete(instance);
      this.setPaymentView({
        processing: false,
        paymentActionPending: false,
      });
      this.showCapsuleToast("订单保存失败，请稍后重试");
      return;
    }
    rememberActivePendingPayment(instance, lease.account, pending);
    await this.runPaymentFlow(lease, pending, "purchase");
  },
  async runPaymentFlow(
    lease: SessionLease,
    pending: PendingAutoDormCheckPayment,
    mode: PaymentFlowMode = "purchase",
  ) {
    if (mode !== "purchase" && this.data.paymentActionPending) return;
    const launchPayment = mode !== "restore";
    this.dismissCapsuleToast();
    this.showPendingOrder(pending.planId, pending.orderId || "", pending);
    this.setPaymentView({
      processing: mode === "purchase",
      checkingPayment: mode !== "purchase",
      canResumePayment: false,
      paymentActionPending: true,
      pendingResult: mode !== "purchase",
      loading: false,
      errorMessage: "",
    });
    const instance = this as unknown as object;
    const revision = nextFlowRevision(instance);
    if (launchPayment) paymentLaunchRevisions.set(instance, revision);
    const canLaunchPayment = () =>
      visiblePages.has(instance) &&
      paymentLaunchRevisions.get(instance) === revision;
    activeFlowAccounts.set(instance, lease.account);
    let trackedPending = pending;
    rememberActivePendingPayment(instance, lease.account, pending);
    try {
      let initialResult = pending.orderId
        ? await this.checkPaymentOrder(pending.orderId)
        : await createAutoDormCheckPaymentOrder(
            pending.planId,
            pending.idempotencyKey,
          );
      if (!isFlowCurrent(instance, revision, lease)) return;
      this.setPaymentView({
        pendingOrderId: initialResult.order.id,
        pendingPriceLabel: `¥${(initialResult.order.amountCents / 100).toFixed(2)}`,
      });
      trackedPending = {
        ...pending,
        orderId: initialResult.order.id,
        planName: this.data.pendingPlanName,
        priceLabel: this.data.pendingPriceLabel,
      };
      rememberActivePendingPayment(instance, lease.account, trackedPending);
      savePendingAutoDormCheckPayment(lease.account, trackedPending);
      if (
        mode === "restore" &&
        !pending.orderId &&
        shouldPollOrder(initialResult.order)
      ) {
        initialResult = await this.checkPaymentOrder(initialResult.order.id);
        if (!isFlowCurrent(instance, revision, lease)) return;
      }
      if (launchPayment && initialResult.order.status === "pending") {
        if (canLaunchPayment() && !initialResult.payment)
          initialResult = await resumeAutoDormCheckPaymentOrder(
            initialResult.order.id,
          );
        if (!isFlowCurrent(instance, revision, lease)) return;
        if (
          canLaunchPayment() &&
          initialResult.payment &&
          initialResult.order.status === "pending"
        ) {
          const payment = initialResult.payment;
          // Persist before invoking wx: unloading during the native call must
          // never restore this order as an untouched draft. Do not launch if
          // the marker cannot be read back from storage.
          trackedPending = { ...trackedPending, paymentInvoked: true };
          rememberActivePendingPayment(instance, lease.account, trackedPending);
          if (!savePendingAutoDormCheckPayment(lease.account, trackedPending))
            throw new Error("订单保存失败，请稍后重试");
          this.setPaymentView({ processing: true, checkingPayment: false });
          initialResult = { ...initialResult, paymentCheck: undefined };
          let outcome: "success" | "cancelled";
          try {
            outcome = await launchWechatPayment(payment);
          } catch (error) {
            if (!isFlowCurrent(instance, revision, lease)) return;
            this.setPaymentView({
              processing: false,
              checkingPayment: true,
              canResumePayment: false,
              pendingResult: true,
            });
            // A native failure is not proof of non-payment. Reconcile once,
            // but keep the known order recoverable if that lookup also fails.
            try {
              initialResult = await this.checkPaymentOrder(
                initialResult.order.id,
              );
            } catch {
              // The next explicit retry or page entry will query this order.
            }
            if (!isFlowCurrent(instance, revision, lease)) return;
            if (!shouldPollOrder(initialResult.order)) {
              await this.finishPaymentFlow(
                lease,
                revision,
                instance,
                initialResult,
              );
              return;
            }
            this.showAwaitingPayment(trackedPending, initialResult);
            activeFlowAccounts.delete(instance);
            if (!this.data.loaded) void this.loadPayment();
            this.showCapsuleToast(
              initialResult.order.status === "paid"
                ? "支付结果确认中"
                : getErrorMessage(error, "未能打开支付，请重试"),
            );
            return;
          }
          if (!isFlowCurrent(instance, revision, lease)) return;
          if (outcome === "cancelled") {
            this.setPaymentView({
              processing: false,
              checkingPayment: true,
              pendingResult: true,
              canResumePayment: false,
            });
            // The provider may have closed or paid the order after dismissal.
            // Only a fresh query can decide whether payment can be resumed.
            try {
              // Allow the cashier's close operation to reach the query API.
              await wait(ORDER_POLL_INTERVAL_MILLISECONDS);
              if (!isFlowCurrent(instance, revision, lease)) return;
              initialResult = await this.checkPaymentOrder(
                initialResult.order.id,
              );
            } catch {
              // Keep the saved order when its current status is unavailable.
            }
          } else {
            // Only a fresh payment attempt starts visible result polling.
            this.setPaymentView({
              processing: true,
              checkingPayment: false,
              pendingResult: false,
            });
          }
        } else if (!canLaunchPayment()) {
          // Leaving the page revokes this payment attempt, even if it returns
          // before the delayed create/sign response. Keep the order recoverable.
          this.setPaymentView({ processing: false, checkingPayment: true });
          initialResult = await this.checkPaymentOrder(initialResult.order.id);
        }
      }
      if (!isFlowCurrent(instance, revision, lease)) return;
      if (
        (!launchPayment || !this.data.processing) &&
        shouldPollOrder(initialResult.order)
      ) {
        activeFlowAccounts.delete(instance);
        this.showAwaitingPayment(trackedPending, initialResult);
        if (!this.data.loaded) void this.loadPayment();
        return;
      }
      const result = await this.pollPaymentOrder(
        initialResult,
        lease,
        revision,
        instance,
      );
      if (!isFlowCurrent(instance, revision, lease)) return;
      if (!result) {
        this.showAwaitingPayment(trackedPending);
        activeFlowAccounts.delete(instance);
        if (!this.data.loaded) void this.loadPayment();
        this.showCapsuleToast("支付结果确认中");
        return;
      }
      await this.finishPaymentFlow(lease, revision, instance, result);
    } catch (error) {
      if (!isFlowCurrent(instance, revision, lease)) return;
      const keepPending = keepPendingAfterError(error);
      if (!keepPending) {
        clearPendingAutoDormCheckPayment(lease.account);
        activePendingPayments.delete(instance);
      } else {
        rememberActivePendingPayment(instance, lease.account, trackedPending);
        savePendingAutoDormCheckPayment(lease.account, trackedPending);
      }
      activeFlowAccounts.delete(instance);
      if (keepPending) this.showAwaitingPayment(trackedPending);
      else
        this.setPaymentView({
          processing: false,
          checkingPayment: false,
          canResumePayment: false,
          loading: false,
          pendingResult: false,
        });
      if (!keepPending || !this.data.loaded) void this.loadPayment();
      const message = keepPending
        ? mode === "restore"
          ? "查询失败，稍后重试"
          : "支付结果确认中"
        : getErrorMessage(error, "购买失败，请重试。");
      if (message) this.showCapsuleToast(message);
    } finally {
      if (paymentLaunchRevisions.get(instance) === revision)
        paymentLaunchRevisions.delete(instance);
      if (isFlowCurrent(instance, revision, lease))
        this.setPaymentView({ paymentActionPending: false });
      if (
        activePages.has(instance) &&
        flowRevisions.get(instance) === revision &&
        activeFlowAccounts.get(instance) === lease.account &&
        !isSessionLeaseCurrent(lease)
      ) {
        activeFlowAccounts.delete(instance);
        this.setPaymentView({
          processing: false,
          checkingPayment: false,
          canResumePayment: false,
          paymentActionPending: false,
          loading: false,
        });
      }
    }
  },
  retryPendingPayment() {
    if (this.data.processing || this.data.paymentActionPending) return;
    if (!this.data.canResumePayment || Date.now() >= this.data.resumeDeadline) {
      this.refreshPendingPayment();
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    if (!pending) {
      this.setPaymentView({ pendingResult: false });
      void this.loadPayment();
      return;
    }
    haptic("light");
    void this.runPaymentFlow(lease, pending, "resume");
  },
  refreshPendingPayment() {
    if (this.data.paymentActionPending) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(this as unknown as object, lease.account);
    if (pending) void this.runPaymentFlow(lease, pending, "restore");
  },
  async checkPaymentOrder(orderId: string) {
    // Complete the initial render and measurement before starting the query.
    // Fast responses must not replace a spinner still hidden at zero height.
    await new Promise<void>((resolve) => {
      this.setPaymentView(
        { checkingPayment: true, canResumePayment: false },
        resolve,
      );
    });
    const startedAt = Date.now();
    const reveal = wait(PAYMENT_PROGRESS_TRANSITION_MS);
    let result: AutoDormCheckPaymentOrderResult;
    try {
      result = await getAutoDormCheckPaymentOrder(orderId, { refresh: true });
    } finally {
      // Let the loading region finish appearing even when the query is fast.
      await reveal;
    }
    return {
      ...result,
      paymentCheck: result.paymentCheck
        ? {
            ...result.paymentCheck,
            remainingMs: Math.max(
              0,
              result.paymentCheck.remainingMs - (Date.now() - startedAt),
            ),
          }
        : undefined,
    };
  },
  showAwaitingPayment(
    pending: PendingAutoDormCheckPayment,
    result?: AutoDormCheckPaymentOrderResult,
  ) {
    this.showPendingOrder(pending.planId, pending.orderId || "", pending);
    const instance = this as unknown as object;
    const visible = visiblePages.has(instance);
    const remainingMs = result?.paymentCheck?.remainingMs || 0;
    const lease = captureSessionLease();
    const saved = lease && loadPendingAutoDormCheckPayment(lease.account);
    const neverInvoked =
      pending.paymentInvoked === false &&
      saved?.idempotencyKey === pending.idempotencyKey &&
      saved.paymentInvoked === false;
    const canResumePayment =
      visible &&
      result?.order.status === "pending" &&
      // A never-invoked draft has no WeChat record yet. A successful fresh
      // server check of this unexpired local order permits its first launch.
      // Missing markers (older clients), failed queries and attempted payments
      // must still require the provider's explicit pending confirmation.
      (result.paymentCheck?.canResume === true || neverInvoked) &&
      Number.isFinite(remainingMs) &&
      remainingMs > 0;
    const previous = resumeTimers.get(instance);
    if (previous !== undefined) clearTimeout(previous);
    resumeTimers.delete(instance);
    this.setPaymentView({
      processing: false,
      checkingPayment: !canResumePayment,
      canResumePayment,
      resumeDeadline: canResumePayment ? Date.now() + remainingMs : 0,
      pendingResult: true,
      loading: false,
    });
    if (canResumePayment) unconfirmedChecks.delete(instance);
    if (lease && visible) {
      const attempt = unconfirmedChecks.get(instance) || 0;
      const delay = canResumePayment
        ? remainingMs
        : Math.min(30000, 3000 * 2 ** Math.min(attempt, 4));
      if (!canResumePayment) unconfirmedChecks.set(instance, attempt + 1);
      const revision = flowRevisions.get(instance) || 0;
      resumeTimers.set(
        instance,
        setTimeout(() => {
          resumeTimers.delete(instance);
          if (
            !isFlowCurrent(instance, revision, lease) ||
            !visiblePages.has(instance)
          )
            return;
          this.setPaymentView({
            canResumePayment: false,
            checkingPayment: true,
          });
          void this.runPaymentFlow(lease, pending, "restore");
        }, delay),
      );
    }
  },
  async cancelPendingPayment() {
    if (this.data.cancellingPayment) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    const revision = nextFlowRevision(instance);
    activeFlowAccounts.set(instance, lease.account);
    this.dismissCapsuleToast();
    this.setPaymentView({
      processing: false,
      checkingPayment: true,
      canResumePayment: false,
      paymentActionPending: true,
      cancellingPayment: true,
      pendingResult: Boolean(pending),
      loading: false,
    });
    try {
      if (!pending) return;
      // Recover a lost creation response with the original key before closing.
      const resolved = pending.orderId
        ? null
        : await createAutoDormCheckPaymentOrder(
            pending.planId,
            pending.idempotencyKey,
          );
      if (!isFlowCurrent(instance, revision, lease)) return;
      const tracked = {
        ...pending,
        orderId: pending.orderId || resolved!.order.id,
      };
      rememberActivePendingPayment(instance, lease.account, tracked);
      savePendingAutoDormCheckPayment(lease.account, tracked);
      this.setPaymentView({ pendingOrderId: tracked.orderId });
      const result =
        resolved && !shouldPollOrder(resolved.order)
          ? resolved
          : await cancelAutoDormCheckPaymentOrder(tracked.orderId);
      if (!isFlowCurrent(instance, revision, lease)) return;
      if (shouldPollOrder(result.order)) {
        this.showAwaitingPayment(tracked);
        this.showCapsuleToast("暂时无法取消，请重试");
      } else {
        await this.finishPaymentFlow(lease, revision, instance, result);
      }
    } catch (error) {
      if (!isFlowCurrent(instance, revision, lease)) return;
      const keepPending =
        Boolean(pending?.orderId) || keepPendingAfterError(error);
      if (!keepPending) {
        clearPendingAutoDormCheckPayment(lease.account);
        activePendingPayments.delete(instance);
      }
      if (keepPending && pending) this.showAwaitingPayment(pending);
      else
        this.setPaymentView({
          pendingResult: false,
          checkingPayment: false,
          canResumePayment: false,
        });
      this.showCapsuleToast(getErrorMessage(error, "取消失败，请重试"));
    } finally {
      if (isFlowCurrent(instance, revision, lease)) {
        activeFlowAccounts.delete(instance);
        this.setPaymentView({
          paymentActionPending: false,
          cancellingPayment: false,
          checkingPayment:
            this.data.pendingResult && !this.data.canResumePayment,
        });
        if (!this.data.loaded) void this.loadPayment();
      }
    }
  },
  showPendingOrder(
    planId: string,
    orderId = "",
    saved?: Pick<PendingAutoDormCheckPayment, "planName" | "priceLabel">,
  ) {
    const plans = this.data.plans.length
      ? this.data.plans
      : getCachedAutoDormCheckPayment()?.plans || [];
    const plan = plans.find((item) => item.id === planId);
    this.setPaymentView({
      pendingPlanName: saved?.planName || plan?.name || "",
      pendingPriceLabel: saved?.priceLabel || plan?.priceLabel || "",
      pendingOrderId: orderId,
    });
  },
  async pollPaymentOrder(
    initial: AutoDormCheckPaymentOrderResult,
    lease: SessionLease,
    revision: number,
    instance: object,
  ): Promise<AutoDormCheckPaymentOrderResult | null> {
    let current = initial;
    for (let attempt = 0; attempt < ORDER_POLL_ATTEMPTS; attempt += 1) {
      if (!shouldPollOrder(current.order)) return current;
      await wait(ORDER_POLL_INTERVAL_MILLISECONDS);
      if (!isFlowCurrent(instance, revision, lease)) return null;
      current = await getAutoDormCheckPaymentOrder(current.order.id);
      if (!isFlowCurrent(instance, revision, lease)) return null;
    }
    return shouldPollOrder(current.order) ? null : current;
  },
  async finishPaymentFlow(
    lease: SessionLease,
    revision: number,
    instance: object,
    result: AutoDormCheckPaymentOrderResult,
  ) {
    const success = isSuccessfulOrder(result.order);
    unconfirmedChecks.delete(instance);
    clearPendingAutoDormCheckPayment(lease.account);
    activePendingPayments.delete(instance);
    if (result.order.status === "cancelled") {
      this.setPaymentView({
        processing: false,
        checkingPayment: false,
        canResumePayment: false,
        pendingResult: false,
      });
      this.showCapsuleToast("订单已关闭");
    }
    let freshPayment: AutoDormCheckPaymentData | null = null;
    try {
      freshPayment = await getAutoDormCheckPayment();
    } catch {
      // 订单已是终态时优先恢复页面，稍后仍会在再次进入时刷新。
    }
    if (!isFlowCurrent(instance, revision, lease)) return;
    const fallback = {
      ...entitlementViewData(result.entitlement),
      paymentEnabled: this.data.loaded ? this.data.paymentEnabled : true,
      loaded: true,
    };
    activeFlowAccounts.delete(instance);
    loadedPaymentAccounts.set(instance, lease.account);
    this.setPaymentView(
      {
        ...(freshPayment ? paymentDataViewData(freshPayment) : fallback),
        processing: false,
        checkingPayment: false,
        canResumePayment: false,
        loading: false,
        loaded: true,
        pendingResult: false,
        errorMessage: "",
      },
      () => {
        if (!isFlowCurrent(instance, revision, lease)) return;
        if (result.order.status === "cancelled") return;
        if (success) {
          haptic("medium");
          this.showCapsuleToast("购买成功");
          return;
        }
        this.showCapsuleToast("购买失败");
      },
    );
  },
  showCapsuleToast(message: string) {
    const instance = this as unknown as object;
    clearCapsuleToastTimers(instance);
    this.setPaymentView(
      {
        capsuleToastMounted: true,
        capsuleToastVisible: false,
        capsuleToastMessage: message,
      },
      () => {
        const timers: CapsuleToastTimers = {};
        timers.reveal = setTimeout(() => {
          if (!activePages.has(instance)) return;
          this.setPaymentView({ capsuleToastVisible: true });
          timers.hide = setTimeout(() => {
            if (!activePages.has(instance)) return;
            this.setPaymentView({ capsuleToastVisible: false });
            timers.unmount = setTimeout(() => {
              capsuleToastTimers.delete(instance);
              if (activePages.has(instance) && !this.data.capsuleToastVisible) {
                this.setPaymentView({ capsuleToastMounted: false });
              }
            }, CAPSULE_TOAST_EXIT_MILLISECONDS);
          }, CAPSULE_TOAST_HOLD_MILLISECONDS);
        }, 16);
        capsuleToastTimers.set(instance, timers);
      },
    );
  },
  dismissCapsuleToast() {
    const instance = this as unknown as object;
    clearCapsuleToastTimers(instance);
    if (!this.data.capsuleToastMounted) return;
    this.setPaymentView({
      capsuleToastMounted: false,
      capsuleToastVisible: false,
      capsuleToastMessage: "",
    });
  },
});
