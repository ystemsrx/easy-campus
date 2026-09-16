export type ThemePreference = "system" | "light" | "dark";
export type VisualTheme = "default" | "soft" | "minimal";

export interface AppPreferences {
  theme: ThemePreference;
  visualTheme: VisualTheme;
  showGradesOnHome: boolean;
  showGradesBelow60: boolean;
  useArithmeticAverage: boolean;
  reducedMotion: boolean;
  haptics: boolean;
  liquidGlass: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "light",
  visualTheme: "default",
  showGradesOnHome: true,
  showGradesBelow60: true,
  useArithmeticAverage: false,
  reducedMotion: false,
  haptics: false,
  liquidGlass: false,
};
