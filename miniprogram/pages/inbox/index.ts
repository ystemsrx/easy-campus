import { getMessages, getNotices } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import { getSession } from "../../store/session";
import {
  cleanupTeachingPreview,
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

interface MessageTypeOption {
  value: MessageType | "";
  label: string;
  selected: boolean;
}

const PAGE_SIZE = 15;
const MESSAGE_TYPE_OPTIONS: ReadonlyArray<
  Pick<MessageTypeOption, "value" | "label">
> = [
  { value: "", label: "全部" },
  { value: "course_rescheduled", label: "调课" },
  { value: "makeup_class", label: "补课" },
  { value: "course_cancelled", label: "停课" },
  { value: "other", label: "其他" },
];
let messageRequestSequence = 0;
let noticeRequestSequence = 0;
let hydratedInboxAccount = "";
let filterTransitionTimer: ReturnType<typeof setTimeout> | undefined;

function messageTypeOptions(selected: MessageType[]): MessageTypeOption[] {
  return MESSAGE_TYPE_OPTIONS.map((option) => ({
    ...option,
    selected: option.value ? selected.includes(option.value) : !selected.length,
  }));
}

function clearFilterTransitionTimer() {
  if (filterTransitionTimer !== undefined) {
    clearTimeout(filterTransitionTimer);
    filterTransitionTimer = undefined;
  }
}

function scheduleView(schedule: {
  weekStart: number;
  weekEnd: number;
  weeks?: number[];
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

function teacherLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.endsWith("老师") ? normalized : `${normalized}老师`;
}

function toMessageView(message: TeachingMessage): MessageView {
  switch (message.type) {
    case "course_rescheduled": {
      const originalTeacher = teacherLabel(message.teacherName);
      const currentTeacher = teacherLabel(message.newTeacherName);
      return {
        id: message.id,
        type: message.type,
        label: "调课",
        tone: "blue",
        title: message.courseName,
        teacher:
          originalTeacher &&
          currentTeacher &&
          originalTeacher !== currentTeacher
            ? `${originalTeacher} → ${currentTeacher}`
            : currentTeacher || originalTeacher,
        createdAt: formatDateTime(message.createdAt),
        original: scheduleView(message.originalSchedule),
        current: scheduleView(message.newSchedule),
      };
    }
    case "makeup_class":
      return {
        id: message.id,
        type: message.type,
        label: "补课",
        tone: "green",
        title: message.courseName,
        teacher: teacherLabel(message.teacherName),
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
        teacher: teacherLabel(message.teacherName),
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
  return [...incoming, ...existing]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, PAGE_SIZE);
}

function mergeNotices(
  incoming: NoticeView[],
  existing: NoticeView[],
): NoticeView[] {
  const seen = new Set<string>();
  return [...incoming, ...existing]
    .filter((item) => {
      const identity = item.id || item.link;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, PAGE_SIZE);
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

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    activeTab: 0,
    messageItems: [] as MessageView[],
    noticeItems: [] as NoticeView[],
    messageLoading: false,
    noticeLoading: false,
    messageLoaded: false,
    noticeLoaded: false,
    messageRefreshing: false,
    noticeRefreshing: false,
    messageError: "",
    noticeError: "",
    messageFilterMounted: false,
    messageFilterOpen: false,
    messageTypes: [] as MessageType[],
    messageFilterCount: 0,
    noticeQuery: "",
    noticeSearchFocused: false,
    messageTypeOptions: messageTypeOptions([]),
  },
  onLoad() {
    hydratedInboxAccount = "";
    clearFilterTransitionTimer();
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    this.hydrateCachedPreview();
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
      void this.loadMessages(false, this.data.messageItems.length > 0);
    } else {
      void this.loadNotices(false, this.data.noticeItems.length > 0);
    }
  },
  onUnload() {
    clearFilterTransitionTimer();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  hydrateCachedPreview() {
    const account = getSession()?.user.account || "";
    if (!account || hydratedInboxAccount === account) return;
    hydratedInboxAccount = account;
    const cached =
      cleanupTeachingPreview(account) || loadTeachingPreview(account);
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
    if (this.data.messageFilterMounted) this.closeMessageFilter();
    this.setData({ activeTab: index });
    this.loadActiveTab(index);
  },
  onSwiperChange(event: WechatMiniprogram.SwiperChange) {
    const index = event.detail.current;
    if (index !== this.data.activeTab) {
      if (this.data.messageFilterMounted) this.closeMessageFilter();
      this.setData({ activeTab: index });
      this.loadActiveTab(index);
    }
  },
  loadActiveTab(index: number) {
    if (index === 0) {
      void this.loadMessages(false, this.data.messageItems.length > 0);
    } else {
      void this.loadNotices(false, this.data.noticeItems.length > 0);
    }
  },
  async loadMessages(
    refresh: boolean,
    mergeFresh = false,
    showRefresher = false,
  ) {
    if (this.data.messageLoading && !refresh) return;
    if (showRefresher && this.data.messageRefreshing) return;
    const sequence = ++messageRequestSequence;
    this.setData({
      messageLoading: this.data.messageItems.length === 0,
      messageRefreshing: showRefresher,
      messageError: "",
    });
    try {
      const result = await getMessages({
        page: 1,
        pageSize: PAGE_SIZE,
        types: this.data.messageTypes.length
          ? this.data.messageTypes
          : undefined,
        refresh,
      });
      if (sequence !== messageRequestSequence) {
        return;
      }
      const incoming = result.data.items.map(toMessageView);
      if (!this.data.messageTypes.length) {
        saveTeachingPreview(getSession()?.user.account || "", {
          messages: result.data.items,
        });
      }
      this.setData({
        messageItems: mergeFresh
          ? mergeMessages(incoming, this.data.messageItems)
          : incoming.slice(0, PAGE_SIZE),
        messageLoaded: true,
      });
      if (!refresh && result.meta.refreshing) {
        setTimeout(() => void this.loadMessages(true, true, false), 0);
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
        });
      }
    }
  },
  async loadNotices(
    refresh: boolean,
    mergeFresh = false,
    showRefresher = false,
  ) {
    if (this.data.noticeLoading && !refresh) return;
    if (showRefresher && this.data.noticeRefreshing) return;
    const sequence = ++noticeRequestSequence;
    this.setData({
      noticeLoading: this.data.noticeItems.length === 0,
      noticeRefreshing: showRefresher,
      noticeError: "",
    });
    try {
      const result = await getNotices({
        page: 1,
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
      if (!this.data.noticeQuery.trim()) {
        saveTeachingPreview(getSession()?.user.account || "", {
          notices: result.data.items,
        });
      }
      this.setData({
        noticeItems: mergeFresh
          ? mergeNotices(incoming, this.data.noticeItems)
          : incoming.slice(0, PAGE_SIZE),
        noticeLoaded: true,
      });
      if (!refresh && result.meta.refreshing) {
        setTimeout(() => void this.loadNotices(true, true, false), 0);
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
  onPageTap() {
    if (this.data.messageFilterMounted) this.closeMessageFilter();
  },
  keepMessageFilterOpen() {},
  openMessageFilter() {
    if (this.data.messageFilterMounted) {
      this.closeMessageFilter();
      return;
    }
    haptic("light");
    clearFilterTransitionTimer();
    this.setData(
      {
        messageFilterMounted: true,
        messageFilterOpen: false,
      },
      () => {
        filterTransitionTimer = setTimeout(() => {
          this.setData({ messageFilterOpen: true });
          filterTransitionTimer = undefined;
        }, 16);
      },
    );
  },
  closeMessageFilter() {
    clearFilterTransitionTimer();
    this.setData({ messageFilterOpen: false });
    filterTransitionTimer = setTimeout(() => {
      this.setData({ messageFilterMounted: false });
      filterTransitionTimer = undefined;
    }, 260);
  },
  selectMessageType(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const value = MESSAGE_TYPE_OPTIONS[index]?.value;
    if (value === undefined) return;
    const current = this.data.messageTypes;
    const messageTypes = value
      ? current.includes(value)
        ? current.filter((type) => type !== value)
        : [...current, value]
      : [];
    haptic("light");
    this.setData(
      {
        messageTypes,
        messageFilterCount: messageTypes.length,
        messageTypeOptions: messageTypeOptions(messageTypes),
      },
      () => void this.loadMessages(false),
    );
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
    void this.loadNotices(false);
  },
  clearNoticeQuery() {
    this.setData({ noticeQuery: "" });
    void this.loadNotices(false);
  },
  openNotice(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const link = String(event.currentTarget.dataset.link || "");
    const title = String(event.currentTarget.dataset.title || "教务通知");
    const publishedAt = String(event.currentTarget.dataset.publishedAt || "");
    if (!id && !link) {
      return;
    }
    haptic("light");
    void navigateTo(
      `/pages/browser/index?id=${encodeURIComponent(id || noticeSourceIdFromLink(link))}&url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&publishedAt=${encodeURIComponent(publishedAt)}`,
      "wx://upwards",
    );
  },
});
