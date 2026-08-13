import { getCurrentUser } from "../../services/auth";
import { getMessages, getNotices } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import {
  coursePreview,
  formatClock,
  remainingCourses,
  type TimetableCourse,
} from "../../data/timetable";
import type { Notice, TeachingMessage } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import {
  currentLocalHour,
  formatDateTime,
  formatFriendlyDate,
  today,
} from "../../utils/date";
import { formatSchedule } from "../../utils/format";
import { haptic } from "../../utils/haptics";
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
  title: string;
  time: string;
  link: string;
}

interface TodayCoursePreview extends TimetableCourse {
  statusLabel: string;
  current: boolean;
}

let courseClockTimer: number | undefined;

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
    title: notice.title,
    time: formatDateTime(notice.publishedAt),
    link: notice.link,
  };
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
      if (seen.has(item.link)) return false;
      seen.add(item.link);
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
    loading: true,
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
    messages: [] as MessagePreview[],
    notices: [] as NoticePreview[],
    quickActions: [
      {
        title: "成绩",
        caption: "明细与分项",
        glyph: "绩",
        tone: "blue",
        route: "/pages/grades/index",
      },
      {
        title: "空教室",
        caption: "按节次查找",
        glyph: "室",
        tone: "cyan",
        route: "/pages/rooms/index",
      },
      {
        title: "考试",
        caption: "时间与座位",
        glyph: "考",
        tone: "purple",
        route: "/pages/exams/index",
      },
      {
        title: "校历",
        caption: "查看最新校历",
        glyph: "历",
        tone: "green",
        route: "/pages/calendar/index",
      },
      {
        title: "课表",
        caption: "查看本周课程",
        glyph: "课",
        tone: "orange",
        route: "/pages/timetable/index",
      },
      {
        title: "全部动态",
        caption: "消息和通知",
        glyph: "讯",
        tone: "pink",
        route: "inbox",
      },
    ],
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    this.getTabBar().setData({
      selected: 0,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
    this.updateTodayCourses();
    this.stopCourseClock();
    courseClockTimer = setInterval(
      () => this.updateTodayCourses(),
      30000,
    ) as unknown as number;
    void this.loadDashboard(false);
  },
  onHide() {
    this.stopCourseClock();
  },
  onUnload() {
    this.stopCourseClock();
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
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  async loadDashboard(refresh: boolean) {
    if (this.data.loading && this.data.loaded && !refresh) {
      return;
    }

    this.setData({
      loading: !this.data.loaded,
      refreshing: false,
      errorMessage: "",
      greeting: getGreeting(),
      dateLabel: formatFriendlyDate(today()),
    });

    const [userResult, messageResult, noticeResult] = await Promise.allSettled([
      getCurrentUser(),
      getMessages({ page: 1, pageSize: 3, refresh }),
      getNotices({ page: 1, pageSize: 3, refresh }),
    ]);

    const serviceHealthy =
      userResult.status === "fulfilled" ||
      messageResult.status === "fulfilled" ||
      noticeResult.status === "fulfilled";
    const patch: Record<string, unknown> = {
      loading: false,
      refreshing: false,
      loaded: true,
      serviceHealthy,
      serviceLabel: serviceHealthy ? "服务连接正常" : "服务连接异常",
    };
    if (userResult.status === "fulfilled") {
      patch.userName = userResult.value.name || "同学";
      patch.organizationName =
        userResult.value.profile.organizationName || "西南大学";
    }
    if (messageResult.status === "fulfilled") {
      patch.messages = mergeMessagePreviews(
        messageResult.value.data.items.map(toMessagePreview),
        this.data.messages,
      );
    }
    if (noticeResult.status === "fulfilled") {
      patch.notices = mergeNoticePreviews(
        noticeResult.value.data.items.map(toNoticePreview),
        this.data.notices,
      );
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
  },
  onRefresh() {
    haptic("light");
    void this.loadDashboard(true);
  },
  onQuickAction(event: WechatMiniprogram.TouchEvent) {
    const route = String(event.currentTarget.dataset.route || "");
    haptic("light");
    if (route === "inbox") {
      wx.setStorageSync("easy-swu:inbox-tab", "messages");
      wx.switchTab({ url: "/pages/inbox/index" });
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
    wx.switchTab({ url: "/pages/inbox/index" });
  },
  openNotices() {
    wx.setStorageSync("easy-swu:inbox-tab", "notices");
    wx.switchTab({ url: "/pages/inbox/index" });
  },
  openNotice(event: WechatMiniprogram.TouchEvent) {
    const link = String(event.currentTarget.dataset.link || "");
    const title = String(event.currentTarget.dataset.title || "教务通知");
    if (!link) return;
    haptic("light");
    void navigateTo(
      `/pages/browser/index?url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`,
      "wx://upwards",
    );
  },
});
