import type { AppPreferences } from "../types/app";

export interface PageAppearance {
  theme: "light" | "dark";
  themeClass: "theme-light" | "theme-dark";
  motionClass: "motion-normal" | "motion-reduced";
}

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
    motionClass: current.reducedMotion ? "motion-reduced" : "motion-normal",
  };
}

export function syncWindowBackground(theme: PageAppearance["theme"]): void {
  const backgroundColor = theme === "dark" ? "#171613" : "#f7f5ef";
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
