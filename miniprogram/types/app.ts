export type ThemePreference = "system" | "light" | "dark";

export interface AppPreferences {
  theme: ThemePreference;
  showGradesOnHome: boolean;
  showGradesBelow60: boolean;
  reducedMotion: boolean;
  haptics: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "light",
  showGradesOnHome: true,
  showGradesBelow60: true,
  reducedMotion: false,
  haptics: false,
};
