import {
  initializeCapsuleBackdrop,
  attachCapsuleBackdrop,
  detachCapsuleBackdrop,
  invalidateCapsuleBackdrop,
  type CapsuleScrollHost,
} from "../../utils/capsule-backdrop";
import { buildAppShare } from "../../utils/app-share";
import {
  loadInteractionDraft,
  saveInteractionDraft,
  clearInteractionDraft,
} from "../../store/interaction-drafts";
import { currentIsoWeekday } from "../../data/timetable";
import { defaultPlanEnd, nextWholeHour } from "../../data/schedule";
import {
  buildScheduleDateView,
  buildSchedulePager,
  getPrewarmedScheduleFirstScreen,
  scheduleDateFromKey,
  scheduleDayIndex,
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
let pagerMoving = false;
let pagerDirty = false;
let pendingSelectedDate = "";
let pendingSavedPlan: { date: string; id: string } | null = null;
let dayScrollPositions = new Map<string, number>();
type SharedNumber = WechatMiniprogram.Skyline.SharedValue<number>;
interface ScheduleMotion {
  position: SharedNumber;
  start: SharedNumber;
  width: SharedNumber;
  weekWidth: SharedNumber;
  ready: SharedNumber;
  active: SharedNumber;
  sequence: SharedNumber;
}
type NativeScrollEvent = WechatMiniprogram.CustomEvent<{ dx: number }>;

const INITIAL_SCHEDULE_PREFERENCES = loadPreferences();
const INITIAL_SCHEDULE_APPEARANCE = resolveAppearance(
  INITIAL_SCHEDULE_PREFERENCES,
);
const SCHEDULE_RETURN_REFRESH_DELAY_MS = 520;
const runOnJS = wx.worklet?.runOnJS;

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
  onShareAppMessage: buildAppShare,
  _capsuleDayScroll: undefined as
    WechatMiniprogram.Skyline.SharedValue<number[]> | undefined,
  _motion: null as ScheduleMotion | null,
  _viewReady: false,
  _headerRendered: false,
  _headerBindingsStarted: false,
  _nativeCurrent: 7 + currentIsoWeekday() - 1,
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
    dayPages: [] as ReturnType<typeof buildSchedulePager>["dayPages"],
    weekPages: [] as ReturnType<typeof buildSchedulePager>["weekPages"],
    dayCurrent: 7 + currentIsoWeekday() - 1,
    dayAnimated: false,
    headerMotionReady: false,
    dayScrollTops: [] as number[],
    focusedPlanId: "",
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
    initializeCapsuleBackdrop(this);
    pagerMoving = false;
    pagerDirty = false;
    pendingSelectedDate = "";
    pendingSavedPlan = null;
    dayScrollPositions = new Map();
    const position = scheduleDayIndex(this.data.selectedDate);
    if (wx.worklet?.shared)
      this._motion = {
        position: wx.worklet.shared(position),
        start: wx.worklet.shared(position),
        width: wx.worklet.shared(wx.getWindowInfo().windowWidth),
        weekWidth: wx.worklet.shared(
          (wx.getWindowInfo().windowWidth * 670) / 750,
        ),
        ready: wx.worklet.shared(0),
        active: wx.worklet.shared(0),
        sequence: wx.worklet.shared(0),
      };
    scheduleVisible = false;
    hydratedScheduleSources = null;
    const account = getSession()?.user.account || "";
    if (account) this.hydrateCachedScheduleIfNeeded(account, true);
  },
  onReady() {
    attachCapsuleBackdrop(this, "schedule");
    this._viewReady = true;
    this.bindWeekMotion();
    this.measureDayPager();
  },
  bindWeekMotion() {
    const motion = this._motion;
    // onReady can precede the deferred date-window render. Selectors must
    // resolve real nodes, not the still-empty wx:for from the first render.
    if (
      !motion ||
      !this._viewReady ||
      !this._headerRendered ||
      this._headerBindingsStarted
    )
      return;
    this._headerBindingsStarted = true;
    // Give each updater direct SharedValue dependencies; do not rely on
    // dependency discovery through the enclosing controller object.
    const dayPosition = motion.position;
    const weekWidth = motion.weekWidth;
    const host = this as unknown as WechatMiniprogram.Component.TrivialInstance;
    let remaining = 3 * (2 + 7 * 2);
    const bound = () => {
      remaining -= 1;
      if (remaining === 0 && this._motion === motion)
        this.setData({ headerMotionReady: true });
    };
    const config = { immediate: true, flush: "sync" as const };
    for (let slot = 0; slot < 3; slot += 1) {
      host.applyAnimatedStyle(
        ".week-strip-slot-" + slot,
        () => {
          "worklet";
          const position = dayPosition.value;
          const week = Math.floor(position / 7);
          const offset = (slot - (week % 3) + 3) % 3;
          const shift =
            (offset === 2 ? -1 : offset) - Math.max(0, position - week * 7 - 6);
          return {
            transform: "translateX(" + shift * weekWidth.value + "px)",
          };
        },
        config,
        bound,
      );
      host.applyAnimatedStyle(
        ".week-selection-slot-" + slot,
        () => {
          "worklet";
          const week = Math.floor(dayPosition.value / 7);
          const offset = (slot - (week % 3) + 3) % 3;
          const slotWeek = week + (offset === 2 ? -1 : offset);
          const position = Math.max(
            0,
            Math.min(6, dayPosition.value - slotWeek * 7),
          );
          return {
            transform: "translateX(" + (position * weekWidth.value) / 7 + "px)",
          };
        },
        config,
        bound,
      );
      for (let weekday = 1; weekday <= 7; weekday += 1) {
        for (const selected of [false, true]) {
          host.applyAnimatedStyle(
            ".week-date-" +
              slot +
              "-" +
              weekday +
              (selected ? "-selected" : "-normal"),
            () => {
              "worklet";
              const position = dayPosition.value;
              const week = Math.floor(position / 7);
              const offset = (slot - (week % 3) + 3) % 3;
              const slotWeek = week + (offset === 2 ? -1 : offset);
              const day = slotWeek * 7 + weekday - 1;
              // Use the selector's position, not the committed selectedDate.
              // A reverse drag immediately retraces the same color mixture.
              const weight = Math.max(0, 1 - Math.abs(position - day));
              return { opacity: "" + (selected ? weight : 1 - weight) };
            },
            config,
            bound,
          );
        }
      }
    }
  },
  onResize() {
    invalidateCapsuleBackdrop(this);
    this.measureDayPager();
  },
  measureDayPager() {
    const query = this.createSelectorQuery();
    query.select(".day-swiper").boundingClientRect();
    query.select(".week-viewport").boundingClientRect();
    query.exec(
      (rects: WechatMiniprogram.BoundingClientRectCallbackResult[]) => {
        const [pager, week] = rects;
        if (!this._motion || !pager?.width || !week?.width) return;
        this._motion.width.value = pager.width;
        this._motion.weekWidth.value = week.width;
      },
    );
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    scheduleVisible = true;
    attachCapsuleBackdrop(this, "schedule");
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
    detachCapsuleBackdrop(this);
    scheduleVisible = false;
    clearScheduleRefreshTimer();
    pagerMoving = false;
    pendingSelectedDate = "";
    if (this._motion) {
      const day = this.data.dayPages[this._nativeCurrent];
      if (day) this.setData({ selectedDate: day.selectedDate });
      this._motion.active.value = 0;
    }
    if (pendingSavedPlan) {
      this.setData({
        selectedDate: pendingSavedPlan.date,
        focusedPlanId: pendingSavedPlan.id,
      });
      pendingSavedPlan = null;
    }
    this.rebuildWeek(true);
    if (this.data.creating || this.data.editingPlanId) {
      this.setData({ creating: false });
    }
    this.setTabBarHidden(false);
  },
  onUnload() {
    detachCapsuleBackdrop(this);
    scheduleVisible = false;
    clearScheduleRefreshTimer();
    this._motion = null;
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
      const timetable = loadTimetableSnapshot(account);
      const schedule = loadScheduleData(account);
      const candidate = force ? getPrewarmedScheduleFirstScreen(account) : null;
      const prewarmed =
        candidate &&
        candidate.timetableStoredAt === (timetable?.localStoredAt || 0) &&
        candidate.scheduleUpdatedAt === schedule.clientUpdatedAt
          ? candidate
          : null;
      activeAccount = account;
      if (prewarmed) {
        activeTimetable = prewarmed.timetable;
        activeSchedulePrewarmRevision = prewarmed.revision;
        activeTimetableStoredAt = prewarmed.timetableStoredAt;
        activeScheduleUpdatedAt = prewarmed.scheduleUpdatedAt;
        Object.assign(patch, prewarmed.view);
      } else {
        activeTimetable = timetable?.data || null;
        activeSchedulePrewarmRevision = 0;
        activeTimetableStoredAt = timetable?.localStoredAt || 0;
        activeScheduleUpdatedAt = schedule.clientUpdatedAt;
        Object.assign(
          patch,
          buildScheduleDateView(
            activeTimetable,
            schedule.plans,
            accountChanged ? toDateString(new Date()) : this.data.selectedDate,
          ),
        );
      }
      if (accountChanged) {
        dayScrollPositions.clear();
        pagerMoving = false;
        pendingSelectedDate = "";
        pendingSavedPlan = null;
        Object.assign(patch, {
          creating: false,
          editingPlanId: "",
          title: "",
          focusedPlanId: "",
          dayScrollTops: [],
        });
      }
      const date = String(patch.selectedDate || this.data.selectedDate);
      Object.assign(
        patch,
        prewarmed?.pager ||
          buildSchedulePager(activeTimetable, schedule.plans, date),
      );
    }
    hydratedScheduleSources = readScheduleSourceRevisions(account);
    if (contentChanged) this.replaceDayWindow(patch);
    else if (Object.keys(patch).length) this.setData(patch);
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
    this.rebuildWeek();
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
          deleted: result.meta.deleted,
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
        deleted: result.meta.deleted,
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
  replaceDayWindow(patch: Record<string, unknown>) {
    // Disable native animation in a completed render BEFORE changing current
    // or replacing items. Same-patch property observers need not run in order.
    const motion = this._motion;
    if (motion) {
      motion.ready.value = 0;
      motion.sequence.value += 1;
    }
    const sequence = motion?.sequence.value;
    pagerMoving = true;
    this.setData({ dayAnimated: false }, () => {
      if (this._motion !== motion || motion?.sequence.value !== sequence)
        return;
      this._nativeCurrent = Number(patch.dayCurrent);
      this.setData(patch, () => {
        if (this._motion !== motion || motion?.sequence.value !== sequence)
          return;
        if (motion) {
          const position = scheduleDayIndex(this.data.selectedDate);
          motion.start.value = position;
          motion.position.value = position;
          motion.active.value = 0;
        }
        this._headerRendered = this.data.weekPages.length === 3;
        this.bindWeekMotion();
        this.setData({ dayAnimated: true }, () => {
          if (this._motion !== motion || motion?.sequence.value !== sequence)
            return;
          if (motion) motion.ready.value = 1;
          pagerMoving = false;
          this.flushPendingDate();
        });
      });
    });
  },
  rebuildWeek(forceRebase = false) {
    if (pagerMoving || this._motion?.active.value) {
      pagerDirty = true;
      return;
    }
    const schedule = loadScheduleData(activeAccount);
    activeScheduleUpdatedAt = schedule.clientUpdatedAt;
    const date = this.data.selectedDate;
    const current = this.data.dayPages.findIndex(
      (day) => day.selectedDate === date,
    );
    // Leave indices and date identities intact throughout the three-week
    // window. Rebase only at a boundary after the native scroll has ended.
    const windowStart =
      !forceRebase && current > 0 && current < 20
        ? this.data.dayPages[0].selectedDate
        : undefined;
    const pager = buildSchedulePager(
      activeTimetable,
      schedule.plans,
      date,
      windowStart,
    );
    const patch = {
      ...buildScheduleDateView(activeTimetable, schedule.plans, date),
      ...pager,
      dayScrollTops: pager.dayPages.map(
        (day) => dayScrollPositions.get(day.selectedDate) || 0,
      ),
    };
    pagerDirty = false;
    if (
      forceRebase ||
      pager.dayCurrent !== this.data.dayCurrent ||
      pager.dayPages[0].selectedDate !== this.data.dayPages[0]?.selectedDate
    ) {
      this.replaceDayWindow(patch);
    } else this.setData(patch);
    markScheduleSourcesHydrated(activeAccount, ["timetable", "schedule"]);
  },
  onDayScrollStart() {
    "worklet";
    const motion = this._motion;
    if (!motion || !motion.ready.value) return;
    motion.active.value = 1;
    motion.sequence.value += 1;
    const markDayScrolling = this.markDayScrolling.bind(this);
    if (runOnJS) runOnJS(markDayScrolling)(motion.sequence.value);
  },
  onDayScrollUpdate(event: NativeScrollEvent) {
    "worklet";
    const motion = this._motion;
    if (!motion || !motion.ready.value || !motion.active.value) return;
    motion.position.value =
      motion.start.value + event.detail.dx / motion.width.value;
  },
  onDayScrollEnd(event: NativeScrollEvent) {
    "worklet";
    const motion = this._motion;
    if (!motion || !motion.ready.value || !motion.active.value) return;
    this.onDayScrollUpdate(event);
    const position = Math.round(motion.position.value);
    // dx is relative to the previous native scroll end. Commit that baseline
    // on the UI thread, BEFORE another gesture can start (official tab pattern).
    motion.start.value = position;
    motion.position.value = position;
    motion.active.value = 0;
    const finishDayScroll = this.finishDayScroll.bind(this);
    if (runOnJS) runOnJS(finishDayScroll)(position, motion.sequence.value);
  },
  markDayScrolling(sequence: number) {
    if (this._motion && sequence !== this._motion.sequence.value) return;
    pagerMoving = true;
    this.setData({ focusedPlanId: "" });
  },
  onDayChange(event: WechatMiniprogram.CustomEvent<{ current: number }>) {
    // Native current is authoritative for dates. It is deliberately not echoed
    // back to the swiper during a drag, and never rewrites the date window.
    const windowStart = event.currentTarget.dataset.windowStart;
    if (this._motion && !this._motion.ready.value) return;
    if (windowStart && windowStart !== this.data.dayPages[0]?.selectedDate)
      return;
    if (!this.data.dayPages[event.detail.current]) return;
    this._nativeCurrent = event.detail.current;
  },
  finishDayScroll(position: number, sequence: number) {
    const motion = this._motion;
    if (
      !motion ||
      !motion.ready.value ||
      sequence !== motion.sequence.value ||
      motion.active.value
    )
      return;
    const current = this._nativeCurrent;
    const day = this.data.dayPages[current];
    if (!day) return;
    const dayIndex = scheduleDayIndex(day.selectedDate);
    const weekChanged = this.data.days[0]?.date !== day.days[0].date;
    if (motion && position !== dayIndex) {
      motion.start.value = dayIndex;
      motion.position.value = dayIndex;
    }
    pagerMoving = false;
    this.setData({
      dayCurrent: current,
      selectedDate: day.selectedDate,
      days: day.days,
      selectedWeekday: day.selectedWeekday,
      selectedDateLabel: day.selectedDateLabel,
      teachingWeekLabel: day.teachingWeekLabel,
      monthLabel: day.monthLabel,
      entries: day.entries,
    });
    // Only an offscreen week changes identity. The visible week's coordinates
    // never depend on the native window index, including during a rebase.
    if (weekChanged || current === 0 || current === 20 || pagerDirty)
      this.rebuildWeek();
    this.flushPendingDate();
  },
  flushPendingDate() {
    if (pagerMoving || this._motion?.active.value) return;
    const next = pendingSelectedDate;
    pendingSelectedDate = "";
    if (next && next !== this.data.selectedDate)
      this.navigateScheduleDate(next);
    else if (pendingSavedPlan?.date === this.data.selectedDate) {
      this.setData({ focusedPlanId: pendingSavedPlan.id });
      pendingSavedPlan = null;
    }
  },
  onGlassDayScroll(
    this: CapsuleScrollHost,
    event: {
      detail: { scrollTop: number };
      currentTarget?: { dataset?: { slot?: number } };
    },
  ) {
    "worklet";
    if (!this._capsuleDayScroll) return;
    const slot = Number(event.currentTarget?.dataset?.slot);
    if (!(slot >= 0)) return;
    const values = this._capsuleDayScroll.value.slice();
    values[slot] = event.detail.scrollTop;
    this._capsuleDayScroll.value = values;
  },
  onDayVerticalScroll(
    event: WechatMiniprogram.CustomEvent<{ scrollTop: number }>,
  ) {
    const date = String(event.currentTarget.dataset.date || "");
    if (date) dayScrollPositions.set(date, event.detail.scrollTop);
    const slot = Number(event.currentTarget.dataset.slot);
    if (this._capsuleDayScroll && slot >= 0) {
      const values = this._capsuleDayScroll.value.slice();
      values[slot] = event.detail.scrollTop;
      this._capsuleDayScroll.value = values;
    }
    if (dayScrollPositions.size > 90)
      dayScrollPositions.delete(dayScrollPositions.keys().next().value!);
  },
  navigateScheduleDate(date: string) {
    if (pagerMoving || this._motion?.active.value) {
      pendingSelectedDate = date;
      return;
    }
    if (date === this.data.selectedDate) return;
    const current = this.data.dayPages.findIndex(
      (day) => day.selectedDate === date,
    );
    const distance = Math.abs(
      scheduleDayIndex(date) - scheduleDayIndex(this.data.selectedDate),
    );
    if (
      current < 0 ||
      distance > 7 ||
      this.data.motionClass === "motion-reduced"
    ) {
      const plans = loadScheduleData(activeAccount).plans;
      const pager = buildSchedulePager(activeTimetable, plans, date);
      this.replaceDayWindow({
        ...buildScheduleDateView(activeTimetable, plans, date),
        ...pager,
        dayScrollTops: pager.dayPages.map(
          (day) => dayScrollPositions.get(day.selectedDate) || 0,
        ),
      });
      return;
    }
    pagerMoving = true;
    this.setData({ dayCurrent: current });
  },
  selectDay(event: WechatMiniprogram.TouchEvent) {
    pendingSavedPlan = null;
    const date = String(event.currentTarget.dataset.date || "");
    if (date) this.navigateScheduleDate(date);
  },
  goToday() {
    pendingSavedPlan = null;
    haptic("light");
    this.navigateScheduleDate(toDateString(new Date()));
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
    const draft = loadInteractionDraft(activeAccount, "schedule");
    this.setData({
      creating: true,
      focusedPlanId: "",
      title: "",
      startDate,
      startTime,
      ...defaultEnd,
      endDirty: false,
      ...draft,
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
    const draft = loadInteractionDraft(activeAccount, "schedule", plan.id);
    this.setData({
      creating: true,
      focusedPlanId: "",
      editingPlanId: plan.id,
      title: plan.title,
      startDate: plan.date,
      startTime: plan.startTime,
      endDate: plan.endDate,
      endTime: plan.endTime,
      endDirty: true,
      ...draft,
    });
  },
  saveCreatorDraft() {
    const {
      title,
      startDate,
      startTime,
      endDate,
      endTime,
      endDirty,
      editingPlanId,
    } = this.data;
    saveInteractionDraft(
      activeAccount,
      "schedule",
      { title, startDate, startTime, endDate, endTime, endDirty },
      editingPlanId,
    );
  },
  closeCreator() {
    this.setData({ creating: false, editingPlanId: "" });
    this.setTabBarHidden(false);
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
    this.saveCreatorDraft();
  },
  onStartDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const startDate = event.detail.value;
    this.setData(
      this.data.endDirty
        ? { startDate }
        : { startDate, ...defaultPlanEnd(startDate, this.data.startTime) },
    );
    this.saveCreatorDraft();
  },
  onEndDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endDate: event.detail.value, endDirty: true });
    this.saveCreatorDraft();
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
    this.saveCreatorDraft();
  },
  onEndTimeChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ endTime: event.detail.value, endDirty: true });
    this.saveCreatorDraft();
  },
  savePlan() {
    if (!this.data.creating) return;
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
    if (
      editingPlanId &&
      !storedPlans.some((plan) => plan.id === editingPlanId)
    ) {
      wx.showToast({ title: "这个日程已删除", icon: "none" });
      this.closeCreator();
      return;
    }
    const planPatch = {
      title,
      date: this.data.startDate,
      startTime: this.data.startTime,
      endDate: this.data.endDate,
      endTime: this.data.endTime,
    };
    const savedPlanId = editingPlanId || `plan-${Date.now()}`;
    const plans = editingPlanId
      ? storedPlans.map((plan) =>
          plan.id === editingPlanId ? { ...plan, ...planPatch } : plan,
        )
      : [
          ...storedPlans,
          {
            id: savedPlanId,
            ...planPatch,
            done: false,
          },
        ];
    this.persistPlans(plans);
    clearInteractionDraft(activeAccount, "schedule", editingPlanId);
    haptic("medium");
    this.setData({
      creating: false,
      editingPlanId: "",
      focusedPlanId: savedPlanId,
    });
    this.setTabBarHidden(false);
    if (pagerMoving || this._motion?.active.value) {
      pendingSavedPlan = { date: this.data.startDate, id: savedPlanId };
      pendingSelectedDate = this.data.startDate;
      pagerDirty = true;
      return;
    }
    this.setData({ selectedDate: this.data.startDate });
    const selectedDate = scheduleDateFromKey(this.data.startDate);
    this.setData({ selectedWeekday: currentIsoWeekday(selectedDate) });
    this.rebuildWeek();
  },
  deletePlan() {
    const editingPlanId = this.data.editingPlanId;
    if (!editingPlanId) return;
    const lease = captureSessionLease();
    if (!lease || lease.account !== activeAccount) return;
    wx.showModal({
      title: "删除日程",
      content: "确定删除这个日程？",
      confirmText: "删除",
      confirmColor: "#c0452d",
      success: (result) => {
        if (!result.confirm || !isSessionLeaseCurrent(lease)) return;
        const plans = loadScheduleData(activeAccount).plans.filter(
          (plan) => plan.id !== editingPlanId,
        );
        this.persistPlans(plans);
        clearInteractionDraft(activeAccount, "schedule", editingPlanId);
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
    this.rebuildWeek();
  },
});
