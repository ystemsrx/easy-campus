import {
  coursesForWeek,
  teachingWeekForDate,
  timetableWeekCount,
  timetableWeekForDisplay,
  type TimetableCourse,
} from "../../data/timetable";
import {
  buildTimetablePeriodRows,
  buildTimetableWeekPage,
  buildTimetableWeekPlaceholder,
  getPrewarmedTimetableFirstScreen,
  timetableGridLayoutMetrics,
  timetableMaxPeriod,
  type TimetableGridLayoutMetrics,
  type TimetablePeriodRow,
  type TimetableWeekPage,
} from "../../data/timetable-render";
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
import type { AcademicSemesterOption, TimetableData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";
import {
  shortAcademicSemesterLabel,
  timetableSemesterMenuLabel,
} from "../../utils/semester";

interface TimetableThemeOption {
  id: string;
  label: string;
  color: string;
  image: boolean;
}

interface TimetableSemesterOption extends AcademicSemesterOption {
  displayLabel: string;
}

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

interface InFlightTimetableRequest {
  refresh: boolean;
  completion: Promise<boolean>;
}

let activeTimetable: TimetableData | null = null;
let visibleCourses: TimetableCourse[] = [];
const timetableRequestsInFlight = new Map<string, InFlightTimetableRequest>();
let activeAccount = "";
let defaultSemesterId = "";
let activeSnapshot: TimetableSnapshot | null = null;
let weekMenuOpenTimer: ReturnType<typeof setTimeout> | undefined;
let weekMenuUnmountTimer: ReturnType<typeof setTimeout> | undefined;
let refreshToastShowTimer: ReturnType<typeof setTimeout> | undefined;
let refreshToastHideTimer: ReturnType<typeof setTimeout> | undefined;
let refreshToastUnmountTimer: ReturnType<typeof setTimeout> | undefined;
let weekBuildTimer: ReturnType<typeof setTimeout> | undefined;
let weekBuildSequence = 0;
let visibleRequestSequence = 0;
let pendingVisibleRequestId: number | null = null;
let pageAlive = false;

function timetableSemesterOptions(
  semesters: AcademicSemesterOption[],
): TimetableSemesterOption[] {
  return semesters.map((semester) => ({
    ...semester,
    displayLabel: timetableSemesterMenuLabel(semester),
  }));
}

function submenuHeight(semesterCount: number): number {
  return Math.min(590, Math.max(250, 104 + Math.min(6, semesterCount) * 78));
}

function weekMenuListHeight(weekCount: number): number {
  return Math.min(448, 32 + Math.ceil(Math.max(1, weekCount) / 4) * 86);
}

function hasSelectedSemesterCalendar(timetable: TimetableData): boolean {
  return Boolean(
    (timetable.semesterCalendar?.semesterId === timetable.semester.id &&
      timetable.semesterCalendar.weeks.length) ||
    timetable.currentSemester?.id === timetable.semester.id,
  );
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

function clearRefreshToastTimers(): void {
  if (refreshToastShowTimer !== undefined) {
    clearTimeout(refreshToastShowTimer);
    refreshToastShowTimer = undefined;
  }
  if (refreshToastHideTimer !== undefined) {
    clearTimeout(refreshToastHideTimer);
    refreshToastHideTimer = undefined;
  }
  if (refreshToastUnmountTimer !== undefined) {
    clearTimeout(refreshToastUnmountTimer);
    refreshToastUnmountTimer = undefined;
  }
}

function cancelPendingWeekBuilds(): void {
  weekBuildSequence += 1;
  if (weekBuildTimer !== undefined) {
    clearTimeout(weekBuildTimer);
    weekBuildTimer = undefined;
  }
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
    refreshToastMounted: false,
    refreshToastVisible: false,
    menuHeight: MAIN_MENU_HEIGHT,
    semesterMenuHeight: 250,
    semesterShortLabel: "选择学期",
    semesterId: "",
    semesters: [] as TimetableSemesterOption[],
    weekNumber: 1,
    currentWeekNumber: 0,
    weekIndex: 0,
    weekLabel: "第 1 周",
    maxWeek: 1,
    weekPages: [] as TimetableWeekPage[],
    periodRows: [] as TimetablePeriodRow[],
    selectedCourse: null as TimetableCourse | null,
    courseSheetVisible: false,
    hasHydrated: false,
  },
  onLoad() {
    pageAlive = true;
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    clearRefreshToastTimers();
    cancelPendingWeekBuilds();
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
    pageAlive = false;
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    clearRefreshToastTimers();
    cancelPendingWeekBuilds();
  },
  queueRemainingWeekPages(
    timetable: TimetableData,
    maxPeriod: number,
    layoutMetrics: TimetableGridLayoutMetrics,
    selectedWeek: number,
    cachedWeekDates: Map<number, string[]>,
  ) {
    cancelPendingWeekBuilds();
    const sequence = weekBuildSequence;
    const remainingWeeks = Array.from(
      { length: this.data.maxWeek },
      (_, index) => index + 1,
    )
      .filter((week) => week !== selectedWeek)
      .sort(
        (left, right) =>
          Math.abs(left - selectedWeek) - Math.abs(right - selectedWeek),
      );

    const buildNext = () => {
      weekBuildTimer = undefined;
      if (
        !pageAlive ||
        activeTimetable !== timetable ||
        sequence !== weekBuildSequence
      ) {
        return;
      }
      const weekNumber = remainingWeeks.shift();
      if (weekNumber === undefined) return;
      const index = weekNumber - 1;
      if (this.data.weekPages[index]?.ready) {
        weekBuildTimer = setTimeout(buildNext, 0);
        return;
      }
      const page = buildTimetableWeekPage(
        timetable,
        weekNumber,
        maxPeriod,
        layoutMetrics,
        cachedWeekDates.get(weekNumber),
      );
      this.setData({ [`weekPages[${index}]`]: page }, () => {
        if (sequence === weekBuildSequence) {
          weekBuildTimer = setTimeout(buildNext, 16);
        }
      });
    };

    weekBuildTimer = setTimeout(buildNext, 0);
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
  async loadTimetable(
    refresh: boolean,
    semester?: string,
    activate = false,
  ): Promise<boolean> {
    const requestAccount = activeAccount;
    if (!requestAccount) return false;
    const requestKey = `${requestAccount}:${semester || "default"}`;
    const existingRequest = timetableRequestsInFlight.get(requestKey);
    if (existingRequest) {
      const succeeded = await existingRequest.completion;
      return refresh && !existingRequest.refresh
        ? this.loadTimetable(true, semester, activate)
        : succeeded;
    }
    let resolveCompletion: (succeeded: boolean) => void = () => undefined;
    const completion = new Promise<boolean>((resolve) => {
      resolveCompletion = resolve;
    });
    timetableRequestsInFlight.set(requestKey, { refresh, completion });
    const visibleRequestId = activate ? ++visibleRequestSequence : 0;
    if (activate) pendingVisibleRequestId = visibleRequestId;
    let shouldRefreshAfterward = false;
    let succeeded = false;
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
        const cachedResult = stored?.data || result.data;
        activeTimetable = cachedResult;
        if (!semester) defaultSemesterId = cachedResult.semester.id;
        this.applyTimetable(cachedResult, refresh || !semester);
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
        (result.meta.stale === true ||
          result.meta.refreshing === true ||
          isCacheStale(current, WEEK_MS) ||
          !hasSelectedSemesterCalendar(current.data)) &&
        claimAutomaticRefresh(
          `timetable:${semester || "default"}`,
          requestAccount,
        );
      succeeded = true;
      return true;
    } catch {
      if (activate && pendingVisibleRequestId === visibleRequestId) {
        pendingVisibleRequestId = null;
      }
      if (!activeTimetable) {
        wx.showToast({ title: "课表暂时不可用", icon: "none" });
      }
      return false;
    } finally {
      if (activate && pendingVisibleRequestId === visibleRequestId) {
        pendingVisibleRequestId = null;
      }
      if (
        timetableRequestsInFlight.get(requestKey)?.completion === completion
      ) {
        timetableRequestsInFlight.delete(requestKey);
      }
      resolveCompletion(succeeded);
      if (shouldRefreshAfterward) {
        setTimeout(() => void this.loadTimetable(true, semester), 0);
      }
    }
  },
  applyTimetable(timetable: TimetableData, preserveWeek: boolean) {
    const maxWeek = timetableWeekCount(timetable);
    const cachedWeekDates = new Map(
      activeSnapshot?.data.semester.id === timetable.semester.id
        ? activeSnapshot.weekDates.map((week) => [week.weekNumber, week.dates])
        : [],
    );
    const maxPeriod = timetableMaxPeriod(timetable);
    const layoutMetrics = timetableGridLayoutMetrics(
      maxPeriod,
      Number(this.data.headerHeight) || 64,
    );
    const prewarmed = activeSnapshot
      ? getPrewarmedTimetableFirstScreen(
          activeAccount,
          activeSnapshot,
          layoutMetrics,
        )
      : null;
    const detectedWeek =
      prewarmed?.currentWeekNumber || teachingWeekForDate(timetable) || 0;
    const weekNumber = Math.min(
      maxWeek,
      Math.max(
        1,
        preserveWeek && this.data.semesterId === timetable.semester.id
          ? this.data.weekNumber
          : prewarmed?.weekNumber || timetableWeekForDisplay(timetable),
      ),
    );
    const firstScreen =
      prewarmed?.weekNumber === weekNumber ? prewarmed : null;
    const periodCourses = firstScreen
      ? firstScreen.courses
      : coursesForWeek(timetable, weekNumber);
    const weekPages = Array.from({ length: maxWeek }, (_, index) =>
      buildTimetableWeekPlaceholder(
        timetable,
        index + 1,
        cachedWeekDates.get(index + 1),
      ),
    );
    weekPages[weekNumber - 1] = firstScreen
      ? firstScreen.weekPage
      : buildTimetableWeekPage(
          timetable,
          weekNumber,
          maxPeriod,
          layoutMetrics,
          cachedWeekDates.get(weekNumber),
        );
    visibleCourses = periodCourses;
    this.setData(
      {
        semesterShortLabel: shortAcademicSemesterLabel(timetable.semester),
        semesterId: timetable.semester.id,
        semesters: timetableSemesterOptions(timetable.semesters),
        semesterMenuHeight: submenuHeight(timetable.semesters.length),
        weekNumber,
        currentWeekNumber: detectedWeek,
        weekIndex: weekNumber - 1,
        weekLabel: `第 ${weekNumber} 周`,
        maxWeek,
        weekMenuListHeight: weekMenuListHeight(maxWeek),
        periodRows: firstScreen
          ? firstScreen.periodRows
          : buildTimetablePeriodRows(timetable, maxPeriod, periodCourses),
        weekPages,
      },
      () =>
        this.queueRemainingWeekPages(
          timetable,
          maxPeriod,
          layoutMetrics,
          weekNumber,
          cachedWeekDates,
        ),
    );
  },
  setWeek(weekNumber: number, feedback = false) {
    if (!activeTimetable) return;
    const normalizedWeek = Math.min(
      this.data.maxWeek,
      Math.max(1, Math.floor(weekNumber)),
    );
    visibleCourses = coursesForWeek(activeTimetable, normalizedWeek);
    const maxPeriod =
      this.data.periodRows.length || timetableMaxPeriod(activeTimetable);
    const weekIndex = normalizedWeek - 1;
    const weekPage = this.data.weekPages[weekIndex];
    const pagePatch = weekPage?.ready
      ? {}
      : {
          [`weekPages[${weekIndex}]`]: buildTimetableWeekPage(
            activeTimetable,
            normalizedWeek,
            maxPeriod,
            timetableGridLayoutMetrics(
              maxPeriod,
              Number(this.data.headerHeight) || 64,
            ),
            activeSnapshot?.weekDates.find(
              (week) => week.weekNumber === normalizedWeek,
            )?.dates,
          ),
        };
    this.setData({
      weekNumber: normalizedWeek,
      weekIndex,
      weekLabel: `第 ${normalizedWeek} 周`,
      periodRows: buildTimetablePeriodRows(
        activeTimetable,
        maxPeriod,
        visibleCourses,
      ),
      ...pagePatch,
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
  showRefreshConfirmation() {
    if (!pageAlive) return;
    clearRefreshToastTimers();
    this.setData(
      { refreshToastMounted: true, refreshToastVisible: false },
      () => {
        refreshToastShowTimer = setTimeout(() => {
          refreshToastShowTimer = undefined;
          if (!pageAlive) return;
          this.setData({ refreshToastVisible: true });
          refreshToastHideTimer = setTimeout(() => {
            refreshToastHideTimer = undefined;
            if (!pageAlive) return;
            this.setData({ refreshToastVisible: false });
            refreshToastUnmountTimer = setTimeout(() => {
              refreshToastUnmountTimer = undefined;
              if (pageAlive && !this.data.refreshToastVisible) {
                this.setData({ refreshToastMounted: false });
              }
            }, 320);
          }, 3000);
        }, 16);
      },
    );
  },
  async onRefresh() {
    this.setData({ menuOpen: false });
    haptic("light");
    const requestAccount = activeAccount;
    const requestSemesterId = this.data.semesterId;
    const succeeded = await this.loadTimetable(
      true,
      this.data.semesterId === defaultSemesterId
        ? undefined
        : this.data.semesterId || undefined,
    );
    if (
      succeeded &&
      pageAlive &&
      activeAccount === requestAccount &&
      this.data.semesterId === requestSemesterId
    ) {
      this.showRefreshConfirmation();
    }
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
