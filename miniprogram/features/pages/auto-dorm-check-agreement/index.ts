import { buildAppShare } from "../../../utils/app-share";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { ensureAuthenticated } from "../../../utils/navigation";

Page({
  onShareAppMessage: buildAppShare,
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
});
