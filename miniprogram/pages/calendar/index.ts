import { ApiClientError, getErrorMessage } from "../../services/request";
import { downloadCalendarImage, getCalendar } from "../../services/teaching";
import type { CalendarData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatDateTime } from "../../utils/date";
import { formatBytes } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface YearOption {
  value: number;
  label: string;
}

function buildYearOptions(latest: number, available?: number[]): YearOption[] {
  const years = available?.length
    ? available
    : Array.from({ length: 6 }, (_, index) => latest - index);
  return [...new Set(years)]
    .sort((a, b) => b - a)
    .map((year) => ({ value: year, label: `${year}-${year + 1}` }));
}

function accessFile(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().access({
      path,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function persistFile(tempFilePath: string): Promise<string> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (result: WechatMiniprogram.SaveFileSuccessCallbackResult) =>
        resolve(result.savedFilePath),
      fail: () => resolve(tempFilePath),
    });
  });
}

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
    publishedLabel: "发布时间未提供",
    sizeLabel: "—",
    yearOptions: [] as YearOption[],
    yearPickerVisible: false,
    draftAcademicYear: 0,
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
    const key = `easy-swu:calendar-image:${calendar.startYear}:${calendar.size}`;
    const cached = wx.getStorageSync(key);
    if (
      !forceDownload &&
      typeof cached === "string" &&
      cached &&
      (await accessFile(cached))
    ) {
      return cached;
    }
    const tempPath = await downloadCalendarImage(calendar.startYear);
    const savedPath = await persistFile(tempPath);
    if (savedPath !== tempPath) {
      wx.setStorageSync(key, savedPath);
    }
    return savedPath;
  },
  async loadCalendar(academicYear?: number, refresh = false) {
    this.setData({
      loading: !this.data.calendar,
      refreshing: refresh,
      imageLoading: true,
      errorMessage: "",
    });
    try {
      const calendar = await getCalendar(academicYear, refresh);
      this.setData({
        calendar,
        academicYear: calendar.startYear,
        draftAcademicYear: calendar.startYear,
        yearLabel: calendar.academicYear,
        publishedLabel: calendar.publishedAt
          ? /[ T]\d{2}:\d{2}/.test(calendar.publishedAt)
            ? formatDateTime(calendar.publishedAt)
            : calendar.publishedAt
          : "发布时间未提供",
        sizeLabel: formatBytes(calendar.size),
        yearOptions: buildYearOptions(calendar.startYear),
      });
      const imagePath = await this.getCachedImage(calendar, refresh);
      this.setData({ imagePath });
      if (refresh) haptic("medium");
    } catch (error) {
      if (error instanceof ApiClientError) {
        const details = error.details as
          { availableAcademicYears?: number[] } | undefined;
        if (details?.availableAcademicYears?.length) {
          this.setData({
            yearOptions: buildYearOptions(
              details.availableAcademicYears[0],
              details.availableAcademicYears,
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
    void this.loadCalendar(undefined, true);
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
    this.setData({
      yearPickerVisible: true,
      draftAcademicYear: this.data.academicYear,
    });
  },
  closeYearPicker() {
    this.setData({ yearPickerVisible: false });
  },
  selectYear(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftAcademicYear: Number(event.currentTarget.dataset.value),
    });
  },
  applyYear() {
    const year = this.data.draftAcademicYear;
    this.setData({ yearPickerVisible: false, imagePath: "", calendar: null });
    void this.loadCalendar(year, false);
  },
});
