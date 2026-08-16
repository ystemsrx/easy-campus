import {
  coursesForWeek,
  currentIsoWeekday,
  currentMinutes,
  formatClock,
  teachingWeekForDate,
  timeToMinutes,
  weekDateKeys,
  type TimetableCourse,
} from "../../data/timetable";
import { getTimetable } from "../../services/teaching";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  WEEK_MS,
} from "../../store/cache-policy";
import { getSession } from "../../store/session";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
  type TimetableSnapshot,
} from "../../store/timetable";
import type { TimetableData } from "../../types/api";
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

interface GridCourse extends TimetableCourse {
  top: number;
  height: number;
}

interface GridDay extends DayOption {
  courses: GridCourse[];
}

interface TimeMark {
  label: string;
  top: number;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
let activeTimetable: TimetableData | null = null;
let visibleCourses: TimetableCourse[] = [];
let clockTimer: number | undefined;
let requestInFlight = false;
let activeAccount = "";
let defaultSemesterId = "";
let activeSnapshot: TimetableSnapshot | null = null;

function gridLayout(courses: TimetableCourse[]) {
  const valid = courses.filter(
    (course) => course.startTime !== "--:--" && course.endTime !== "--:--",
  );
  const earliest = valid.length
    ? Math.min(...valid.map((course) => timeToMinutes(course.startTime)))
    : 8 * 60;
  const latest = valid.length
    ? Math.max(...valid.map((course) => timeToMinutes(course.endTime)))
    : 22 * 60;
  const start = Math.max(0, Math.floor((earliest - 60) / 120) * 120);
  const end = Math.min(24 * 60, Math.ceil((latest + 60) / 120) * 120);
  const height = Math.max(480, end - start);
  const marks: TimeMark[] = [];
  for (let minute = start; minute <= end; minute += 120) {
    marks.push({
      label: `${String(Math.floor(minute / 60)).padStart(2, "0")}:00`,
      top: minute - start,
    });
  }
  return { start, height, marks };
}

function toGridCourse(course: TimetableCourse, gridStart: number): GridCourse {
  const start = timeToMinutes(course.startTime);
  const end = timeToMinutes(course.endTime);
  return {
    ...course,
    top: Math.max(0, start - gridStart),
    height: Math.max(58, end - start),
  };
}

function buildDays(
  timetable: TimetableData | null,
  week: number,
  courses: TimetableCourse[],
): DayOption[] {
  const todayKey = toDateString(new Date());
  const dateKeys = weekDateKeys(timetable, week);
  return DAY_LABELS.map((shortLabel, index) => {
    const weekday = (index + 1) as DayOption["weekday"];
    const date = dateKeys[index] || "";
    return {
      weekday,
      shortLabel,
      dateLabel: date ? String(Number(date.slice(-2))) : "—",
      date,
      isToday: date === todayKey,
      hasCourses: courses.some((course) =>
        date ? course.date === date : course.weekday === weekday,
      ),
    };
  });
}

function coursesForDay(
  courses: TimetableCourse[],
  day: DayOption,
): TimetableCourse[] {
  return courses.filter((course) =>
    day.date ? course.date === day.date : course.weekday === day.weekday,
  );
}

function toCourseView(course: TimetableCourse, now: Date): CourseView {
  const todayKey = toDateString(now);
  if (course.date && course.date !== todayKey) {
    return { ...course, state: "upcoming", stateLabel: course.periodLabel };
  }
  if (!course.date && course.weekday !== currentIsoWeekday(now)) {
    return { ...course, state: "upcoming", stateLabel: course.periodLabel };
  }
  const timestamp = now.getTime();
  if (
    course.startAt &&
    course.endAt &&
    timestamp >= new Date(course.startAt).getTime() &&
    timestamp < new Date(course.endAt).getTime()
  ) {
    return { ...course, state: "current", stateLabel: "进行中" };
  }
  if (course.endAt && timestamp >= new Date(course.endAt).getTime()) {
    return { ...course, state: "finished", stateLabel: "已结束" };
  }
  if (!course.startAt) {
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
    semesterLabel: "课表",
    semesterId: "",
    semesters: [] as TimetableData["semesters"],
    weekNumber: 1,
    weekLabel: "第 1 教学周",
    maxWeek: 1,
    canPreviousWeek: false,
    canNextWeek: false,
    days: [] as DayOption[],
    selectedWeekday: currentIsoWeekday(),
    selectedDateLabel: "",
    courses: [] as CourseView[],
    courseCount: 0,
    totalCourseCount: 0,
    gridDays: [] as GridDay[],
    gridHeight: 840,
    timeMarks: [] as TimeMark[],
    statusCaption: "正在读取已保存的课表",
    emptyDescription: "课表同步后会显示在这里",
    selectedCourse: null as TimetableCourse | null,
    courseSheetVisible: false,
  },
  onLoad() {
    activeAccount = "";
    activeTimetable = null;
    activeSnapshot = null;
    defaultSemesterId = "";
    this.setData(resolveAppearance());
    this.hydrate();
    void this.loadTimetable(false);
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
    this.hydrate();
    this.updateClock();
    this.stopClock();
    clockTimer = setInterval(
      () => this.updateClock(),
      30000,
    ) as unknown as number;
    if (!activeTimetable) void this.loadTimetable(false);
  },
  onHide() {
    this.stopClock();
  },
  onUnload() {
    this.stopClock();
  },
  hydrate() {
    const account = getSession()?.user.account || "";
    if (!account || account === activeAccount) return;
    activeAccount = account;
    activeSnapshot = loadTimetableSnapshot(account);
    activeTimetable = activeSnapshot?.data || null;
    defaultSemesterId = activeTimetable?.semester.id || "";
    if (activeTimetable) this.applyTimetable(activeTimetable, false);
  },
  async loadTimetable(refresh: boolean, semester?: string) {
    if (requestInFlight) return;
    requestInFlight = true;
    let shouldRefreshAfterward = false;
    try {
      const result = await getTimetable({ semester, refresh });
      const local = loadTimetableSnapshot(activeAccount, semester);
      if (refresh || shouldUseServerSnapshot(local, result.meta.fetchedAt)) {
        activeSnapshot = saveTimetableSnapshot(activeAccount, result.data, {
          semesterId: semester,
          serverFetchedAt: result.meta.fetchedAt,
        });
        activeTimetable = result.data;
        if (!semester) defaultSemesterId = result.data.semester.id;
        this.applyTimetable(result.data, !semester);
      } else if (!activeTimetable && local) {
        activeSnapshot = local;
        activeTimetable = local.data;
        this.applyTimetable(local.data, !semester);
      }
      const current =
        loadTimetableSnapshot(activeAccount, semester) || activeSnapshot;
      shouldRefreshAfterward =
        !refresh &&
        !semester &&
        isCacheStale(current, WEEK_MS) &&
        claimAutomaticRefresh("timetable", activeAccount);
    } catch {
      if (!activeTimetable) {
        this.setData({
          statusCaption: "课表暂时不可用",
          emptyDescription: "请稍后下拉或重新进入页面",
        });
      }
    } finally {
      requestInFlight = false;
      if (shouldRefreshAfterward) {
        setTimeout(() => void this.loadTimetable(true), 0);
      }
    }
  },
  applyTimetable(timetable: TimetableData, preserveWeek: boolean) {
    const detectedWeek = teachingWeekForDate(timetable);
    const maxWeek = Math.max(1, timetable.summary.maxWeek);
    const weekNumber = Math.min(
      maxWeek,
      Math.max(
        1,
        preserveWeek && this.data.semesterId === timetable.semester.id
          ? this.data.weekNumber
          : detectedWeek || 1,
      ),
    );
    this.setData({
      semesterLabel: timetable.semester.label,
      semesterId: timetable.semester.id,
      semesters: timetable.semesters,
      totalCourseCount: timetable.summary.courseCount,
      maxWeek,
      statusCaption:
        detectedWeek === null
          ? "周期课表按节次展示 · 开学后换算设备时区"
          : "已同步教务系统 · 时间按用户所在时区展示",
      emptyDescription: "本周这一天没有课程",
    });
    this.applyWeek(weekNumber, new Date());
  },
  stopClock() {
    if (clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  },
  updateClock() {
    this.setData({ currentTime: formatClock() });
    if (activeTimetable) this.applyWeek(this.data.weekNumber, new Date());
  },
  applyWeek(week: number, now: Date) {
    const maxWeek = Math.max(1, this.data.maxWeek);
    const weekNumber = Math.min(maxWeek, Math.max(1, week));
    visibleCourses = coursesForWeek(activeTimetable, weekNumber);
    const days = buildDays(activeTimetable, weekNumber, visibleCourses);
    const layout = gridLayout(visibleCourses);
    let selectedWeekday = this.data.selectedWeekday;
    if (!days.some((day) => day.weekday === selectedWeekday)) {
      selectedWeekday = currentIsoWeekday(now);
    }
    const detectedWeek = teachingWeekForDate(activeTimetable, now);
    if (detectedWeek === weekNumber) selectedWeekday = currentIsoWeekday(now);
    this.setData({
      weekNumber,
      weekLabel: `第 ${weekNumber} 教学周`,
      canPreviousWeek: weekNumber > 1,
      canNextWeek: weekNumber < maxWeek,
      days,
      gridDays: days.map((day) => ({
        ...day,
        courses: coursesForDay(visibleCourses, day).map((course) =>
          toGridCourse(course, layout.start),
        ),
      })),
      gridHeight: layout.height,
      timeMarks: layout.marks,
      selectedWeekday,
    });
    this.applyDay(selectedWeekday, now, days);
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
  applyDay(weekday: DayOption["weekday"], now: Date, dayOptions?: DayOption[]) {
    const days = dayOptions || this.data.days;
    const selectedDay = days.find((day) => day.weekday === weekday);
    if (!selectedDay) return;
    const courses = coursesForDay(visibleCourses, selectedDay).map((course) =>
      toCourseView(course, now),
    );
    this.setData({
      selectedWeekday: weekday,
      selectedDateLabel: selectedDay.date
        ? `${formatFriendlyDate(selectedDay.date)}${selectedDay.isToday ? " · 今天" : ""}`
        : `周${DAY_LABELS[weekday - 1]} · 第 ${this.data.weekNumber} 教学周`,
      courses,
      courseCount: courses.length,
    });
  },
  changeWeek(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (!Number.isFinite(delta)) return;
    const next = this.data.weekNumber + delta;
    if (next < 1 || next > this.data.maxWeek) return;
    haptic("light");
    this.applyWeek(next, new Date());
  },
  selectSemester(event: WechatMiniprogram.TouchEvent) {
    const semester = String(event.currentTarget.dataset.semester || "");
    if (!semester || semester === this.data.semesterId) return;
    haptic("light");
    const querySemester = semester === defaultSemesterId ? undefined : semester;
    const cached = loadTimetableSnapshot(activeAccount, querySemester);
    if (cached) {
      activeSnapshot = cached;
      activeTimetable = cached.data;
      this.applyTimetable(cached.data, false);
    }
    void this.loadTimetable(false, querySemester);
  },
  goToday() {
    haptic("light");
    const currentWeek = teachingWeekForDate(activeTimetable);
    if (currentWeek !== null) {
      this.applyWeek(currentWeek, new Date());
      return;
    }
    this.applyDay(currentIsoWeekday(), new Date());
  },
  onRefresh() {
    haptic("light");
    void this.loadTimetable(
      true,
      this.data.semesterId === defaultSemesterId
        ? undefined
        : this.data.semesterId || undefined,
    );
  },
  openCourse(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const course = visibleCourses.find((item) => item.id === id);
    if (!course) return;
    haptic("light");
    this.setData({ selectedCourse: course, courseSheetVisible: true });
  },
  closeCourse() {
    this.setData({ courseSheetVisible: false, selectedCourse: null });
  },
});
