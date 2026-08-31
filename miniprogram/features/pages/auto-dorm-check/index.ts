import {
  getAutoDormCheckLocalStatus,
  getAutoDormCheckStatus,
  setAutoDormCheckEnabled,
} from "../../../services/auto-dorm-check";
import type {
  AutoDormCheckState,
  AutoDormCheckStatus,
} from "../../../types/api";
import { ApiClientError, getErrorMessage } from "../../../services/request";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";

const STATUS_PRESENTATION: Record<
  AutoDormCheckState,
  { label: string; tone: string }
> = {
  checked_in: { label: "已打卡", tone: "success" },
  pending: { label: "待打卡", tone: "warning" },
  failed: { label: "已失败", tone: "danger" },
  unavailable: { label: "不可用", tone: "danger" },
  disabled: { label: "已关闭", tone: "muted" },
};
const CHINA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const LOCATION_REQUIRED_CODE = "AUTO_DORM_CHECK_LOCATION_REQUIRED";
const NO_TASK_CODE = "AUTO_DORM_CHECK_NO_TASK";
const CAPSULE_TOAST_HOLD_MILLISECONDS = 3000;
const CAPSULE_TOAST_EXIT_MILLISECONDS = 150;
const TASK_STATUS_REFRESH_INTERVAL_MILLISECONDS = 30_000;
let chinaDayRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let taskStatusRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastShowTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastHideTimer: ReturnType<typeof setTimeout> | undefined;
let capsuleToastUnmountTimer: ReturnType<typeof setTimeout> | undefined;

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
  if (error.code === LOCATION_REQUIRED_CODE) {
    return "请先手动进行一次正常打卡";
  }
  return "当前账号暂时无法打卡";
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
    enabled: status.enabled,
    effectiveEnabled: status.effectiveEnabled,
    checkInStatus: status.checkInStatus,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    checkInWindowLabel: `${status.checkInStartTime}–${status.checkInEndTime}`,
    targetTimeLabel: targetTimeLabel(status),
    checkInLocationName,
    hasCheckInLocation: Boolean(checkInLocationName),
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
    checkingCapability: false,
    entryEnabled: false,
    functionEnabled: false,
    available: false,
    enabled: false,
    effectiveEnabled: false,
    checkInStatus: "unavailable" as AutoDormCheckState,
    statusLabel: "不可用",
    statusTone: "danger",
    checkInWindowLabel: "21:00–23:30",
    targetTimeLabel: "—",
    checkInLocationName: "",
    hasCheckInLocation: false,
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
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  async loadStatus(observeSchool = true) {
    if (this.data.loading && this.data.loaded) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({
      loading: true,
      errorMessage: "",
    });
    try {
      const status = await (observeSchool
        ? getAutoDormCheckStatus()
        : getAutoDormCheckLocalStatus());
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
      this.scheduleTaskStatusRefresh(status);
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        available: false,
        errorMessage: getErrorMessage(error, "自动查寝状态读取失败。"),
      });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ loading: false });
    }
  },
  retryStatus() {
    haptic("light");
    void this.loadStatus();
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
      void this.loadStatus(false);
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
  async onEnabledTap() {
    if (this.data.saving || !this.data.available) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const previous = {
      enabled: this.data.enabled,
      effectiveEnabled: this.data.effectiveEnabled,
      checkInStatus: this.data.checkInStatus,
      statusLabel: this.data.statusLabel,
      statusTone: this.data.statusTone,
      targetTimeLabel: this.data.targetTimeLabel,
    };
    const enabled = !this.data.effectiveEnabled;
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
});
