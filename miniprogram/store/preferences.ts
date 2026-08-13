import {
  DEFAULT_PREFERENCES,
  type AppPreferences,
  type ThemePreference,
} from "../types/app";

const PREFERENCES_KEY = "easy-swu:preferences";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function loadPreferences(): AppPreferences {
  const stored = wx.getStorageSync(PREFERENCES_KEY) as
    Partial<AppPreferences> | undefined;
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    theme: isThemePreference(stored.theme)
      ? stored.theme
      : DEFAULT_PREFERENCES.theme,
    reducedMotion:
      typeof stored.reducedMotion === "boolean"
        ? stored.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
    haptics:
      typeof stored.haptics === "boolean"
        ? stored.haptics
        : DEFAULT_PREFERENCES.haptics,
  };
}

export function savePreferences(preferences: AppPreferences): void {
  wx.setStorageSync(PREFERENCES_KEY, preferences);
  getApp<IAppOption>().globalData.preferences = preferences;
}

export function updatePreferences(
  patch: Partial<AppPreferences>,
): AppPreferences {
  const next = {
    ...getApp<IAppOption>().globalData.preferences,
    ...patch,
  };
  savePreferences(next);
  return next;
}
