import {
  createAutoDormCheckPaymentOrder,
  getCachedAutoDormCheckPayment,
  getAutoDormCheckPayment,
  getAutoDormCheckPaymentOrder,
  getPendingAutoDormCheckPayment,
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
import { ensureAuthenticated } from "../../../utils/navigation";

const ORDER_POLL_INTERVAL_MILLISECONDS = 900;
const ORDER_POLL_ATTEMPTS = 45;
const CAPSULE_TOAST_HOLD_MILLISECONDS = 3000;
const CAPSULE_TOAST_EXIT_MILLISECONDS = 180;
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
  uses: { remaining: 0 },
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
const flowRevisions = new WeakMap<object, number>();
const activeFlowAccounts = new WeakMap<object, string>();
const activePendingPayments = new WeakMap<object, AccountPendingPayment>();
const loadedPaymentAccounts = new WeakMap<object, string>();
const capsuleToastTimers = new WeakMap<object, CapsuleToastTimers>();

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
    hasTimeEntitlement: normalized.time.remainingSeconds > 0,
    hasUseEntitlement: normalized.uses.remaining > 0,
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
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    loading: false,
    loaded: false,
    processing: false,
    pendingResult: false,
    confirmingPlanId: "",
    paymentEnabled: false,
    accessGranted: true,
    accessMode: "free" as AutoDormCheckAccessMode,
    plans: [] as AutoDormCheckPaymentPlan[],
    timePlans: [] as AutoDormCheckPaymentPlan[],
    countPlans: [] as AutoDormCheckPaymentPlan[],
    entitlement: EMPTY_ENTITLEMENT,
    remainingDays: 0,
    remainingUses: 0,
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
    flowRevisions.set(instance, 0);
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    if (this.data.processing) {
      if (activeFlowAccounts.get(instance) === lease.account) return;
      nextFlowRevision(instance);
      activeFlowAccounts.delete(instance);
      activePendingPayments.delete(instance);
      this.setData({
        processing: false,
        pendingResult: false,
        confirmingPlanId: "",
      });
    }
    const loadedAccount = loadedPaymentAccounts.get(instance);
    if (loadedAccount && loadedAccount !== lease.account) {
      loadedPaymentAccounts.delete(instance);
      this.dismissCapsuleToast();
      this.setData({
        loaded: false,
        loading: false,
        paymentEnabled: false,
        accessGranted: true,
        accessMode: "free",
        plans: [],
        timePlans: [],
        countPlans: [],
        ...entitlementViewData(EMPTY_ENTITLEMENT),
        pendingResult: false,
        confirmingPlanId: "",
        errorMessage: "",
      });
    }
    const cachedPayment = getCachedAutoDormCheckPayment();
    if (cachedPayment) {
      loadedPaymentAccounts.set(instance, lease.account);
      this.setData({
        ...paymentDataViewData(cachedPayment),
        loaded: true,
        loading: false,
        errorMessage: "",
      });
    }
    const pending = loadPendingAutoDormCheckPayment(lease.account);
    if (pending) {
      rememberActivePendingPayment(instance, lease.account, pending);
      void this.runPaymentFlow(lease, pending);
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
    this.dismissCapsuleToast();
  },
  onUnload() {
    const instance = this as unknown as object;
    activePages.delete(instance);
    activeFlowAccounts.delete(instance);
    activePendingPayments.delete(instance);
    loadedPaymentAccounts.delete(instance);
    nextFlowRevision(instance);
    clearCapsuleToastTimers(instance);
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  async loadPayment(preloaded?: Promise<AutoDormCheckPaymentData>) {
    if (this.data.processing || (this.data.loading && !this.data.loaded))
      return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({ loading: true, errorMessage: "" });
    try {
      const payment = await (preloaded || getAutoDormCheckPayment());
      if (!isSessionLeaseCurrent(lease)) return;
      loadedPaymentAccounts.set(this as unknown as object, lease.account);
      this.setData({
        ...paymentDataViewData(payment),
        loaded: true,
      });
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        errorMessage: getErrorMessage(error, "打卡套餐读取失败。"),
      });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ loading: false });
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
    if (
      this.data.processing ||
      this.data.loading ||
      this.data.confirmingPlanId ||
      !this.data.paymentEnabled
    ) {
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    if (pending) {
      this.setData({ pendingResult: true });
      this.showCapsuleToast("支付结果确认中");
      void this.runPaymentFlow(lease, pending);
      return;
    }
    const planId = String(event.currentTarget.dataset.id || "");
    const plan = this.data.plans.find((item) => item.id === planId);
    if (!plan) return;
    haptic("light");
    this.setData({ confirmingPlanId: plan.id });
    let purchaseAccepted = false;
    wx.showModal({
      title: "确认购买",
      content: `${plan.name} · ${plan.quotaLabel}\n${plan.priceLabel}`,
      cancelText: "取消",
      confirmText: "确认购买",
      confirmColor: "#b85c38",
      success: (result) => {
        if (!activePages.has(this as unknown as object)) return;
        if (!isSessionLeaseCurrent(lease)) {
          this.setData({ confirmingPlanId: "" });
          return;
        }
        if (!result.confirm) return;
        purchaseAccepted = true;
        void this.startPurchase(plan.id);
      },
      fail: () => {
        if (!activePages.has(this as unknown as object)) return;
        this.showCapsuleToast("暂时无法发起购买");
      },
      complete: () => {
        if (
          activePages.has(this as unknown as object) &&
          !purchaseAccepted &&
          !this.data.processing
        ) {
          this.setData({ confirmingPlanId: "" });
        }
      },
    });
  },
  async startPurchase(planId: string) {
    if (this.data.processing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.dismissCapsuleToast();
    const instance = this as unknown as object;
    const preparationRevision = nextFlowRevision(instance);
    activeFlowAccounts.set(instance, lease.account);
    this.setData({
      processing: true,
      loading: false,
      pendingResult: false,
      confirmingPlanId: "",
      errorMessage: "",
    });
    const idempotencyKey = await createIdempotencyKey();
    const preparationStillActive =
      activePages.has(instance) &&
      flowRevisions.get(instance) === preparationRevision &&
      activeFlowAccounts.get(instance) === lease.account;
    if (!preparationStillActive || !isSessionLeaseCurrent(lease)) {
      if (preparationStillActive) {
        activeFlowAccounts.delete(instance);
        this.setData({ processing: false, confirmingPlanId: "" });
      }
      return;
    }
    const pending: PendingAutoDormCheckPayment = {
      idempotencyKey,
      orderId: null,
      planId,
      createdAt: Date.now(),
    };
    if (!savePendingAutoDormCheckPayment(lease.account, pending)) {
      activeFlowAccounts.delete(instance);
      this.setData({ processing: false, confirmingPlanId: "" });
      this.showCapsuleToast("订单保存失败，请稍后重试");
      return;
    }
    rememberActivePendingPayment(instance, lease.account, pending);
    await this.runPaymentFlow(lease, pending, true);
  },
  async runPaymentFlow(
    lease: SessionLease,
    pending: PendingAutoDormCheckPayment,
    processingAlreadyVisible = false,
  ) {
    if (!processingAlreadyVisible) {
      if (this.data.processing) return;
      this.dismissCapsuleToast();
      this.setData({
        processing: true,
        loading: false,
        pendingResult: false,
        confirmingPlanId: "",
        errorMessage: "",
      });
    }
    const instance = this as unknown as object;
    const revision = nextFlowRevision(instance);
    activeFlowAccounts.set(instance, lease.account);
    let trackedPending = pending;
    rememberActivePendingPayment(instance, lease.account, pending);
    try {
      const initialResult = pending.orderId
        ? await getAutoDormCheckPaymentOrder(pending.orderId)
        : await createAutoDormCheckPaymentOrder(
            pending.planId,
            pending.idempotencyKey,
          );
      if (!isFlowCurrent(instance, revision, lease)) return;
      if (
        initialResult.order.id &&
        initialResult.order.id !== pending.orderId
      ) {
        trackedPending = { ...pending, orderId: initialResult.order.id };
        rememberActivePendingPayment(instance, lease.account, trackedPending);
        savePendingAutoDormCheckPayment(lease.account, trackedPending);
      }
      const result = await this.pollPaymentOrder(
        initialResult,
        lease,
        revision,
        instance,
      );
      if (!isFlowCurrent(instance, revision, lease)) return;
      if (!result) {
        this.setData({
          processing: false,
          loading: false,
          pendingResult: true,
        });
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
      this.setData({
        processing: false,
        loading: false,
        pendingResult: keepPending,
        confirmingPlanId: "",
      });
      if (!keepPending || !this.data.loaded) void this.loadPayment();
      const message = keepPending
        ? "支付结果确认中"
        : getErrorMessage(error, "购买失败，请重试。");
      if (message) this.showCapsuleToast(message);
    } finally {
      if (
        activePages.has(instance) &&
        flowRevisions.get(instance) === revision &&
        activeFlowAccounts.get(instance) === lease.account &&
        !isSessionLeaseCurrent(lease)
      ) {
        activeFlowAccounts.delete(instance);
        this.setData({
          processing: false,
          loading: false,
          confirmingPlanId: "",
        });
      }
    }
  },
  retryPendingPayment() {
    if (this.data.processing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const pending =
      loadPendingAutoDormCheckPayment(lease.account) ||
      activePendingPayment(instance, lease.account);
    if (!pending) {
      this.setData({ pendingResult: false });
      void this.loadPayment();
      return;
    }
    haptic("light");
    void this.runPaymentFlow(lease, pending);
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
    clearPendingAutoDormCheckPayment(lease.account);
    activePendingPayments.delete(instance);
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
    this.setData(
      {
        ...(freshPayment ? paymentDataViewData(freshPayment) : fallback),
        processing: false,
        loading: false,
        loaded: true,
        pendingResult: false,
        confirmingPlanId: "",
        errorMessage: "",
      },
      () => {
        if (!isFlowCurrent(instance, revision, lease)) return;
        if (success) {
          haptic("medium");
          this.showCapsuleToast("购买成功");
          return;
        }
        this.showCapsuleToast(
          result.order.status === "cancelled" ? "已取消购买" : "购买失败",
        );
      },
    );
  },
  showCapsuleToast(message: string) {
    const instance = this as unknown as object;
    clearCapsuleToastTimers(instance);
    this.setData(
      {
        capsuleToastMounted: true,
        capsuleToastVisible: false,
        capsuleToastMessage: message,
      },
      () => {
        const timers: CapsuleToastTimers = {};
        timers.reveal = setTimeout(() => {
          if (!activePages.has(instance)) return;
          this.setData({ capsuleToastVisible: true });
          timers.hide = setTimeout(() => {
            if (!activePages.has(instance)) return;
            this.setData({ capsuleToastVisible: false });
            timers.unmount = setTimeout(() => {
              capsuleToastTimers.delete(instance);
              if (activePages.has(instance) && !this.data.capsuleToastVisible) {
                this.setData({ capsuleToastMounted: false });
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
    this.setData({
      capsuleToastMounted: false,
      capsuleToastVisible: false,
      capsuleToastMessage: "",
    });
  },
});
