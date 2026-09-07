import { cancelPresence, setPresence } from "../../utils/motion";

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(visible: boolean) {
        this.syncVisibility(visible);
      },
    },
    title: { type: String, value: "" },
    theme: { type: String, value: "light" },
    expanded: { type: Boolean, value: false },
    expandedHeight: { type: Number, value: 86 },
    compactHeader: { type: Boolean, value: false },
    scrollable: { type: Boolean, value: false },
    safeArea: { type: Boolean, value: true },
    closeOnMask: { type: Boolean, value: true },
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    mounted: false,
    active: false,
  },
  lifetimes: {
    detached() {
      cancelPresence(this);
    },
  },
  pageLifetimes: {
    hide() {
      cancelPresence(this);
      this.setData({ mounted: false, active: false });
    },
    show() {
      this.syncVisibility(this.data.visible);
    },
  },
  methods: {
    syncVisibility(visible: boolean) {
      setPresence(this, visible, { reducedMotion: this.data.reducedMotion });
    },
    onMaskTap() {
      if (this.data.closeOnMask) {
        this.triggerEvent("close");
      }
    },
    onClose() {
      this.triggerEvent("close");
    },
    noop() {},
  },
});
