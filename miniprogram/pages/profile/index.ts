import { getCurrentUser, logout as logoutSession } from "../../services/auth";
import { getErrorMessage } from "../../services/request";
import { loadCurrentUser } from "../../store/session";
import { updatePreferences } from "../../store/preferences";
import type { ThemePreference } from "../../types/app";
import type { CurrentUserData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

function classLabel(user: CurrentUserData): string {
  const grade = (user.profile.grade || "").trim().replace(/级$/, "");
  const className = (user.profile.className || "").trim();
  if (!className) return "";
  return grade && !className.includes(grade)
    ? `${grade}${className}`
    : className;
}

function enrollmentDateLabel(value?: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec((value || "").trim())?.[1] || "";
}

function themeLabel(theme: ThemePreference): string {
  if (theme === "light") return "浅色";
  if (theme === "dark") return "深色";
  return "跟随系统";
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    loading: false,
    refreshing: false,
    errorMessage: "",
    userName: "同学",
    avatarText: "易",
    account: "",
    organizationName: "西南大学",
    classLabel: "",
    enrollmentDate: "",
    themePreference: "system" as ThemePreference,
    themePreferenceLabel: "跟随系统",
    reducedMotion: false,
    haptics: true,
    themeSheetVisible: false,
    themeOptions: [
      { value: "system", label: "跟随系统", caption: "自动匹配设备外观" },
      { value: "light", label: "浅色", caption: "明亮、清晰的界面" },
      { value: "dark", label: "深色", caption: "降低夜间视觉亮度" },
    ],
  },
  onLoad() {
    this.applyAppearance();
    const cached = loadCurrentUser();
    if (cached) {
      this.applyUser(cached);
    }
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    this.syncTabBarAppearance();
    void this.loadUser();
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    this.setData({
      ...resolveAppearance(preferences),
      themePreference: preferences.theme,
      themePreferenceLabel: themeLabel(preferences.theme),
      reducedMotion: preferences.reducedMotion,
      haptics: preferences.haptics,
    });
  },
  syncTabBarAppearance() {
    this.getTabBar().setData({
      selected: 2,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
  },
  applyUser(user: CurrentUserData) {
    const name = user.name || user.profile.name || "同学";
    this.setData({
      userName: name,
      avatarText: name.slice(0, 1),
      account: user.account,
      organizationName: user.profile.organizationName || "西南大学",
      classLabel: classLabel(user),
      enrollmentDate: enrollmentDateLabel(user.profile.enrollmentDate),
    });
  },
  async loadUser() {
    if (this.data.loading) {
      return;
    }
    this.setData({
      loading: !this.data.account,
      refreshing: false,
      errorMessage: "",
    });
    try {
      const user = await getCurrentUser();
      this.applyUser(user);
    } catch (error) {
      this.setData({
        errorMessage: getErrorMessage(error, "个人资料加载失败。"),
      });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },
  onRefresh() {
    haptic("light");
    void this.loadUser();
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  openThemeSheet() {
    haptic("light");
    this.setData({ themeSheetVisible: true });
  },
  closeThemeSheet() {
    this.setData({ themeSheetVisible: false });
  },
  selectTheme(event: WechatMiniprogram.TouchEvent) {
    const theme = String(event.currentTarget.dataset.value) as ThemePreference;
    updatePreferences({ theme });
    haptic("medium");
    this.setData({ themeSheetVisible: false });
    this.applyAppearance();
    this.syncTabBarAppearance();
  },
  onReducedMotionChange(event: WechatMiniprogram.SwitchChange) {
    updatePreferences({ reducedMotion: event.detail.value });
    haptic("light");
    this.applyAppearance();
    this.syncTabBarAppearance();
  },
  onHapticsChange(event: WechatMiniprogram.SwitchChange) {
    if (event.detail.value) {
      updatePreferences({ haptics: true });
      haptic("medium");
    } else {
      haptic("light");
      updatePreferences({ haptics: false });
    }
    this.applyAppearance();
    this.syncTabBarAppearance();
  },
  logout() {
    haptic("heavy");
    void logoutSession()
      .catch(() => undefined)
      .finally(() => wx.reLaunch({ url: "/pages/login/index" }));
  },
});
