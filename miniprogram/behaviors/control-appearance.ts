import { loadPreferences, subscribePreferences } from "../store/preferences";
import { resolveAppearance } from "../utils/appearance";
import type { AppPreferences } from "../types/app";

const subscriptions = new WeakMap<object, () => void>();

// Isolated components cannot inherit a page's WXSS. Keep their material in sync
// with the same preference, including mounted drawers and cached tab pages.
export const controlAppearance = Behavior({
  data: {
    liquidGlass: false,
    liquidGlassClass: "",
    glassThemeClass: "theme-light",
    glassMotionClass: "motion-normal",
  },
  lifetimes: {
    attached() {
      this.syncControlAppearance(loadPreferences());
      subscriptions.set(
        this,
        subscribePreferences((preferences) => {
          this.syncControlAppearance(preferences);
        }),
      );
    },
    detached() {
      subscriptions.get(this)?.();
      subscriptions.delete(this);
    },
  },
  pageLifetimes: {
    show() {
      this.syncControlAppearance(loadPreferences());
    },
  },
  methods: {
    syncControlAppearance(preferences: AppPreferences) {
      const appearance = resolveAppearance(preferences);
      this.setData({
        liquidGlass: appearance.liquidGlass,
        liquidGlassClass: appearance.liquidGlassClass,
        glassThemeClass: appearance.themeClass,
        glassMotionClass: appearance.motionClass,
      });
    },
  },
});
