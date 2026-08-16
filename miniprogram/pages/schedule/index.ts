import {
  coursesForDate,
  currentIsoWeekday,
  formatClock,
  teachingWeekForDate,
  timeToMinutes,
  type TimetableCourse,
} from "../../data/timetable";
import { getTimetable } from "../../services/teaching";
import { getSession } from "../../store/session";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
} from "../../store/timetable";
import type { TimetableData } from "../../types/api";
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
  hasEntries: boolean;
}

interface LocalPlan {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  done: boolean;
}

interface ScheduleEntry {
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

const STORAGE_KEY = "easy-swu:schedule-plans";
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

function loadPlans(): LocalPlan[] {
  const stored = wx.getStorageSync(STORAGE_KEY);
  return Array.isArray(stored) ? (stored as LocalPlan[]) : [];
}

function savePlans(plans: LocalPlan[]) {
  wx.setStorageSync(STORAGE_KEY, plans);
}

function entryGeometry(startTime: string, endTime: string) {
  const start = Math.max(DAY_START, timeToMinutes(startTime));
  const end = Math.min(DAY_END, Math.max(start + 30, timeToMinutes(endTime)));
  return {
    top: Math.round((start - DAY_START) * RPX_PER_MINUTE),
    height: Math.max(74, Math.round((end - start) * RPX_PER_MINUTE)),
  };
}

function buildEntries(
  timetable: TimetableData | null,
  date: string,
  plans: LocalPlan[],
): ScheduleEntry[] {
  const courses = coursesForDate(timetable, date).map((course) => ({
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
  const planEntries = plans
    .filter((plan) => plan.date === date)
    .map((plan) => ({
      id: plan.id,
      kind: "plan" as const,
      title: plan.title,
      subtitle:
        plan.endDate === plan.date ? "我的安排" : `延续至 ${plan.endDate}`,
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
  return [...courses, ...planEntries].sort(
    (left, right) =>
      timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
  );
}

let activeTimetable: TimetableData | null = null;
let activeAccount = "";
let timetableRequestInFlight = false;

function addHour(value: string): string {
  const total = timeToMinutes(value) + 60;
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    currentTime: formatClock(),
    monthLabel: "",
    teachingWeekLabel: "学期外",
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
  },
  onLoad() {
    this.setData(resolveAppearance());
    this.hydrateTimetable();
    this.rebuildWeek();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
    this.getTabBar().setData({
      selected: 1,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
    this.hydrateTimetable();
    this.rebuildWeek();
    void this.loadTimetable();
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
    try {
      const result = await getTimetable();
      activeTimetable = result.data;
      saveTimetableSnapshot(activeAccount, result.data);
      this.rebuildWeek();
    } catch {
      // 保留本地课表与用户日程，不用加载态打断当前页面。
    } finally {
      timetableRequestInFlight = false;
    }
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const headerScrolled = event.detail.scrollTop > 18;
    if (headerScrolled !== this.data.headerScrolled)
      this.setData({ headerScrolled });
  },
  rebuildWeek() {
    const now = new Date();
    const plans = loadPlans();
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
        hasEntries:
          coursesForDate(activeTimetable, dateKey, now).length > 0 ||
          plans.some((plan) => plan.date === dateKey),
      };
    });
    const selected =
      days.find((day) => day.weekday === this.data.selectedWeekday) || days[0];
    this.setData({
      currentTime: formatClock(now),
      monthLabel: `${now.getMonth() + 1} 月`,
      teachingWeekLabel: (() => {
        const week = teachingWeekForDate(activeTimetable, now);
        return week === null ? "学期外" : `第 ${week} 教学周`;
      })(),
      days,
    });
    this.applyDay(selected.weekday, days, plans);
  },
  applyDay(
    weekday: DayOption["weekday"],
    dayOptions?: DayOption[],
    planOptions?: LocalPlan[],
  ) {
    const days: DayOption[] = dayOptions || this.data.days;
    const plans: LocalPlan[] = planOptions || loadPlans();
    const selected = days.find((day: DayOption) => day.weekday === weekday);
    if (!selected) return;
    this.setData({
      selectedWeekday: weekday,
      selectedDate: selected.date,
      selectedDateLabel: `${formatFriendlyDate(selected.date)}${selected.isToday ? " · 今天" : ""}`,
      entries: buildEntries(activeTimetable, selected.date, plans),
    });
  },
  selectDay(event: WechatMiniprogram.TouchEvent) {
    const weekday = Number(
      event.currentTarget.dataset.weekday,
    ) as DayOption["weekday"];
    if (weekday === this.data.selectedWeekday) return;
    haptic("light");
    this.applyDay(weekday);
  },
  goToday() {
    haptic("light");
    this.applyDay(currentIsoWeekday());
  },
  openTimetable() {
    haptic("light");
    void navigateTo("/pages/timetable/index");
  },
  openCreator() {
    haptic("light");
    const startDate = this.data.selectedDate;
    this.setData({
      creating: true,
      title: "",
      startDate,
      endDate: startDate,
      startTime: "20:00",
      endTime: "21:00",
    });
  },
  closeCreator() {
    this.setData({ creating: false });
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  onStartDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({
      startDate: event.detail.value,
      endDate: event.detail.value,
    });
  },
  onEndDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endDate: event.detail.value });
  },
  onStartTimeChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const startTime = event.detail.value;
    this.setData({ startTime, endTime: addHour(startTime) });
  },
  onEndTimeChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endTime: event.detail.value });
  },
  addPlan() {
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
    const plans = loadPlans();
    plans.push({
      id: `plan-${Date.now()}`,
      title,
      date: this.data.startDate,
      startTime: this.data.startTime,
      endDate: this.data.endDate,
      endTime: this.data.endTime,
      done: false,
    });
    savePlans(plans);
    haptic("medium");
    this.setData({ creating: false, selectedDate: this.data.startDate });
    const selectedDate = new Date(`${this.data.startDate}T12:00:00`);
    this.setData({ selectedWeekday: currentIsoWeekday(selectedDate) });
    this.rebuildWeek();
  },
  togglePlan(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const plans = loadPlans().map((plan) =>
      plan.id === id ? { ...plan, done: !plan.done } : plan,
    );
    savePlans(plans);
    haptic("light");
    this.applyDay(this.data.selectedWeekday, this.data.days, plans);
  },
});
