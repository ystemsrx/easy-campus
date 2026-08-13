export function haptic(type: "light" | "medium" | "heavy" = "light"): void {
  const preferences = getApp<IAppOption>().globalData.preferences;
  if (!preferences.haptics) {
    return;
  }

  try {
    wx.vibrateShort({ type });
  } catch {
    // 部分桌面环境不支持触感反馈，视觉反馈仍然保留。
  }
}
