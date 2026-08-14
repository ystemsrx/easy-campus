Component({
  options: {
    virtualHost: true,
  },
  properties: {
    name: { type: String, value: "circle-help" },
    tone: { type: String, value: "ink" },
    size: { type: Number, value: 32 },
    label: { type: String, value: "" },
  },
});
