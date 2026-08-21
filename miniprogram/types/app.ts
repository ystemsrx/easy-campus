export type ThemePreference = "system" | "light" | "dark";

export interface AppPreferences {
  theme: ThemePreference;
  showGradesOnHome: boolean;
  reducedMotion: boolean;
  haptics: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  showGradesOnHome: true,
  reducedMotion: false,
  haptics: false,
};
