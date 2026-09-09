import { loadPreferences, subscribePreferences } from "../store/preferences";
import { getSession } from "../store/session";
import type { AppPreferences } from "../types/app";
import { resolveAppearance } from "../utils/appearance";
import { haptic } from "../utils/haptics";
import {
  GLASS_DRAG_DATA,
  startGlassDrag,
  moveGlassDrag,
  endGlassDrag,
  cancelGlassDrag,
  consumeGlassTap,
} from "../utils/glass-drag";

interface TabItem {
  pagePath: string;
  text: string;
  icon: "home" | "calendar-days" | "user-round";
}

const INITIAL_TAB_APPEARANCE = resolveAppearance(loadPreferences());
const INITIAL_TAB_HIDDEN = !Boolean(getSession()?.token);
const subscriptions = new WeakMap<object, () => void>();
const pendingSelections = new WeakMap<
  object,
  { previous: number; target: number }
>();

Component({
  data: {
    ...GLASS_DRAG_DATA,
    selected: 0,
    hidden: INITIAL_TAB_HIDDEN,
    themeClass: INITIAL_TAB_APPEARANCE.themeClass,
    visualThemeClass: INITIAL_TAB_APPEARANCE.visualThemeClass,
    motionClass: INITIAL_TAB_APPEARANCE.motionClass,
    liquidGlass: INITIAL_TAB_APPEARANCE.liquidGlass,
    liquidGlassClass: INITIAL_TAB_APPEARANCE.liquidGlassClass,
    items: [
      { pagePath: "/pages/home/index", text: "概览", icon: "home" },
      {
        pagePath: "/pages/schedule/index",
        text: "日程",
        icon: "calendar-days",
      },
      { pagePath: "/pages/profile/index", text: "我的", icon: "user-round" },
    ] as TabItem[],
  },
  lifetimes: {
    detached() {
      subscriptions.get(this)?.();
      subscriptions.delete(this);
      cancelGlassDrag(this);
      pendingSelections.delete(this);
    },
    attached() {
      this.setData({
        hidden: !Boolean(getSession()?.token),
      });
      this.syncAppearance();
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
    },
    hide() {
      cancelGlassDrag(this);
    },
  },
  methods: {
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
        count: 3,
        selector: ".tabbar-material",
        insetRpx: 10,
        widthRpx: 528,
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
        wx.switchTab({
          url: item.pagePath,
          success: () => {
            if (pendingSelections.get(this) === intent)
              pendingSelections.delete(this);
          },
          fail,
        });
      } catch {
        fail();
      }
    },
  },
});
