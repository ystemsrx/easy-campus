import {
  coursesForWeek,
  layoutGridCourseText,
  teachingWeekForDate,
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
import type {
  AcademicSemesterOption,
  TimetableData,
  TimetablePeriod,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

interface DayOption {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortLabel: string;
  dateLabel: string;
  date: string;
  isToday: boolean;
}

interface GridCourse extends TimetableCourse {
  topPercent: string;
  heightPercent: string;
  nameRows: Array<{ key: string; text: string }>;
  locationRows: Array<{ key: string; text: string }>;
  teacherRows: Array<{ key: string; text: string }>;
  nameLines: number;
  nameStyle: string;
  locationStyle: string;
  teacherStyle: string;
}

interface GridDay extends DayOption {
  courses: GridCourse[];
}

interface WeekPage {
  weekNumber: number;
  monthNumber: string;
  startDateLabel: string;
  days: DayOption[];
  gridDays: GridDay[];
}

interface PeriodRow {
  period: number;
  startTime: string;
  endTime: string;
}

interface TimetableThemeOption {
  id: string;
  label: string;
  color: string;
  image: boolean;
}

interface GridLayoutMetrics {
  rowHeightPx: number;
  nameFontSizePx: number;
  locationFontSizePx: number;
  teacherFontSizePx: number;
  contentWidthPx: number;
  contentInsetPx: number;
  scale: number;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const THEME_STORAGE_KEY = "easy-swu:timetable-theme";
const BACKGROUND_WIDTH = 854;
const BACKGROUND_HEIGHT = 1920;
const MAIN_MENU_HEIGHT = 478;
const THEMES: TimetableThemeOption[] = [
  { id: "image", label: "默认壁纸", color: "#0862ad", image: true },
  { id: "ocean", label: "深海", color: "#17588f", image: false },
  { id: "azure", label: "晴空", color: "#3478ae", image: false },
  { id: "forest", label: "松林", color: "#416f68", image: false },
  { id: "plum", label: "暮紫", color: "#655b82", image: false },
];

let activeTimetable: TimetableData | null = null;
let visibleCourses: TimetableCourse[] = [];
const timetableRequestsInFlight = new Set<string>();
let activeAccount = "";
let defaultSemesterId = "";
let activeSnapshot: TimetableSnapshot | null = null;
let weekMenuOpenTimer: ReturnType<typeof setTimeout> | undefined;
let weekMenuUnmountTimer: ReturnType<typeof setTimeout> | undefined;
let visibleRequestSequence = 0;
let pendingVisibleRequestId: number | null = null;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function shortSemesterLabel(semester: AcademicSemesterOption | null): string {
  if (!semester) return "选择学期";
  const start = pad(semester.academicYear % 100);
  const end = pad((semester.academicYear + 1) % 100);
  const term = semester.term === 1 ? "秋" : semester.term === 2 ? "春" : "夏";
  return `${start}-${end} ${term}`;
}

function buildDays(timetable: TimetableData, week: number): DayOption[] {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const dates = weekDateKeys(timetable, week);
  return DAY_LABELS.map((shortLabel, index) => {
    const date = dates[index] || "";
    return {
      weekday: (index + 1) as DayOption["weekday"],
      shortLabel,
      dateLabel: date ? String(Number(date.slice(-2))) : "—",
      date,
      isToday: date === todayKey,
    };
  });
}

function courseOccursOnDay(course: TimetableCourse, day: DayOption): boolean {
  return day.date ? course.date === day.date : course.weekday === day.weekday;
}

function maxPeriodFor(timetable: TimetableData): number {
  const periods = timetable.periods.map((item) => item.period);
  const coursePeriods = timetable.courses.flatMap((course) =>
    course.arrangements.map((arrangement) => arrangement.periodEnd),
  );
  return Math.max(12, ...periods, ...coursePeriods);
}

function toGridCourse(
  course: TimetableCourse,
  maxPeriod: number,
  metrics: GridLayoutMetrics,
): GridCourse {
  const start = Math.max(1, Math.min(maxPeriod, course.periodStart));
  const end = Math.max(start, Math.min(maxPeriod, course.periodEnd));
  const span = end - start + 1;
  const textLayout = layoutGridCourseText(
    course,
    span * metrics.rowHeightPx,
    metrics,
  );
  return {
    ...course,
    topPercent: (((start - 1) / maxPeriod) * 100).toFixed(5),
    heightPercent: ((span / maxPeriod) * 100).toFixed(5),
    ...textLayout,
  };
}

function gridLayoutMetrics(
  maxPeriod: number,
  headerHeight: number,
): GridLayoutMetrics {
  let viewportWidth = 375;
  let viewportHeight = 667;
  try {
    const windowInfo = wx.getWindowInfo();
    viewportWidth = windowInfo.windowWidth || viewportWidth;
    viewportHeight = windowInfo.windowHeight || viewportHeight;
  } catch {
    // 默认视口仅用于旧基础库，真实设备会读取窗口尺寸。
  }
  const scale = viewportWidth / 750;
  const columnWidth = (viewportWidth - 84 * scale) / 7;
  // 槽内边距 4rpx、课程边框 4rpx、课程内边距 8rpx。
  const contentWidth = Math.max(1, columnWidth - 16 * scale);
  const widthSafetyPx = 1;
  const fittedFontSize = (charactersPerLine: number, maximum: number) =>
    Math.max(
      1,
      Math.min(maximum, (contentWidth - widthSafetyPx) / charactersPerLine),
    );
  const gridHeight = Math.max(160, viewportHeight - headerHeight - 84 * scale);
  return {
    rowHeightPx: gridHeight / Math.max(1, maxPeriod),
    nameFontSizePx: fittedFontSize(3, 15),
    locationFontSizePx: fittedFontSize(3, 14),
    teacherFontSizePx: fittedFontSize(3, 12),
    contentWidthPx: contentWidth,
    // 卡片槽上下内边距 4rpx + 卡片边框 4rpx + 内边距 8rpx。
    contentInsetPx: 16 * scale,
    scale,
  };
}

function submenuHeight(semesterCount: number): number {
  return Math.min(590, Math.max(250, 104 + Math.min(6, semesterCount) * 78));
}

function weekMenuListHeight(weekCount: number): number {
  return Math.min(440, 32 + Math.ceil(Math.max(1, weekCount) / 4) * 82);
}

function hasSelectedSemesterCalendar(timetable: TimetableData): boolean {
  return Boolean(
    (timetable.semesterCalendar?.semesterId === timetable.semester.id &&
      timetable.semesterCalendar.weeks.length) ||
    timetable.currentSemester?.id === timetable.semester.id,
  );
}

function monthNumber(days: DayOption[]): string {
  const datedDays = days.filter((day) => day.date);
  const displayDate = datedDays[datedDays.length - 1]?.date;
  return displayDate ? String(Number(displayDate.slice(5, 7))) : "—";
}

function weekStartDateLabel(days: DayOption[]): string {
  const date = days.find((day) => day.date)?.date;
  return date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "";
}

function buildWeekPage(
  timetable: TimetableData,
  weekNumber: number,
  maxPeriod: number,
  metrics: GridLayoutMetrics,
): WeekPage {
  const courses = coursesForWeek(timetable, weekNumber);
  const days = buildDays(timetable, weekNumber);
  return {
    weekNumber,
    monthNumber: monthNumber(days),
    startDateLabel: weekStartDateLabel(days),
    days,
    gridDays: days.map((day) => ({
      ...day,
      courses: courses
        .filter((course) => courseOccursOnDay(course, day))
        .map((course) => toGridCourse(course, maxPeriod, metrics)),
    })),
  };
}

function buildPeriodRows(
  timetable: TimetableData,
  maxPeriod: number,
  courses: TimetableCourse[],
): PeriodRow[] {
  const source = new Map<number, TimetablePeriod>(
    timetable.periods.map((period) => [period.period, period]),
  );
  const starts = new Map<number, string>();
  const ends = new Map<number, string>();
  for (const course of courses) {
    if (course.startTime !== "--:--")
      starts.set(course.periodStart, course.startTime);
    if (course.endTime !== "--:--") ends.set(course.periodEnd, course.endTime);
  }
  return Array.from({ length: maxPeriod }, (_, index) => {
    const period = index + 1;
    return {
      period,
      startTime: starts.get(period) || source.get(period)?.startTime || "--:--",
      endTime: ends.get(period) || source.get(period)?.endTime || "--:--",
    };
  });
}

function backgroundMetrics(): {
  headerTop: number;
  headerHeight: number;
  headerControlSize: number;
  headerControlCenter: number;
  menuTop: number;
  weekMenuTop: number;
  imageStyle: string;
} {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || menu.top || 24;
    const headerControlSize = menu.height || 32;
    const headerControlTop = menu.top || statusBarHeight + 4;
    const headerControlBottom =
      menu.bottom || headerControlTop + headerControlSize;
    const contentHeight =
      Math.max(0, headerControlTop - statusBarHeight) * 2 + headerControlSize;
    const headerHeight = statusBarHeight + contentHeight;
    const scale = Math.max(
      windowInfo.windowWidth / BACKGROUND_WIDTH,
      windowInfo.windowHeight / BACKGROUND_HEIGHT,
    );
    const width = BACKGROUND_WIDTH * scale;
    const height = BACKGROUND_HEIGHT * scale;
    const left = (windowInfo.windowWidth - width) / 2;
    return {
      headerTop: statusBarHeight,
      headerHeight,
      headerControlSize,
      headerControlCenter: headerControlTop + headerControlSize / 2,
      menuTop: Math.max(headerHeight, headerControlBottom) + 4,
      weekMenuTop: headerControlBottom + 8,
      imageStyle: `width:${width}px;height:${height}px;left:${left}px;top:0px;`,
    };
  } catch {
    return {
      headerTop: 24,
      headerHeight: 64,
      headerControlSize: 32,
      headerControlCenter: 44,
      menuTop: 68,
      weekMenuTop: 68,
      imageStyle: "width:100%;height:100%;left:0;top:0;",
    };
  }
}

function loadThemeId(): string {
  try {
    const saved = String(wx.getStorageSync(THEME_STORAGE_KEY) || "");
    return THEMES.some((theme) => theme.id === saved) ? saved : "image";
  } catch {
    return "image";
  }
}

function themePatch(id: string): {
  timetableThemeId: string;
  useBackgroundImage: boolean;
  backgroundColor: string;
} {
  const selected = THEMES.find((theme) => theme.id === id) || THEMES[0];
  return {
    timetableThemeId: selected.id,
    useBackgroundImage: selected.image,
    backgroundColor: selected.color,
  };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    ...backgroundMetrics(),
    ...themePatch("image"),
    timetableThemes: THEMES,
    menuOpen: false,
    semesterOpen: false,
    weekMenuMounted: false,
    weekMenuOpen: false,
    weekScrollIntoView: "",
    weekMenuListHeight: 114,
    menuHeight: MAIN_MENU_HEIGHT,
    semesterMenuHeight: 250,
    semesterShortLabel: "选择学期",
    semesterId: "",
    semesters: [] as TimetableData["semesters"],
    weekNumber: 1,
    weekIndex: 0,
    weekLabel: "第 1 周",
    maxWeek: 1,
    weekPages: [] as WeekPage[],
    periodRows: [] as PeriodRow[],
    selectedCourse: null as TimetableCourse | null,
    courseSheetVisible: false,
    hasHydrated: false,
  },
  onLoad() {
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    activeAccount = "";
    activeTimetable = null;
    activeSnapshot = null;
    defaultSemesterId = "";
    visibleRequestSequence += 1;
    pendingVisibleRequestId = null;
    this.setData({
      ...resolveAppearance(),
      ...backgroundMetrics(),
      ...themePatch(loadThemeId()),
    });
    this.hydrate();
    this.syncTimetableIfNeeded();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData({ ...resolveAppearance(), ...backgroundMetrics() });
    this.hydrate();
    this.syncTimetableIfNeeded();
  },
  onUnload() {
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
  },
  hydrate() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    if (account === activeAccount) {
      if (!this.data.hasHydrated) this.setData({ hasHydrated: true });
      return;
    }
    activeAccount = account;
    activeSnapshot = loadTimetableSnapshot(account);
    activeTimetable = activeSnapshot?.data || null;
    defaultSemesterId = activeTimetable?.semester.id || "";
    if (activeTimetable) this.applyTimetable(activeTimetable, false);
    this.setData({ hasHydrated: true });
  },
  syncTimetableIfNeeded(semester?: string) {
    if (!activeAccount) return;
    const snapshot =
      loadTimetableSnapshot(activeAccount, semester) ||
      (!semester ? activeSnapshot : null);
    if (!snapshot) {
      void this.loadTimetable(false, semester, !activeTimetable);
      return;
    }
    const needsRefresh =
      isCacheStale(snapshot, WEEK_MS) ||
      !hasSelectedSemesterCalendar(snapshot.data);
    if (
      needsRefresh &&
      claimAutomaticRefresh(`timetable:${semester || "default"}`, activeAccount)
    ) {
      void this.loadTimetable(true, semester);
    }
  },
  async loadTimetable(refresh: boolean, semester?: string, activate = false) {
    const requestAccount = activeAccount;
    if (!requestAccount) return;
    const requestKey = `${requestAccount}:${semester || "default"}`;
    if (timetableRequestsInFlight.has(requestKey)) return;
    timetableRequestsInFlight.add(requestKey);
    const visibleRequestId = activate ? ++visibleRequestSequence : 0;
    if (activate) pendingVisibleRequestId = visibleRequestId;
    let shouldRefreshAfterward = false;
    try {
      const result = await getTimetable({ semester, refresh });
      const local = loadTimetableSnapshot(requestAccount, semester);
      const shouldStore =
        refresh || shouldUseServerSnapshot(local, result.meta.fetchedAt);
      let stored = local;
      if (shouldStore) {
        stored = saveTimetableSnapshot(requestAccount, result.data, {
          semesterId: semester,
          serverFetchedAt: result.meta.fetchedAt,
        });
      }
      const stillViewingResult = activate
        ? activeAccount === requestAccount &&
          pendingVisibleRequestId === visibleRequestId
        : activeAccount === requestAccount &&
          pendingVisibleRequestId === null &&
          (!activeTimetable ||
            !this.data.semesterId ||
            this.data.semesterId === result.data.semester.id);
      if (shouldStore && stillViewingResult) {
        if (activate) pendingVisibleRequestId = null;
        activeSnapshot = stored;
        activeTimetable = result.data;
        if (!semester) defaultSemesterId = result.data.semester.id;
        this.applyTimetable(result.data, refresh || !semester);
      } else if (stillViewingResult && !activeTimetable && local) {
        if (activate) pendingVisibleRequestId = null;
        activeSnapshot = local;
        activeTimetable = local.data;
        this.applyTimetable(local.data, !semester);
      }
      const current =
        loadTimetableSnapshot(requestAccount, semester) ||
        (activeAccount === requestAccount ? activeSnapshot : null);
      shouldRefreshAfterward =
        !refresh &&
        current !== null &&
        (isCacheStale(current, WEEK_MS) ||
          !hasSelectedSemesterCalendar(current.data)) &&
        claimAutomaticRefresh(
          `timetable:${semester || "default"}`,
          requestAccount,
        );
    } catch {
      if (activate && pendingVisibleRequestId === visibleRequestId) {
        pendingVisibleRequestId = null;
      }
      if (!activeTimetable) {
        wx.showToast({ title: "课表暂时不可用", icon: "none" });
      }
    } finally {
      if (activate && pendingVisibleRequestId === visibleRequestId) {
        pendingVisibleRequestId = null;
      }
      timetableRequestsInFlight.delete(requestKey);
      if (shouldRefreshAfterward) {
        setTimeout(() => void this.loadTimetable(true, semester), 0);
      }
    }
  },
  applyTimetable(timetable: TimetableData, preserveWeek: boolean) {
    const maxWeek = Math.max(
      1,
      timetable.summary.maxWeek,
      timetable.semesterCalendar?.totalWeeks || 0,
    );
    const detectedWeek = teachingWeekForDate(timetable);
    const weekNumber = Math.min(
      maxWeek,
      Math.max(
        1,
        preserveWeek && this.data.semesterId === timetable.semester.id
          ? this.data.weekNumber
          : detectedWeek || 1,
      ),
    );
    const maxPeriod = maxPeriodFor(timetable);
    const layoutMetrics = gridLayoutMetrics(
      maxPeriod,
      Number(this.data.headerHeight) || 64,
    );
    const periodCourses = coursesForWeek(timetable, weekNumber);
    const weekPages = Array.from({ length: maxWeek }, (_, index) =>
      buildWeekPage(timetable, index + 1, maxPeriod, layoutMetrics),
    );
    visibleCourses = periodCourses;
    this.setData({
      semesterShortLabel: shortSemesterLabel(timetable.semester),
      semesterId: timetable.semester.id,
      semesters: timetable.semesters,
      semesterMenuHeight: submenuHeight(timetable.semesters.length),
      weekNumber,
      weekIndex: weekNumber - 1,
      weekLabel: `第 ${weekNumber} 周`,
      maxWeek,
      weekMenuListHeight: weekMenuListHeight(maxWeek),
      periodRows: buildPeriodRows(timetable, maxPeriod, periodCourses),
      weekPages,
    });
  },
  setWeek(weekNumber: number, feedback = false) {
    if (!activeTimetable) return;
    const normalizedWeek = Math.min(
      this.data.maxWeek,
      Math.max(1, Math.floor(weekNumber)),
    );
    visibleCourses = coursesForWeek(activeTimetable, normalizedWeek);
    this.setData({
      weekNumber: normalizedWeek,
      weekIndex: normalizedWeek - 1,
      weekLabel: `第 ${normalizedWeek} 周`,
      periodRows: buildPeriodRows(
        activeTimetable,
        this.data.periodRows.length || maxPeriodFor(activeTimetable),
        visibleCourses,
      ),
    });
    if (feedback) haptic("light");
  },
  onWeekChange(event: WechatMiniprogram.SwiperChange) {
    if (!activeTimetable) return;
    const weekNumber = Math.min(
      this.data.maxWeek,
      Math.max(1, Number(event.detail.current) + 1),
    );
    if (weekNumber === this.data.weekNumber) return;
    this.setWeek(weekNumber, true);
  },
  selectWeek(event: WechatMiniprogram.TouchEvent) {
    const weekNumber = Number(event.currentTarget.dataset.week);
    this.closeWeekMenu();
    if (
      !Number.isInteger(weekNumber) ||
      weekNumber < 1 ||
      weekNumber > this.data.maxWeek ||
      weekNumber === this.data.weekNumber
    ) {
      return;
    }
    this.setWeek(weekNumber, true);
  },
  selectSemester(event: WechatMiniprogram.TouchEvent) {
    const semester = String(event.currentTarget.dataset.semester || "");
    this.setData({
      menuOpen: false,
      semesterOpen: false,
      menuHeight: MAIN_MENU_HEIGHT,
    });
    if (!semester || semester === this.data.semesterId) return;
    haptic("light");
    const querySemester = semester === defaultSemesterId ? undefined : semester;
    const cached = loadTimetableSnapshot(activeAccount, querySemester);
    if (cached) {
      visibleRequestSequence += 1;
      pendingVisibleRequestId = null;
      this.setData({ menuOpen: false, semesterOpen: false });
      activeSnapshot = cached;
      activeTimetable = cached.data;
      this.applyTimetable(cached.data, false);
      this.syncTimetableIfNeeded(querySemester);
      return;
    }
    this.setData({ menuOpen: false, semesterOpen: false });
    void this.loadTimetable(false, querySemester, true);
  },
  toggleWeekMenu() {
    haptic("light");
    if (this.data.weekMenuOpen) {
      this.closeWeekMenu();
      return;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    this.setData(
      {
        menuOpen: false,
        semesterOpen: false,
        menuHeight: MAIN_MENU_HEIGHT,
        weekMenuMounted: true,
        weekScrollIntoView: `week-option-${this.data.weekNumber}`,
      },
      () => {
        weekMenuOpenTimer = setTimeout(() => {
          weekMenuOpenTimer = undefined;
          if (this.data.weekMenuMounted) this.setData({ weekMenuOpen: true });
        }, 16);
      },
    );
  },
  closeWeekMenu() {
    if (!this.data.weekMenuMounted) return;
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    this.setData({ weekMenuOpen: false });
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
    }
    weekMenuUnmountTimer = setTimeout(() => {
      weekMenuUnmountTimer = undefined;
      if (!this.data.weekMenuOpen) {
        this.setData({ weekMenuMounted: false });
      }
    }, 320);
  },
  toggleMenu() {
    haptic("light");
    this.closeWeekMenu();
    this.setData({
      menuOpen: !this.data.menuOpen,
      semesterOpen: false,
      menuHeight: MAIN_MENU_HEIGHT,
    });
  },
  openSemesterMenu() {
    haptic("light");
    this.setData({
      semesterOpen: true,
      menuHeight: this.data.semesterMenuHeight,
    });
  },
  backToMainMenu() {
    haptic("light");
    this.setData({ semesterOpen: false, menuHeight: MAIN_MENU_HEIGHT });
  },
  closeMenus() {
    this.setData({
      menuOpen: false,
      semesterOpen: false,
      menuHeight: MAIN_MENU_HEIGHT,
    });
  },
  stopPropagation() {},
  selectTheme(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.theme || "image");
    const patch = themePatch(id);
    this.setData(patch);
    try {
      wx.setStorageSync(THEME_STORAGE_KEY, patch.timetableThemeId);
    } catch {
      // 外观偏好保存失败不影响当前显示。
    }
    haptic("light");
  },
  openCalendar() {
    this.setData({ menuOpen: false });
    haptic("light");
    void navigateTo("/pages/calendar/index", "wx://upwards");
  },
  goToday() {
    if (!activeTimetable) return;
    this.setData({ menuOpen: false });
    const week = teachingWeekForDate(activeTimetable);
    if (week !== null && week >= 1 && week <= this.data.maxWeek) {
      this.setWeek(week, true);
    }
  },
  onRefresh() {
    this.setData({ menuOpen: false });
    haptic("light");
    void this.loadTimetable(
      true,
      this.data.semesterId === defaultSemesterId
        ? undefined
        : this.data.semesterId || undefined,
    );
  },
  goBack() {
    haptic("light");
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) });
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
  onResize() {
    this.setData(backgroundMetrics());
    if (activeTimetable) this.applyTimetable(activeTimetable, true);
  },
});
