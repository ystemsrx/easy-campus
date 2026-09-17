import { loadPreferences, subscribePreferences } from "../store/preferences";
import { getSession } from "../store/session";
import type { AppPreferences } from "../types/app";
import { resolveAppearance } from "../utils/appearance";
import { haptic } from "../utils/haptics";
import {
  loadNavigation,
  navigationItem,
  subscribeNavigation,
} from "../store/navigation";
import { openNavigation } from "../utils/tab-navigation";
import {
  GLASS_DRAG_DATA,
  startGlassDrag,
  moveGlassDrag,
  endGlassDrag,
  cancelGlassDrag,
  consumeGlassTap,
} from "../utils/glass-drag";

const INITIAL_TAB_APPEARANCE = resolveAppearance(loadPreferences());
const INITIAL_TAB_HIDDEN = !Boolean(getSession()?.token);
const subscriptions = new WeakMap<object, () => void>();
const navigationSubscriptions = new WeakMap<object, () => void>();
const dismissTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const pendingSelections = new WeakMap<
  object,
  { previous: number; target: number }
>();

Component({
  properties: {
    embedded: { type: Boolean, value: false },
    autoDismiss: { type: Boolean, value: false },
    current: { type: String, value: "" },
  },
  data: {
    ...GLASS_DRAG_DATA,
    selected: 0,
    hidden: INITIAL_TAB_HIDDEN,
    dismissed: false,
    themeClass: INITIAL_TAB_APPEARANCE.themeClass,
    visualThemeClass: INITIAL_TAB_APPEARANCE.visualThemeClass,
    motionClass: INITIAL_TAB_APPEARANCE.motionClass,
    liquidGlass: INITIAL_TAB_APPEARANCE.liquidGlass,
    liquidGlassClass: INITIAL_TAB_APPEARANCE.liquidGlassClass,
    source: "home",
    items: loadNavigation().items.map(navigationItem),
  },
  lifetimes: {
    detached() {
      this.clearDismissTimer();
      subscriptions.get(this)?.();
      subscriptions.delete(this);
      navigationSubscriptions.get(this)?.();
      navigationSubscriptions.delete(this);
      cancelGlassDrag(this);
      pendingSelections.delete(this);
    },
    attached() {
      this.setData({
        hidden: !Boolean(getSession()?.token),
      });
      this.syncAppearance();
      this.syncNavigation();
      this.scheduleDismiss();
      navigationSubscriptions.set(
        this,
        subscribeNavigation(() => this.syncNavigation()),
      );
      // Tab bars survive navigation to settings and must update independently.
      subscriptions.set(
        this,
        subscribePreferences((preferences) => {
          this.syncAppearance(preferences);
        }),
      );
    },
  },
  pageLifetimes: {
    show() {
      this.syncAppearance();
      this.syncNavigation();
      this.scheduleDismiss();
    },
    hide() {
      this.clearDismissTimer();
      if (this.data.autoDismiss) this.setData({ dismissed: true });
      cancelGlassDrag(this);
    },
  },
  methods: {
    clearDismissTimer() {
      const timer = dismissTimers.get(this);
      if (timer !== undefined) clearTimeout(timer);
      dismissTimers.delete(this);
    },
    scheduleDismiss() {
      if (!this.data.autoDismiss || this.data.dismissed) return;
      this.clearDismissTimer();
      if (this.data.motionClass === "motion-reduced") {
        this.setData({ dismissed: true });
        return;
      }
      // Present the inherited tab bar once, then slide it below the safe area.
      dismissTimers.set(
        this,
        setTimeout(() => {
          dismissTimers.delete(this);
          this.setData({ dismissed: true });
        }, 80),
      );
    },
    syncNavigation() {
      const items = loadNavigation().items.map(navigationItem);
      const pages = getCurrentPages();
      const route =
        this.data.current ||
        `/${pages[pages.length - 1]?.route || "pages/home/index"}`;
      const selected = items.findIndex((item) => item.pagePath === route);
      this.setData({
        items,
        selected,
        source: route.includes("/schedule/")
          ? "schedule"
          : route.includes("/profile/")
            ? "profile"
            : "home",
      });
    },
    syncAppearance(preferences: AppPreferences = loadPreferences()) {
      cancelGlassDrag(this);
      const appearance = resolveAppearance(preferences);
      this.setData({
        themeClass: appearance.themeClass,
        visualThemeClass: appearance.visualThemeClass,
        motionClass: appearance.motionClass,
        liquidGlass: appearance.liquidGlass,
        liquidGlassClass: appearance.liquidGlassClass,
      });
    },
    onSelectorTouchStart(event: WechatMiniprogram.TouchEvent) {
      startGlassDrag(this, event, {
        enabled: this.data.liquidGlass && !pendingSelections.has(this),
        index: this.data.selected,
        count: this.data.items.length,
        selector: ".tabbar-material",
        insetRpx: 10,
        widthRpx: this.data.items.length === 4 ? 680 : 528,
      });
    },
    onSelectorTouchMove(event: WechatMiniprogram.TouchEvent) {
      moveGlassDrag(this, event);
    },
    onSelectorTouchEnd(event: WechatMiniprogram.TouchEvent) {
      const index = endGlassDrag(this, event);
      if (index !== undefined) this.selectIndex(index);
    },
    onSelectorTouchCancel() {
      cancelGlassDrag(this);
    },
    setSelected(index: number) {
      this.syncAppearance();
      // The visible page is authoritative, including platform back/switch events.
      pendingSelections.delete(this);
      this.setData({
        selected: index,
      });
    },
    onSelect(event: WechatMiniprogram.TouchEvent) {
      if (consumeGlassTap(this)) return;
      const index = Number(event.currentTarget.dataset.index);
      this.selectIndex(index);
    },
    selectIndex(index: number) {
      const item = this.data.items[index];
      if (
        !item ||
        this.data.dismissed ||
        index === this.data.selected ||
        pendingSelections.has(this)
      ) {
        return;
      }

      haptic("light");
      const intent = { previous: this.data.selected, target: index };
      pendingSelections.set(this, intent);
      this.setData({ selected: index });
      const fail = () => {
        if (pendingSelections.get(this) !== intent) return;
        pendingSelections.delete(this);
        this.setData({ selected: intent.previous });
        wx.showToast({ title: "暂时无法打开，请重试", icon: "none" });
      };
      try {
        openNavigation(
          item.id,
          () => {
            if (pendingSelections.get(this) === intent)
              pendingSelections.delete(this);
          },
          fail,
        );
      } catch {
        fail();
      }
    },
  },
});
