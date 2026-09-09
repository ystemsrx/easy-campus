import {
  DEFAULT_PREFERENCES,
  type AppPreferences,
  type ThemePreference,
  type VisualTheme,
} from "../types/app";

const PREFERENCES_KEY = "easy-swu:preferences";
let preferencesRevision = 0;
const listeners = new Set<(preferences: AppPreferences) => void>();

export function subscribePreferences(
  listener: (preferences: AppPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPreferencesRevision(): number {
  return preferencesRevision;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isVisualTheme(value: unknown): value is VisualTheme {
  return value === "default" || value === "soft" || value === "minimal";
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
    visualTheme: isVisualTheme(stored.visualTheme)
      ? stored.visualTheme
      : DEFAULT_PREFERENCES.visualTheme,
    showGradesOnHome:
      typeof stored.showGradesOnHome === "boolean"
        ? stored.showGradesOnHome
        : DEFAULT_PREFERENCES.showGradesOnHome,
    showGradesBelow60:
      typeof stored.showGradesBelow60 === "boolean"
        ? stored.showGradesBelow60
        : DEFAULT_PREFERENCES.showGradesBelow60,
    reducedMotion:
      typeof stored.reducedMotion === "boolean"
        ? stored.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
    haptics:
      typeof stored.haptics === "boolean"
        ? stored.haptics
        : DEFAULT_PREFERENCES.haptics,
    liquidGlass:
      typeof stored.liquidGlass === "boolean"
        ? stored.liquidGlass
        : DEFAULT_PREFERENCES.liquidGlass,
  };
}

export function savePreferences(preferences: AppPreferences): void {
  wx.setStorageSync(PREFERENCES_KEY, preferences);
  getApp<IAppOption>().globalData.preferences = preferences;
  preferencesRevision += 1;
  listeners.forEach((listener) => listener(preferences));
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
