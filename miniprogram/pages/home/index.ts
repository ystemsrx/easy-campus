import {
  getCredentialStatus,
  logout as logoutSession,
} from "../../services/auth";
import {
  getPreloadedCurrentUser,
  getPreloadedTimetable,
} from "../../services/primary-tab-preload";
import {
  downloadPublicationMedia,
  getPublicationFeed,
  markPublicationRead,
  recordAnnouncementPopup,
} from "../../services/content";
import {
  getGrades,
  getMessages,
  getNotices,
  getTimetable,
} from "../../services/teaching";
import { refreshExamsAfterSignIn } from "../../services/cache-refresh";
import { getErrorMessage } from "../../services/request";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  WEEK_MS,
} from "../../store/cache-policy";
import { loadGradesSnapshot, saveGradesSnapshot } from "../../store/grades";
import { loadElectricitySnapshot } from "../../store/electricity";
import { loadExamsSnapshot } from "../../store/exams";
import {
  loadPetPreferences,
  savePetSelection,
  shouldShowPet,
  skipPetSetup,
} from "../../store/pet";
import { loadScheduleData } from "../../store/schedule";
import { getSession, loadCurrentUser } from "../../store/session";
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
  Notice,
  Publication,
  TeachingMessage,
  TimetableData,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
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
import { gradePointRingValue, latestSemesterGrades } from "../../utils/grades";
import { haptic } from "../../utils/haptics";
import { resolveHomeIdentity } from "../../utils/identity";
import { renderMarkdown, stripMarkdown } from "../../utils/markdown";
import {
  ensureAuthenticated,
  goToLogin,
  navigateTo,
} from "../../utils/navigation";
import { progressRingSource } from "../../utils/progress-ring";
import { sortPublicationsNewestFirst } from "../../utils/publications";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";

interface MessagePreview {
  id: string;
  title: string;
  subtitle: string;
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
}

interface TodayCoursePreview extends TimetableCourse {
  statusLabel: string;
  current: boolean;
}

interface PlanPreview {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  done: boolean;
  dateLabel: string;
  timeLabel: string;
}

interface PublicationPreview extends Publication {
  contentHtml: string;
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
const PUBLICATION_REFRESH_THROTTLE_MS = 8_000;

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
let publicationRequestInFlight = false;
let lastPublicationRequestAt = 0;
let homeVisible = false;
let queuedAnnouncements: Publication[] = [];
let automaticPopupsThisEntry = new Set<string>();
let automaticPopupEntryKey = "";
let dashboardRequestInFlight = false;
let dashboardRefreshQueued = false;
let dashboardStableRefreshQueued = false;
let credentialPollTimer: number | undefined;
let credentialExitInFlight = false;
let hydratedAccount = "";
let timetableRouteOpening = false;
let gradesRouteOpening = false;
let electricityRouteOpening = false;
let examsRouteOpening = false;
let inboxRouteOpening = false;
let petSetupDrawerTimer: ReturnType<typeof setTimeout> | undefined;
let activeTimetable: TimetableData | null = null;

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

function shortcutCachePatch(account: string): ShortcutCachePatch {
  const electricity = loadElectricitySnapshot(account)?.data;
  const electricityAccount = electricity?.account;
  const exams = loadExamsSnapshot(account)?.data.items || [];
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

function getTimetableCardRadius(): number {
  try {
    return (wx.getWindowInfo().windowWidth * 56) / 750;
  } catch {
    return 28;
  }
}

function getCampusCardRadius(): number {
  try {
    return (wx.getWindowInfo().windowWidth * 44) / 750;
  } catch {
    return 22;
  }
}

function getFeatureCardRadius(): number {
  try {
    return (wx.getWindowInfo().windowWidth * 48) / 750;
  } catch {
    return 24;
  }
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
  const summary = latestSemesterGrades(data).summary;
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
    contentHtml: renderMarkdown(publication.contentMarkdown, {
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
        dateLabel: formatScheduleDate(message.newSchedule),
        label: "调课",
        tone: "blue",
      };
    case "makeup_class":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        dateLabel: formatScheduleDate(message.schedule),
        label: "补课",
        tone: "green",
      };
    case "course_cancelled":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        dateLabel: formatScheduleDate(message.schedule),
        label: "停课",
        tone: "orange",
      };
    case "other":
      return {
        id: message.id,
        title: message.title,
        subtitle: message.content,
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
  };
}

function noticeSourceIdFromLink(link: string): string {
  const matched = /[?&]xwbh=([^&]+)/.exec(link);
  if (!matched) return "";
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return matched[1];
  }
}

function loadPlanPreviews(account: string): PlanPreview[] {
  const stored = loadScheduleData(account).plans;
  const todayKey = today();
  return (
    stored as Array<{
      id: string;
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      done: boolean;
    }>
  )
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

function mergeMessagePreviews(
  incoming: MessagePreview[],
  existing: MessagePreview[],
): MessagePreview[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
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
): NoticePreview[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
    .filter((item) => {
      const identity = item.id || item.link;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, HOME_PREVIEW_ITEM_LIMIT);
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
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
    timetableCardRadius: getTimetableCardRadius(),
    campusCardRadius: getCampusCardRadius(),
    examCardRadius: getCampusCardRadius(),
    gradeCardRadius: getFeatureCardRadius(),
    electricityCardRadius: getFeatureCardRadius(),
    gradeRingSource: progressRingSource(null),
    gradeAverageLabel: "—",
    gradePointAverageLabel: "—",
    gradeCourseCount: 0,
    electricityBound: false,
    electricityBalanceLabel: "—",
    electricityUsageLabel: "绑定寝室后查看",
    examPreviews: [] as ExamPreview[],
    examEmptyLabel: "暂时没有考试安排",
    plans: [] as PlanPreview[],
    messages: [] as MessagePreview[],
    notices: [] as NoticePreview[],
    publications: [] as PublicationPreview[],
    publicationUnreadCount: 0,
    publicationUnreadLabel: "",
    petShape: "blob" as PetShapeId,
    petColor: "#111214",
    petEnhanced: false,
    petSelected: false,
    petVisible: false,
    petReducedMotion: false,
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
    hydratedAccount = "";
    activeTimetable = null;
    timetableRouteOpening = false;
    gradesRouteOpening = false;
    electricityRouteOpening = false;
    inboxRouteOpening = false;
    if (petSetupDrawerTimer !== undefined) {
      clearTimeout(petSetupDrawerTimer);
      petSetupDrawerTimer = undefined;
    }
    credentialExitInFlight = false;
    lastPublicationRequestAt = 0;
    this.applyAppearance();
    this.hydrateIdentity();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    const sessionAccount = getSession()?.user.account || "";
    this.applyAppearance();
    this.hydratePet(sessionAccount);
    const petSetupPending = this.openPendingPetSetup(sessionAccount);
    homeVisible = true;
    const currentAutomaticPopupEntryKey = `${getApp<IAppOption>().globalData.foregroundEntryId}:${sessionAccount}`;
    if (currentAutomaticPopupEntryKey !== automaticPopupEntryKey) {
      automaticPopupEntryKey = currentAutomaticPopupEntryKey;
      automaticPopupsThisEntry = new Set<string>();
    }
    this.hydrateIdentity();
    this.hydrateCachedDashboard();
    this.hydrateShortcutCaches();
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
      hidden: petSetupPending,
    });
    this.updateTodayCourses();
    this.setData({
      plans: loadPlanPreviews(getSession()?.user.account || ""),
    });
    this.stopCourseClock();
    courseClockTimer = setInterval(
      () => this.updateTodayCourses(),
      30000,
    ) as unknown as number;
    void this.loadDashboard(false);
    void this.loadPublicationFeed();
    void refreshExamsAfterSignIn().then(() => {
      if (homeVisible) this.hydrateShortcutCaches();
    });
  },
  onHide() {
    homeVisible = false;
    this.stopCourseClock();
    this.stopCredentialPoll();
    this.resetPublicationLayers();
  },
  onUnload() {
    homeVisible = false;
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
    const appearance = resolveAppearance();
    this.setData({
      ...appearance,
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
    this.persistPendingPetSelection({ color: event.detail.color });
  },
  persistPendingPetSelection(patch: {
    shape?: PetShapeId;
    color?: string;
  }) {
    const account = getSession()?.user.account || "";
    if (!account || !this.data.petSetupDrawerMounted) return;
    const preferences = savePetSelection(account, {
      shape: patch.shape ?? this.data.petShape,
      color: patch.color ?? this.data.petColor,
      enabled: true,
      enhanced: this.data.petEnhanced,
    });
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
    if (!account || hydratedAccount === account) return;
    const changedAccount = Boolean(
      hydratedAccount && hydratedAccount !== account,
    );
    hydratedAccount = account;
    const cached =
      cleanupTeachingPreview(account) || loadTeachingPreview(account);
    const cachedTimetable = loadTimetableSnapshot(account);
    const cachedGrades = loadGradesSnapshot(account);
    activeTimetable = cachedTimetable?.data || null;
    const messages = (cached?.messages || [])
      .slice(0, HOME_PREVIEW_ITEM_LIMIT)
      .map(toMessagePreview);
    const notices = (cached?.notices || [])
      .slice(0, HOME_PREVIEW_ITEM_LIMIT)
      .map(toNoticePreview);
    this.setData({
      messages,
      notices,
      ...(cachedGrades
        ? gradePreviewPatch(
            cachedGrades.data,
            this.data.motionClass !== "motion-reduced",
          )
        : {}),
      loaded:
        messages.length > 0 || notices.length > 0 || Boolean(cachedTimetable),
      ...(changedAccount ? { errorMessage: "" } : {}),
    });
    this.updateTodayCourses();
  },
  hydrateServerGrade(
    account: string,
    result: Awaited<ReturnType<typeof getGrades>>,
    refresh: boolean,
  ) {
    const local = loadGradesSnapshot(account);
    const useServer =
      refresh || shouldUseServerSnapshot(local, result.meta.fetchedAt);
    if (useServer) {
      saveGradesSnapshot(account, result.data, result.meta.fetchedAt);
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
  stopCredentialPoll() {
    if (credentialPollTimer !== undefined) {
      clearTimeout(credentialPollTimer);
      credentialPollTimer = undefined;
    }
  },
  handleCredentialState(credential: CredentialState) {
    if (credential.status === "invalid") {
      this.exitInvalidCredential();
      return;
    }
    if (credential.status === "pending") {
      this.scheduleCredentialPoll();
      return;
    }
    this.stopCredentialPoll();
    if (credential.status === "unavailable") {
      this.setData({
        serviceHealthy: false,
        serviceLabel: "校园验证暂不可用，正在显示缓存",
      });
    }
  },
  scheduleCredentialPoll() {
    if (credentialPollTimer !== undefined || !homeVisible) return;
    credentialPollTimer = setTimeout(async () => {
      credentialPollTimer = undefined;
      if (!homeVisible) return;
      try {
        this.handleCredentialState(await getCredentialStatus());
      } catch {
        // 普通网络失败不应清除仍然有效的本地会话。
      }
    }, 1800) as unknown as number;
  },
  exitInvalidCredential() {
    if (credentialExitInFlight) return;
    credentialExitInFlight = true;
    this.stopCredentialPoll();
    void logoutSession()
      .catch(() => undefined)
      .finally(() => {
        wx.showToast({
          title: "校园密码已变更，请重新登录",
          icon: "none",
          duration: 1800,
        });
        setTimeout(() => goToLogin(), 360);
      });
  },
  async loadPublicationFeed() {
    const now = Date.now();
    if (
      publicationRequestInFlight ||
      now - lastPublicationRequestAt < PUBLICATION_REFRESH_THROTTLE_MS
    ) {
      return;
    }
    lastPublicationRequestAt = now;
    publicationRequestInFlight = true;
    try {
      const feed = await getPublicationFeed();
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
          (item) => item.shouldPopup && !automaticPopupsThisEntry.has(item.id),
        );
        if (!this.data.petSetupDrawerMounted) {
          this.showNextQueuedAnnouncement();
        }
      }
    } catch {
      // 平台公告是附加信息。刷新失败时保留当前内容，不打断主页使用。
    } finally {
      publicationRequestInFlight = false;
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
    });
  },
  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden });
  },
  stopPropagation() {},
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
    const preview = publicationPreview(publication, false, this.data.theme);
    this.closePublicationPanel();
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

    if (!preview.media.length) return;
    const downloaded = await Promise.all(
      preview.media.map(async (asset) => ({
        id: asset.id.toLowerCase(),
        path: await downloadPublicationMedia(asset),
      })),
    );
    const mediaUrls: Record<string, string> = {};
    for (const asset of downloaded) {
      if (asset.path) mediaUrls[asset.id] = asset.path;
    }
    if (this.data.activeAnnouncement?.id !== preview.id) return;
    this.setData(
      {
        activeAnnouncement: {
          ...this.data.activeAnnouncement,
          contentHtml: renderMarkdown(preview.contentMarkdown, {
            accentColor: preview.accentColor,
            mediaUrls,
            theme: this.data.theme,
          }),
        },
      },
      () => {
        this.measureAnnouncementModal(preview.id, false, true);
        setTimeout(() => {
          if (this.data.activeAnnouncement?.id === preview.id) {
            this.measureAnnouncementModal(preview.id, false, true);
          }
        }, 240);
      },
    );
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
  async loadDashboard(refresh: boolean, includeStableData = true) {
    if (dashboardRequestInFlight) {
      if (refresh) {
        dashboardRefreshQueued = true;
        if (includeStableData) dashboardStableRefreshQueued = true;
      }
      return;
    }
    dashboardRequestInFlight = true;

    this.setData({
      loading: false,
      errorMessage: "",
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });

    const userRequest = includeStableData
      ? getPreloadedCurrentUser(refresh).then((user) => {
          if (user && homeVisible) this.hydrateIdentity(user);
          return user;
        })
      : Promise.resolve(null);
    const account = getSession()?.user.account || "";
    const gradeRequest = includeStableData
      ? getGrades({ page: 1, pageSize: 200, refresh }).then((result) => {
          this.hydrateServerGrade(account, result, refresh);
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
      getMessages({ page: 1, pageSize: 15, refresh }),
      getNotices({ page: 1, pageSize: 15, refresh }),
      gradeRequest,
      includeStableData
        ? refresh
          ? getTimetable({ refresh: true })
          : getPreloadedTimetable()
        : Promise.resolve(null),
    ]);

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
    if (messageResult.status === "fulfilled") {
      saveTeachingPreview(getSession()?.user.account || "", {
        messages: messageResult.value.data.items,
      });
      patch.messages = mergeMessagePreviews(
        messageResult.value.data.items.map(toMessagePreview),
        this.data.messages,
      );
    }
    if (noticeResult.status === "fulfilled") {
      saveTeachingPreview(getSession()?.user.account || "", {
        notices: noticeResult.value.data.items,
      });
      patch.notices = mergeNoticePreviews(
        noticeResult.value.data.items.map(toNoticePreview),
        this.data.notices,
      );
    }
    if (timetableResult.status === "fulfilled" && timetableResult.value) {
      const account = getSession()?.user.account || "";
      const local = loadTimetableSnapshot(account);
      if (
        refresh ||
        shouldUseServerSnapshot(local, timetableResult.value.meta.fetchedAt)
      ) {
        activeTimetable = timetableResult.value.data;
        saveTimetableSnapshot(account, timetableResult.value.data, {
          serverFetchedAt: timetableResult.value.meta.fetchedAt,
        });
      }
      activeTimetable =
        loadTimetableSnapshot(account)?.data || timetableResult.value.data;
      const now = new Date();
      const courses = todayCoursePreview(now);
      patch.currentTime = formatClock(now);
      patch.todayCourses = courses;
      patch.remainingCourseCount = remainingCourses(
        activeTimetable,
        now,
      ).length;
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
      !refresh &&
      ((messageResult.status === "fulfilled" &&
        messageResult.value.meta.refreshing) ||
        (noticeResult.status === "fulfilled" &&
          noticeResult.value.meta.refreshing));
    if (!refresh && includeStableData) {
      const account = getSession()?.user.account || "";
      const stableDataStale =
        (isCacheStale(loadGradesSnapshot(account), WEEK_MS) &&
          claimAutomaticRefresh("grades", account)) ||
        (isCacheStale(loadTimetableSnapshot(account), WEEK_MS) &&
          claimAutomaticRefresh("timetable", account));
      if (stableDataStale) {
        dashboardRefreshQueued = true;
        dashboardStableRefreshQueued = true;
      }
    }
    dashboardRequestInFlight = false;
    if (needsFreshResult || dashboardRefreshQueued) {
      const includeStableRefresh = dashboardStableRefreshQueued;
      dashboardRefreshQueued = false;
      dashboardStableRefreshQueued = false;
      setTimeout(() => void this.loadDashboard(true, includeStableRefresh), 0);
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
      wx.navigateTo({ url: "/pages/inbox/index" });
      return;
    }
    if (route) {
      void navigateTo(route);
    }
  },
  openTimetable() {
    if (timetableRouteOpening) return;
    timetableRouteOpening = true;
    haptic("light");
    wx.navigateTo({
      url: "/pages/timetable/index",
      complete: () => {
        timetableRouteOpening = false;
      },
    });
  },
  openGrades() {
    if (gradesRouteOpening) return;
    gradesRouteOpening = true;
    haptic("light");
    wx.navigateTo({
      url: "/pages/grades/index",
      complete: () => {
        gradesRouteOpening = false;
      },
    });
  },
  openElectricity() {
    if (electricityRouteOpening) return;
    electricityRouteOpening = true;
    haptic("light");
    wx.navigateTo({
      url: "/pages/electricity/index",
      complete: () => {
        electricityRouteOpening = false;
      },
    });
  },
  openExams() {
    if (examsRouteOpening) return;
    examsRouteOpening = true;
    haptic("light");
    wx.navigateTo({
      url: "/pages/exams/index",
      complete: () => {
        examsRouteOpening = false;
      },
    });
  },
  openMessages() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "messages");
    wx.navigateTo({ url: "/pages/inbox/index" });
  },
  openNotices() {
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    wx.navigateTo({ url: "/pages/inbox/index" });
  },
  openMessagesFromCard() {
    if (inboxRouteOpening) return;
    inboxRouteOpening = true;
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "messages");
    wx.navigateTo({
      url: "/pages/inbox/index",
      complete: () => {
        inboxRouteOpening = false;
      },
    });
  },
  openNoticesFromCard() {
    if (inboxRouteOpening) return;
    inboxRouteOpening = true;
    haptic("light");
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    wx.navigateTo({
      url: "/pages/inbox/index",
      complete: () => {
        inboxRouteOpening = false;
      },
    });
  },
  openSchedule() {
    haptic("light");
    wx.switchTab({ url: "/pages/schedule/index" });
  },
  openNotice(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const link = String(event.currentTarget.dataset.link || "");
    const title = String(event.currentTarget.dataset.title || "教务通知");
    const publishedAt = String(event.currentTarget.dataset.publishedAt || "");
    if (!id && !link) return;
    haptic("light");
    void navigateTo(
      `/pages/browser/index?id=${encodeURIComponent(id || noticeSourceIdFromLink(link))}&url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&publishedAt=${encodeURIComponent(publishedAt)}`,
      "wx://upwards",
    );
  },
});
