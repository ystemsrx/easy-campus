import { ApiClientError, getErrorMessage } from "../../../services/request";
import { downloadCalendarImage, getCalendar } from "../../../services/teaching";
import { getCachedCalendarImage } from "../../store/calendar";
import type {
  CalendarAcademicYearOption,
  CalendarData,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import { showRefreshConfirmation } from "../../utils/refresh-feedback";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../utils/refresh-flight";

interface YearOption {
  value: number;
  label: string;
}

interface CalendarRefreshOutcome {
  succeeded: boolean;
  calendar: CalendarData | null;
  imagePath: string;
  errorMessage: string;
  availableCalendars: CalendarAcademicYearOption[];
}

function buildYearOptions(
  selected: number,
  selectedLabel: string,
  available?: CalendarAcademicYearOption[],
  availableAcademicYears?: number[],
): YearOption[] {
  const entries = available?.length
    ? available
    : availableAcademicYears?.length
      ? availableAcademicYears.map((startYear) => ({
          startYear,
          academicYear: `${startYear}-${startYear + 1}`,
        }))
      : [{ startYear: selected, academicYear: selectedLabel }];
  const options = new Map<number, YearOption>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.startYear) || entry.startYear <= 0) continue;
    options.set(entry.startYear, {
      value: entry.startYear,
      label: entry.academicYear,
    });
  }
  return [...options.values()].sort((a, b) => b.value - a.value);
}

let yearPickerCloseTimer: ReturnType<typeof setTimeout> | null = null;
let calendarRequestSequence = 0;

function calendarRefreshFlightKey(lease: SessionLease): string {
  return `calendar:${sessionLeaseKey(lease)}`;
}

async function refreshCalendar(
  lease: SessionLease,
  academicYear?: number,
): Promise<CalendarRefreshOutcome> {
  try {
    const calendar = await getCalendar(academicYear, true);
    if (!isSessionLeaseCurrent(lease)) {
      return {
        succeeded: false,
        calendar: null,
        imagePath: "",
        errorMessage: "",
        availableCalendars: [],
      };
    }
    const imagePath = await getCachedCalendarImage(
      calendar,
      () => downloadCalendarImage(calendar, true),
      true,
    );
    return {
      succeeded: isSessionLeaseCurrent(lease),
      calendar,
      imagePath,
      errorMessage: "",
      availableCalendars: [],
    };
  } catch (error) {
    const details =
      error instanceof ApiClientError
        ? (error.details as
            { availableCalendars?: CalendarAcademicYearOption[] } | undefined)
        : undefined;
    return {
      succeeded: false,
      calendar: null,
      imagePath: "",
      errorMessage: getErrorMessage(error, "校历加载失败。"),
      availableCalendars: details?.availableCalendars || [],
    };
  }
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    loading: true,
    refreshing: false,
    imageLoading: false,
    errorMessage: "",
    calendar: null as CalendarData | null,
    imagePath: "",
    academicYear: 0,
    yearLabel: "最新校历",
    yearOptions: [] as YearOption[],
    yearPickerMounted: false,
    yearPickerOpen: false,
    refreshPageToken: 0,
    observedRefreshFlightId: 0,
  },
  onLoad() {
    calendarRequestSequence += 1;
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    this.setData({ refreshPageToken });
    this.applyAppearance();
    this.syncActiveCalendarRefresh();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    markRefreshPageVisible(this.data.refreshPageToken);
    this.applyAppearance();
    if (!this.syncActiveCalendarRefresh() && !this.data.calendar) {
      void this.loadCalendar(undefined, false);
    }
  },
  onHide() {
    markRefreshPageHidden(this.data.refreshPageToken);
  },
  onUnload() {
    markRefreshPageHidden(this.data.refreshPageToken);
    if (yearPickerCloseTimer) clearTimeout(yearPickerCloseTimer);
    yearPickerCloseTimer = null;
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  syncActiveCalendarRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<CalendarRefreshOutcome>(
          calendarRefreshFlightKey(lease),
        )
      : null;
    if (!lease || !flight) {
      if (this.data.refreshing || this.data.observedRefreshFlightId) {
        this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    this.observeCalendarRefresh(flight, lease);
    return true;
  },
  observeCalendarRefresh(
    flight: RefreshFlight<CalendarRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedRefreshFlightId === flight.id) {
      if (!this.data.refreshing) this.setData({ refreshing: true });
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({ refreshing: true, observedRefreshFlightId: flight.id });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({
        loading: false,
        refreshing: false,
        imageLoading: false,
        observedRefreshFlightId: 0,
      });
      if (!outcome.succeeded || !outcome.calendar) {
        const available = outcome.availableCalendars;
        this.setData({
          errorMessage: outcome.errorMessage,
          ...(available.length
            ? {
                yearOptions: buildYearOptions(
                  available[0].startYear,
                  available[0].academicYear,
                  available,
                ),
              }
            : {}),
        });
        return;
      }
      const calendar = outcome.calendar;
      this.setData({
        calendar,
        academicYear: calendar.startYear,
        yearLabel: calendar.academicYear,
        yearOptions: buildYearOptions(
          calendar.startYear,
          calendar.academicYear,
          calendar.availableCalendars,
          calendar.availableAcademicYears,
        ),
        imagePath: outcome.imagePath,
        errorMessage: "",
        loading: false,
        imageLoading: false,
      });
      haptic("medium");
      showRefreshConfirmation(this);
    });
  },
  async getCachedImage(
    calendar: CalendarData,
    forceDownload = false,
  ): Promise<string> {
    return getCachedCalendarImage(
      calendar,
      () => downloadCalendarImage(calendar, forceDownload),
      forceDownload,
    );
  },
  async loadCalendar(academicYear?: number, refresh = false): Promise<boolean> {
    const lease = captureSessionLease();
    if (!lease) return false;
    const sequence = ++calendarRequestSequence;
    this.setData({
      loading: !this.data.calendar,
      refreshing: refresh,
      imageLoading: !this.data.imagePath,
      errorMessage: "",
    });
    try {
      const calendar = await getCalendar(academicYear, refresh);
      if (
        sequence !== calendarRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return false;
      }
      const imagePath = await this.getCachedImage(calendar, refresh);
      if (
        sequence !== calendarRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return false;
      }
      this.setData({
        calendar,
        academicYear: calendar.startYear,
        yearLabel: calendar.academicYear,
        yearOptions: buildYearOptions(
          calendar.startYear,
          calendar.academicYear,
          calendar.availableCalendars,
          calendar.availableAcademicYears,
        ),
        imagePath,
      });
      if (refresh) haptic("medium");
      return true;
    } catch (error) {
      if (
        sequence !== calendarRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return false;
      }
      if (error instanceof ApiClientError) {
        const details = error.details as
          { availableCalendars?: CalendarAcademicYearOption[] } | undefined;
        if (details?.availableCalendars?.length) {
          this.setData({
            yearOptions: buildYearOptions(
              details.availableCalendars[0].startYear,
              details.availableCalendars[0].academicYear,
              details.availableCalendars,
            ),
          });
        }
      }
      this.setData({ errorMessage: getErrorMessage(error, "校历加载失败。") });
      return false;
    } finally {
      if (
        sequence === calendarRequestSequence &&
        isSessionLeaseCurrent(lease)
      ) {
        this.setData({
          loading: false,
          refreshing: false,
          imageLoading: false,
        });
      }
    }
  },
  onRefresh() {
    if (this.data.refreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const academicYear = this.data.academicYear || undefined;
    const { flight, started } = startRefreshFlight(
      calendarRefreshFlightKey(lease),
      () => refreshCalendar(lease, academicYear),
    );
    this.observeCalendarRefresh(flight, lease);
    if (started) calendarRequestSequence += 1;
  },
  previewImage() {
    if (!this.data.imagePath) return;
    haptic("light");
    wx.previewImage({
      current: this.data.imagePath,
      urls: [this.data.imagePath],
    });
  },
  saveImage() {
    if (!this.data.imagePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.imagePath,
      success: () => {
        haptic("medium");
        wx.showToast({ title: "已保存到相册", icon: "success" });
      },
      fail: () =>
        wx.showToast({ title: "未能保存，请检查相册权限", icon: "none" }),
    });
  },
  openYearPicker() {
    haptic("light");
    if (yearPickerCloseTimer) clearTimeout(yearPickerCloseTimer);
    this.setData({ yearPickerMounted: true });
    setTimeout(() => this.setData({ yearPickerOpen: true }), 20);
  },
  closeYearPicker() {
    this.setData({ yearPickerOpen: false });
    if (yearPickerCloseTimer) clearTimeout(yearPickerCloseTimer);
    yearPickerCloseTimer = setTimeout(() => {
      this.setData({ yearPickerMounted: false });
      yearPickerCloseTimer = null;
    }, 280);
  },
  selectYear(event: WechatMiniprogram.TouchEvent) {
    const year = Number(event.currentTarget.dataset.value);
    if (!Number.isInteger(year) || year <= 0) return;
    haptic("light");
    this.closeYearPicker();
    if (year === this.data.academicYear) return;
    void this.loadCalendar(year, false);
  },
  stopPropagation() {},
});
