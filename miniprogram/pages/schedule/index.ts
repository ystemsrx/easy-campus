import {
  coursesForDate,
  currentIsoWeekday,
  formatClock,
  teachingWeekForDate,
  timeToMinutes,
  type TimetableCourse,
} from "../../data/timetable";
import {
  defaultPlanEnd,
  layoutScheduleOverlaps,
  nextWholeHour,
  vacationLabelForDate,
  type ScheduleColumnLayout,
} from "../../data/schedule";
import {
  getLocalSchedule,
  getTimetable,
  putLocalSchedule,
} from "../../services/teaching";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  WEEK_MS,
} from "../../store/cache-policy";
import {
  loadScheduleData,
  saveScheduleData,
  storeScheduleData,
} from "../../store/schedule";
import { getSession } from "../../store/session";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
} from "../../store/timetable";
import type { LocalSchedulePlan, TimetableData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatFriendlyDate, toDateString } from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

interface DayOption {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortLabel: string;
  dateLabel: string;
  date: string;
  isToday: boolean;
  hasPlan: boolean;
}

interface ScheduleEntryBase {
  id: string;
  kind: "course" | "plan";
  title: string;
  subtitle: string;
  startTime: string;
  endTime: string;
  timeLabel: string;
  tone: TimetableCourse["tone"] | "plan";
  done: boolean;
  top: number;
  height: number;
}

interface ScheduleEntry extends ScheduleEntryBase, ScheduleColumnLayout {
  displayMeta: string;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const DAY_START = 8 * 60;
const DAY_END = 22 * 60 + 30;
const RPX_PER_MINUTE = 1.55;

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = date.getDay() || 7;
  monday.setDate(monday.getDate() - weekday + 1);
  return monday;
}

function entryGeometry(startTime: string, endTime: string) {
  const start = Math.max(DAY_START, timeToMinutes(startTime));
  const end = Math.min(DAY_END, Math.max(start + 30, timeToMinutes(endTime)));
  return {
    top: Math.round((start - DAY_START) * RPX_PER_MINUTE),
    height: Math.max(74, Math.round((end - start) * RPX_PER_MINUTE)),
  };
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function buildEntries(
  timetable: TimetableData | null,
  date: string,
  plans: LocalSchedulePlan[],
): ScheduleEntry[] {
  const selectedDate = dateFromKey(date);
  const courses: ScheduleEntryBase[] = coursesForDate(
    timetable,
    date,
    selectedDate,
  ).map((course) => ({
    id: course.id,
    kind: "course" as const,
    title: course.name,
    subtitle: `${course.location} · ${course.teacher}`,
    startTime: course.startTime,
    endTime: course.endTime,
    timeLabel: `${course.periodLabel} · ${course.startTime}–${course.endTime}`,
    tone: course.tone,
    done: false,
    ...entryGeometry(course.startTime, course.endTime),
  }));
  const planEntries: ScheduleEntryBase[] = plans
    .filter((plan) => plan.date === date)
    .map((plan) => ({
      id: plan.id,
      kind: "plan" as const,
      title: plan.title,
      subtitle:
        plan.endDate === plan.date ? "日程" : `日程 · 延续至 ${plan.endDate}`,
      startTime: plan.startTime,
      endTime: plan.endTime,
      timeLabel: `${plan.startTime}–${plan.endDate === plan.date ? "" : "次日 "}${plan.endTime}`,
      tone: "plan" as const,
      done: plan.done,
      ...entryGeometry(
        plan.startTime,
        plan.endDate === plan.date ? plan.endTime : "22:30",
      ),
    }));
  return layoutScheduleOverlaps([...courses, ...planEntries]).map((entry) => ({
    ...entry,
    displayMeta: entry.compact
      ? entry.timeLabel
      : `${entry.timeLabel} · ${entry.subtitle}`,
  }));
}

let activeTimetable: TimetableData | null = null;
let activeAccount = "";
let timetableRequestInFlight = false;
let scheduleSyncInFlight = false;

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    currentTime: formatClock(),
    monthLabel: "",
    teachingWeekLabel: "",
    days: [] as DayOption[],
    selectedWeekday: currentIsoWeekday(),
    selectedDate: toDateString(new Date()),
    selectedDateLabel: "",
    entries: [] as ScheduleEntry[],
    timelineHeight: Math.round((DAY_END - DAY_START) * RPX_PER_MINUTE),
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
    this.hydrateTimetable();
    this.rebuildWeek();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({
        selected: 1,
        themeClass: this.data.themeClass,
        motionClass: this.data.motionClass,
        hidden: false,
      });
    }
    this.hydrateTimetable();
    this.rebuildWeek();
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
    if (!account || account === activeAccount) return;
    activeAccount = account;
    activeTimetable = loadTimetableSnapshot(account)?.data || null;
  },
  async loadTimetable() {
    if (timetableRequestInFlight) return;
    timetableRequestInFlight = true;
    let shouldRefreshAfterward = false;
    try {
      const result = await getTimetable();
      const local = loadTimetableSnapshot(activeAccount);
      if (shouldUseServerSnapshot(local, result.meta.fetchedAt)) {
        activeTimetable = result.data;
        saveTimetableSnapshot(activeAccount, result.data, {
          serverFetchedAt: result.meta.fetchedAt,
        });
        this.rebuildWeek();
      }
      const current = loadTimetableSnapshot(activeAccount);
      shouldRefreshAfterward =
        isCacheStale(current, WEEK_MS) &&
        claimAutomaticRefresh("timetable", activeAccount);
    } catch {
      // 保留本地课表与用户日程，不用加载态打断当前页面。
    } finally {
      timetableRequestInFlight = false;
      if (shouldRefreshAfterward) {
        setTimeout(() => void this.refreshTimetable(), 0);
      }
    }
  },
  async refreshTimetable() {
    if (timetableRequestInFlight) return;
    timetableRequestInFlight = true;
    try {
      const result = await getTimetable({ refresh: true });
      activeTimetable = result.data;
      saveTimetableSnapshot(activeAccount, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
      });
      this.rebuildWeek();
    } catch {
      // 周期刷新失败时继续使用旧课表。
    } finally {
      timetableRequestInFlight = false;
    }
  },
  async syncSchedule() {
    if (scheduleSyncInFlight || !activeAccount) return;
    scheduleSyncInFlight = true;
    try {
      const local = loadScheduleData(activeAccount);
      const result = await getLocalSchedule();
      if (local.clientUpdatedAt) {
        if (JSON.stringify(local) !== JSON.stringify(result.data)) {
          await putLocalSchedule(local);
        }
      } else if (result.data.clientUpdatedAt || result.data.plans.length) {
        storeScheduleData(activeAccount, result.data);
        this.rebuildWeek();
      }
    } catch {
      // 日程以本地状态为准，服务端暂不可用时等待下次进入再同步。
    } finally {
      scheduleSyncInFlight = false;
    }
  },
  persistPlans(plans: LocalSchedulePlan[]) {
    const data = saveScheduleData(activeAccount, plans);
    void putLocalSchedule(data).catch(() => {
      // 本地写入已经完成，服务端将在下次进入页面时追平。
    });
  },
  rebuildWeek() {
    const now = new Date();
    const plans = loadScheduleData(activeAccount).plans;
    const monday = mondayOf(now);
    const todayKey = toDateString(now);
    const days = DAY_LABELS.map((shortLabel, index) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + index);
      const weekday = (index + 1) as DayOption["weekday"];
      const dateKey = toDateString(date);
      return {
        weekday,
        shortLabel,
        dateLabel: String(date.getDate()),
        date: dateKey,
        isToday: dateKey === todayKey,
        hasPlan: plans.some((plan) => plan.date === dateKey),
      };
    });
    const selected =
      days.find((day) => day.weekday === this.data.selectedWeekday) || days[0];
    this.setData({
      currentTime: formatClock(now),
      days,
    });
    this.applyDay(selected.weekday, days, plans);
  },
  applyDay(
    weekday: DayOption["weekday"],
    dayOptions?: DayOption[],
    planOptions?: LocalSchedulePlan[],
  ) {
    const days: DayOption[] = dayOptions || this.data.days;
    const plans: LocalSchedulePlan[] =
      planOptions || loadScheduleData(activeAccount).plans;
    const selected = days.find((day: DayOption) => day.weekday === weekday);
    if (!selected) return;
    const selectedDate = dateFromKey(selected.date);
    const teachingWeek = teachingWeekForDate(activeTimetable, selectedDate);
    this.setData({
      selectedWeekday: weekday,
      selectedDate: selected.date,
      monthLabel: `${selectedDate.getMonth() + 1} 月`,
      teachingWeekLabel:
        teachingWeek === null
          ? vacationLabelForDate(activeTimetable, selected.date) || ""
          : `第 ${teachingWeek} 教学周`,
      selectedDateLabel: `${formatFriendlyDate(selected.date)}${selected.isToday ? " · 今天" : ""}`,
      entries: buildEntries(activeTimetable, selected.date, plans),
    });
  },
  selectDay(event: WechatMiniprogram.TouchEvent) {
    const weekday = Number(
      event.currentTarget.dataset.weekday,
    ) as DayOption["weekday"];
    if (weekday === this.data.selectedWeekday) return;
    this.applyDay(weekday);
  },
  goToday() {
    haptic("light");
    this.applyDay(currentIsoWeekday());
  },
  openTimetable() {
    haptic("light");
    void navigateTo("/pages/timetable/index?source=schedule");
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
    const selectedDate = dateFromKey(this.data.startDate);
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
