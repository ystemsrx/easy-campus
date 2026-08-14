Component({
  properties: {
    glyph: { type: String, value: "·" },
    icon: { type: String, value: "" },
    iconTone: { type: String, value: "coral" },
    title: { type: String, value: "暂无内容" },
    description: { type: String, value: "稍后再来看看" },
    actionText: { type: String, value: "" },
    compact: { type: Boolean, value: false },
  },
  methods: {
    onAction() {
      this.triggerEvent("action");
    },
  },
});
