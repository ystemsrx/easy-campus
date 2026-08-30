export type ThemePreference = "system" | "light" | "dark";
export type VisualTheme = "default" | "soft" | "minimal";

export interface AppPreferences {
  theme: ThemePreference;
  visualTheme: VisualTheme;
  showGradesOnHome: boolean;
  showGradesBelow60: boolean;
  reducedMotion: boolean;
  haptics: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "light",
  visualTheme: "default",
  showGradesOnHome: true,
  showGradesBelow60: true,
  reducedMotion: false,
  haptics: false,
};
