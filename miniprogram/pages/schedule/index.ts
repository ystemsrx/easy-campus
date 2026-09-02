import { currentIsoWeekday } from "../../data/timetable";
import { defaultPlanEnd, nextWholeHour } from "../../data/schedule";
import {
  buildScheduleDayView,
  buildScheduleWeekView,
  getPrewarmedScheduleFirstScreen,
  scheduleDateFromKey,
  SCHEDULE_TIMELINE_HEIGHT,
  type ScheduleDayOption,
  type ScheduleEntry,
} from "../../data/schedule-render";
import {
  getPreloadedSchedule,
  getPreloadedTimetable,
} from "../../services/primary-tab-preload";
import { getTimetable, putLocalSchedule } from "../../services/teaching";
import {
  claimAutomaticRefresh,
  FIFTEEN_DAYS_MS,
  isCacheStale,
  shouldStoreServerSnapshot,
} from "../../store/cache-policy";
import {
  getScheduleRevision,
  loadScheduleData,
  saveScheduleData,
} from "../../store/schedule";
import {
  getPreferencesRevision,
  loadPreferences,
} from "../../store/preferences";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  type SessionLease,
} from "../../store/session";
import {
  getTimetableRevision,
  loadTimetableSnapshot,
  saveTimetableSnapshot,
} from "../../store/timetable";
import type { LocalSchedulePlan, TimetableData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { toDateString } from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

let activeTimetable: TimetableData | null = null;
let activeAccount = "";
let timetableRequestLease: SessionLease | null = null;
let scheduleSyncLease: SessionLease | null = null;
let activeSchedulePrewarmRevision = 0;
let activeTimetableStoredAt = 0;
let activeScheduleUpdatedAt: string | null = null;
let hydratedScheduleSources: ScheduleSourceRevisions | null = null;
let scheduleRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let scheduleVisible = false;

const INITIAL_SCHEDULE_PREFERENCES = loadPreferences();
const INITIAL_SCHEDULE_APPEARANCE = resolveAppearance(
  INITIAL_SCHEDULE_PREFERENCES,
);
const SCHEDULE_RETURN_REFRESH_DELAY_MS = 520;

interface ScheduleSourceRevisions {
  account: string;
  date: string;
  preferences: number;
  timetable: number;
  schedule: number;
}

type ScheduleSourceName = Exclude<
  keyof ScheduleSourceRevisions,
  "account" | "date"
>;

const SCHEDULE_SOURCE_NAMES: readonly ScheduleSourceName[] = [
  "preferences",
  "timetable",
  "schedule",
];

function readScheduleSourceRevisions(account: string): ScheduleSourceRevisions {
  return {
    account,
    date: toDateString(new Date()),
    preferences: getPreferencesRevision(),
    timetable: getTimetableRevision(),
    schedule: getScheduleRevision(),
  };
}

function scheduleSourcesAreCurrent(account: string): boolean {
  if (!hydratedScheduleSources || hydratedScheduleSources.account !== account) {
    return false;
  }
  const current = readScheduleSourceRevisions(account);
  return (
    current.date === hydratedScheduleSources.date &&
    SCHEDULE_SOURCE_NAMES.every(
      (source) => current[source] === hydratedScheduleSources?.[source],
    )
  );
}

function markScheduleSourcesHydrated(
  account: string,
  sources: readonly ScheduleSourceName[],
): void {
  if (!hydratedScheduleSources || hydratedScheduleSources.account !== account) {
    return;
  }
  const current = readScheduleSourceRevisions(account);
  const next = { ...hydratedScheduleSources, date: current.date };
  for (const source of sources) next[source] = current[source];
  hydratedScheduleSources = next;
}

function clearScheduleRefreshTimer(): void {
  if (scheduleRefreshTimer === undefined) return;
  clearTimeout(scheduleRefreshTimer);
  scheduleRefreshTimer = undefined;
}

Page({
  data: {
    ...INITIAL_SCHEDULE_APPEARANCE,
    currentTime: "",
    monthLabel: "",
    teachingWeekLabel: "",
    days: [] as ScheduleDayOption[],
    selectedWeekday: currentIsoWeekday(),
    selectedDate: toDateString(new Date()),
    selectedDateLabel: "",
    entries: [] as ScheduleEntry[],
    timelineHeight: SCHEDULE_TIMELINE_HEIGHT,
    creating: false,
    title: "",
    startDate: toDateString(new Date()),
    startTime: "20:00",
    endDate: toDateString(new Date()),
    endTime: "21:00",
    endDirty: false,
    editingPlanId: "",
  },
  onLoad() {
    scheduleVisible = false;
    hydratedScheduleSources = null;
    const account = getSession()?.user.account || "";
    if (account) this.hydrateCachedScheduleIfNeeded(account, true);
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    scheduleVisible = true;
    const account = getSession()?.user.account || "";
    if (!account) return;
    this.hydrateCachedScheduleIfNeeded(account);
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({
        selected: 1,
        themeClass: this.data.themeClass,
        visualThemeClass: this.data.visualThemeClass,
        motionClass: this.data.motionClass,
        hidden: false,
      });
    }
    this.scheduleBackgroundRefresh(SCHEDULE_RETURN_REFRESH_DELAY_MS);
  },
  onHide() {
    scheduleVisible = false;
    clearScheduleRefreshTimer();
    if (this.data.creating || this.data.editingPlanId) {
      this.setData({ creating: false, editingPlanId: "" });
    }
    this.setTabBarHidden(false);
  },
  onUnload() {
    scheduleVisible = false;
    clearScheduleRefreshTimer();
  },
  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden });
  },
  hydrateCachedScheduleIfNeeded(account: string, force = false): boolean {
    if (!force && scheduleSourcesAreCurrent(account)) return false;
    const previous = hydratedScheduleSources;
    const current = readScheduleSourceRevisions(account);
    const accountChanged = !previous || previous.account !== account;
    const preferencesChanged =
      force || accountChanged || previous.preferences !== current.preferences;
    const contentChanged =
      force ||
      accountChanged ||
      previous.date !== current.date ||
      previous.timetable !== current.timetable ||
      previous.schedule !== current.schedule;
    const patch: Record<string, unknown> = {};
    if (preferencesChanged) {
      Object.assign(patch, resolveAppearance(loadPreferences()));
    }
    if (contentChanged) {
      const prewarmed = force ? getPrewarmedScheduleFirstScreen(account) : null;
      activeAccount = account;
      if (prewarmed) {
        activeTimetable = prewarmed.timetable;
        activeSchedulePrewarmRevision = prewarmed.revision;
        activeTimetableStoredAt = prewarmed.timetableStoredAt;
        activeScheduleUpdatedAt = prewarmed.scheduleUpdatedAt;
        Object.assign(patch, prewarmed.view);
      } else {
        const timetable = loadTimetableSnapshot(account);
        const schedule = loadScheduleData(account);
        activeTimetable = timetable?.data || null;
        activeSchedulePrewarmRevision = 0;
        activeTimetableStoredAt = timetable?.localStoredAt || 0;
        activeScheduleUpdatedAt = schedule.clientUpdatedAt;
        Object.assign(
          patch,
          buildScheduleWeekView(
            activeTimetable,
            schedule.plans,
            accountChanged ? currentIsoWeekday() : this.data.selectedWeekday,
          ),
        );
      }
    }
    hydratedScheduleSources = readScheduleSourceRevisions(account);
    if (Object.keys(patch).length) this.setData(patch);
    return true;
  },
  scheduleBackgroundRefresh(delay: number) {
    clearScheduleRefreshTimer();
    scheduleRefreshTimer = setTimeout(() => {
      scheduleRefreshTimer = undefined;
      if (!scheduleVisible) return;
      void this.loadTimetable();
      void this.syncSchedule();
    }, delay);
  },
  applyPrewarmedSchedule() {
    if (!scheduleVisible) return false;
    const prewarmed = getPrewarmedScheduleFirstScreen(activeAccount);
    if (!prewarmed || prewarmed.revision === activeSchedulePrewarmRevision) {
      return false;
    }
    if (
      prewarmed.timetableStoredAt === activeTimetableStoredAt &&
      prewarmed.scheduleUpdatedAt === activeScheduleUpdatedAt
    ) {
      activeSchedulePrewarmRevision = prewarmed.revision;
      return false;
    }
    activeTimetable = prewarmed.timetable;
    activeSchedulePrewarmRevision = prewarmed.revision;
    activeTimetableStoredAt = prewarmed.timetableStoredAt;
    activeScheduleUpdatedAt = prewarmed.scheduleUpdatedAt;
    this.setData(prewarmed.view, () => {
      markScheduleSourcesHydrated(activeAccount, ["timetable", "schedule"]);
    });
    return true;
  },
  async loadTimetable() {
    const lease = captureSessionLease();
    if (!lease) return;
    if (timetableRequestLease && isSessionLeaseCurrent(timetableRequestLease)) {
      return;
    }
    timetableRequestLease = lease;
    let shouldRefreshAfterward = false;
    try {
      const result = await getPreloadedTimetable();
      if (
        !result ||
        !scheduleVisible ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return;
      }
      const local = loadTimetableSnapshot(lease.account);
      if (shouldStoreServerSnapshot(local, result.meta)) {
        saveTimetableSnapshot(lease.account, result.data, {
          serverFetchedAt: result.meta.fetchedAt,
        });
      }
      this.applyPrewarmedSchedule();
      const current = loadTimetableSnapshot(lease.account);
      const storedAt = current?.localStoredAt || 0;
      if (storedAt !== activeTimetableStoredAt) {
        activeTimetable = current?.data || result.data;
        activeTimetableStoredAt = storedAt;
        this.rebuildWeek();
      }
      shouldRefreshAfterward =
        isCacheStale(current, FIFTEEN_DAYS_MS) &&
        claimAutomaticRefresh("timetable", lease.account);
    } catch {
      // 保留本地课表与用户日程，不用加载态打断当前页面。
    } finally {
      if (timetableRequestLease === lease) timetableRequestLease = null;
      if (shouldRefreshAfterward && isSessionLeaseCurrent(lease)) {
        setTimeout(() => {
          if (
            scheduleVisible &&
            isSessionLeaseCurrent(lease) &&
            activeAccount === lease.account
          ) {
            void this.refreshTimetable();
          }
        }, 0);
      }
    }
  },
  async refreshTimetable() {
    const lease = captureSessionLease();
    if (!lease || activeAccount !== lease.account) return;
    if (timetableRequestLease && isSessionLeaseCurrent(timetableRequestLease)) {
      return;
    }
    timetableRequestLease = lease;
    try {
      const result = await getTimetable({ refresh: true, automatic: true });
      if (!isSessionLeaseCurrent(lease) || activeAccount !== lease.account) {
        return;
      }
      const local = loadTimetableSnapshot(lease.account);
      if (!shouldStoreServerSnapshot(local, result.meta, true)) return;
      activeTimetable = result.data;
      const snapshot = saveTimetableSnapshot(lease.account, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
      });
      activeTimetableStoredAt = snapshot?.localStoredAt || Date.now();
      if (scheduleVisible) this.rebuildWeek();
    } catch {
      // 周期刷新失败时继续使用旧课表。
    } finally {
      if (timetableRequestLease === lease) timetableRequestLease = null;
    }
  },
  async syncSchedule() {
    const lease = captureSessionLease();
    if (!lease || activeAccount !== lease.account) return;
    if (scheduleSyncLease && isSessionLeaseCurrent(scheduleSyncLease)) return;
    scheduleSyncLease = lease;
    try {
      await getPreloadedSchedule();
      if (
        !scheduleVisible ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return;
      }
      if (!this.applyPrewarmedSchedule()) {
        const updatedAt = loadScheduleData(lease.account).clientUpdatedAt;
        if (updatedAt !== activeScheduleUpdatedAt) {
          this.rebuildWeek();
        }
      }
    } catch {
      // 日程以本地状态为准，服务端暂不可用时等待下次进入再同步。
    } finally {
      if (scheduleSyncLease === lease) scheduleSyncLease = null;
    }
  },
  persistPlans(plans: LocalSchedulePlan[]) {
    const data = saveScheduleData(activeAccount, plans);
    activeScheduleUpdatedAt = data.clientUpdatedAt;
    void putLocalSchedule(data).catch(() => {
      // 本地写入已经完成，服务端将在下次进入页面时追平。
    });
  },
  rebuildWeek() {
    const schedule = loadScheduleData(activeAccount);
    activeScheduleUpdatedAt = schedule.clientUpdatedAt;
    this.setData(
      buildScheduleWeekView(
        activeTimetable,
        schedule.plans,
        this.data.selectedWeekday,
      ),
      () => {
        markScheduleSourcesHydrated(activeAccount, ["timetable", "schedule"]);
      },
    );
  },
  applyDay(
    weekday: ScheduleDayOption["weekday"],
    dayOptions?: ScheduleDayOption[],
    planOptions?: LocalSchedulePlan[],
  ) {
    const days: ScheduleDayOption[] = dayOptions || this.data.days;
    const plans: LocalSchedulePlan[] =
      planOptions || loadScheduleData(activeAccount).plans;
    const view = buildScheduleDayView(activeTimetable, days, plans, weekday);
    if (view) this.setData(view);
  },
  selectDay(event: WechatMiniprogram.TouchEvent) {
    const weekday = Number(
      event.currentTarget.dataset.weekday,
    ) as ScheduleDayOption["weekday"];
    if (weekday === this.data.selectedWeekday) return;
    this.applyDay(weekday);
  },
  goToday() {
    haptic("light");
    this.applyDay(currentIsoWeekday());
  },
  openTimetable() {
    haptic("light");
    void navigateTo(
      "/features/pages/timetable/index?source=schedule",
      "wx://cupertino-modal",
    );
  },
  openCreator() {
    haptic("light");
    const now = new Date();
    const nextStart = nextWholeHour(now);
    const startDate =
      this.data.selectedDate === toDateString(now)
        ? nextStart.startDate
        : this.data.selectedDate;
    const startTime = nextStart.startTime;
    const defaultEnd = defaultPlanEnd(startDate, startTime);
    this.setTabBarHidden(true);
    this.setData({
      creating: true,
      title: "",
      startDate,
      startTime,
      ...defaultEnd,
      endDirty: false,
      editingPlanId: "",
    });
  },
  openPlanEditor(event: WechatMiniprogram.TouchEvent) {
    if (String(event.currentTarget.dataset.kind || "") !== "plan") return;
    const id = String(event.currentTarget.dataset.id || "");
    const plan = loadScheduleData(activeAccount).plans.find(
      (candidate) => candidate.id === id,
    );
    if (!plan) return;
    haptic("light");
    this.setTabBarHidden(true);
    this.setData({
      creating: true,
      editingPlanId: plan.id,
      title: plan.title,
      startDate: plan.date,
      startTime: plan.startTime,
      endDate: plan.endDate,
      endTime: plan.endTime,
      endDirty: true,
    });
  },
  closeCreator() {
    this.setData({ creating: false, editingPlanId: "" });
    this.setTabBarHidden(false);
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  onStartDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const startDate = event.detail.value;
    this.setData(
      this.data.endDirty
        ? { startDate }
        : { startDate, ...defaultPlanEnd(startDate, this.data.startTime) },
    );
  },
  onEndDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endDate: event.detail.value, endDirty: true });
  },
  onStartTimeChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const startTime = event.detail.value;
    this.setData(
      this.data.endDirty
        ? { startTime }
        : {
            startTime,
            ...defaultPlanEnd(this.data.startDate, startTime),
          },
    );
  },
  onEndTimeChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endTime: event.detail.value, endDirty: true });
  },
  savePlan() {
    const title = this.data.title.trim();
    if (!title) {
      wx.showToast({ title: "先写下要做什么", icon: "none" });
      return;
    }
    if (
      this.data.endDate < this.data.startDate ||
      (this.data.endDate === this.data.startDate &&
        this.data.endTime <= this.data.startTime)
    ) {
      wx.showToast({ title: "结束时间需要晚于开始时间", icon: "none" });
      return;
    }
    const storedPlans = loadScheduleData(activeAccount).plans;
    const editingPlanId = this.data.editingPlanId;
    const planPatch = {
      title,
      date: this.data.startDate,
      startTime: this.data.startTime,
      endDate: this.data.endDate,
      endTime: this.data.endTime,
    };
    const plans = editingPlanId
      ? storedPlans.map((plan) =>
          plan.id === editingPlanId ? { ...plan, ...planPatch } : plan,
        )
      : [
          ...storedPlans,
          {
            id: `plan-${Date.now()}`,
            ...planPatch,
            done: false,
          },
        ];
    this.persistPlans(plans);
    haptic("medium");
    this.setData({
      creating: false,
      editingPlanId: "",
      selectedDate: this.data.startDate,
    });
    this.setTabBarHidden(false);
    const selectedDate = scheduleDateFromKey(this.data.startDate);
    this.setData({ selectedWeekday: currentIsoWeekday(selectedDate) });
    this.rebuildWeek();
  },
  deletePlan() {
    const editingPlanId = this.data.editingPlanId;
    if (!editingPlanId) return;
    wx.showModal({
      title: "删除日程",
      content: "确定删除这个日程？",
      confirmText: "删除",
      confirmColor: "#c0452d",
      success: (result) => {
        if (!result.confirm) return;
        const plans = loadScheduleData(activeAccount).plans.filter(
          (plan) => plan.id !== editingPlanId,
        );
        this.persistPlans(plans);
        haptic("medium");
        this.setData({ creating: false, editingPlanId: "" });
        this.setTabBarHidden(false);
        this.rebuildWeek();
      },
    });
  },
  togglePlan(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const plans = loadScheduleData(activeAccount).plans.map((plan) =>
      plan.id === id ? { ...plan, done: !plan.done } : plan,
    );
    this.persistPlans(plans);
    haptic("light");
    this.applyDay(this.data.selectedWeekday, this.data.days, plans);
  },
});
