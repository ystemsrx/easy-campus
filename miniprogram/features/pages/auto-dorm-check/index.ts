import {
  getAutoDormCheckStatus,
  setAutoDormCheckEnabled,
} from "../../../services/auto-dorm-check";
import type {
  AutoDormCheckState,
  AutoDormCheckStatus,
} from "../../../types/api";
import { getErrorMessage } from "../../../services/request";
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
  unavailable: { label: "不可用", tone: "danger" },
  disabled: { label: "已关闭", tone: "muted" },
};
const CHINA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
let chinaDayRefreshTimer: ReturnType<typeof setTimeout> | undefined;

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

function statusViewData(status: AutoDormCheckStatus) {
  const presentation = STATUS_PRESENTATION[status.checkInStatus];
  const checkInLocationName = status.lastCheckIn?.locationName || "";
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
  },
  onUnload() {
    clearChinaDayRefreshTimer();
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  async loadStatus() {
    if (this.data.loading && this.data.loaded) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({
      loading: true,
      errorMessage: "",
    });
    try {
      const status = await getAutoDormCheckStatus();
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
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
  async onEnabledChange(event: WechatMiniprogram.SwitchChange) {
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
    const enabled = event.detail.value;
    haptic("light");
    const optimisticState: AutoDormCheckState = enabled
      ? "pending"
      : "disabled";
    this.setData({
      enabled,
      effectiveEnabled: enabled,
      checkInStatus: optimisticState,
      statusLabel: STATUS_PRESENTATION[optimisticState].label,
      statusTone: STATUS_PRESENTATION[optimisticState].tone,
      targetTimeLabel: enabled ? "计算中" : "—",
      saving: true,
      errorMessage: "",
    });
    try {
      const status = await setAutoDormCheckEnabled(enabled);
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        ...statusViewData(status),
        loaded: true,
      });
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        ...previous,
        errorMessage: getErrorMessage(error, "设置保存失败，请重试。"),
      });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ saving: false });
    }
  },
});
