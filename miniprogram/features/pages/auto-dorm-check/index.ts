import {
  getAutoDormCheckLocation,
  getAutoDormCheckLocalStatus,
  getAutoDormCheckStatus,
  preloadAutoDormCheckPayment,
  setAutoDormCheckAgreement,
  setAutoDormCheckEnabled,
} from "../../../services/auto-dorm-check";
import type {
  AutoDormCheckEntitlement,
  AutoDormCheckState,
  AutoDormCheckStatus,
} from "../../../types/api";
import { ApiClientError, getErrorMessage } from "../../../services/request";
import {
  loadAutoDormCheckSnapshot,
  type AutoDormCheckSnapshot,
} from "../../../store/auto-dorm-check";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";

const STATUS_PRESENTATION: Record<
  AutoDormCheckState,
  { label: string; tone: string }
> = {
  checked_in: { label: "已打卡", tone: "success" },
  pending: { label: "待打卡", tone: "warning" },
  skipped: { label: "已跳过", tone: "muted" },
  failed: { label: "已失败", tone: "danger" },
  unavailable: { label: "不可用", tone: "danger" },
  disabled: { label: "已关闭", tone: "muted" },
  agreement_required: { label: "待同意", tone: "warning" },
  payment_required: { label: "额度不足", tone: "warning" },
};
const CHINA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const LOCATION_REQUIRED_CODE = "AUTO_DORM_CHECK_LOCATION_REQUIRED";
const NO_TASK_CODE = "AUTO_DORM_CHECK_NO_TASK";
const PAYMENT_REQUIRED_CODE = "AUTO_DORM_CHECK_PAYMENT_REQUIRED";
const AGREEMENT_REQUIRED_CODE = "AUTO_DORM_CHECK_AGREEMENT_REQUIRED";
const CAPSULE_TOAST_HOLD_MILLISECONDS = 3000;
const CAPSULE_TOAST_EXIT_MILLISECONDS = 150;
const TASK_STATUS_REFRESH_INTERVAL_MILLISECONDS = 30_000;
const EMPTY_ENTITLEMENT: AutoDormCheckEntitlement = {
  time: {
    remainingSeconds: 0,
    remainingDays: 0,
    paused: false,
    resumesAt: null,
  },
  uses: { remaining: 0, reserved: 0 },
};
let chinaDayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let taskStatusRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastShowTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastHideTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastUnmountTimer: ReturnType<typeof setTimeout> | undefined;
const loadedStatusAccounts = new WeakMap<object, string>();

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function chinaDateKey(date: Date): string {
  const chinaDate = new Date(date.getTime() + CHINA_OFFSET_MILLISECONDS);
  return [
    chinaDate.getUTCFullYear(),
    pad(chinaDate.getUTCMonth() + 1),
    pad(chinaDate.getUTCDate()),
  ].join("-");
}

function addDate(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-");
}

function formatChinaTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const chinaDate = new Date(date.getTime() + CHINA_OFFSET_MILLISECONDS);
  return [
    pad(chinaDate.getUTCHours()),
    pad(chinaDate.getUTCMinutes()),
    pad(chinaDate.getUTCSeconds()),
  ].join(":");
}

function targetTimeLabel(status: AutoDormCheckStatus): string {
  if (status.checkInStatus !== "pending" || !status.plannedCheckInAt) {
    return "—";
  }
  const time = formatChinaTime(status.plannedCheckInAt);
  const targetDate = status.plannedCheckInDate;
  const today = chinaDateKey(new Date());
  if (!targetDate || targetDate === today) return time;
  if (targetDate === addDate(today, 1)) return `明天 ${time}`;
  const [, month, day] = targetDate.split("-");
  return `${Number(month)}月${Number(day)}日 ${time}`;
}

function millisecondsUntilNextChinaDay(now = new Date()): number {
  const chinaDate = new Date(now.getTime() + CHINA_OFFSET_MILLISECONDS);
  const nextDay = Date.UTC(
    chinaDate.getUTCFullYear(),
    chinaDate.getUTCMonth(),
    chinaDate.getUTCDate() + 1,
  );
  return Math.max(1000, nextDay - chinaDate.getTime() + 1000);
}

function clearChinaDayRefreshTimer(): void {
  if (chinaDayRefreshTimer === undefined) return;
  clearTimeout(chinaDayRefreshTimer);
  chinaDayRefreshTimer = undefined;
}

function clearTaskStatusRefreshTimer(): void {
  if (taskStatusRefreshTimer === undefined) return;
  clearTimeout(taskStatusRefreshTimer);
  taskStatusRefreshTimer = undefined;
}

function taskStatusRefreshDelay(
  status: AutoDormCheckStatus,
  now = new Date(),
): number | null {
  if (status.checkInStatus !== "pending" || !status.plannedCheckInAt) {
    return null;
  }
  const target = new Date(status.plannedCheckInAt).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(
    TASK_STATUS_REFRESH_INTERVAL_MILLISECONDS,
    target - now.getTime() + TASK_STATUS_REFRESH_INTERVAL_MILLISECONDS,
  );
}

function clearCapsuleToastTimers(): void {
  for (const timer of [
    capsuleToastShowTimer,
    capsuleToastHideTimer,
    capsuleToastUnmountTimer,
  ]) {
    if (timer !== undefined) clearTimeout(timer);
  }
  capsuleToastShowTimer = undefined;
  capsuleToastHideTimer = undefined;
  capsuleToastUnmountTimer = undefined;
}

function capabilityFailureMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "当前账号暂时无法打卡";
  if (error.code === NO_TASK_CODE) return "暂无打卡任务";
  if (error.code === AGREEMENT_REQUIRED_CODE) return "请先阅读并勾选同意";
  if (error.code === PAYMENT_REQUIRED_CODE) return "请先购买打卡套餐";
  if (error.code === LOCATION_REQUIRED_CODE) {
    return "请先手动进行一次正常打卡";
  }
  return "当前账号暂时无法打卡";
}

function entitlementViewData(entitlement: AutoDormCheckEntitlement) {
  const remainingDays = Math.max(
    0,
    Math.floor(Number(entitlement.time.remainingDays) || 0),
  );
  const remainingUses = Math.max(
    0,
    Math.floor(Number(entitlement.uses.remaining) || 0),
  );
  const parts: string[] = [];
  if (remainingDays > 0) parts.push(`${remainingDays} 天`);
  if (remainingUses > 0) parts.push(`${remainingUses} 次`);
  return {
    entitlementRemainingDays: remainingDays,
    entitlementRemainingUses: remainingUses,
    entitlementPaused: entitlement.time.paused && remainingDays > 0,
    entitlementResumesAt: entitlement.time.resumesAt || "",
    entitlementLabel: parts.length
      ? `剩余 ${parts.join(" · ")}`
      : "选择适合你的套餐",
  };
}

function statusViewData(status: AutoDormCheckStatus) {
  const presentation = STATUS_PRESENTATION[status.checkInStatus];
  const checkInLocationName =
    status.checkInLocation?.locationName ||
    status.lastCheckIn?.locationName ||
    "";
  return {
    entryEnabled: status.entryEnabled,
    functionEnabled: status.functionEnabled,
    available: status.available,
    agreementVersion: status.agreementVersion,
    agreementAccepted: status.agreementAccepted,
    agreementAcceptedAt: status.agreementAcceptedAt || "",
    enabled: status.enabled,
    effectiveEnabled: status.effectiveEnabled,
    checkInStatus: status.checkInStatus,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    checkInWindowLabel: `${status.checkInStartTime}–${status.checkInEndTime}`,
    targetTimeLabel: targetTimeLabel(status),
    checkInLocationName,
    hasCheckInLocation: Boolean(checkInLocationName),
    paymentEnabled: Boolean(status.paymentEnabled),
    accessGranted:
      status.paymentEnabled === true ? Boolean(status.accessGranted) : true,
    accessMode: status.accessMode || "free",
    ...entitlementViewData(status.entitlement || EMPTY_ENTITLEMENT),
  };
}

function cachedStatusForDisplay(
  snapshot: AutoDormCheckSnapshot,
  now = new Date(),
): AutoDormCheckStatus | null {
  const status = snapshot.status;
  if (!status) return null;
  const storedAt = new Date(snapshot.localStoredAt);
  if (
    !Number.isNaN(storedAt.getTime()) &&
    chinaDateKey(storedAt) === chinaDateKey(now)
  ) {
    return status;
  }
  const checkInStatus: AutoDormCheckState = !status.available
    ? "unavailable"
    : !status.enabled
      ? "disabled"
      : !status.agreementAccepted
        ? "agreement_required"
        : !status.accessGranted
          ? "payment_required"
          : "pending";
  return {
    ...status,
    checkInStatus,
    plannedCheckInAt: null,
    plannedCheckInDate: null,
  };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    loading: true,
    loaded: false,
    saving: false,
    savingAgreement: false,
    checkingCapability: false,
    locationLoading: false,
    entryEnabled: false,
    functionEnabled: false,
    available: false,
    agreementVersion: 0,
    agreementAccepted: false,
    agreementAcceptedAt: "",
    enabled: false,
    effectiveEnabled: false,
    checkInStatus: "unavailable" as AutoDormCheckState,
    statusLabel: "不可用",
    statusTone: "danger",
    checkInWindowLabel: "21:10–22:30",
    targetTimeLabel: "—",
    checkInLocationName: "",
    hasCheckInLocation: false,
    paymentEnabled: false,
    accessGranted: true,
    accessMode: "free" as "free" | "time" | "count" | "none",
    entitlementRemainingDays: 0,
    entitlementRemainingUses: 0,
    entitlementPaused: false,
    entitlementResumesAt: "",
    entitlementLabel: "选择适合你的套餐",
    openingPayment: false,
    openingAgreement: false,
    errorMessage: "",
    capsuleToastMounted: false,
    capsuleToastVisible: false,
    capsuleToastMessage: "",
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    const lease = captureSessionLease();
    if (!lease) return;
    const instance = this as unknown as object;
    const loadedAccount = loadedStatusAccounts.get(instance);
    if (loadedAccount && loadedAccount !== lease.account) {
      loadedStatusAccounts.delete(instance);
      clearTaskStatusRefreshTimer();
      this.dismissCapsuleToast();
      this.setData({
        loading: true,
        loaded: false,
        saving: false,
        savingAgreement: false,
        checkingCapability: false,
        locationLoading: false,
        entryEnabled: false,
        functionEnabled: false,
        available: false,
        agreementVersion: 0,
        agreementAccepted: false,
        agreementAcceptedAt: "",
        enabled: false,
        effectiveEnabled: false,
        checkInStatus: "unavailable",
        statusLabel: STATUS_PRESENTATION.unavailable.label,
        statusTone: STATUS_PRESENTATION.unavailable.tone,
        checkInWindowLabel: "21:10–22:30",
        targetTimeLabel: "—",
        checkInLocationName: "",
        hasCheckInLocation: false,
        paymentEnabled: false,
        accessGranted: true,
        accessMode: "free",
        ...entitlementViewData(EMPTY_ENTITLEMENT),
        openingPayment: false,
        openingAgreement: false,
        errorMessage: "",
      });
    } else {
      this.setData({ openingPayment: false, openingAgreement: false });
    }
    this.hydrateCachedStatus(lease.account);
    void preloadAutoDormCheckPayment().catch(() => undefined);
    if (!this.data.hasCheckInLocation) void this.loadCheckInLocation();
    void this.loadStatus();
    this.scheduleChinaDayRefresh();
  },
  onHide() {
    clearChinaDayRefreshTimer();
    clearTaskStatusRefreshTimer();
    this.dismissCapsuleToast();
  },
  onUnload() {
    clearChinaDayRefreshTimer();
    clearTaskStatusRefreshTimer();
    clearCapsuleToastTimers();
    loadedStatusAccounts.delete(this as unknown as object);
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  hydrateCachedStatus(account: string) {
    const cached = loadAutoDormCheckSnapshot(account);
    if (!cached) return false;
    const status = cachedStatusForDisplay(cached);
    if (!status) return false;
    loadedStatusAccounts.set(this as unknown as object, account);
    this.setData({
      ...statusViewData(status),
      loading: false,
      loaded: true,
      errorMessage: "",
    });
    this.scheduleTaskStatusRefresh(status);
    return true;
  },
  async loadStatus(observeSchool = true, showBackgroundError = false) {
    if (this.data.loading && this.data.loaded) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const silent = this.data.loaded && !showBackgroundError;
    this.setData({
      loading: true,
      errorMessage: "",
    });
    try {
      const status = await (observeSchool
        ? getAutoDormCheckStatus()
        : getAutoDormCheckLocalStatus());
      if (!isSessionLeaseCurrent(lease)) return;
      if (this.data.saving || this.data.savingAgreement) return;
      loadedStatusAccounts.set(this as unknown as object, lease.account);
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
      if (!status.checkInLocation && !status.lastCheckIn) {
        void this.loadCheckInLocation();
      }
      this.scheduleTaskStatusRefresh(status);
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      if (!silent) {
        this.setData({
          available: false,
          errorMessage: getErrorMessage(error, "自动查寝状态读取失败。"),
        });
      }
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ loading: false });
    }
  },
  async loadCheckInLocation() {
    if (this.data.locationLoading || this.data.hasCheckInLocation) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({ locationLoading: true });
    try {
      const location = await getAutoDormCheckLocation();
      if (!location || !isSessionLeaseCurrent(lease)) return;
      this.setData({
        checkInLocationName: location.locationName,
        hasCheckInLocation: true,
      });
    } catch {
      // 地点补取保持静默，不影响页面中已经展示的状态。
    } finally {
      if (isSessionLeaseCurrent(lease)) {
        this.setData({ locationLoading: false });
      }
    }
  },
  retryStatus() {
    haptic("light");
    void this.loadStatus(true, true);
  },
  scheduleChinaDayRefresh() {
    clearChinaDayRefreshTimer();
    chinaDayRefreshTimer = setTimeout(() => {
      chinaDayRefreshTimer = undefined;
      void this.loadStatus();
      this.scheduleChinaDayRefresh();
    }, millisecondsUntilNextChinaDay());
  },
  scheduleTaskStatusRefresh(status: AutoDormCheckStatus) {
    clearTaskStatusRefreshTimer();
    const delay = taskStatusRefreshDelay(status);
    if (delay === null) return;
    taskStatusRefreshTimer = setTimeout(() => {
      taskStatusRefreshTimer = undefined;
      void this.loadStatus();
    }, delay);
  },
  showCapsuleToast(message: string) {
    clearCapsuleToastTimers();
    this.setData(
      {
        capsuleToastMounted: true,
        capsuleToastVisible: false,
        capsuleToastMessage: message,
      },
      () => {
        capsuleToastShowTimer = setTimeout(() => {
          capsuleToastShowTimer = undefined;
          this.setData({ capsuleToastVisible: true });
          capsuleToastHideTimer = setTimeout(() => {
            capsuleToastHideTimer = undefined;
            this.setData({ capsuleToastVisible: false });
            capsuleToastUnmountTimer = setTimeout(() => {
              capsuleToastUnmountTimer = undefined;
              if (!this.data.capsuleToastVisible) {
                this.setData({ capsuleToastMounted: false });
              }
            }, CAPSULE_TOAST_EXIT_MILLISECONDS);
          }, CAPSULE_TOAST_HOLD_MILLISECONDS);
        }, 16);
      },
    );
  },
  dismissCapsuleToast() {
    clearCapsuleToastTimers();
    if (!this.data.capsuleToastMounted) return;
    this.setData({
      capsuleToastMounted: false,
      capsuleToastVisible: false,
      capsuleToastMessage: "",
    });
  },
  openPayment() {
    if (!this.data.paymentEnabled || this.data.openingPayment) return;
    haptic("light");
    this.setData({ openingPayment: true }, () => {
      void navigateTo("/features/pages/auto-dorm-check-payment/index").then(
        (opened) => {
          if (!opened) this.setData({ openingPayment: false });
        },
      );
    });
  },
  openAgreement() {
    if (this.data.openingAgreement) return;
    haptic("light");
    this.setData({ openingAgreement: true }, () => {
      void navigateTo("/features/pages/auto-dorm-check-agreement/index").then(
        (opened) => {
          if (!opened) this.setData({ openingAgreement: false });
        },
      );
    });
  },
  async onEnabledTap() {
    if (this.data.saving || this.data.savingAgreement || !this.data.available)
      return;
    const lease = captureSessionLease();
    if (!lease) return;
    const enabled = !this.data.enabled;
    if (enabled && !this.data.agreementAccepted) {
      haptic("light");
      this.dismissCapsuleToast();
      this.showCapsuleToast("请先阅读并勾选同意");
      return;
    }
    if (enabled && this.data.paymentEnabled && !this.data.accessGranted) {
      haptic("light");
      this.dismissCapsuleToast();
      this.showCapsuleToast("请先购买打卡套餐");
      return;
    }
    const previous = {
      enabled: this.data.enabled,
      effectiveEnabled: this.data.effectiveEnabled,
      checkInStatus: this.data.checkInStatus,
      statusLabel: this.data.statusLabel,
      statusTone: this.data.statusTone,
      targetTimeLabel: this.data.targetTimeLabel,
    };
    haptic("light");
    this.dismissCapsuleToast();
    if (enabled) {
      this.setData({
        saving: true,
        checkingCapability: true,
        errorMessage: "",
      });
    } else {
      this.setData({
        enabled: false,
        effectiveEnabled: false,
        checkInStatus: "disabled",
        statusLabel: STATUS_PRESENTATION.disabled.label,
        statusTone: STATUS_PRESENTATION.disabled.tone,
        targetTimeLabel: "—",
        saving: true,
        errorMessage: "",
      });
    }
    try {
      const status = await setAutoDormCheckEnabled(enabled);
      if (!isSessionLeaseCurrent(lease)) return;
      loadedStatusAccounts.set(this as unknown as object, lease.account);
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
      this.scheduleTaskStatusRefresh(status);
      if (enabled) {
        haptic("medium");
        this.showCapsuleToast("已开启自动打卡");
      }
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      if (enabled) {
        this.setData({ ...previous, errorMessage: "" });
        this.showCapsuleToast(capabilityFailureMessage(error));
      } else {
        this.setData({
          ...previous,
          errorMessage: getErrorMessage(error, "设置保存失败，请重试。"),
        });
      }
    } finally {
      if (isSessionLeaseCurrent(lease)) {
        this.setData({ saving: false, checkingCapability: false });
      }
    }
  },
  async onAgreementTap() {
    if (this.data.savingAgreement || this.data.saving) return;
    const lease = captureSessionLease();
    if (!lease || this.data.agreementVersion < 1) return;
    const accepted = !this.data.agreementAccepted;
    const previous = {
      agreementAccepted: this.data.agreementAccepted,
      agreementAcceptedAt: this.data.agreementAcceptedAt,
      enabled: this.data.enabled,
      effectiveEnabled: this.data.effectiveEnabled,
      checkInStatus: this.data.checkInStatus,
      statusLabel: this.data.statusLabel,
      statusTone: this.data.statusTone,
      targetTimeLabel: this.data.targetTimeLabel,
    };
    const enabled = accepted ? this.data.enabled : false;
    const optimisticStatus: AutoDormCheckState = !this.data.available
      ? "unavailable"
      : !enabled
        ? "disabled"
        : this.data.paymentEnabled && !this.data.accessGranted
          ? "payment_required"
          : "pending";
    const presentation = STATUS_PRESENTATION[optimisticStatus];
    haptic("light");
    this.dismissCapsuleToast();
    this.setData({
      agreementAccepted: accepted,
      agreementAcceptedAt: accepted ? this.data.agreementAcceptedAt : "",
      enabled,
      effectiveEnabled:
        accepted &&
        this.data.available &&
        enabled &&
        (!this.data.paymentEnabled || this.data.accessGranted),
      checkInStatus: optimisticStatus,
      statusLabel: presentation.label,
      statusTone: presentation.tone,
      targetTimeLabel: "—",
      savingAgreement: true,
      errorMessage: "",
    });
    try {
      const status = await setAutoDormCheckAgreement(
        accepted,
        this.data.agreementVersion,
      );
      if (!isSessionLeaseCurrent(lease)) return;
      loadedStatusAccounts.set(this as unknown as object, lease.account);
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
      this.scheduleTaskStatusRefresh(status);
      this.showCapsuleToast(
        accepted ? "已同意使用须知" : "已取消并关闭自动打卡",
      );
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData(previous);
      this.showCapsuleToast(
        getErrorMessage(
          error,
          accepted ? "确认失败，请重试" : "取消失败，请重试",
        ),
      );
    } finally {
      if (isSessionLeaseCurrent(lease)) {
        this.setData({ savingAgreement: false });
      }
    }
  },
});
