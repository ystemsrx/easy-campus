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
    closeOnMask: { type: Boolean, value: true },
  },
  data: {
    mounted: false,
    active: false,
  },
  methods: {
    syncVisibility(visible: boolean) {
      if (visible) {
        this.setData({ mounted: true });
        wx.nextTick(() => this.setData({ active: true }));
        return;
      }

      this.setData({ active: false });
      setTimeout(() => {
        if (!this.data.visible) {
          this.setData({ mounted: false });
        }
      }, 380);
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
