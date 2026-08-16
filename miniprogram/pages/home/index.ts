import {
  getCredentialStatus,
  getCurrentUser,
  logout as logoutSession,
} from "../../services/auth";
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
import { loadScheduleData } from "../../store/schedule";
import { getSession } from "../../store/session";
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
  coursesForDate,
  formatClock,
  remainingCourses,
  teachingWeekForDate,
  type TimetableCourse,
} from "../../data/timetable";
import type {
  CredentialState,
  Exam,
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
  localDateKey,
  today,
} from "../../utils/date";
import { formatSchedule, formatScheduleDate } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { renderMarkdown, stripMarkdown } from "../../utils/markdown";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

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
  badgeSub: string;
  badgeTone: "current" | "future" | "past" | "pending";
}

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
let homeVisible = false;
let queuedAnnouncements: Publication[] = [];
let automaticPopupsThisEntry = new Set<string>();
let dashboardRequestInFlight = false;
let dashboardRefreshQueued = false;
let dashboardStableRefreshQueued = false;
let credentialPollTimer: number | undefined;
let credentialExitInFlight = false;
let hydratedAccount = "";
let timetableRouteOpening = false;
let activeTimetable: TimetableData | null = null;

function dateAtLocalMidnight(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
}

function examDateKey(exam: Exam): string {
  return exam.time.startAt ? localDateKey(exam.time.startAt) : exam.time.date;
}

function examTimestamp(exam: Exam): number {
  if (exam.time.startAt) {
    const value = new Date(exam.time.startAt).getTime();
    if (Number.isFinite(value)) return value;
  }
  const date = dateAtLocalMidnight(examDateKey(exam));
  return date ?? Number.MAX_SAFE_INTEGER;
}

function examBadge(
  exam: Exam,
): Pick<ExamPreview, "badgeText" | "badgeSub" | "badgeTone"> {
  const target = dateAtLocalMidnight(examDateKey(exam));
  const current = dateAtLocalMidnight(today());
  if (target === null || current === null) {
    return { badgeText: "待", badgeSub: "定", badgeTone: "pending" };
  }
  const days = Math.round((target - current) / (24 * 60 * 60 * 1000));
  if (days === 0)
    return { badgeText: "今", badgeSub: "日", badgeTone: "current" };
  if (days > 0) {
    return {
      badgeText: days > 99 ? "99+" : String(days),
      badgeSub: "天",
      badgeTone: "future",
    };
  }
  return { badgeText: "已", badgeSub: "考", badgeTone: "past" };
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
  const ordered = [...exams].sort(
    (left, right) => examTimestamp(left) - examTimestamp(right),
  );
  const upcoming = ordered.filter((exam) => examTimestamp(exam) >= now);
  const selected = (
    upcoming.length ? upcoming : ordered.slice().reverse()
  ).slice(0, 2);
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

function publicationPreview(
  publication: Publication,
  expanded = false,
): PublicationPreview {
  const plainText = stripMarkdown(publication.contentMarkdown);
  return {
    ...publication,
    contentHtml: renderMarkdown(publication.contentMarkdown, {
      accentColor: publication.accentColor,
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

function timetableEmptyCopy(now = new Date()) {
  if (!activeTimetable) {
    return {
      title: "课表暂未同步",
      caption: "连接服务后会自动显示今日课程",
    };
  }
  if (teachingWeekForDate(activeTimetable, now) === null) {
    return {
      title: "当前不在教学周",
      caption: "去完整课表查看所选学期安排",
    };
  }
  const allToday = coursesForDate(activeTimetable, today(), now);
  return allToday.length
    ? {
        title: "今天的课程已结束",
        caption: "去完整课表看看本周安排",
      }
    : {
        title: "今天没有课程",
        caption: "给自己留一点从容的时间",
      };
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
        dateLabel: "",
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
    .slice(0, 3);
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
    .slice(0, 3);
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    loading: false,
    refreshing: false,
    loaded: false,
    errorMessage: "",
    serviceHealthy: false,
    serviceLabel: "正在连接服务",
    greeting: getGreeting(),
    dateLabel: formatFriendlyDate(today()),
    userName: "同学",
    organizationName: "",
    currentTime: formatClock(),
    todayCourses: [] as TodayCoursePreview[],
    remainingCourseCount: 0,
    timetableEmptyTitle: "课表暂未同步",
    timetableEmptyCaption: "连接服务后会自动显示今日课程",
    timetableCardRadius: getTimetableCardRadius(),
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
    announcements: [] as PublicationPreview[],
    platformNotifications: [] as PublicationPreview[],
    publicationUnreadCount: 0,
    publicationUnreadLabel: "",
    publicationPanelMounted: false,
    publicationPanelOpen: false,
    announcementModalMounted: false,
    announcementModalOpen: false,
    activeAnnouncement: null as PublicationPreview | null,
  },
  onLoad() {
    hydratedAccount = "";
    activeTimetable = null;
    credentialExitInFlight = false;
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    homeVisible = true;
    automaticPopupsThisEntry = new Set<string>();
    this.applyAppearance();
    this.hydrateCachedDashboard();
    this.hydrateShortcutCaches();
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
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
    const emptyCopy = timetableEmptyCopy(now);
    this.setData({
      currentTime: formatClock(now),
      todayCourses: courses,
      remainingCourseCount: remainingCourses(activeTimetable, now).length,
      timetableEmptyTitle: emptyCopy.title,
      timetableEmptyCaption: emptyCopy.caption,
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });
  },
  applyAppearance() {
    this.setData(resolveAppearance());
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
    const messages = (cached?.messages || []).map(toMessagePreview);
    const notices = (cached?.notices || []).map(toNoticePreview);
    this.setData({
      messages,
      notices,
      gradeAverageLabel: (() => {
        const average = cachedGrades?.data.summary.weightedAverage;
        if (average === null || average === undefined) return "—";
        return Number.isInteger(average) ? String(average) : average.toFixed(1);
      })(),
      gradePointAverageLabel: (() => {
        const gradePointAverage = cachedGrades?.data.summary.gradePointAverage;
        if (gradePointAverage === null || gradePointAverage === undefined) {
          return "—";
        }
        return gradePointAverage.toFixed(2);
      })(),
      gradeCourseCount: cachedGrades?.data.summary.courseCount || 0,
      loaded:
        messages.length > 0 || notices.length > 0 || Boolean(cachedTimetable),
      ...(changedAccount ? { errorMessage: "" } : {}),
    });
    this.updateTodayCourses();
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
        setTimeout(() => wx.reLaunch({ url: "/pages/login/index" }), 360);
      });
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  async loadPublicationFeed() {
    if (publicationRequestInFlight) return;
    publicationRequestInFlight = true;
    try {
      const feed = await getPublicationFeed();
      const expandedIds = new Set(
        this.data.platformNotifications
          .filter((item) => item.expanded)
          .map((item) => item.id),
      );
      const announcements = feed.announcements.map((item) =>
        publicationPreview(item),
      );
      const platformNotifications = feed.notifications.map((item) =>
        publicationPreview(item, expandedIds.has(item.id)),
      );
      this.setData({
        announcements,
        platformNotifications,
        publicationUnreadCount: feed.unreadCount,
        publicationUnreadLabel:
          feed.unreadCount > 99 ? "99+" : String(feed.unreadCount || ""),
      });

      if (homeVisible && !this.data.announcementModalMounted) {
        queuedAnnouncements = feed.announcements.filter(
          (item) => item.shouldPopup && !automaticPopupsThisEntry.has(item.id),
        );
        this.showNextQueuedAnnouncement();
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
    this.setData({ publicationPanelMounted: true });
    setTimeout(() => {
      if (homeVisible) this.setData({ publicationPanelOpen: true });
    }, 16);
  },
  closePublicationPanel() {
    if (!this.data.publicationPanelMounted) return;
    this.setData({ publicationPanelOpen: false });
    if (publicationPanelTimer !== undefined) {
      clearTimeout(publicationPanelTimer);
    }
    publicationPanelTimer = setTimeout(() => {
      this.setData({ publicationPanelMounted: false });
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
    this.setData({
      publicationPanelMounted: false,
      publicationPanelOpen: false,
      announcementModalMounted: false,
      announcementModalOpen: false,
      activeAnnouncement: null,
    });
  },
  stopPropagation() {},
  onAnnouncementTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const announcement = this.data.announcements.find((item) => item.id === id);
    if (!announcement) return;
    haptic("light");
    queuedAnnouncements = [];
    this.closePublicationPanel();
    void this.presentAnnouncement(announcement, false);
  },
  onPlatformNotificationTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const notification = this.data.platformNotifications.find(
      (item) => item.id === id,
    );
    if (!notification) return;
    haptic("light");
    this.markPublicationLocallyRead(id);
    if (!notification.isRead) {
      void markPublicationRead(id).catch(() => undefined);
    }
    if (notification.isLong) {
      this.setData({
        platformNotifications: this.data.platformNotifications.map((item) =>
          item.id === id ? { ...item, expanded: !item.expanded } : item,
        ),
      });
    }
  },
  showNextQueuedAnnouncement() {
    if (
      !homeVisible ||
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
    const preview = publicationPreview(publication);
    this.closePublicationPanel();
    this.setData({
      activeAnnouncement: preview,
      announcementModalMounted: true,
    });
    setTimeout(() => {
      if (homeVisible && this.data.activeAnnouncement?.id === preview.id) {
        this.setData({ announcementModalOpen: true });
      }
    }, 16);
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
    this.setData({
      activeAnnouncement: {
        ...this.data.activeAnnouncement,
        contentHtml: renderMarkdown(preview.contentMarkdown, {
          accentColor: preview.accentColor,
          mediaUrls,
        }),
      },
    });
  },
  markPublicationLocallyRead(id: string) {
    const wasUnread = [
      ...this.data.announcements,
      ...this.data.platformNotifications,
    ].some((item) => item.id === id && !item.isRead);
    if (!wasUnread) return;
    const publicationUnreadCount = Math.max(
      0,
      this.data.publicationUnreadCount - 1,
    );
    this.setData({
      announcements: this.data.announcements.map((item) =>
        item.id === id ? { ...item, isRead: true } : item,
      ),
      platformNotifications: this.data.platformNotifications.map((item) =>
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
        activeAnnouncement: null,
      });
      announcementModalTimer = undefined;
      setTimeout(() => this.showNextQueuedAnnouncement(), 90);
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
      refreshing: false,
      errorMessage: "",
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });

    const [
      userResult,
      messageResult,
      noticeResult,
      gradeResult,
      timetableResult,
    ] = await Promise.allSettled([
      includeStableData ? getCurrentUser() : Promise.resolve(null),
      getMessages({ page: 1, pageSize: 15, refresh }),
      getNotices({ page: 1, pageSize: 15, refresh }),
      includeStableData
        ? getGrades({ page: 1, pageSize: 200, refresh })
        : Promise.resolve(null),
      includeStableData ? getTimetable({ refresh }) : Promise.resolve(null),
    ]);

    const serviceHealthy =
      (includeStableData && userResult.status === "fulfilled") ||
      messageResult.status === "fulfilled" ||
      noticeResult.status === "fulfilled" ||
      (includeStableData && gradeResult.status === "fulfilled") ||
      (includeStableData && timetableResult.status === "fulfilled");
    const patch: Record<string, unknown> = {
      loading: false,
      refreshing: false,
      loaded: true,
      serviceHealthy,
      serviceLabel: serviceHealthy ? "服务连接正常" : "服务连接异常",
    };
    if (userResult.status === "fulfilled" && userResult.value) {
      patch.userName = userResult.value.name || "同学";
      patch.organizationName =
        userResult.value.profile.organizationName || "西南大学";
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
    if (gradeResult.status === "fulfilled" && gradeResult.value) {
      const account = getSession()?.user.account || "";
      const local = loadGradesSnapshot(account);
      if (
        refresh ||
        shouldUseServerSnapshot(local, gradeResult.value.meta.fetchedAt)
      ) {
        saveGradesSnapshot(
          account,
          gradeResult.value.data,
          gradeResult.value.meta.fetchedAt,
        );
        const average = gradeResult.value.data.summary.weightedAverage;
        patch.gradeAverageLabel =
          average === null
            ? "—"
            : Number.isInteger(average)
              ? String(average)
              : average.toFixed(1);
        const gradePointAverage =
          gradeResult.value.data.summary.gradePointAverage;
        patch.gradePointAverageLabel =
          gradePointAverage === null ? "—" : gradePointAverage.toFixed(2);
        patch.gradeCourseCount = gradeResult.value.data.summary.courseCount;
      }
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
        const now = new Date();
        const courses = todayCoursePreview(now);
        const emptyCopy = timetableEmptyCopy(now);
        patch.currentTime = formatClock(now);
        patch.todayCourses = courses;
        patch.remainingCourseCount = remainingCourses(
          activeTimetable,
          now,
        ).length;
        patch.timetableEmptyTitle = emptyCopy.title;
        patch.timetableEmptyCaption = emptyCopy.caption;
      }
    }
    if (
      messageResult.status === "rejected" &&
      noticeResult.status === "rejected"
    ) {
      patch.errorMessage = getErrorMessage(
        messageResult.reason,
        "动态暂时加载失败。下拉即可重试。",
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
  onRefresh() {
    haptic("light");
    void this.loadDashboard(true);
    void this.loadPublicationFeed();
  },
  onQuickAction(event: WechatMiniprogram.TouchEvent) {
    const route = String(event.currentTarget.dataset.route || "");
    haptic("light");
    if (route === "inbox") {
      wx.setStorageSync("easy-swu:inbox-tab", "messages");
      void navigateTo("/pages/inbox/index", "wx://upwards");
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
  openMessages() {
    wx.setStorageSync("easy-swu:inbox-tab", "messages");
    void navigateTo("/pages/inbox/index", "wx://upwards");
  },
  openNotices() {
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    void navigateTo("/pages/inbox/index", "wx://upwards");
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
