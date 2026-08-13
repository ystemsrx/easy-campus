import { getMessages, getNotices } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import { getSession } from "../../store/session";
import {
  loadTeachingPreview,
  saveTeachingPreview,
} from "../../store/teaching-preview";
import type { MessageType, Notice, TeachingMessage } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatDateTime } from "../../utils/date";
import { formatSchedule } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

interface ScheduleView {
  primary: string;
  location: string;
}

interface MessageView {
  id: string;
  type: MessageType;
  label: string;
  tone: string;
  title: string;
  teacher: string;
  createdAt: string;
  original?: ScheduleView;
  current?: ScheduleView;
  content?: string;
}

interface NoticeView extends Notice {
  displayTime: string;
}

const PAGE_SIZE = 20;
let messageRequestSequence = 0;
let noticeRequestSequence = 0;
let hydratedInboxAccount = "";

function scheduleView(schedule: {
  weekStart: number;
  weekEnd: number;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  periodStart: number;
  periodEnd: number;
  location: string | null;
}): ScheduleView {
  return {
    primary: formatSchedule(schedule),
    location: schedule.location || "地点待定",
  };
}

function toMessageView(message: TeachingMessage): MessageView {
  switch (message.type) {
    case "course_rescheduled":
      return {
        id: message.id,
        type: message.type,
        label: "调课",
        tone: "blue",
        title: message.courseName,
        teacher: `${message.teacherName}${message.newTeacherName !== message.teacherName ? ` → ${message.newTeacherName}` : ""}`,
        createdAt: formatDateTime(message.createdAt),
        original: scheduleView(message.originalSchedule),
        current: scheduleView(message.newSchedule),
      };
    case "makeup_class":
      return {
        id: message.id,
        type: message.type,
        label: "补课",
        tone: "green",
        title: message.courseName,
        teacher: message.teacherName,
        createdAt: formatDateTime(message.createdAt),
        current: scheduleView(message.schedule),
      };
    case "course_cancelled":
      return {
        id: message.id,
        type: message.type,
        label: "停课",
        tone: "orange",
        title: message.courseName,
        teacher: message.teacherName,
        createdAt: formatDateTime(message.createdAt),
        original: scheduleView(message.schedule),
      };
    case "other":
      return {
        id: message.id,
        type: message.type,
        label: "消息",
        tone: "gray",
        title: message.title,
        teacher: "",
        createdAt: formatDateTime(message.createdAt),
        content: message.content,
      };
  }
}

function mergeMessages(
  incoming: MessageView[],
  existing: MessageView[],
): MessageView[] {
  const seen = new Set<string>();
  return [...incoming, ...existing].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mergeNotices(
  incoming: NoticeView[],
  existing: NoticeView[],
): NoticeView[] {
  const seen = new Set<string>();
  return [...incoming, ...existing].filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    activeTab: 0,
    messageItems: [] as MessageView[],
    noticeItems: [] as NoticeView[],
    messagePage: 1,
    messageTotalPages: 1,
    noticePage: 1,
    noticeTotalPages: 1,
    messageLoading: false,
    noticeLoading: false,
    messageLoaded: false,
    noticeLoaded: false,
    messageRefreshing: false,
    noticeRefreshing: false,
    messageLoadingMore: false,
    noticeLoadingMore: false,
    messageError: "",
    noticeError: "",
    messageFilterVisible: false,
    messageType: "" as MessageType | "",
    from: "",
    to: "",
    draftType: "" as MessageType | "",
    draftFrom: "",
    draftTo: "",
    noticeQuery: "",
    noticeSearchFocused: false,
    messageTypeOptions: [
      { value: "", label: "全部" },
      { value: "course_rescheduled", label: "调课" },
      { value: "makeup_class", label: "补课" },
      { value: "course_cancelled", label: "停课" },
      { value: "other", label: "其他" },
    ],
  },
  onLoad() {
    hydratedInboxAccount = "";
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    this.hydrateCachedPreview();
    this.getTabBar().setData({
      selected: 1,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
    const requestedTab = wx.getStorageSync("easy-swu:inbox-tab");
    wx.removeStorageSync("easy-swu:inbox-tab");
    const activeTab =
      requestedTab === "notices"
        ? 1
        : requestedTab === "messages"
          ? 0
          : this.data.activeTab;
    this.setData({ activeTab });
    if (activeTab === 0) {
      void this.loadMessages(true, false, this.data.messageItems.length > 0);
    } else {
      void this.loadNotices(true, false, this.data.noticeItems.length > 0);
    }
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  hydrateCachedPreview() {
    const account = getSession()?.user.account || "";
    if (!account || hydratedInboxAccount === account) return;
    hydratedInboxAccount = account;
    const cached = loadTeachingPreview(account);
    const messageItems = (cached?.messages || []).map(toMessageView);
    const noticeItems = (cached?.notices || []).map((notice) => ({
      ...notice,
      displayTime: formatDateTime(notice.publishedAt),
    }));
    this.setData({
      messageItems,
      noticeItems,
      messageLoaded: messageItems.length > 0,
      noticeLoaded: noticeItems.length > 0,
    });
  },
  onTabTap(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (index === this.data.activeTab) {
      return;
    }
    haptic("light");
    this.setData({ activeTab: index });
    this.loadActiveTab(index);
  },
  onSwiperChange(event: WechatMiniprogram.SwiperChange) {
    const index = event.detail.current;
    if (index !== this.data.activeTab) {
      this.setData({ activeTab: index });
      this.loadActiveTab(index);
    }
  },
  loadActiveTab(index: number) {
    if (index === 0) {
      void this.loadMessages(true, false, this.data.messageItems.length > 0);
    } else {
      void this.loadNotices(true, false, this.data.noticeItems.length > 0);
    }
  },
  async loadMessages(reset: boolean, refresh: boolean, mergeFresh = false) {
    if (
      (this.data.messageLoading || this.data.messageLoadingMore) &&
      !refresh
    ) {
      return;
    }
    const page = reset ? 1 : this.data.messagePage + 1;
    const sequence = ++messageRequestSequence;
    this.setData({
      messageLoading: reset && this.data.messageItems.length === 0,
      messageRefreshing: false,
      messageLoadingMore: !reset,
      messageError: "",
    });
    try {
      const result = await getMessages({
        page,
        pageSize: PAGE_SIZE,
        type: this.data.messageType || undefined,
        from: this.data.from || undefined,
        to: this.data.to || undefined,
        refresh,
      });
      if (sequence !== messageRequestSequence) {
        return;
      }
      const incoming = result.data.items.map(toMessageView);
      if (
        page === 1 &&
        !this.data.messageType &&
        !this.data.from &&
        !this.data.to
      ) {
        saveTeachingPreview(getSession()?.user.account || "", {
          messages: result.data.items,
        });
      }
      this.setData({
        messageItems: reset
          ? mergeFresh
            ? mergeMessages(incoming, this.data.messageItems)
            : incoming
          : mergeMessages(this.data.messageItems, incoming),
        messagePage: result.data.pagination.page,
        messageTotalPages: result.data.pagination.totalPages,
        messageLoaded: true,
      });
      if (!refresh && result.meta.refreshing) {
        setTimeout(() => void this.loadMessages(true, true, true), 0);
      }
    } catch (error) {
      if (sequence === messageRequestSequence) {
        this.setData({ messageError: getErrorMessage(error) });
      }
    } finally {
      if (sequence === messageRequestSequence) {
        this.setData({
          messageLoading: false,
          messageRefreshing: false,
          messageLoadingMore: false,
        });
      }
    }
  },
  async loadNotices(reset: boolean, refresh: boolean, mergeFresh = false) {
    if ((this.data.noticeLoading || this.data.noticeLoadingMore) && !refresh) {
      return;
    }
    const page = reset ? 1 : this.data.noticePage + 1;
    const sequence = ++noticeRequestSequence;
    this.setData({
      noticeLoading: reset && this.data.noticeItems.length === 0,
      noticeRefreshing: false,
      noticeLoadingMore: !reset,
      noticeError: "",
    });
    try {
      const result = await getNotices({
        page,
        pageSize: PAGE_SIZE,
        q: this.data.noticeQuery.trim() || undefined,
        refresh,
      });
      if (sequence !== noticeRequestSequence) {
        return;
      }
      const incoming = result.data.items.map((notice) => ({
        ...notice,
        displayTime: formatDateTime(notice.publishedAt),
      }));
      if (page === 1 && !this.data.noticeQuery.trim()) {
        saveTeachingPreview(getSession()?.user.account || "", {
          notices: result.data.items,
        });
      }
      this.setData({
        noticeItems: reset
          ? mergeFresh
            ? mergeNotices(incoming, this.data.noticeItems)
            : incoming
          : mergeNotices(this.data.noticeItems, incoming),
        noticePage: result.data.pagination.page,
        noticeTotalPages: result.data.pagination.totalPages,
        noticeLoaded: true,
      });
      if (!refresh && result.meta.refreshing) {
        setTimeout(() => void this.loadNotices(true, true, true), 0);
      }
    } catch (error) {
      if (sequence === noticeRequestSequence) {
        this.setData({ noticeError: getErrorMessage(error) });
      }
    } finally {
      if (sequence === noticeRequestSequence) {
        this.setData({
          noticeLoading: false,
          noticeRefreshing: false,
          noticeLoadingMore: false,
        });
      }
    }
  },
  refreshMessages() {
    haptic("light");
    void this.loadMessages(true, true, true);
  },
  refreshNotices() {
    haptic("light");
    void this.loadNotices(true, true, true);
  },
  loadMoreMessages() {
    if (this.data.messagePage < this.data.messageTotalPages) {
      void this.loadMessages(false, false);
    }
  },
  loadMoreNotices() {
    if (this.data.noticePage < this.data.noticeTotalPages) {
      void this.loadNotices(false, false);
    }
  },
  openMessageFilter() {
    haptic("light");
    this.setData({
      messageFilterVisible: true,
      draftType: this.data.messageType,
      draftFrom: this.data.from,
      draftTo: this.data.to,
    });
  },
  closeMessageFilter() {
    this.setData({ messageFilterVisible: false });
  },
  selectDraftType(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftType: String(event.currentTarget.dataset.value) as MessageType | "",
    });
  },
  onDraftFromChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ draftFrom: event.detail.value });
  },
  onDraftToChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ draftTo: event.detail.value });
  },
  clearDraftFrom() {
    this.setData({ draftFrom: "" });
  },
  clearDraftTo() {
    this.setData({ draftTo: "" });
  },
  resetMessageFilter() {
    this.setData({ draftType: "", draftFrom: "", draftTo: "" });
  },
  applyMessageFilter() {
    if (
      this.data.draftFrom &&
      this.data.draftTo &&
      this.data.draftFrom > this.data.draftTo
    ) {
      wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
      return;
    }
    haptic("medium");
    this.setData({
      messageType: this.data.draftType,
      from: this.data.draftFrom,
      to: this.data.draftTo,
      messageFilterVisible: false,
    });
    void this.loadMessages(true, false);
  },
  onNoticeQueryInput(event: WechatMiniprogram.Input) {
    this.setData({ noticeQuery: event.detail.value });
  },
  onNoticeSearchFocus() {
    this.setData({ noticeSearchFocused: true });
  },
  onNoticeSearchBlur() {
    this.setData({ noticeSearchFocused: false });
  },
  searchNotices() {
    void this.loadNotices(true, false);
  },
  clearNoticeQuery() {
    this.setData({ noticeQuery: "" });
    void this.loadNotices(true, false);
  },
  openNotice(event: WechatMiniprogram.TouchEvent) {
    const link = String(event.currentTarget.dataset.link || "");
    const title = String(event.currentTarget.dataset.title || "教务通知");
    if (!link) {
      return;
    }
    haptic("light");
    void navigateTo(
      `/pages/browser/index?url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`,
      "wx://upwards",
    );
  },
});
