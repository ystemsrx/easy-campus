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
import { loadScheduleData, saveScheduleData } from "../../store/schedule";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  type SessionLease,
} from "../../store/session";
import {
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
let skipNextScheduleRebuild = false;
let activeSchedulePrewarmRevision = 0;
let activeTimetableStoredAt = 0;
let activeScheduleUpdatedAt: string | null = null;

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
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
    this.setData(resolveAppearance());
    const account = getSession()?.user.account || "";
    const prewarmed = getPrewarmedScheduleFirstScreen(account);
    if (prewarmed) {
      activeAccount = account;
      activeTimetable = prewarmed.timetable;
      activeSchedulePrewarmRevision = prewarmed.revision;
      activeTimetableStoredAt = prewarmed.timetableStoredAt;
      activeScheduleUpdatedAt = prewarmed.scheduleUpdatedAt;
      this.setData(prewarmed.view);
    } else {
      activeSchedulePrewarmRevision = 0;
      activeTimetableStoredAt = 0;
      activeScheduleUpdatedAt = null;
      this.hydrateTimetable();
      this.rebuildWeek();
    }
    skipNextScheduleRebuild = true;
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
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
    this.hydrateTimetable();
    if (skipNextScheduleRebuild) {
      skipNextScheduleRebuild = false;
    } else {
      this.rebuildWeek();
    }
    void this.loadTimetable();
    void this.syncSchedule();
  },
  onHide() {
    this.setData({ creating: false, editingPlanId: "" });
    this.setTabBarHidden(false);
  },
  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden });
  },
  hydrateTimetable() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    if (account !== activeAccount) {
      activeAccount = account;
      const snapshot = loadTimetableSnapshot(account);
      activeTimetable = snapshot?.data || null;
      activeTimetableStoredAt = snapshot?.localStoredAt || 0;
    } else if (!activeTimetable) {
      const snapshot = loadTimetableSnapshot(account);
      activeTimetable = snapshot?.data || null;
      activeTimetableStoredAt = snapshot?.localStoredAt || 0;
    }
  },
  applyPrewarmedSchedule() {
    const prewarmed = getPrewarmedScheduleFirstScreen(activeAccount);
    if (!prewarmed || prewarmed.revision === activeSchedulePrewarmRevision) {
      return false;
    }
    activeTimetable = prewarmed.timetable;
    activeSchedulePrewarmRevision = prewarmed.revision;
    activeTimetableStoredAt = prewarmed.timetableStoredAt;
    activeScheduleUpdatedAt = prewarmed.scheduleUpdatedAt;
    this.setData(prewarmed.view);
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
          if (isSessionLeaseCurrent(lease) && activeAccount === lease.account) {
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
      this.rebuildWeek();
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
      if (!isSessionLeaseCurrent(lease) || activeAccount !== lease.account) {
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
