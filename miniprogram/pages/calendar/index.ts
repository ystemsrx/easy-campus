import { ApiClientError, getErrorMessage } from "../../services/request";
import { downloadCalendarImage, getCalendar } from "../../services/teaching";
import { getCachedCalendarImage } from "../../store/calendar";
import type { CalendarAcademicYearOption, CalendarData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface YearOption {
  value: number;
  label: string;
}

function buildYearOptions(
  selected: number,
  selectedLabel: string,
  available?: CalendarAcademicYearOption[],
): YearOption[] {
  const entries = available?.length
    ? available
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

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
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
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    if (!this.data.calendar) {
      void this.loadCalendar(undefined, false);
    }
  },
  onUnload() {
    if (yearPickerCloseTimer) clearTimeout(yearPickerCloseTimer);
    yearPickerCloseTimer = null;
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
  async getCachedImage(
    calendar: CalendarData,
    forceDownload = false,
  ): Promise<string> {
    return getCachedCalendarImage(
      calendar,
      () => downloadCalendarImage(calendar.startYear),
      forceDownload,
    );
  },
  async loadCalendar(academicYear?: number, refresh = false) {
    this.setData({
      loading: !this.data.calendar,
      refreshing: false,
      imageLoading: !this.data.imagePath,
      errorMessage: "",
    });
    try {
      const calendar = await getCalendar(academicYear, refresh);
      const imagePath = await this.getCachedImage(calendar, refresh);
      this.setData({
        calendar,
        academicYear: calendar.startYear,
        yearLabel: calendar.academicYear,
        yearOptions: buildYearOptions(
          calendar.startYear,
          calendar.academicYear,
          calendar.availableCalendars,
        ),
        imagePath,
      });
      if (refresh) haptic("medium");
    } catch (error) {
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
    } finally {
      this.setData({ loading: false, refreshing: false, imageLoading: false });
    }
  },
  onRefresh() {
    void this.loadCalendar(this.data.academicYear || undefined, true);
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
