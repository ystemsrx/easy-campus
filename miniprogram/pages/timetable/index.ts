import {
  coursesForWeekday,
  currentIsoWeekday,
  currentMinutes,
  formatClock,
  timeToMinutes,
  type TimetableCourse,
} from "../../data/timetable";
import { resolveAppearance } from "../../utils/appearance";
import { formatFriendlyDate, toDateString } from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface DayOption {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortLabel: string;
  dateLabel: string;
  date: string;
  isToday: boolean;
  hasCourses: boolean;
}

interface CourseView extends TimetableCourse {
  state: "current" | "upcoming" | "finished";
  stateLabel: string;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
let clockTimer: number | undefined;

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = date.getDay() || 7;
  monday.setDate(monday.getDate() - weekday + 1);
  return monday;
}

function buildDays(now: Date): DayOption[] {
  const monday = mondayOf(now);
  const todayKey = toDateString(now);
  return DAY_LABELS.map((shortLabel, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const weekday = (index + 1) as DayOption["weekday"];
    return {
      weekday,
      shortLabel,
      dateLabel: String(date.getDate()),
      date: toDateString(date),
      isToday: toDateString(date) === todayKey,
      hasCourses: coursesForWeekday(weekday).length > 0,
    };
  });
}

function toCourseView(
  course: TimetableCourse,
  selectedWeekday: number,
  now: Date,
): CourseView {
  if (selectedWeekday !== currentIsoWeekday(now)) {
    return { ...course, state: "upcoming", stateLabel: course.periodLabel };
  }
  const minutes = currentMinutes(now);
  if (
    minutes >= timeToMinutes(course.startTime) &&
    minutes < timeToMinutes(course.endTime)
  ) {
    return { ...course, state: "current", stateLabel: "进行中" };
  }
  if (minutes >= timeToMinutes(course.endTime)) {
    return { ...course, state: "finished", stateLabel: "已结束" };
  }
  return { ...course, state: "upcoming", stateLabel: course.periodLabel };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    currentTime: formatClock(),
    days: [] as DayOption[],
    selectedWeekday: currentIsoWeekday(),
    selectedDateLabel: "",
    courses: [] as CourseView[],
    courseCount: 0,
  },
  onLoad() {
    this.setData(resolveAppearance());
    const now = new Date();
    const days = buildDays(now);
    this.setData({ days });
    this.applyDay(currentIsoWeekday(now), now);
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
    this.updateClock();
    this.stopClock();
    clockTimer = setInterval(
      () => this.updateClock(),
      30000,
    ) as unknown as number;
  },
  onHide() {
    this.stopClock();
  },
  onUnload() {
    this.stopClock();
  },
  stopClock() {
    if (clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  },
  updateClock() {
    const now = new Date();
    const days = buildDays(now);
    this.setData({ currentTime: formatClock(now), days });
    this.applyDay(this.data.selectedWeekday, now);
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  selectDay(event: WechatMiniprogram.TouchEvent) {
    const weekday = Number(
      event.currentTarget.dataset.weekday,
    ) as DayOption["weekday"];
    if (weekday === this.data.selectedWeekday) return;
    haptic("light");
    this.applyDay(weekday, new Date());
  },
  applyDay(weekday: DayOption["weekday"], now: Date) {
    const selectedDay = this.data.days.find((day) => day.weekday === weekday);
    const courses = coursesForWeekday(weekday).map((course) =>
      toCourseView(course, weekday, now),
    );
    this.setData({
      selectedWeekday: weekday,
      selectedDateLabel: selectedDay
        ? `${formatFriendlyDate(selectedDay.date)}${selectedDay.isToday ? " · 今天" : ""}`
        : `周${DAY_LABELS[weekday - 1]}`,
      courses,
      courseCount: courses.length,
    });
  },
  goToday() {
    haptic("light");
    this.applyDay(currentIsoWeekday(), new Date());
  },
});
