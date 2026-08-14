import { resolveAppearance } from "../utils/appearance";
import { haptic } from "../utils/haptics";

interface TabItem {
  pagePath: string;
  text: string;
  icon: "home" | "calendar-days" | "user-round";
}

Component({
  data: {
    selected: 0,
    themeClass: "theme-light",
    motionClass: "motion-normal",
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
    attached() {
      const appearance = resolveAppearance();
      this.setData({
        themeClass: appearance.themeClass,
        motionClass: appearance.motionClass,
      });
    },
  },
  methods: {
    setSelected(index: number) {
      const appearance = resolveAppearance();
      this.setData({
        selected: index,
        themeClass: appearance.themeClass,
        motionClass: appearance.motionClass,
      });
    },
    onSelect(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item || index === this.data.selected) {
        return;
      }

      haptic("light");
      this.setData({ selected: index });
      wx.switchTab({ url: item.pagePath });
    },
  },
});
