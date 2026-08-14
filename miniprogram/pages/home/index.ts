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
import { getGrades, getMessages, getNotices } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import { getSession } from "../../store/session";
import {
  loadTeachingPreview,
  saveTeachingPreview,
} from "../../store/teaching-preview";
import {
  coursePreview,
  formatClock,
  remainingCourses,
  type TimetableCourse,
} from "../../data/timetable";
import type {
  CredentialState,
  Notice,
  Publication,
  TeachingMessage,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import {
  currentLocalHour,
  formatDateTime,
  formatFriendlyDate,
  today,
} from "../../utils/date";
import { formatSchedule } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { renderMarkdown, stripMarkdown } from "../../utils/markdown";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

interface MessagePreview {
  id: string;
  title: string;
  subtitle: string;
  time: string;
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
  const preview = coursePreview(now, 3);
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
        time: formatDateTime(message.createdAt),
        label: "调课",
        tone: "blue",
      };
    case "makeup_class":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        time: formatDateTime(message.createdAt),
        label: "补课",
        tone: "green",
      };
    case "course_cancelled":
      return {
        id: message.id,
        title: message.courseName,
        subtitle: formatSchedule(message.schedule),
        time: formatDateTime(message.createdAt),
        label: "停课",
        tone: "orange",
      };
    case "other":
      return {
        id: message.id,
        title: message.title,
        subtitle: message.content,
        time: formatDateTime(message.createdAt),
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

function loadPlanPreviews(): PlanPreview[] {
  const stored = wx.getStorageSync("easy-swu:schedule-plans");
  if (!Array.isArray(stored)) return [];
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
    todayCourses: todayCoursePreview(),
    remainingCourseCount: remainingCourses().length,
    gradeAverageLabel: "—",
    gradeCourseCount: 0,
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
    supportActions: [
      {
        title: "考试",
        caption: "安排与座位",
        icon: "clipboard-check",
        tone: "amber",
        route: "/pages/exams/index",
      },
      {
        title: "校历",
        caption: "查看最新校历",
        icon: "calendar-range",
        tone: "sage",
        route: "/pages/calendar/index",
      },
      {
        title: "校园消息",
        caption: "通知与教务",
        icon: "inbox",
        tone: "rose",
        route: "inbox",
      },
    ],
  },
  onLoad() {
    hydratedAccount = "";
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
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
    this.updateTodayCourses();
    this.setData({ plans: loadPlanPreviews() });
    this.stopCourseClock();
    courseClockTimer = setInterval(
      () => this.updateTodayCourses(),
      30000,
    ) as unknown as number;
    void this.loadDashboard(false);
    void this.loadPublicationFeed();
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
    this.setData({
      currentTime: formatClock(now),
      todayCourses: courses,
      remainingCourseCount: remainingCourses(now).length,
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  hydrateCachedDashboard() {
    const account = getSession()?.user.account || "";
    if (!account || hydratedAccount === account) return;
    const changedAccount = Boolean(
      hydratedAccount && hydratedAccount !== account,
    );
    hydratedAccount = account;
    const cached = loadTeachingPreview(account);
    const messages = (cached?.messages || []).map(toMessagePreview);
    const notices = (cached?.notices || []).map(toNoticePreview);
    this.setData({
      messages,
      notices,
      loaded: messages.length > 0 || notices.length > 0,
      ...(changedAccount ? { errorMessage: "" } : {}),
    });
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

    const [userResult, messageResult, noticeResult, gradeResult] =
      await Promise.allSettled([
        includeStableData ? getCurrentUser() : Promise.resolve(null),
        getMessages({ page: 1, pageSize: 3, refresh }),
        getNotices({ page: 1, pageSize: 3, refresh }),
        includeStableData
          ? getGrades({ page: 1, pageSize: 1, refresh })
          : Promise.resolve(null),
      ]);

    const serviceHealthy =
      (includeStableData && userResult.status === "fulfilled") ||
      messageResult.status === "fulfilled" ||
      noticeResult.status === "fulfilled" ||
      (includeStableData && gradeResult.status === "fulfilled");
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
      const average = gradeResult.value.data.summary.numericWeightedAverage;
      patch.gradeAverageLabel =
        average === null
          ? "—"
          : Number.isInteger(average)
            ? String(average)
            : average.toFixed(1);
      patch.gradeCourseCount = gradeResult.value.data.summary.courseCount;
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
    haptic("light");
    void navigateTo("/pages/timetable/index");
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
