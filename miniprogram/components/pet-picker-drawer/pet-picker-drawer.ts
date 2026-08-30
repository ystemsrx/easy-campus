import { PET_SHAPE_IDS, type PetShapeId } from "../geometric-pet/engine-data";
import { PET_COLORS } from "../../store/pet";

const SHAPE_OPTIONS = PET_SHAPE_IDS.map((id, index) => ({
  id,
  accessibleLabel: `形状 ${index + 1}`,
}));

Component({
  properties: {
    open: { type: Boolean, value: false },
    themeClass: { type: String, value: "theme-light" },
    visualThemeClass: { type: String, value: "theme-style-default" },
    motionClass: { type: String, value: "motion-normal" },
    selected: { type: Boolean, value: false },
    selectedShape: { type: String, value: "blob" },
    selectedColor: { type: String, value: "#111214" },
    enhanced: { type: Boolean, value: false },
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    shapeOptions: SHAPE_OPTIONS,
    colorOptions: PET_COLORS,
  },
  methods: {
    selectShape(event: WechatMiniprogram.TouchEvent) {
      const shape = String(event.currentTarget.dataset.shape) as PetShapeId;
      if (!(PET_SHAPE_IDS as readonly string[]).includes(shape)) return;
      this.triggerEvent("shapechange", { shape });
    },
    selectColor(event: WechatMiniprogram.TouchEvent) {
      const color = String(event.currentTarget.dataset.color || "");
      if (!PET_COLORS.some((option) => option.value === color)) return;
      this.triggerEvent("colorchange", { color });
    },
    finish() {
      this.triggerEvent("finish");
    },
    noop() {},
  },
});
