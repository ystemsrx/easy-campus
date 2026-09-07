import { clearFeedback, showFeedback } from "../../utils/transient-feedback";

Component({
  properties: {
    reducedMotion: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
    visualTheme: { type: String, value: "default" },
  },
  data: { mounted: false, visible: false, message: "访问速度太快了" },
  lifetimes: {
    detached() {
      clearFeedback(this);
    },
  },
  pageLifetimes: {
    hide() {
      clearFeedback(this);
      this.setData({ mounted: false, visible: false });
    },
  },
  methods: {
    show(message = "访问速度太快了") {
      showFeedback(this, message.trim() || "访问速度太快了");
    },
  },
});
