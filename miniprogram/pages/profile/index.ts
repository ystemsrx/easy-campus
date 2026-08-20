import { logout as logoutSession } from "../../services/auth";
import { getPreloadedCurrentUser } from "../../services/primary-tab-preload";
import { getErrorMessage } from "../../services/request";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";
import { loadPetPreferences, shouldShowPet } from "../../store/pet";
import { getSession, loadCurrentUser } from "../../store/session";
import { loadPreferences, updatePreferences } from "../../store/preferences";
import type { ThemePreference } from "../../types/app";
import type { CurrentUserData } from "../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../utils/appearance";
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

const INITIAL_PROFILE_PREFERENCES = loadPreferences();
const INITIAL_PROFILE_APPEARANCE = resolveAppearance(
  INITIAL_PROFILE_PREFERENCES,
);

Page({
  data: {
    ...INITIAL_PROFILE_APPEARANCE,
    loading: false,
    errorMessage: "",
    userName: "同学",
    avatarText: "易",
    account: "",
    organizationName: "西南大学",
    classLabel: "",
    enrollmentDate: "",
    themePreference: INITIAL_PROFILE_PREFERENCES.theme,
    themePreferenceLabel: themeLabel(INITIAL_PROFILE_PREFERENCES.theme),
    reducedMotion: INITIAL_PROFILE_PREFERENCES.reducedMotion,
    haptics: INITIAL_PROFILE_PREFERENCES.haptics,
    themeSheetVisible: false,
    petShape: "blob" as PetShapeId,
    petColor: "#111214",
    petEnhanced: false,
    petSelected: false,
    petEnabled: false,
    petVisible: false,
    themeOptions: [
      { value: "system", label: "跟随系统", caption: "自动匹配设备外观" },
      { value: "light", label: "浅色", caption: "明亮、清晰的界面" },
      { value: "dark", label: "深色", caption: "降低夜间视觉亮度" },
    ],
  },
  onLoad() {
    this.applyAppearance();
    const cached = getApp<IAppOption>().globalData.user || loadCurrentUser();
    if (cached) {
      this.applyUser(cached);
      this.loadPet(cached.account);
    }
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    this.loadPet(getSession()?.user.account || "");
    this.syncTabBarAppearance();
    void this.loadUser();
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance.theme);
    this.setData({
      ...appearance,
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
  loadPet(account: string) {
    if (!account) return;
    const preferences = loadPetPreferences(account);
    this.setData({
      petShape: preferences.shape,
      petColor: preferences.color,
      petEnhanced: preferences.enhanced,
      petSelected: preferences.selected,
      petEnabled: preferences.enabled,
      petVisible: shouldShowPet(preferences),
    });
  },
  async loadUser(refresh = false) {
    if (this.data.loading) {
      return;
    }
    this.setData({
      loading: !this.data.account,
      errorMessage: "",
    });
    try {
      const user = await getPreloadedCurrentUser(refresh);
      if (user) this.applyUser(user);
    } catch (error) {
      this.setData({
        errorMessage: getErrorMessage(error, "个人资料加载失败。"),
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  retryLoadUser() {
    haptic("light");
    void this.loadUser(true);
  },
  openPetSetup() {
    haptic("light");
    wx.navigateTo({ url: "/pages/pet-setup/index?source=profile" });
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
