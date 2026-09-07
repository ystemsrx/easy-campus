import { clearFeedback, showFeedback } from "../../utils/transient-feedback";

Component({
  properties: {
    reducedMotion: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
    visualTheme: { type: String, value: "default" },
  },
  data: { mounted: false, visible: false, message: "已刷新" },
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
    show(message = "已刷新") {
      showFeedback(this, message.trim() || "已刷新");
    },
  },
});
