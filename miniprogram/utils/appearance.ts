import type { AppPreferences, VisualTheme } from "../types/app";

export interface PageAppearance {
  theme: "light" | "dark";
  themeClass: "theme-light" | "theme-dark";
  visualTheme: VisualTheme;
  visualThemeClass: `theme-style-${VisualTheme}`;
  motionClass: "motion-normal" | "motion-reduced";
}

const WINDOW_BACKGROUNDS: Record<
  VisualTheme,
  Record<PageAppearance["theme"], string>
> = {
  default: { light: "#f7f5ef", dark: "#171613" },
  soft: { light: "#f7fcf8", dark: "#16201b" },
  minimal: { light: "#ffffff", dark: "#000000" },
};

function getSystemTheme(): "light" | "dark" {
  try {
    return wx.getAppBaseInfo().theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveAppearance(
  preferences?: AppPreferences,
): PageAppearance {
  const current = preferences || getApp<IAppOption>().globalData.preferences;
  const theme = current.theme === "system" ? getSystemTheme() : current.theme;

  return {
    theme,
    themeClass: theme === "dark" ? "theme-dark" : "theme-light",
    visualTheme: current.visualTheme,
    visualThemeClass: `theme-style-${current.visualTheme}`,
    motionClass: current.reducedMotion ? "motion-reduced" : "motion-normal",
  };
}

export function syncWindowBackground(appearance: PageAppearance): void {
  const backgroundColor =
    WINDOW_BACKGROUNDS[appearance.visualTheme][appearance.theme];
  try {
    wx.setBackgroundColor({
      backgroundColor,
      backgroundColorTop: backgroundColor,
      backgroundColorBottom: backgroundColor,
      fail: () => undefined,
    });
  } catch {
    // 页面根节点仍会提供相同背景色。
  }
}
