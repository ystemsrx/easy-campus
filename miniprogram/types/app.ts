export type ThemePreference = "system" | "light" | "dark";

export interface AppPreferences {
  theme: ThemePreference;
  reducedMotion: boolean;
  haptics: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  reducedMotion: false,
  haptics: true,
};
