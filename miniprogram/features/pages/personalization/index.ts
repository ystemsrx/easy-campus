import { loadPreferences, updatePreferences } from "../../../store/preferences";
import type { ThemePreference, VisualTheme } from "../../../types/app";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";

const APPEARANCE_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
}> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

const VISUAL_THEME_OPTIONS: ReadonlyArray<{
  value: VisualTheme;
  label: string;
}> = [
  { value: "default", label: "默认" },
  { value: "soft", label: "淡色" },
  { value: "minimal", label: "极简" },
];

function isThemePreference(value: string): value is ThemePreference {
  return APPEARANCE_OPTIONS.some((option) => option.value === value);
}

function isVisualTheme(value: string): value is VisualTheme {
  return VISUAL_THEME_OPTIONS.some((option) => option.value === value);
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default" as VisualTheme,
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    themePreference: "light" as ThemePreference,
    reducedMotion: false,
    haptics: false,
    appearanceOptions: APPEARANCE_OPTIONS,
    visualThemeOptions: VISUAL_THEME_OPTIONS,
  },
  onLoad() {
    this.applyPreferences();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyPreferences();
  },
  applyPreferences() {
    const preferences = loadPreferences();
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData({
      ...appearance,
      themePreference: preferences.theme,
      visualTheme: preferences.visualTheme,
      reducedMotion: preferences.reducedMotion,
      haptics: preferences.haptics,
    });
  },
  selectTheme(event: WechatMiniprogram.TouchEvent) {
    const theme = String(event.currentTarget.dataset.value || "");
    if (!isThemePreference(theme)) return;
    updatePreferences({ theme });
    haptic("medium");
    this.applyPreferences();
  },
  selectVisualTheme(event: WechatMiniprogram.TouchEvent) {
    const visualTheme = String(event.currentTarget.dataset.value || "");
    if (!isVisualTheme(visualTheme)) return;
    updatePreferences({ visualTheme });
    haptic("medium");
    this.applyPreferences();
  },
  onReducedMotionChange(event: WechatMiniprogram.SwitchChange) {
    updatePreferences({ reducedMotion: event.detail.value });
    haptic("light");
    this.applyPreferences();
  },
  onHapticsChange(event: WechatMiniprogram.SwitchChange) {
    if (event.detail.value) {
      updatePreferences({ haptics: true });
      haptic("medium");
    } else {
      haptic("light");
      updatePreferences({ haptics: false });
    }
    this.applyPreferences();
  },
});
