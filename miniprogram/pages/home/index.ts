import { APP_NAME } from "../../config/app";
import { getCredentialStatus } from "../../services/auth";
import { preloadAutoDormCheckStatus } from "../../services/auto-dorm-check";
import {
  getPreloadedCurrentUser,
  getPreloadedTimetable,
} from "../../services/primary-tab-preload";
import {
  getPublicationFeed,
  markPublicationRead,
  preloadPublicationMedia,
  recordAnnouncementPopup,
} from "../../services/content";
import {
  getGrades,
  getMessages,
  getNotices,
  getTimetable,
  putLocalSchedule,
} from "../../services/teaching";
import {
  refreshElectricityOnForeground,
  refreshExamsOnForeground,
} from "../../services/cache-refresh";
import { getErrorMessage } from "../../services/request";
import {
  claimAutomaticRefresh,
  FIFTEEN_DAYS_MS,
  isCacheStale,
  isUpstreamRefreshResult,
  shouldStoreServerSnapshot,
} from "../../store/cache-policy";
import {
  loadGradesSnapshot,
  loadGradesSnapshotForPreference,
  saveGradesSnapshot,
} from "../../store/grades";
import { loadElectricitySnapshot } from "../../store/electricity";
import { loadExamsSnapshot } from "../../store/exams";
import {
  loadPetPreferences,
  savePetSelection,
  shouldShowPet,
  skipPetSetup,
} from "../../store/pet";
import { uploadLocalCompanionPreferences } from "../../services/companion";
import { loadPreferences } from "../../store/preferences";
import { loadScheduleData, saveScheduleData } from "../../store/schedule";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  loadCurrentUser,
  sessionLeaseKey,
  type SessionLease,
} from "../../store/session";
import {
  cleanupTeachingPreview,
  loadTeachingPreview,
  saveTeachingPreview,
} from "../../store/teaching-preview";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
} from "../../store/timetable";
import {
  coursePreview,
  formatClock,
  remainingCourses,
  type TimetableCourse,
} from "../../data/timetable";
import type {
  CredentialState,
  CurrentUserData,
  Exam,
  GradesData,
  LocalSchedulePlan,
  Notice,
  Publication,
  TeachingMessage,
  TimetableData,
} from "../../types/api";
import type { VisualTheme } from "../../types/app";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../utils/appearance";
import {
  currentLocalHour,
  formatDateTime,
  formatFriendlyDate,
  formatShortDate,
  formatTimestampTime,
  today,
} from "../../utils/date";
import {
  examCountdown,
  examDateKey,
  examTimestamp,
  type ExamCountdownTone,
} from "../../utils/exams";
import { formatSchedule, formatScheduleDate } from "../../utils/format";
import {
  gradePointRingValue,
  highestGradesByCourseName,
  summarizeGrades,
} from "../../utils/grades";
import { haptic } from "../../utils/haptics";
import { resolveHomeIdentity } from "../../utils/identity";
import {
  renderMarkdownBlocks,
  stripMarkdown,
  type MarkdownBlock,
} from "../../utils/markdown";
import {
  ensureAuthenticated,
  navigateTo,
  registerHomeAuthenticationHost,
  unregisterHomeAuthenticationHost,
} from "../../utils/navigation";
import { progressRingSource } from "../../utils/progress-ring";
import { sortPublicationsNewestFirst } from "../../utils/publications";
import {
  isCurrentSemesterId,
  isCurrentSemesterTimestamp,
  isLatestSchoolNoticeSemesterAssignment,
  latestSchoolNoticeSemesterId,
  startedCurrentSemester,
  type StartedSemesterBoundary,
} from "../../utils/semester";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";

interface MessagePreview {
  id: string;
  title: string;
  subtitle: string;
  sourceCreatedAt: string;
  dateLabel: string;
  label: string;
  tone: string;
}

interface NoticePreview {
  id: string;
  title: string;
  time: string;
  link: string;
  publishedAt: string;
  semesterId?: string | null;
}

interface TodayCoursePreview extends TimetableCourse {
  statusLabel: string;
  current: boolean;
}

interface PlanPreview extends LocalSchedulePlan {
  dateLabel: string;
  timeLabel: string;
}

interface PublicationPreview extends Publication {
  contentBlocks: MarkdownBlock[];
  previewText: string;
  timeLabel: string;
  isLong: boolean;
  expanded: boolean;
}

interface ExamPreview {
  id: string;
  courseName: string;
  location: string;
  dateLabel: string;
  timeLabel: string;
  typeLabel: string;
  badgeText: string;
  badgeTone: ExamCountdownTone;
}

const HOME_PREVIEW_ITEM_LIMIT = 3;
const HOME_FIRST_FRAME_SETTLE_MS = 32;
const HOME_LOGIN_REVEAL_SETTLE_MS = 360;
const PUBLICATION_REFRESH_THROTTLE_MS = 8_000;
const TEACHING_BACKGROUND_FOLLOWUP_MS = 1_500;
const PLAN_CARD_MIN_HEIGHT_RPX = 224;
const PLAN_ROW_HEIGHT_RPX = 104;
const PLAN_COMPLETION_ACK_MS = 140;
const PLAN_REMOVAL_TRANSITION_MS = 360;
const PLAN_ENTRY_TRANSITION_MS = 280;
const CREDENTIAL_POLL_DELAYS_MS = [1_800, 3_000, 5_000, 8_000, 12_000];
const MODAL_QUICK_ACTION_ROUTES = new Set([
  "/features/pages/pass-rates/index",
  "/features/pages/rooms/index",
]);
const INITIAL_HOME_PREFERENCES = loadPreferences();
const INITIAL_HOME_APPEARANCE = resolveAppearance(INITIAL_HOME_PREFERENCES);
const INITIAL_HOME_AUTHENTICATED = Boolean(getSession()?.token);

interface ShortcutCachePatch {
  electricityBound: boolean;
  electricityBalanceLabel: string;
  electricityUsageLabel: string;
  examPreviews: ExamPreview[];
  examEmptyLabel: string;
}

let courseClockTimer: number | undefined;
let publicationPanelTimer: number | undefined;
let announcementModalTimer: number | undefined;
let codeCopyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
let publicationRequestLease: SessionLease | null = null;
let lastPublicationRequestAt = 0;
let lastPublicationRequestSessionKey = "";
let publicationRefreshQueued = false;
let homeVisible = false;
let homeReady = false;
let homeActivationTimer: ReturnType<typeof setTimeout> | undefined;
let authenticationRevealPrepared = false;
let nextPrimaryTabFrameworkPreloadStarted = false;
let queuedAnnouncements: Publication[] = [];
let automaticPopupsThisEntry = new Set<string>();
let automaticPopupEntryKey = "";
let announcementPresentationGeneration = 0;
let announcementPresentationPending = false;
let pendingAnnouncementId = "";
let dashboardRequestLease: SessionLease | null = null;
let dashboardTeachingRefreshQueued = false;
let dashboardStableRefreshQueued = false;
let dashboardTeachingFollowupTimer: ReturnType<typeof setTimeout> | undefined;
let credentialPollTimer: number | undefined;
let credentialPollAttempt = 0;
let credentialProfileRefreshPending = false;
let hydratedAccount = "";
let hydratedDashboardKey = "";
let petSetupDrawerTimer: ReturnType<typeof setTimeout> | undefined;
let planCompletionTimer: ReturnType<typeof setTimeout> | undefined;
let planRemovalTimer: ReturnType<typeof setTimeout> | undefined;
let planEntryTimer: ReturnType<typeof setTimeout> | undefined;
let activeTimetable: TimetableData | null = null;
const CODE_COPY_FEEDBACK_MS = 1_600;

function clearCodeCopyFeedbackTimer() {
  if (codeCopyFeedbackTimer === undefined) return;
  clearTimeout(codeCopyFeedbackTimer);
  codeCopyFeedbackTimer = undefined;
}

function cancelPendingAnnouncementPresentation(): void {
  announcementPresentationGeneration += 1;
  announcementPresentationPending = false;
  pendingAnnouncementId = "";
}

function examBadge(exam: Exam): Pick<ExamPreview, "badgeText" | "badgeTone"> {
  const countdown = examCountdown(exam);
  return {
    badgeText: countdown.label,
    badgeTone: countdown.tone,
  };
}

function toExamPreview(exam: Exam): ExamPreview {
  const dateKey = examDateKey(exam);
  const startTime = exam.time.startAt
    ? formatTimestampTime(exam.time.startAt)
    : exam.time.startTime || "待定";
  const endTime = exam.time.endAt
    ? formatTimestampTime(exam.time.endAt)
    : exam.time.endTime;
  return {
    id: exam.id,
    courseName: exam.course.name,
    location:
      [exam.location.room, exam.location.campus].filter(Boolean).join(" · ") ||
      "考场待定",
    dateLabel: dateKey ? formatShortDate(dateKey) : "日期待定",
    timeLabel: endTime ? `${startTime}–${endTime}` : startTime,
    typeLabel: exam.arrangementTypeLabel || "正常考试",
    ...examBadge(exam),
  };
}

function shortcutCachePatch(
  account: string,
  timetable = loadTimetableSnapshot(account)?.data || null,
): ShortcutCachePatch {
  const electricity = loadElectricitySnapshot(account)?.data;
  const electricityAccount = electricity?.account;
  const examData = loadExamsSnapshot(account)?.data;
  const semesterBoundary = startedCurrentSemester(timetable);
  const exams = isCurrentSemesterId(examData?.semester?.id, semesterBoundary)
    ? examData?.items || []
    : [];
  const now = Date.now();
  const ordered = [...exams].sort((left, right) => {
    const leftTime = examTimestamp(left);
    const rightTime = examTimestamp(right);
    const distance = Math.abs(leftTime - now) - Math.abs(rightTime - now);
    return distance || leftTime - rightTime;
  });
  const selected = ordered.slice(0, 2);
  return {
    electricityBound: Boolean(electricity?.binding),
    electricityBalanceLabel: electricityAccount
      ? electricityAccount.remainingAmountYuan.toFixed(2)
      : "—",
    electricityUsageLabel: electricityAccount
      ? `计费 ${electricityAccount.billedElectricityKwh.toFixed(2)} 度`
      : electricity?.binding
        ? "账单暂不可用"
        : "绑定寝室后查看",
    examPreviews: selected.map(toExamPreview),
    examEmptyLabel: exams.length ? "本学期考试已结束" : "暂时没有考试安排",
  };
}

function scaledRadius(rpx: number, fallback: number): number {
  try {
    return (wx.getWindowInfo().windowWidth * rpx) / 750;
  } catch {
    return fallback;
  }
}

function getTimetableCardRadius(visualTheme: VisualTheme = "default"): number {
  return visualTheme === "minimal" ? scaledRadius(8, 4) : scaledRadius(56, 28);
}

function getCampusCardRadius(visualTheme: VisualTheme = "default"): number {
  return visualTheme === "minimal" ? scaledRadius(8, 4) : scaledRadius(44, 22);
}

function getFeatureCardRadius(visualTheme: VisualTheme = "default"): number {
  return visualTheme === "minimal" ? scaledRadius(8, 4) : scaledRadius(48, 24);
}

function displayGradeAverage(value: number | null, digits: number): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function gradePreviewPatch(
  data: GradesData,
  animate: boolean,
): {
  gradeRingSource: string;
  gradeAverageLabel: string;
  gradePointAverageLabel: string;
  gradeCourseCount: number;
} {
  const summary = summarizeGrades(highestGradesByCourseName(data.items));
  return {
    gradeRingSource: progressRingSource(
      gradePointRingValue(summary.gradePointAverage),
      animate,
    ),
    gradeAverageLabel: displayGradeAverage(summary.weightedAverage, 1),
    gradePointAverageLabel:
      summary.gradePointAverage === null
        ? "—"
        : summary.gradePointAverage.toFixed(2),
    gradeCourseCount: summary.courseCount,
  };
}

function publicationPreview(
  publication: Publication,
  expanded = false,
  theme: "light" | "dark" = "light",
): PublicationPreview {
  const plainText = stripMarkdown(publication.contentMarkdown);
  return {
    ...publication,
    contentBlocks: renderMarkdownBlocks(publication.contentMarkdown, {
      accentColor: publication.accentColor,
      compact: publication.kind === "notification",
      theme,
    }),
    previewText: plainText,
    timeLabel: formatDateTime(publication.startsAt),
    isLong: plainText.length > 78 || publication.contentMarkdown.includes("\n"),
    expanded,
  };
}

function todayCoursePreview(now = new Date()): TodayCoursePreview[] {
  const preview = coursePreview(activeTimetable, now, 3);
  return preview.courses.map((course) => {
    const current = course.id === preview.currentCourseId;
    return {
      ...course,
      current,
      statusLabel: current ? "进行中" : `${course.startTime}–${course.endTime}`,
    };
  });
}

function getGreeting(): string {
  const hour = currentLocalHour();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function toMessagePreview(message: TeachingMessage): MessagePreview {
  switch (message.type) {
    case "course_rescheduled":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: `调整至 ${formatSchedule(message.newSchedule)}`,
        sourceCreatedAt: message.createdAt,
        dateLabel: formatScheduleDate(message.newSchedule),
        label: "调课",
        tone: "blue",
      };
    case "makeup_class":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        sourceCreatedAt: message.createdAt,
        dateLabel: formatScheduleDate(message.schedule),
        label: "补课",
        tone: "green",
      };
    case "course_cancelled":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        sourceCreatedAt: message.createdAt,
        dateLabel: formatScheduleDate(message.schedule),
        label: "停课",
        tone: "orange",
      };
    case "other":
      return {
        id: message.id,
        title: message.title,
        subtitle: message.content,
        sourceCreatedAt: message.createdAt,
        dateLabel: formatDateTime(message.createdAt),
        label: "消息",
        tone: "gray",
      };
  }
}

function toNoticePreview(notice: Notice): NoticePreview {
  return {
    id: notice.id || noticeSourceIdFromLink(notice.link),
    title: notice.title,
    time: formatDateTime(notice.publishedAt),
    link: notice.link,
    publishedAt: notice.publishedAt,
    semesterId: notice.semesterId,
  };
}

function noticeSourceIdFromLink(link: string): string {
  const matched = /[?&]xwbh=([^&]+)/.exec(link);
  if (matched) {
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  }
  const publicArticle = /\/info\/(\d+)\/(\d+)\.htm(?:[?#]|$)/i.exec(link);
  return publicArticle ? `ugs:${publicArticle[1]}:${publicArticle[2]}` : "";
}

function loadPlanPreviews(account: string): PlanPreview[] {
  const stored = loadScheduleData(account).plans;
  const todayKey = today();
  return stored
    .filter((plan) => !plan.done && plan.date >= todayKey)
    .sort((left, right) =>
      `${left.date} ${left.startTime}`.localeCompare(
        `${right.date} ${right.startTime}`,
      ),
    )
    .slice(0, 3)
    .map((plan) => ({
      ...plan,
      dateLabel:
        plan.date === todayKey ? "今天" : formatFriendlyDate(plan.date),
      timeLabel: `${plan.startTime}–${plan.endTime}`,
    }));
}

function planCardHeight(planCount: number): number {
  return Math.max(PLAN_CARD_MIN_HEIGHT_RPX, planCount * PLAN_ROW_HEIGHT_RPX);
}

function planPreviewPatch(account: string): {
  plans: PlanPreview[];
  planCardHeight: number;
} {
  const plans = loadPlanPreviews(account);
  return { plans, planCardHeight: planCardHeight(plans.length) };
}

function clearPlanTransitionTimers(): void {
  if (planCompletionTimer !== undefined) {
    clearTimeout(planCompletionTimer);
    planCompletionTimer = undefined;
  }
  if (planRemovalTimer !== undefined) {
    clearTimeout(planRemovalTimer);
    planRemovalTimer = undefined;
  }
  if (planEntryTimer !== undefined) {
    clearTimeout(planEntryTimer);
    planEntryTimer = undefined;
  }
}

function mergeMessagePreviews(
  incoming: MessagePreview[],
  existing: MessagePreview[],
  semesterBoundary: StartedSemesterBoundary | null,
): MessagePreview[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
    .filter((item) =>
      isCurrentSemesterTimestamp(item.sourceCreatedAt, semesterBoundary),
    )
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, HOME_PREVIEW_ITEM_LIMIT);
}

function mergeNoticePreviews(
  incoming: NoticePreview[],
  existing: NoticePreview[],
  semesterBoundary: StartedSemesterBoundary | null,
): NoticePreview[] {
  const seen = new Set<string>();
  const merged = [...incoming, ...existing].filter((item) => {
    const identity = item.id || item.link;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return latestSchoolNoticeItems(merged, semesterBoundary).slice(
    0,
    HOME_PREVIEW_ITEM_LIMIT,
  );
}

function latestSchoolNoticeItems<T extends NoticePreview>(
  items: T[],
  semesterBoundary: StartedSemesterBoundary | null,
): T[] {
  const latestSemesterId = latestSchoolNoticeSemesterId(items);
  return items.filter((item) =>
    isLatestSchoolNoticeSemesterAssignment(
      item.semesterId,
      latestSemesterId,
      item.publishedAt,
      semesterBoundary,
    ),
  );
}

function cachedDashboardState(account: string, animateGrades: boolean) {
  const cached =
    cleanupTeachingPreview(account) || loadTeachingPreview(account);
  const timetable = loadTimetableSnapshot(account);
  const preferences = loadPreferences();
  const grades =
    loadGradesSnapshotForPreference(account, preferences.showGradesBelow60) ||
    loadGradesSnapshot(account);
  const semesterBoundary = startedCurrentSemester(timetable?.data || null);
  const messages = (cached?.messages || [])
    .filter((message) =>
      isCurrentSemesterTimestamp(message.createdAt, semesterBoundary),
    )
    .slice(0, HOME_PREVIEW_ITEM_LIMIT)
    .map(toMessagePreview);
  const notices = latestSchoolNoticeItems(
    (cached?.notices || []).map(toNoticePreview),
    semesterBoundary,
  ).slice(0, HOME_PREVIEW_ITEM_LIMIT);
  return {
    key: [
      account,
      cached?.updatedAt || 0,
      timetable?.localStoredAt || 0,
      grades?.localStoredAt || 0,
      grades?.serverFetchedAt || "",
      preferences.showGradesBelow60 ? 1 : 0,
    ].join(":"),
    timetable: timetable?.data || null,
    hasGrades: Boolean(grades),
    patch: {
      messages,
      notices,
      ...(grades ? gradePreviewPatch(grades.data, animateGrades) : {}),
      loaded:
        messages.length > 0 ||
        notices.length > 0 ||
        Boolean(timetable) ||
        Boolean(grades),
    },
  };
}

function preloadNextPrimaryTabFramework(): void {
  if (nextPrimaryTabFrameworkPreloadStarted) return;
  nextPrimaryTabFrameworkPreloadStarted = true;
  if (typeof wx.preloadSkylineView !== "function") return;
  try {
    wx.preloadSkylineView();
  } catch {
    // 预加载失败时仍使用标准 Tab 切换。
  }
}

function clearDashboardTeachingFollowupTimer(): void {
  if (dashboardTeachingFollowupTimer === undefined) return;
  clearTimeout(dashboardTeachingFollowupTimer);
  dashboardTeachingFollowupTimer = undefined;
}

function clearHomeActivationTimer(): void {
  if (homeActivationTimer === undefined) return;
  clearTimeout(homeActivationTimer);
  homeActivationTimer = undefined;
}

Page({
  data: {
    ...INITIAL_HOME_APPEARANCE,
    appName: APP_NAME,
    authenticated: INITIAL_HOME_AUTHENTICATED,
    loading: false,
    loaded: false,
    errorMessage: "",
    serviceHealthy: false,
    serviceLabel: "正在连接服务",
    greeting: getGreeting(),
    dateLabel: formatFriendlyDate(today()),
    userName: "",
    organizationName: "",
    currentTime: formatClock(),
    todayCourses: [] as TodayCoursePreview[],
    remainingCourseCount: 0,
    timetableCardRadius: getTimetableCardRadius(
      INITIAL_HOME_APPEARANCE.visualTheme,
    ),
    campusCardRadius: getCampusCardRadius(INITIAL_HOME_APPEARANCE.visualTheme),
    examCardRadius: getCampusCardRadius(INITIAL_HOME_APPEARANCE.visualTheme),
    gradeCardRadius: getFeatureCardRadius(INITIAL_HOME_APPEARANCE.visualTheme),
    electricityCardRadius: getFeatureCardRadius(
      INITIAL_HOME_APPEARANCE.visualTheme,
    ),
    gradeRingSource: progressRingSource(null),
    gradeAverageLabel: "—",
    gradePointAverageLabel: "—",
    gradeCourseCount: 0,
    showGradesOnHome: INITIAL_HOME_PREFERENCES.showGradesOnHome,
    hiddenGradeRingSource: progressRingSource(null),
    electricityBound: false,
    electricityBalanceLabel: "—",
    electricityUsageLabel: "绑定寝室后查看",
    examPreviews: [] as ExamPreview[],
    examEmptyLabel: "暂时没有考试安排",
    plans: [] as PlanPreview[],
    planCardHeight: PLAN_CARD_MIN_HEIGHT_RPX,
    completingPlanId: "",
    removingPlanId: "",
    enteringPlanId: "",
    messages: [] as MessagePreview[],
    notices: [] as NoticePreview[],
    publications: [] as PublicationPreview[],
    publicationUnreadCount: 0,
    publicationUnreadLabel: "",
    copiedCodeKey: "",
    petShape: "blob" as PetShapeId,
    petColor: "#111214",
    petEnhanced: false,
    petSelected: false,
    petVisible: false,
    petReducedMotion: INITIAL_HOME_APPEARANCE.motionClass === "motion-reduced",
    petSetupDrawerMounted: false,
    petSetupDrawerOpen: false,
    publicationPanelMounted: false,
    publicationPanelOpen: false,
    publicationPanelTop: 132,
    publicationPanelTransformOrigin: "318px -31px",
    publicationPanelScrollHeight: 0,
    announcementModalMounted: false,
    announcementModalOpen: false,
    announcementScrollHeight: 0,
    activeAnnouncement: null as PublicationPreview | null,
  },
  onLoad() {
    registerHomeAuthenticationHost(this);
    homeVisible = false;
    homeReady = false;
    authenticationRevealPrepared = false;
    clearHomeActivationTimer();
    clearPlanTransitionTimers();
    hydratedAccount = "";
    hydratedDashboardKey = "";
    activeTimetable = null;
    cancelPendingAnnouncementPresentation();
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
      petSetupDrawerTimer = undefined;
    }
    credentialPollAttempt = 0;
    credentialProfileRefreshPending = false;
    lastPublicationRequestAt = 0;
    publicationRefreshQueued = false;
    dashboardTeachingRefreshQueued = false;
    dashboardStableRefreshQueued = false;
    clearDashboardTeachingFollowupTimer();
    this.applyAppearance();
    if (getSession()?.token) {
      if (!this.data.authenticated) this.setData({ authenticated: true });
      this.hydrateIdentity();
      const account = getSession()?.user.account || "";
      if (account) {
        this.hydratePet(account);
        this.hydrateCachedDashboard();
        this.hydrateShortcutCaches();
        this.setData(planPreviewPatch(account));
      }
    } else {
      this.prepareForAuthenticationRequired();
    }
  },
  onReady() {
    homeReady = true;
    const delay = authenticationRevealPrepared
      ? HOME_LOGIN_REVEAL_SETTLE_MS
      : HOME_FIRST_FRAME_SETTLE_MS;
    authenticationRevealPrepared = false;
    this.scheduleHomeActivation(delay);
  },
  onShow() {
    if (!ensureAuthenticated()) {
      homeVisible = false;
      clearHomeActivationTimer();
      return;
    }
    homeVisible = true;
    void preloadAutoDormCheckStatus().catch(() => undefined);
    if (this.data.authenticated) {
      this.applyAppearance();
      this.hydrateIdentity();
    } else {
      this.prepareForAuthenticatedReveal();
    }
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      visualThemeClass: this.data.visualThemeClass,
      motionClass: this.data.motionClass,
      hidden: this.data.petSetupDrawerMounted,
    });
    if (homeReady) {
      const delay = authenticationRevealPrepared
        ? HOME_LOGIN_REVEAL_SETTLE_MS
        : 0;
      authenticationRevealPrepared = false;
      this.scheduleHomeActivation(delay);
    }
  },
  prepareForAuthenticationRequired(onReady?: () => void) {
    homeVisible = false;
    authenticationRevealPrepared = false;
    clearHomeActivationTimer();
    clearDashboardTeachingFollowupTimer();
    clearPlanTransitionTimers();
    this.stopCourseClock();
    this.stopCredentialPoll();
    this.setTabBarHidden(true);
    hydratedAccount = "";
    hydratedDashboardKey = "";
    activeTimetable = null;
    queuedAnnouncements = [];
    publicationRefreshQueued = false;
    credentialProfileRefreshPending = false;
    automaticPopupsThisEntry = new Set<string>();
    automaticPopupEntryKey = "";
    cancelPendingAnnouncementPresentation();
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
      petSetupDrawerTimer = undefined;
    }
    if (publicationPanelTimer !== undefined) {
      clearTimeout(publicationPanelTimer);
      publicationPanelTimer = undefined;
    }
    if (announcementModalTimer !== undefined) {
      clearTimeout(announcementModalTimer);
      announcementModalTimer = undefined;
    }
    if (!this.data.authenticated) {
      wx.nextTick(() => onReady?.());
      return;
    }
    this.setData(
      {
        authenticated: false,
        loading: false,
        loaded: false,
        errorMessage: "",
        serviceHealthy: false,
        serviceLabel: "正在连接服务",
        userName: "",
        organizationName: "",
        todayCourses: [],
        remainingCourseCount: 0,
        gradeRingSource: progressRingSource(null),
        gradeAverageLabel: "—",
        gradePointAverageLabel: "—",
        gradeCourseCount: 0,
        electricityBound: false,
        electricityBalanceLabel: "—",
        electricityUsageLabel: "绑定寝室后查看",
        examPreviews: [],
        examEmptyLabel: "暂时没有考试安排",
        plans: [],
        planCardHeight: PLAN_CARD_MIN_HEIGHT_RPX,
        completingPlanId: "",
        removingPlanId: "",
        enteringPlanId: "",
        messages: [],
        notices: [],
        publications: [],
        publicationUnreadCount: 0,
        publicationUnreadLabel: "",
        petShape: "blob",
        petColor: "#111214",
        petEnhanced: false,
        petSelected: false,
        petVisible: false,
        petSetupDrawerMounted: false,
        petSetupDrawerOpen: false,
        publicationPanelMounted: false,
        publicationPanelOpen: false,
        publicationPanelScrollHeight: 0,
        announcementModalMounted: false,
        announcementModalOpen: false,
        announcementScrollHeight: 0,
        activeAnnouncement: null,
      },
      () => wx.nextTick(() => onReady?.()),
    );
  },
  prepareForAuthenticatedReveal(onReady?: () => void) {
    const session = getSession();
    if (!session?.token) {
      this.prepareForAuthenticationRequired(onReady);
      return;
    }
    const lease = captureSessionLease(session);
    if (!lease) {
      this.prepareForAuthenticationRequired(onReady);
      return;
    }
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    const identity = resolveHomeIdentity(session, loadCurrentUser());
    const account = lease.account;
    const dashboard = cachedDashboardState(
      account,
      appearance.motionClass !== "motion-reduced",
    );
    hydratedAccount = account;
    hydratedDashboardKey = dashboard.key;
    activeTimetable = dashboard.timetable;
    const now = new Date();
    syncWindowBackground(appearance);
    authenticationRevealPrepared = true;
    this.setData(
      {
        authenticated: true,
        ...appearance,
        ...identity,
        timetableCardRadius: getTimetableCardRadius(appearance.visualTheme),
        campusCardRadius: getCampusCardRadius(appearance.visualTheme),
        examCardRadius: getCampusCardRadius(appearance.visualTheme),
        gradeCardRadius: getFeatureCardRadius(appearance.visualTheme),
        electricityCardRadius: getFeatureCardRadius(appearance.visualTheme),
        showGradesOnHome: preferences.showGradesOnHome,
        petReducedMotion: appearance.motionClass === "motion-reduced",
        ...dashboard.patch,
        ...shortcutCachePatch(account, activeTimetable),
        ...planPreviewPatch(account),
        currentTime: formatClock(now),
        todayCourses: todayCoursePreview(now),
        remainingCourseCount: remainingCourses(activeTimetable, now).length,
      },
      () => {
        if (!isSessionLeaseCurrent(lease)) return;
        this.hydratePet(account);
        const tabBar = this.getTabBar();
        const finish = () =>
          wx.nextTick(() => {
            if (isSessionLeaseCurrent(lease)) onReady?.();
          });
        if (!tabBar) {
          finish();
          return;
        }
        tabBar.setData(
          {
            selected: 0,
            themeClass: appearance.themeClass,
            visualThemeClass: appearance.visualThemeClass,
            motionClass: appearance.motionClass,
            hidden: false,
          },
          () => {
            if (isSessionLeaseCurrent(lease)) finish();
          },
        );
      },
    );
  },
  scheduleHomeActivation(delay: number) {
    clearHomeActivationTimer();
    homeActivationTimer = setTimeout(() => {
      homeActivationTimer = undefined;
      if (homeVisible) this.activateHomeAfterFirstFrame();
    }, delay);
  },
  activateHomeAfterFirstFrame() {
    const sessionAccount = getSession()?.user.account || "";
    if (!sessionAccount || !homeVisible) return;
    this.hydratePet(sessionAccount);
    const petSetupPending = this.openPendingPetSetup(sessionAccount);
    const currentAutomaticPopupEntryKey = `${getApp<IAppOption>().globalData.foregroundEntryId}:${sessionAccount}`;
    if (currentAutomaticPopupEntryKey !== automaticPopupEntryKey) {
      automaticPopupEntryKey = currentAutomaticPopupEntryKey;
      automaticPopupsThisEntry = new Set<string>();
    }
    this.hydrateCachedDashboard();
    this.hydrateShortcutCaches();
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      visualThemeClass: this.data.visualThemeClass,
      motionClass: this.data.motionClass,
      hidden: petSetupPending,
    });
    this.updateTodayCourses();
    this.setData(planPreviewPatch(sessionAccount));
    this.stopCourseClock();
    courseClockTimer = setInterval(
      () => this.updateTodayCourses(),
      30000,
    ) as unknown as number;
    const credential = getSession()?.credential;
    if (credential) this.handleCredentialState(credential);
    void this.loadDashboard(false);
    void this.loadPublicationFeed();
    const lease = captureSessionLease();
    void Promise.all([
      refreshExamsOnForeground(),
      refreshElectricityOnForeground(),
    ]).then(() => {
      if (homeVisible && isSessionLeaseCurrent(lease)) {
        this.hydrateShortcutCaches();
      }
    });
    preloadNextPrimaryTabFramework();
  },
  onHide() {
    homeVisible = false;
    this.settlePlanTransition();
    clearHomeActivationTimer();
    clearDashboardTeachingFollowupTimer();
    this.stopCourseClock();
    this.stopCredentialPoll();
    this.resetPublicationLayers();
    if (!getSession()?.token) this.setTabBarHidden(true);
  },
  onUnload() {
    unregisterHomeAuthenticationHost(this);
    homeVisible = false;
    homeReady = false;
    clearHomeActivationTimer();
    clearDashboardTeachingFollowupTimer();
    clearPlanTransitionTimers();
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
      petSetupDrawerTimer = undefined;
    }
    this.stopCourseClock();
    this.stopCredentialPoll();
    this.resetPublicationLayers();
  },
  stopCourseClock() {
    if (courseClockTimer !== undefined) {
      clearInterval(courseClockTimer);
      courseClockTimer = undefined;
    }
  },
  settlePlanTransition() {
    if (
      planCompletionTimer === undefined &&
      planRemovalTimer === undefined &&
      planEntryTimer === undefined &&
      !this.data.completingPlanId &&
      !this.data.removingPlanId &&
      !this.data.enteringPlanId
    ) {
      return;
    }
    clearPlanTransitionTimers();
    const account = getSession()?.user.account || "";
    this.setData({
      ...planPreviewPatch(account),
      completingPlanId: "",
      removingPlanId: "",
      enteringPlanId: "",
    });
  },
  updateTodayCourses() {
    const now = new Date();
    const courses = todayCoursePreview(now);
    this.setData({
      currentTime: formatClock(now),
      todayCourses: courses,
      remainingCourseCount: remainingCourses(activeTimetable, now).length,
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData({
      ...appearance,
      timetableCardRadius: getTimetableCardRadius(appearance.visualTheme),
      campusCardRadius: getCampusCardRadius(appearance.visualTheme),
      examCardRadius: getCampusCardRadius(appearance.visualTheme),
      gradeCardRadius: getFeatureCardRadius(appearance.visualTheme),
      electricityCardRadius: getFeatureCardRadius(appearance.visualTheme),
      showGradesOnHome: preferences.showGradesOnHome,
      petReducedMotion: appearance.motionClass === "motion-reduced",
    });
  },
  hydratePet(account: string) {
    if (!account) return;
    const preferences = loadPetPreferences(account);
    this.setData({
      petShape: preferences.shape,
      petColor: preferences.color,
      petEnhanced: preferences.enhanced,
      petSelected: preferences.selected,
      petVisible: shouldShowPet(preferences),
    });
  },
  openPendingPetSetup(account: string): boolean {
    if (!account) return false;
    if (this.data.petSetupDrawerMounted) return true;
    const preferences = loadPetPreferences(account);
    if (preferences.completed) return false;
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
      petSetupDrawerTimer = undefined;
    }
    this.setData(
      {
        petShape: preferences.shape,
        petColor: preferences.color,
        petEnhanced: preferences.enhanced,
        petSelected: preferences.selected,
        petVisible: shouldShowPet(preferences),
        petSetupDrawerMounted: true,
        petSetupDrawerOpen: false,
      },
      () => {
        wx.nextTick(() => {
          if (this.data.petSetupDrawerMounted) {
            this.setData({ petSetupDrawerOpen: true });
          }
        });
      },
    );
    return true;
  },
  onPendingPetShapeChange(
    event: WechatMiniprogram.CustomEvent<{ shape: PetShapeId }>,
  ) {
    haptic("light");
    this.persistPendingPetSelection({ shape: event.detail.shape });
  },
  onPendingPetColorChange(
    event: WechatMiniprogram.CustomEvent<{ color: string }>,
  ) {
    haptic("light");
    if (!this.data.petSelected) {
      this.setData({ petColor: event.detail.color });
      return;
    }
    this.persistPendingPetSelection({ color: event.detail.color });
  },
  persistPendingPetSelection(patch: { shape?: PetShapeId; color?: string }) {
    const account = getSession()?.user.account || "";
    if (!account || !this.data.petSetupDrawerMounted) return;
    const preferences = savePetSelection(account, {
      shape: patch.shape ?? this.data.petShape,
      color: patch.color ?? this.data.petColor,
      enabled: true,
      enhanced: this.data.petEnhanced,
    });
    uploadLocalCompanionPreferences(account);
    this.setData({
      petShape: preferences.shape,
      petColor: preferences.color,
      petEnhanced: preferences.enhanced,
      petSelected: preferences.selected,
      petVisible: shouldShowPet(preferences),
    });
  },
  finishPendingPetSetup() {
    if (!this.data.petSetupDrawerMounted) return;
    const account = getSession()?.user.account || "";
    if (!account) return;
    if (!this.data.petSelected) {
      skipPetSetup(account);
      uploadLocalCompanionPreferences(account);
    }
    haptic("light");
    this.hydratePet(account);
    this.setData({ petSetupDrawerOpen: false });
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
    }
    petSetupDrawerTimer = setTimeout(() => {
      this.setData({ petSetupDrawerMounted: false });
      this.setTabBarHidden(false);
      petSetupDrawerTimer = undefined;
      if (homeVisible) this.showNextQueuedAnnouncement();
    }, 420);
  },
  hydrateIdentity(user?: CurrentUserData) {
    const identity = resolveHomeIdentity(
      getSession(),
      user || loadCurrentUser(),
    );
    if (!identity.userName) return;
    this.setData(identity);
  },
  hydrateShortcutCaches() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    this.setData(shortcutCachePatch(account));
  },
  hydrateCachedDashboard() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    const dashboard = cachedDashboardState(
      account,
      this.data.motionClass !== "motion-reduced",
    );
    if (hydratedDashboardKey === dashboard.key) return;
    const changedAccount = Boolean(
      hydratedAccount && hydratedAccount !== account,
    );
    hydratedAccount = account;
    hydratedDashboardKey = dashboard.key;
    activeTimetable = dashboard.timetable;
    this.setData({
      ...dashboard.patch,
      ...(!dashboard.hasGrades && changedAccount
        ? {
            gradeRingSource: progressRingSource(null),
            gradeAverageLabel: "—",
            gradePointAverageLabel: "—",
            gradeCourseCount: 0,
          }
        : {}),
      ...(changedAccount
        ? {
            publications: [],
            publicationUnreadCount: 0,
            publicationUnreadLabel: "",
          }
        : {}),
      ...(changedAccount ? { errorMessage: "" } : {}),
    });
    this.updateTodayCourses();
  },
  hydrateServerGrade(
    account: string,
    result: Awaited<ReturnType<typeof getGrades>>,
    refresh: boolean,
    includeUnsuccessful: boolean,
  ) {
    const local = loadGradesSnapshotForPreference(account, includeUnsuccessful);
    const useServer = shouldStoreServerSnapshot(local, result.meta, refresh);
    if (useServer) {
      saveGradesSnapshot(
        account,
        result.data,
        result.meta.fetchedAt,
        includeUnsuccessful,
      );
    }
    if (useServer && getSession()?.user.account === account) {
      this.setData(
        gradePreviewPatch(
          result.data,
          this.data.motionClass !== "motion-reduced",
        ),
      );
    }
  },
  hydrateServerTimetable(
    account: string,
    result: Awaited<ReturnType<typeof getTimetable>>,
    refresh: boolean,
  ) {
    const local = loadTimetableSnapshot(account);
    if (shouldStoreServerSnapshot(local, result.meta, refresh)) {
      activeTimetable = result.data;
      saveTimetableSnapshot(account, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
      });
    }
    activeTimetable = loadTimetableSnapshot(account)?.data || result.data;
    const now = new Date();
    const courses = todayCoursePreview(now);
    this.setData({
      currentTime: formatClock(now),
      todayCourses: courses,
      remainingCourseCount: remainingCourses(activeTimetable, now).length,
      ...shortcutCachePatch(account, activeTimetable),
    });
  },
  stopCredentialPoll() {
    if (credentialPollTimer !== undefined) {
      clearTimeout(credentialPollTimer);
      credentialPollTimer = undefined;
    }
    credentialPollAttempt = 0;
  },
  handleCredentialState(credential: CredentialState) {
    if (credential.status === "invalid") {
      this.stopCredentialPoll();
      credentialProfileRefreshPending = false;
      this.setData({
        serviceHealthy: false,
        serviceLabel: "正在显示缓存",
      });
      return;
    }
    if (credential.status === "pending") {
      credentialProfileRefreshPending = true;
      this.scheduleCredentialPoll();
      return;
    }
    this.stopCredentialPoll();
    const refreshProfile =
      credential.status === "verified" && credentialProfileRefreshPending;
    credentialProfileRefreshPending = false;
    if (refreshProfile) void this.refreshProfileAfterVerification();
    if (credential.status === "unavailable") {
      this.setData({
        serviceHealthy: false,
        serviceLabel: "校园验证暂不可用，正在显示缓存",
      });
    }
  },
  async refreshProfileAfterVerification() {
    const lease = captureSessionLease();
    if (!lease) return;
    try {
      const user = await getPreloadedCurrentUser(true);
      if (!user || !homeVisible || !isSessionLeaseCurrent(lease)) return;
      this.hydrateIdentity(user);
      this.hydratePet(lease.account);
      void this.loadPublicationFeed(true);
    } catch {
      // 继续显示已有资料；下一次进入前台时会再次读取服务器版本。
    }
  },
  scheduleCredentialPoll() {
    if (credentialPollTimer !== undefined || !homeVisible) return;
    const delay =
      CREDENTIAL_POLL_DELAYS_MS[
        Math.min(credentialPollAttempt, CREDENTIAL_POLL_DELAYS_MS.length - 1)
      ];
    credentialPollAttempt += 1;
    credentialPollTimer = setTimeout(async () => {
      credentialPollTimer = undefined;
      if (!homeVisible) return;
      const lease = captureSessionLease();
      if (!lease) return;
      try {
        const credential = await getCredentialStatus();
        if (homeVisible && isSessionLeaseCurrent(lease)) {
          this.handleCredentialState(credential);
        }
      } catch {
        // 普通网络失败不应清除仍然有效的本地会话。
      }
    }, delay) as unknown as number;
  },
  async loadPublicationFeed(force = false) {
    const lease = captureSessionLease();
    if (!lease) return;
    const sessionKey = sessionLeaseKey(lease);
    const now = Date.now();
    if (
      publicationRequestLease &&
      isSessionLeaseCurrent(publicationRequestLease)
    ) {
      if (force) publicationRefreshQueued = true;
      return;
    }
    if (publicationRefreshQueued) {
      force = true;
      publicationRefreshQueued = false;
    }
    if (
      !force &&
      lastPublicationRequestSessionKey === sessionKey &&
      now - lastPublicationRequestAt < PUBLICATION_REFRESH_THROTTLE_MS
    ) {
      return;
    }
    lastPublicationRequestAt = now;
    lastPublicationRequestSessionKey = sessionKey;
    publicationRequestLease = lease;
    try {
      const feed = await getPublicationFeed();
      if (!homeVisible || !isSessionLeaseCurrent(lease)) return;
      const expandedIds = new Set(
        this.data.publications
          .filter((item) => item.kind === "notification" && item.expanded)
          .map((item) => item.id),
      );
      const publications = sortPublicationsNewestFirst(feed.items).map((item) =>
        publicationPreview(
          item,
          item.kind === "notification" && expandedIds.has(item.id),
          this.data.theme,
        ),
      );
      this.setData({
        publications,
        publicationUnreadCount: feed.unreadCount,
        publicationUnreadLabel:
          feed.unreadCount > 99 ? "99+" : String(feed.unreadCount || ""),
      });

      if (homeVisible && !this.data.announcementModalMounted) {
        queuedAnnouncements = feed.announcements.filter(
          (item) =>
            item.shouldPopup &&
            item.id !== pendingAnnouncementId &&
            !automaticPopupsThisEntry.has(item.id),
        );
        if (!this.data.petSetupDrawerMounted) {
          this.showNextQueuedAnnouncement();
        }
      }
    } catch {
      // 平台公告是附加信息。刷新失败时保留当前内容，不打断主页使用。
    } finally {
      if (publicationRequestLease === lease) publicationRequestLease = null;
      const refreshQueued = publicationRefreshQueued;
      if (refreshQueued && homeVisible && isSessionLeaseCurrent(lease)) {
        publicationRefreshQueued = false;
        void this.loadPublicationFeed(true);
      }
    }
  },
  togglePublicationPanel() {
    haptic("light");
    if (this.data.publicationPanelOpen) {
      this.closePublicationPanel();
      return;
    }
    if (publicationPanelTimer !== undefined) {
      clearTimeout(publicationPanelTimer);
      publicationPanelTimer = undefined;
    }
    this.createSelectorQuery()
      .select(".publication-bell")
      .boundingClientRect((rect) => {
        const windowWidth = wx.getWindowInfo().windowWidth || 375;
        const panelInset = (24 * windowWidth) / 750;
        const rectLeft = Number(rect?.left);
        const rectTop = Number(rect?.top);
        const rectWidth = Number(rect?.width);
        const rectHeight = Number(rect?.height);
        const bottom = Number(rect?.bottom);
        const panelTop = Number.isFinite(bottom) ? bottom + 10 : 132;
        const originX =
          Number.isFinite(rectLeft) && Number.isFinite(rectWidth)
            ? rectLeft + rectWidth / 2 - panelInset
            : windowWidth - (114 * windowWidth) / 750;
        const originY =
          Number.isFinite(rectTop) && Number.isFinite(rectHeight)
            ? rectTop + rectHeight / 2 - panelTop
            : -(42 * windowWidth) / 750 - 10;
        this.setData(
          {
            publicationPanelMounted: true,
            publicationPanelTop: panelTop,
            publicationPanelTransformOrigin: `${originX}px ${originY}px`,
            publicationPanelScrollHeight: 1,
          },
          () => {
            this.measurePublicationPanel(true);
          },
        );
      })
      .exec();
  },
  measurePublicationPanel(openAfterMeasure: boolean) {
    setTimeout(() => {
      if (!this.data.publicationPanelMounted) return;
      const windowInfo = wx.getWindowInfo();
      const windowWidth = windowInfo.windowWidth || 375;
      const windowHeight = windowInfo.windowHeight || 667;
      const fixedPanelHeight = (680 * windowWidth) / 750;
      const maxPanelHeight = windowHeight * 0.62;
      const panelHeight = Math.min(fixedPanelHeight, maxPanelHeight);
      this.createSelectorQuery()
        .select(".publication-popover-header")
        .boundingClientRect()
        .exec((results) => {
          if (!this.data.publicationPanelMounted) return;
          const headerHeight =
            Number(results?.[0]?.height) || (96 * windowWidth) / 750;
          const publicationPanelScrollHeight = Math.ceil(
            Math.max(1, panelHeight - headerHeight),
          );
          this.setData({ publicationPanelScrollHeight }, () => {
            if (openAfterMeasure && homeVisible) {
              this.setData({ publicationPanelOpen: true });
            }
          });
        });
    }, 16);
  },
  closePublicationPanel() {
    if (!this.data.publicationPanelMounted) return;
    this.setData({ publicationPanelOpen: false });
    if (publicationPanelTimer !== undefined) {
      clearTimeout(publicationPanelTimer);
    }
    publicationPanelTimer = setTimeout(() => {
      this.setData({
        publicationPanelMounted: false,
        publicationPanelScrollHeight: 0,
      });
      publicationPanelTimer = undefined;
    }, 260) as unknown as number;
  },
  resetPublicationLayers() {
    cancelPendingAnnouncementPresentation();
    clearCodeCopyFeedbackTimer();
    if (publicationPanelTimer !== undefined) {
      clearTimeout(publicationPanelTimer);
      publicationPanelTimer = undefined;
    }
    if (announcementModalTimer !== undefined) {
      clearTimeout(announcementModalTimer);
      announcementModalTimer = undefined;
    }
    queuedAnnouncements = [];
    this.setTabBarHidden(false);
    this.setData({
      publicationPanelMounted: false,
      publicationPanelOpen: false,
      publicationPanelScrollHeight: 0,
      announcementModalMounted: false,
      announcementModalOpen: false,
      announcementScrollHeight: 0,
      activeAnnouncement: null,
      copiedCodeKey: "",
    });
  },
  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden });
  },
  stopPropagation() {},
  copyCodeBlock(event: WechatMiniprogram.TouchEvent) {
    const value = event.currentTarget.dataset.code;
    const copyKey = String(event.currentTarget.dataset.copyKey || "");
    const code = typeof value === "string" ? value : String(value || "");
    clearCodeCopyFeedbackTimer();
    this.setData({ copiedCodeKey: copyKey });
    haptic("light");
    codeCopyFeedbackTimer = setTimeout(() => {
      if (this.data.copiedCodeKey === copyKey) {
        this.setData({ copiedCodeKey: "" });
      }
      codeCopyFeedbackTimer = undefined;
    }, CODE_COPY_FEEDBACK_MS);
    wx.nextTick(() => {
      wx.setClipboardData({
        data: code,
        fail: () => {
          clearCodeCopyFeedbackTimer();
          if (this.data.copiedCodeKey === copyKey) {
            this.setData({ copiedCodeKey: "" });
          }
        },
      });
    });
  },
  onPublicationTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const publication = this.data.publications.find((item) => item.id === id);
    if (!publication) return;
    if (publication.kind === "announcement") {
      haptic("light");
      queuedAnnouncements = [];
      this.closePublicationPanel();
      void this.presentAnnouncement(publication, false);
      return;
    }

    const wasUnread = !publication.isRead;
    const publicationUnreadCount = wasUnread
      ? Math.max(0, this.data.publicationUnreadCount - 1)
      : this.data.publicationUnreadCount;
    this.setData({
      publications: this.data.publications.map((item) =>
        item.id === id
          ? {
              ...item,
              isRead: true,
              expanded: item.isLong ? !item.expanded : item.expanded,
            }
          : item,
      ),
      publicationUnreadCount,
      publicationUnreadLabel:
        publicationUnreadCount > 99
          ? "99+"
          : String(publicationUnreadCount || ""),
    });
    haptic("light");
    if (wasUnread) {
      void markPublicationRead(id).catch(() => undefined);
    }
  },
  showNextQueuedAnnouncement() {
    if (
      !homeVisible ||
      this.data.petSetupDrawerMounted ||
      this.data.announcementModalMounted ||
      announcementPresentationPending ||
      !queuedAnnouncements.length
    ) {
      return;
    }
    const next = queuedAnnouncements.shift();
    if (next) void this.presentAnnouncement(next, true);
  },
  async presentAnnouncement(
    publication: Publication | PublicationPreview,
    automatic: boolean,
  ) {
    const lease = captureSessionLease();
    if (!lease) return;
    const generation = ++announcementPresentationGeneration;
    announcementPresentationPending = true;
    pendingAnnouncementId = publication.id;
    let preview = publicationPreview(publication, false, this.data.theme);
    this.closePublicationPanel();
    try {
      if (preview.media.length) {
        const mediaUrls = await preloadPublicationMedia(preview.media);
        if (
          generation !== announcementPresentationGeneration ||
          !homeVisible ||
          !isSessionLeaseCurrent(lease)
        ) {
          return;
        }
        preview = {
          ...preview,
          contentBlocks: renderMarkdownBlocks(preview.contentMarkdown, {
            accentColor: preview.accentColor,
            mediaUrls,
            theme: this.data.theme,
          }),
        };
      }
      if (
        generation !== announcementPresentationGeneration ||
        !homeVisible ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setTabBarHidden(true);
      this.setData(
        {
          activeAnnouncement: preview,
          announcementModalMounted: true,
          announcementScrollHeight: 1,
        },
        () => this.measureAnnouncementModal(preview.id, true),
      );
      this.markPublicationLocallyRead(preview.id);
      if (automatic) {
        automaticPopupsThisEntry.add(preview.id);
        void recordAnnouncementPopup(preview.id).catch(() => undefined);
      } else if (!preview.isRead) {
        void markPublicationRead(preview.id).catch(() => undefined);
      }
    } finally {
      if (generation === announcementPresentationGeneration) {
        announcementPresentationPending = false;
        pendingAnnouncementId = "";
      }
    }
  },
  measureAnnouncementModal(
    id: string,
    openAfterMeasure: boolean,
    contentProbeReady = false,
    attempt = 0,
  ) {
    setTimeout(() => {
      if (
        !this.data.announcementModalMounted ||
        this.data.activeAnnouncement?.id !== id
      ) {
        return;
      }
      const windowInfo = wx.getWindowInfo();
      const windowWidth = windowInfo.windowWidth || 375;
      const windowHeight = windowInfo.windowHeight || 667;
      const safeAreaBottom = Number(windowInfo.safeArea?.bottom);
      const safeAreaInset = Number.isFinite(safeAreaBottom)
        ? Math.max(0, windowHeight - safeAreaBottom)
        : 0;
      const maxModalHeight = windowHeight * 0.86;
      this.createSelectorQuery()
        .select(".announcement-header")
        .boundingClientRect()
        .select(".announcement-footer")
        .boundingClientRect()
        .select(".announcement-article")
        .boundingClientRect()
        .select(".announcement-content-end")
        .boundingClientRect()
        .exec((results) => {
          if (
            !this.data.announcementModalMounted ||
            this.data.activeAnnouncement?.id !== id
          ) {
            return;
          }
          const headerHeight =
            Number(results?.[0]?.height) || (186 * windowWidth) / 750;
          const footerHeight =
            Number(results?.[1]?.height) || (140 * windowWidth) / 750;
          const maxScrollHeight = Math.max(
            1,
            maxModalHeight - headerHeight - footerHeight - safeAreaInset,
          );
          const probeContentHeight = Math.min(
            maxScrollHeight,
            (180 * windowWidth) / 750,
          );
          if (!contentProbeReady) {
            this.setData(
              { announcementScrollHeight: Math.ceil(probeContentHeight) },
              () => {
                wx.nextTick(() =>
                  wx.nextTick(() =>
                    this.measureAnnouncementModal(id, openAfterMeasure, true),
                  ),
                );
              },
            );
            return;
          }
          const measuredContentHeight =
            (Number(results?.[2]?.height) || 0) +
            (Number(results?.[3]?.height) || 0);
          if (
            (!Number.isFinite(measuredContentHeight) ||
              measuredContentHeight <= 1) &&
            attempt < 2
          ) {
            wx.nextTick(() =>
              this.measureAnnouncementModal(
                id,
                openAfterMeasure,
                true,
                attempt + 1,
              ),
            );
            return;
          }
          const contentHeight =
            Number.isFinite(measuredContentHeight) && measuredContentHeight > 0
              ? measuredContentHeight
              : probeContentHeight;
          const announcementScrollHeight = Math.ceil(
            Math.min(maxScrollHeight, contentHeight),
          );
          this.setData({ announcementScrollHeight }, () => {
            if (
              openAfterMeasure &&
              homeVisible &&
              this.data.activeAnnouncement?.id === id
            ) {
              this.setData({ announcementModalOpen: true });
            }
          });
        });
    }, 16);
  },
  markPublicationLocallyRead(id: string) {
    const wasUnread = this.data.publications.some(
      (item) => item.id === id && !item.isRead,
    );
    if (!wasUnread) return;
    const publicationUnreadCount = Math.max(
      0,
      this.data.publicationUnreadCount - 1,
    );
    this.setData({
      publications: this.data.publications.map((item) =>
        item.id === id ? { ...item, isRead: true } : item,
      ),
      publicationUnreadCount,
      publicationUnreadLabel:
        publicationUnreadCount > 99
          ? "99+"
          : String(publicationUnreadCount || ""),
    });
  },
  closeAnnouncementModal() {
    if (!this.data.announcementModalMounted) return;
    haptic("light");
    this.setData({ announcementModalOpen: false });
    if (announcementModalTimer !== undefined) {
      clearTimeout(announcementModalTimer);
    }
    announcementModalTimer = setTimeout(() => {
      this.setData({
        announcementModalMounted: false,
        announcementScrollHeight: 0,
        activeAnnouncement: null,
      });
      announcementModalTimer = undefined;
      setTimeout(() => {
        if (homeVisible && queuedAnnouncements.length) {
          this.showNextQueuedAnnouncement();
        } else {
          this.setTabBarHidden(false);
        }
      }, 90);
    }, 280) as unknown as number;
  },
  async loadDashboard(
    refreshTeaching: boolean,
    includeStableData = true,
    refreshStable = refreshTeaching,
    allowTeachingFollowup = true,
  ) {
    const lease = captureSessionLease();
    if (!lease) return;
    if (dashboardRequestLease && isSessionLeaseCurrent(dashboardRequestLease)) {
      if (refreshTeaching) dashboardTeachingRefreshQueued = true;
      if (includeStableData && refreshStable) {
        dashboardStableRefreshQueued = true;
      }
      return;
    }
    dashboardRequestLease = lease;

    this.setData({
      loading: false,
      errorMessage: "",
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });

    const account = lease.account;
    const includeUnsuccessful = loadPreferences().showGradesBelow60;
    const profileInitializationPending =
      getSession()?.credential.status === "pending";
    const userRequest = includeStableData
      ? getPreloadedCurrentUser(refreshTeaching).then((user) => {
          if (
            user &&
            isSessionLeaseCurrent(lease) &&
            profileInitializationPending &&
            user.credential.status === "verified"
          ) {
            if (homeVisible) void this.loadPublicationFeed(true);
            else publicationRefreshQueued = true;
          }
          if (user && homeVisible && isSessionLeaseCurrent(lease)) {
            this.hydrateIdentity(user);
            this.hydratePet(account);
            if (
              profileInitializationPending &&
              user.credential.status === "verified"
            ) {
              credentialProfileRefreshPending = false;
            }
            this.handleCredentialState(user.credential);
            const preferences = loadPetPreferences(account);
            if (preferences.completed && this.data.petSetupDrawerMounted) {
              this.setData({
                petSetupDrawerOpen: false,
                petSetupDrawerMounted: false,
              });
              this.setTabBarHidden(false);
            }
          }
          return user;
        })
      : Promise.resolve(null);
    const messageRequest = getMessages({
      page: 1,
      pageSize: 15,
      refresh: refreshTeaching,
      automatic: true,
    }).then((result) => {
      if (homeVisible && isSessionLeaseCurrent(lease)) {
        if (!refreshTeaching || isUpstreamRefreshResult(result.meta)) {
          saveTeachingPreview(account, { messages: result.data.items });
        }
        this.setData({
          messages: mergeMessagePreviews(
            result.data.items.map(toMessagePreview),
            this.data.messages,
            startedCurrentSemester(activeTimetable),
          ),
        });
      }
      return result;
    });
    const noticeRequest = getNotices({
      page: 1,
      pageSize: 50,
      refresh: refreshTeaching,
      automatic: true,
    }).then((result) => {
      if (homeVisible && isSessionLeaseCurrent(lease)) {
        if (!refreshTeaching || isUpstreamRefreshResult(result.meta)) {
          saveTeachingPreview(account, { notices: result.data.items });
        }
        this.setData({
          notices: mergeNoticePreviews(
            result.data.items.map(toNoticePreview),
            this.data.notices,
            startedCurrentSemester(activeTimetable),
          ),
        });
      }
      return result;
    });
    const gradeRequest = includeStableData
      ? getGrades({
          page: 1,
          pageSize: 5000,
          includeUnsuccessful,
          refresh: refreshStable,
          automatic: refreshStable,
        }).then((result) => {
          if (isSessionLeaseCurrent(lease)) {
            this.hydrateServerGrade(
              account,
              result,
              refreshStable,
              includeUnsuccessful,
            );
          }
          return result;
        })
      : Promise.resolve(null);
    const timetableRequest = includeStableData
      ? (refreshStable
          ? getTimetable({ refresh: true, automatic: true })
          : getPreloadedTimetable()
        ).then((result) => {
          if (result && homeVisible && isSessionLeaseCurrent(lease)) {
            this.hydrateServerTimetable(account, result, refreshStable);
          }
          return result;
        })
      : Promise.resolve(null);
    const [
      userResult,
      messageResult,
      noticeResult,
      gradeResult,
      timetableResult,
    ] = await Promise.allSettled([
      userRequest,
      messageRequest,
      noticeRequest,
      gradeRequest,
      timetableRequest,
    ]);

    if (!homeVisible || !isSessionLeaseCurrent(lease)) {
      if (dashboardRequestLease === lease) {
        dashboardRequestLease = null;
        dashboardTeachingRefreshQueued = false;
        dashboardStableRefreshQueued = false;
      }
      return;
    }

    const serviceHealthy =
      (includeStableData && userResult.status === "fulfilled") ||
      messageResult.status === "fulfilled" ||
      noticeResult.status === "fulfilled" ||
      (includeStableData && gradeResult.status === "fulfilled") ||
      (includeStableData && timetableResult.status === "fulfilled");
    const patch: Record<string, unknown> = {
      loading: false,
      loaded: true,
      serviceHealthy,
      serviceLabel: serviceHealthy ? "服务连接正常" : "服务连接异常",
    };
    if (userResult.status === "fulfilled" && userResult.value) {
      Object.assign(patch, resolveHomeIdentity(getSession(), userResult.value));
      this.handleCredentialState(userResult.value.credential);
    }
    const semesterBoundary = startedCurrentSemester(activeTimetable);
    patch.messages = this.data.messages.filter((item) =>
      isCurrentSemesterTimestamp(item.sourceCreatedAt, semesterBoundary),
    );
    patch.notices = latestSchoolNoticeItems(
      this.data.notices,
      semesterBoundary,
    );
    if (messageResult.status === "fulfilled") {
      if (
        !refreshTeaching ||
        isUpstreamRefreshResult(messageResult.value.meta)
      ) {
        saveTeachingPreview(account, {
          messages: messageResult.value.data.items,
        });
      }
      patch.messages = mergeMessagePreviews(
        messageResult.value.data.items.map(toMessagePreview),
        this.data.messages,
        semesterBoundary,
      );
    }
    if (noticeResult.status === "fulfilled") {
      if (
        !refreshTeaching ||
        isUpstreamRefreshResult(noticeResult.value.meta)
      ) {
        saveTeachingPreview(account, {
          notices: noticeResult.value.data.items,
        });
      }
      patch.notices = mergeNoticePreviews(
        noticeResult.value.data.items.map(toNoticePreview),
        this.data.notices,
        semesterBoundary,
      );
    }
    if (
      messageResult.status === "rejected" &&
      noticeResult.status === "rejected"
    ) {
      patch.errorMessage = getErrorMessage(
        messageResult.reason,
        "动态暂时加载失败，请稍后再试。",
      );
    }
    this.setData(patch);
    const needsFreshResult =
      !refreshTeaching &&
      ((messageResult.status === "fulfilled" &&
        messageResult.value.meta.refreshing) ||
        (noticeResult.status === "fulfilled" &&
          noticeResult.value.meta.refreshing));
    if (!refreshStable && includeStableData) {
      const stableDataStale =
        (isCacheStale(loadGradesSnapshot(account), FIFTEEN_DAYS_MS) &&
          claimAutomaticRefresh("grades", account)) ||
        (isCacheStale(loadTimetableSnapshot(account), FIFTEEN_DAYS_MS) &&
          claimAutomaticRefresh("timetable", account));
      if (stableDataStale) {
        dashboardStableRefreshQueued = true;
      }
    }
    if (dashboardRequestLease === lease) dashboardRequestLease = null;
    const queuedTeachingRefresh = dashboardTeachingRefreshQueued;
    const queuedStableRefresh = dashboardStableRefreshQueued;
    dashboardTeachingRefreshQueued = false;
    dashboardStableRefreshQueued = false;
    if (queuedTeachingRefresh || queuedStableRefresh) {
      setTimeout(
        () =>
          void this.loadDashboard(
            queuedTeachingRefresh,
            true,
            queuedStableRefresh,
          ),
        0,
      );
    }
    if (
      needsFreshResult &&
      allowTeachingFollowup &&
      dashboardTeachingFollowupTimer === undefined
    ) {
      dashboardTeachingFollowupTimer = setTimeout(() => {
        dashboardTeachingFollowupTimer = undefined;
        if (homeVisible) {
          void this.loadDashboard(false, false, false, false);
        }
      }, TEACHING_BACKGROUND_FOLLOWUP_MS);
    }
  },
  retryDashboard() {
    haptic("light");
    void this.loadDashboard(true);
    void this.loadPublicationFeed();
  },
  onQuickAction(event: WechatMiniprogram.TouchEvent) {
    const route = String(event.currentTarget.dataset.route || "");
    haptic("light");
    if (route === "inbox") {
      wx.setStorageSync("easy-swu:inbox-tab", "messages");
      void navigateTo("/features/pages/inbox/index");
      return;
    }
    if (route) {
      if (MODAL_QUICK_ACTION_ROUTES.has(route)) {
        void navigateTo(route, "wx://cupertino-modal");
        return;
      }
      void navigateTo(route);
    }
  },
  openTimetable() {
    haptic("light");
    void navigateTo("/features/pages/timetable/index");
  },
  openGrades() {
    haptic("light");
    void navigateTo("/features/pages/grades/index");
  },
  openElectricity() {
    haptic("light");
    void navigateTo("/features/pages/electricity/index");
  },
  openExams() {
    haptic("light");
    void navigateTo("/features/pages/exams/index");
  },
  openMessages() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "messages");
    void navigateTo("/features/pages/inbox/index");
  },
  openNotices() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    void navigateTo("/features/pages/inbox/index");
  },
  openMessagesFromCard() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "messages");
    void navigateTo("/features/pages/inbox/index");
  },
  openNoticesFromCard() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    void navigateTo("/features/pages/inbox/index");
  },
  completePlan(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || this.data.completingPlanId || this.data.removingPlanId) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const schedule = loadScheduleData(lease.account);
    const target = schedule.plans.find((plan) => plan.id === id && !plan.done);
    if (!target) {
      this.setData(planPreviewPatch(lease.account));
      return;
    }

    const saved = saveScheduleData(
      lease.account,
      schedule.plans.map((plan) =>
        plan.id === id ? { ...plan, done: true } : plan,
      ),
    );
    const nextPlans = loadPlanPreviews(lease.account);
    const retainedIds = new Set(
      this.data.plans.filter((plan) => plan.id !== id).map((plan) => plan.id),
    );
    const enteringPlanId =
      nextPlans.find((plan) => !retainedIds.has(plan.id))?.id || "";
    const reducedMotion = this.data.motionClass === "motion-reduced";
    clearPlanTransitionTimers();
    haptic("light");
    this.setData({ completingPlanId: id, enteringPlanId: "" });
    void putLocalSchedule(saved).catch(() => {
      // 本地状态已经生效，服务端会在下一次日程同步时追平。
    });

    planCompletionTimer = setTimeout(
      () => {
        planCompletionTimer = undefined;
        if (!isSessionLeaseCurrent(lease)) return;
        this.setData({
          removingPlanId: id,
          planCardHeight: planCardHeight(nextPlans.length),
        });
        planRemovalTimer = setTimeout(
          () => {
            planRemovalTimer = undefined;
            if (!isSessionLeaseCurrent(lease)) return;
            this.setData({
              plans: nextPlans,
              planCardHeight: planCardHeight(nextPlans.length),
              completingPlanId: "",
              removingPlanId: "",
              enteringPlanId: reducedMotion ? "" : enteringPlanId,
            });
            if (!reducedMotion && enteringPlanId) {
              planEntryTimer = setTimeout(() => {
                planEntryTimer = undefined;
                if (
                  isSessionLeaseCurrent(lease) &&
                  this.data.enteringPlanId === enteringPlanId
                ) {
                  this.setData({ enteringPlanId: "" });
                }
              }, PLAN_ENTRY_TRANSITION_MS);
            }
          },
          reducedMotion ? 16 : PLAN_REMOVAL_TRANSITION_MS,
        );
      },
      reducedMotion ? 0 : PLAN_COMPLETION_ACK_MS,
    );
  },
  openSchedule() {
    haptic("light");
    wx.switchTab({ url: "/pages/schedule/index" });
  },
  openNotice(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const link = String(event.currentTarget.dataset.link || "");
    const title = String(event.currentTarget.dataset.title || "学校通知");
    const publishedAt = String(event.currentTarget.dataset.publishedAt || "");
    if (!id && !link) return;
    haptic("light");
    void navigateTo(
      `/features/pages/browser/index?id=${encodeURIComponent(id || noticeSourceIdFromLink(link))}&url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&publishedAt=${encodeURIComponent(publishedAt)}`,
    );
  },
});
