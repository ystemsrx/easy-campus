import { loadPreferences, updatePreferences } from "../../../store/preferences";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    showGradesOnHome: true,
    showGradesBelow60: true,
  },
  onLoad() {
    this.applyPreferences();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyPreferences();
  },
  applyPreferences() {
    const preferences = loadPreferences();
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance.theme);
    this.setData({
      ...appearance,
      showGradesOnHome: preferences.showGradesOnHome,
      showGradesBelow60: preferences.showGradesBelow60,
    });
  },
  onShowGradesOnHomeChange(event: WechatMiniprogram.SwitchChange) {
    updatePreferences({ showGradesOnHome: event.detail.value });
    haptic("light");
    this.applyPreferences();
  },
  onShowGradesBelow60Change(event: WechatMiniprogram.SwitchChange) {
    updatePreferences({ showGradesBelow60: event.detail.value });
    haptic("light");
    this.applyPreferences();
  },
});
