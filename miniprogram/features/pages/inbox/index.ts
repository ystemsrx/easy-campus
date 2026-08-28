import { getMessages, getNotices } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import { loadTimetableSnapshot } from "../../../store/timetable";
import {
  cleanupTeachingPreview,
  loadTeachingPreview,
  saveTeachingPreview,
} from "../../../store/teaching-preview";
import type { MessageType, Notice, TeachingMessage } from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { formatDateTime } from "../../../utils/date";
import { formatSchedule } from "../../../utils/format";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../utils/refresh-flight";
import { showRefreshConfirmation } from "../../utils/refresh-feedback";
import {
  isCurrentSemesterTimestamp,
  isLatestSchoolNoticeSemesterAssignment,
  latestSchoolNoticeSemesterId,
  startedCurrentSemester,
  type StartedSemesterBoundary,
} from "../../../utils/semester";

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
  sourceCreatedAt: string;
  showHistoryDivider: boolean;
  original?: ScheduleView;
  current?: ScheduleView;
  content?: string;
}

interface NoticeView extends Notice {
  displayTime: string;
  showHistoryDivider: boolean;
}

interface MessageTypeOption {
  value: MessageType | "";
  label: string;
  selected: boolean;
}

interface MessageRefreshOutcome {
  succeeded: boolean;
  messageTypes: MessageType[];
  result: Awaited<ReturnType<typeof getMessages>> | null;
  errorMessage: string;
}

interface NoticeRefreshOutcome {
  succeeded: boolean;
  query: string;
  result: Awaited<ReturnType<typeof getNotices>> | null;
  errorMessage: string;
}

const MESSAGE_PAGE_SIZE = 15;
const NOTICE_PAGE_SIZE = 50;
const BACKGROUND_REFRESH_FOLLOWUP_MS = 1_500;
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

function messageRefreshFlightKey(lease: SessionLease): string {
  return `inbox-messages:${sessionLeaseKey(lease)}`;
}

function noticeRefreshFlightKey(lease: SessionLease): string {
  return `inbox-notices:${sessionLeaseKey(lease)}`;
}

async function refreshInboxMessages(
  lease: SessionLease,
  messageTypes: MessageType[],
): Promise<MessageRefreshOutcome> {
  try {
    const result = await getMessages({
      page: 1,
      pageSize: MESSAGE_PAGE_SIZE,
      types: messageTypes.length ? messageTypes : undefined,
      refresh: true,
    });
    if (!isSessionLeaseCurrent(lease)) {
      return {
        succeeded: false,
        messageTypes,
        result: null,
        errorMessage: "",
      };
    }
    if (!messageTypes.length) {
      saveTeachingPreview(lease.account, { messages: result.data.items });
    }
    return { succeeded: true, messageTypes, result, errorMessage: "" };
  } catch (error) {
    return {
      succeeded: false,
      messageTypes,
      result: null,
      errorMessage: getErrorMessage(error),
    };
  }
}

async function refreshInboxNotices(
  lease: SessionLease,
  query: string,
): Promise<NoticeRefreshOutcome> {
  try {
    const result = await getNotices({
      page: 1,
      pageSize: NOTICE_PAGE_SIZE,
      q: query || undefined,
      refresh: true,
    });
    if (!isSessionLeaseCurrent(lease)) {
      return { succeeded: false, query, result: null, errorMessage: "" };
    }
    if (!query) {
      saveTeachingPreview(lease.account, { notices: result.data.items });
    }
    return { succeeded: true, query, result, errorMessage: "" };
  } catch (error) {
    return {
      succeeded: false,
      query,
      result: null,
      errorMessage: getErrorMessage(error),
    };
  }
}
let hydratedInboxAccount = "";
let filterTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let messageFollowupTimer: ReturnType<typeof setTimeout> | undefined;
let noticeFollowupTimer: ReturnType<typeof setTimeout> | undefined;

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

function clearBackgroundFollowupTimers() {
  if (messageFollowupTimer !== undefined) {
    clearTimeout(messageFollowupTimer);
    messageFollowupTimer = undefined;
  }
  if (noticeFollowupTimer !== undefined) {
    clearTimeout(noticeFollowupTimer);
    noticeFollowupTimer = undefined;
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
  return value.trim().replace(/老师/g, "").trim();
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
        sourceCreatedAt: message.createdAt,
        showHistoryDivider: false,
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
        sourceCreatedAt: message.createdAt,
        showHistoryDivider: false,
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
        sourceCreatedAt: message.createdAt,
        showHistoryDivider: false,
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
        sourceCreatedAt: message.createdAt,
        showHistoryDivider: false,
        content: message.content,
      };
  }
}

function toNoticeView(notice: Notice): NoticeView {
  return {
    ...notice,
    displayTime: formatDateTime(notice.publishedAt),
    showHistoryDivider: false,
  };
}

function semesterBoundary(): StartedSemesterBoundary | null {
  const account = getSession()?.user.account || "";
  return startedCurrentSemester(loadTimetableSnapshot(account)?.data);
}

function withHistoryDivider<T>(
  items: T[],
  timestamp: (item: T) => string,
  boundary = semesterBoundary(),
): T[] {
  let historyStarted = false;
  return items.map((item) => {
    const historical = !isCurrentSemesterTimestamp(timestamp(item), boundary);
    const showHistoryDivider = historical && !historyStarted;
    if (historical) historyStarted = true;
    return { ...item, showHistoryDivider };
  });
}

function decorateMessages(items: MessageView[]): MessageView[] {
  return withHistoryDivider(items, (item) => item.sourceCreatedAt);
}

function decorateNotices(
  items: NoticeView[],
  latestSemesterId = latestSchoolNoticeSemesterId(items),
): NoticeView[] {
  const boundary = semesterBoundary();
  let historyStarted = false;
  return items.map((item) => {
    const historical = !isLatestSchoolNoticeSemesterAssignment(
      item.semesterId,
      latestSemesterId,
      item.publishedAt,
      boundary,
    );
    const showHistoryDivider = historical && !historyStarted;
    if (historical) historyStarted = true;
    return { ...item, showHistoryDivider };
  });
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
    .slice(0, MESSAGE_PAGE_SIZE);
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
    .slice(0, NOTICE_PAGE_SIZE);
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
    latestNoticeSemesterId: "",
    messageFilterMounted: false,
    messageFilterOpen: false,
    messageTypes: [] as MessageType[],
    messageFilterCount: 0,
    noticeQuery: "",
    noticeSearchFocused: false,
    messageTypeOptions: messageTypeOptions([]),
    refreshPageToken: 0,
    observedMessageRefreshFlightId: 0,
    observedNoticeRefreshFlightId: 0,
  },
  onLoad() {
    hydratedInboxAccount = "";
    messageRequestSequence += 1;
    noticeRequestSequence += 1;
    clearFilterTransitionTimer();
    clearBackgroundFollowupTimers();
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    this.setData({ refreshPageToken });
    this.applyAppearance();
    this.syncActiveMessageRefresh();
    this.syncActiveNoticeRefresh();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    markRefreshPageVisible(this.data.refreshPageToken);
    this.applyAppearance();
    this.hydrateCachedPreview();
    const requestedTab = wx.getStorageSync("easy-swu:inbox-tab");
    wx.removeStorageSync("easy-swu:inbox-tab");
    const lease = captureSessionLease();
    const hasMessageRefresh = Boolean(
      lease &&
      findRefreshFlight<MessageRefreshOutcome>(messageRefreshFlightKey(lease)),
    );
    const hasNoticeRefresh = Boolean(
      lease &&
      findRefreshFlight<NoticeRefreshOutcome>(noticeRefreshFlightKey(lease)),
    );
    const activeTab =
      requestedTab === "notices"
        ? 1
        : requestedTab === "messages"
          ? 0
          : hasNoticeRefresh && !hasMessageRefresh
            ? 1
            : this.data.activeTab;
    this.setData({ activeTab });
    if (activeTab === 0) {
      if (!this.syncActiveMessageRefresh()) {
        void this.loadMessages(false, this.data.messageItems.length > 0);
      }
    } else {
      if (!this.syncActiveNoticeRefresh()) {
        void this.loadNotices(false, this.data.noticeItems.length > 0);
      }
    }
  },
  onHide() {
    markRefreshPageHidden(this.data.refreshPageToken);
  },
  onUnload() {
    markRefreshPageHidden(this.data.refreshPageToken);
    clearFilterTransitionTimer();
    clearBackgroundFollowupTimers();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  syncActiveMessageRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<MessageRefreshOutcome>(messageRefreshFlightKey(lease))
      : null;
    if (!lease || !flight) {
      if (
        this.data.messageRefreshing ||
        this.data.observedMessageRefreshFlightId
      ) {
        this.setData({
          messageRefreshing: false,
          observedMessageRefreshFlightId: 0,
        });
      }
      return false;
    }
    this.observeMessageRefresh(flight, lease);
    return true;
  },
  observeMessageRefresh(
    flight: RefreshFlight<MessageRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedMessageRefreshFlightId === flight.id) {
      if (!this.data.messageRefreshing) {
        this.setData({ messageRefreshing: true });
      }
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({
      messageRefreshing: true,
      observedMessageRefreshFlightId: flight.id,
    });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({
        messageLoading: false,
        messageRefreshing: false,
        observedMessageRefreshFlightId: 0,
      });
      if (!outcome.succeeded || !outcome.result) {
        if (outcome.errorMessage) {
          this.setData({ messageError: outcome.errorMessage });
        }
        return;
      }
      const messageItems = mergeMessages(
        outcome.result.data.items.map(toMessageView),
        this.data.messageItems,
      );
      this.setData({
        messageTypes: outcome.messageTypes,
        messageFilterCount: outcome.messageTypes.length,
        messageTypeOptions: messageTypeOptions(outcome.messageTypes),
        messageItems: decorateMessages(messageItems),
        messageLoaded: true,
        messageError: "",
      });
      if (this.data.activeTab === 0) showRefreshConfirmation(this);
    });
  },
  syncActiveNoticeRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<NoticeRefreshOutcome>(noticeRefreshFlightKey(lease))
      : null;
    if (!lease || !flight) {
      if (
        this.data.noticeRefreshing ||
        this.data.observedNoticeRefreshFlightId
      ) {
        this.setData({
          noticeRefreshing: false,
          observedNoticeRefreshFlightId: 0,
        });
      }
      return false;
    }
    this.observeNoticeRefresh(flight, lease);
    return true;
  },
  observeNoticeRefresh(
    flight: RefreshFlight<NoticeRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedNoticeRefreshFlightId === flight.id) {
      if (!this.data.noticeRefreshing) {
        this.setData({ noticeRefreshing: true });
      }
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({
      noticeRefreshing: true,
      observedNoticeRefreshFlightId: flight.id,
    });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({
        noticeLoading: false,
        noticeRefreshing: false,
        observedNoticeRefreshFlightId: 0,
      });
      if (!outcome.succeeded || !outcome.result) {
        if (outcome.errorMessage) {
          this.setData({ noticeError: outcome.errorMessage });
        }
        return;
      }
      const noticeItems = mergeNotices(
        outcome.result.data.items.map(toNoticeView),
        this.data.noticeItems,
      );
      const latestNoticeSemesterId =
        latestSchoolNoticeSemesterId(noticeItems) ||
        this.data.latestNoticeSemesterId;
      this.setData({
        noticeQuery: outcome.query,
        latestNoticeSemesterId,
        noticeItems: decorateNotices(noticeItems, latestNoticeSemesterId),
        noticeLoaded: true,
        noticeError: "",
      });
      if (this.data.activeTab === 1) showRefreshConfirmation(this);
    });
  },
  hydrateCachedPreview() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    if (hydratedInboxAccount === account) {
      this.setData({
        messageItems: decorateMessages(this.data.messageItems),
        noticeItems: decorateNotices(
          this.data.noticeItems,
          this.data.latestNoticeSemesterId || undefined,
        ),
      });
      return;
    }
    if (hydratedInboxAccount && hydratedInboxAccount !== account) {
      messageRequestSequence += 1;
      noticeRequestSequence += 1;
      clearFilterTransitionTimer();
      clearBackgroundFollowupTimers();
      this.setData({
        messageLoading: false,
        noticeLoading: false,
        messageRefreshing: false,
        noticeRefreshing: false,
        messageError: "",
        noticeError: "",
        messageFilterMounted: false,
        messageFilterOpen: false,
        messageTypes: [],
        messageFilterCount: 0,
        messageTypeOptions: messageTypeOptions([]),
        noticeQuery: "",
        noticeSearchFocused: false,
        latestNoticeSemesterId: "",
      });
    }
    hydratedInboxAccount = account;
    const cached =
      cleanupTeachingPreview(account) || loadTeachingPreview(account);
    const messageItems = decorateMessages(
      (cached?.messages || []).map(toMessageView),
    );
    const cachedNotices = (cached?.notices || []).map(toNoticeView);
    const latestNoticeSemesterId =
      latestSchoolNoticeSemesterId(cachedNotices) || "";
    const noticeItems = decorateNotices(
      cachedNotices,
      latestNoticeSemesterId || undefined,
    );
    this.setData({
      messageItems,
      noticeItems,
      latestNoticeSemesterId,
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
      if (!this.syncActiveMessageRefresh()) {
        void this.loadMessages(false, this.data.messageItems.length > 0);
      }
    } else {
      if (!this.syncActiveNoticeRefresh()) {
        void this.loadNotices(false, this.data.noticeItems.length > 0);
      }
    }
  },
  async loadMessages(
    refresh: boolean,
    mergeFresh = false,
    showRefresher = false,
    allowBackgroundFollowup = true,
  ): Promise<boolean> {
    if (this.data.messageLoading && !refresh) return false;
    if (showRefresher && this.data.messageRefreshing) return false;
    const lease = captureSessionLease();
    if (!lease) return false;
    const sequence = ++messageRequestSequence;
    this.setData({
      messageLoading: this.data.messageItems.length === 0,
      messageRefreshing: showRefresher,
      messageError: "",
    });
    try {
      const result = await getMessages({
        page: 1,
        pageSize: MESSAGE_PAGE_SIZE,
        types: this.data.messageTypes.length
          ? this.data.messageTypes
          : undefined,
        refresh,
      });
      if (
        sequence !== messageRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return false;
      }
      const incoming = result.data.items.map(toMessageView);
      if (!this.data.messageTypes.length) {
        saveTeachingPreview(lease.account, {
          messages: result.data.items,
        });
      }
      const messageItems = mergeFresh
        ? mergeMessages(incoming, this.data.messageItems)
        : incoming.slice(0, MESSAGE_PAGE_SIZE);
      this.setData({
        messageItems: decorateMessages(messageItems),
        messageLoaded: true,
      });
      if (
        !refresh &&
        result.meta.refreshing &&
        allowBackgroundFollowup &&
        messageFollowupTimer === undefined
      ) {
        messageFollowupTimer = setTimeout(() => {
          messageFollowupTimer = undefined;
          if (isSessionLeaseCurrent(lease)) {
            void this.loadMessages(false, true, false, false);
          }
        }, BACKGROUND_REFRESH_FOLLOWUP_MS);
      }
      return true;
    } catch (error) {
      if (sequence === messageRequestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ messageError: getErrorMessage(error) });
      }
      return false;
    } finally {
      if (sequence === messageRequestSequence && isSessionLeaseCurrent(lease)) {
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
    allowBackgroundFollowup = true,
  ): Promise<boolean> {
    if (this.data.noticeLoading && !refresh) return false;
    if (showRefresher && this.data.noticeRefreshing) return false;
    const lease = captureSessionLease();
    if (!lease) return false;
    const sequence = ++noticeRequestSequence;
    this.setData({
      noticeLoading: this.data.noticeItems.length === 0,
      noticeRefreshing: showRefresher,
      noticeError: "",
    });
    try {
      const result = await getNotices({
        page: 1,
        pageSize: NOTICE_PAGE_SIZE,
        q: this.data.noticeQuery.trim() || undefined,
        refresh,
      });
      if (sequence !== noticeRequestSequence || !isSessionLeaseCurrent(lease)) {
        return false;
      }
      const incoming = result.data.items.map(toNoticeView);
      if (!this.data.noticeQuery.trim()) {
        saveTeachingPreview(lease.account, {
          notices: result.data.items,
        });
      }
      const noticeItems = mergeFresh
        ? mergeNotices(incoming, this.data.noticeItems)
        : incoming.slice(0, NOTICE_PAGE_SIZE);
      const latestNoticeSemesterId = this.data.noticeQuery.trim()
        ? this.data.latestNoticeSemesterId ||
          latestSchoolNoticeSemesterId(noticeItems) ||
          ""
        : latestSchoolNoticeSemesterId(noticeItems) || "";
      this.setData({
        latestNoticeSemesterId,
        noticeItems: decorateNotices(
          noticeItems,
          latestNoticeSemesterId || undefined,
        ),
        noticeLoaded: true,
      });
      if (
        !refresh &&
        result.meta.refreshing &&
        allowBackgroundFollowup &&
        noticeFollowupTimer === undefined
      ) {
        noticeFollowupTimer = setTimeout(() => {
          noticeFollowupTimer = undefined;
          if (isSessionLeaseCurrent(lease)) {
            void this.loadNotices(false, true, false, false);
          }
        }, BACKGROUND_REFRESH_FOLLOWUP_MS);
      }
      return true;
    } catch (error) {
      if (sequence === noticeRequestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ noticeError: getErrorMessage(error) });
      }
      return false;
    } finally {
      if (sequence === noticeRequestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({
          noticeLoading: false,
          noticeRefreshing: false,
        });
      }
    }
  },
  refreshMessages() {
    if (this.data.messageRefreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const messageTypes = [...this.data.messageTypes];
    const { flight, started } = startRefreshFlight(
      messageRefreshFlightKey(lease),
      () => refreshInboxMessages(lease, messageTypes),
    );
    this.observeMessageRefresh(flight, lease);
    if (started) {
      messageRequestSequence += 1;
      haptic("light");
    }
  },
  refreshNotices() {
    if (this.data.noticeRefreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const query = this.data.noticeQuery.trim();
    const { flight, started } = startRefreshFlight(
      noticeRefreshFlightKey(lease),
      () => refreshInboxNotices(lease, query),
    );
    this.observeNoticeRefresh(flight, lease);
    if (started) {
      noticeRequestSequence += 1;
      haptic("light");
    }
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
    const title = String(event.currentTarget.dataset.title || "学校通知");
    const publishedAt = String(event.currentTarget.dataset.publishedAt || "");
    if (!id && !link) {
      return;
    }
    haptic("light");
    void navigateTo(
      `/features/pages/browser/index?id=${encodeURIComponent(id || noticeSourceIdFromLink(link))}&url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&publishedAt=${encodeURIComponent(publishedAt)}`,
    );
  },
});
