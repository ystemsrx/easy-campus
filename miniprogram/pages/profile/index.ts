import { getApiOrigin } from "../../config/index";
import { getCurrentUser } from "../../services/auth";
import { getErrorMessage } from "../../services/request";
import { clearSession, getSession, loadCurrentUser } from "../../store/session";
import { updatePreferences } from "../../store/preferences";
import type { ThemePreference } from "../../types/app";
import type { CurrentUserData } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface ProfileRow {
  label: string;
  value: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function getUserTimeZoneLabel(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes > 0 ? "+" : "−";
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function buildProfileRows(user: CurrentUserData): ProfileRow[] {
  const profile = user.profile;
  return [
    { label: "学院", value: profile.organizationName || "—" },
    { label: "专业", value: profile.majorName || "—" },
    { label: "班级", value: profile.className || "—" },
    { label: "年级", value: profile.grade || "—" },
    { label: "培养层次", value: profile.studentType || "—" },
    { label: "学籍状态", value: profile.studentStatus || "—" },
    { label: "入学日期", value: profile.enrollmentDate || "—" },
    {
      label: "学制",
      value: profile.programLength ? `${profile.programLength} 年` : "—",
    },
  ];
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
    majorName: "",
    profileRows: [] as ProfileRow[],
    themePreference: "system" as ThemePreference,
    themePreferenceLabel: "跟随系统",
    reducedMotion: false,
    haptics: true,
    themeSheetVisible: false,
    apiOrigin: getApiOrigin(),
    timeZoneLabel: getUserTimeZoneLabel(),
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
      apiOrigin: getApiOrigin(),
      timeZoneLabel: getUserTimeZoneLabel(),
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
      majorName: user.profile.majorName || user.profile.studentType || "",
      profileRows: buildProfileRows(user),
    });
  },
  async loadUser() {
    if (this.data.loading) {
      return;
    }
    this.setData({
      loading: !this.data.profileRows.length,
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
  copyAccount() {
    if (!this.data.account) return;
    wx.setClipboardData({ data: this.data.account });
  },
  copyApiOrigin() {
    wx.setClipboardData({ data: this.data.apiOrigin });
  },
  logout() {
    wx.showModal({
      title: "退出登录？",
      content: "本机将移除登录会话。再次使用时需要重新输入学号和密码。",
      confirmText: "退出登录",
      confirmColor: "#e64b5d",
      success: (result) => {
        if (!result.confirm) return;
        haptic("heavy");
        clearSession();
        wx.reLaunch({ url: "/pages/login/index" });
      },
    });
  },
  showSessionInfo() {
    const session = getSession();
    wx.showModal({
      title: "滑动会话",
      content: session
        ? "登录状态连续 90 天未使用才会失效。每次成功访问都会重新获得完整的 90 天有效期。"
        : "当前没有有效会话。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
