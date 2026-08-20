import {
  PET_SHAPE_IDS,
  type PetShapeId,
} from "../../components/geometric-pet/engine-data";
import {
  loadPetPreferences,
  PET_COLORS,
  savePetSelection,
  skipPetSetup,
} from "../../store/pet";
import { uploadLocalCompanionPreferences } from "../../services/companion";
import { getSession } from "../../store/session";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

type SetupSource = "login" | "home" | "profile";

interface ShapeOption {
  id: PetShapeId;
  accessibleLabel: string;
}

interface SelectionPatch {
  shape?: PetShapeId;
  color?: string;
  enabled?: boolean;
  enhanced?: boolean;
}

function setupSource(value: string | undefined): SetupSource {
  if (value === "home" || value === "profile") return value;
  return "login";
}

const SHAPE_OPTIONS: readonly ShapeOption[] = PET_SHAPE_IDS.map(
  (id, index) => ({
    id,
    accessibleLabel: `形状 ${index + 1}`,
  }),
);

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    reducedMotion: false,
    source: "login" as SetupSource,
    canSkip: true,
    drawerOpen: false,
    petSelected: false,
    petEnabled: false,
    draftEnabled: true,
    draftEnhanced: false,
    selectedShape: "blob" as PetShapeId,
    selectedColor: "#111214",
    shapeOptions: SHAPE_OPTIONS,
    colorOptions: PET_COLORS,
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!ensureAuthenticated()) return;
    const source = setupSource(options.source);
    const account = getSession()?.user.account || "";
    const preferences = loadPetPreferences(account);
    const appearance = resolveAppearance();
    this.setData({
      ...appearance,
      reducedMotion: appearance.motionClass === "motion-reduced",
      source,
      canSkip: source !== "profile" && !preferences.completed,
      petSelected: preferences.selected,
      petEnabled: preferences.enabled,
      draftEnabled: preferences.selected ? preferences.enabled : true,
      draftEnhanced: preferences.enhanced,
      selectedShape: preferences.shape,
      selectedColor: preferences.color,
    });
  },
  onShow() {
    const appearance = resolveAppearance();
    this.setData({
      ...appearance,
      reducedMotion: appearance.motionClass === "motion-reduced",
    });
  },
  openDrawer() {
    haptic("light");
    this.setData({ drawerOpen: true });
  },
  closeDrawer() {
    haptic("light");
    this.setData({ drawerOpen: false });
  },
  selectShape(event: WechatMiniprogram.TouchEvent) {
    const shape = String(event.currentTarget.dataset.shape) as PetShapeId;
    if (!(PET_SHAPE_IDS as readonly string[]).includes(shape)) return;
    haptic("light");
    this.persistSelection({ shape });
  },
  selectColor(event: WechatMiniprogram.TouchEvent) {
    const color = String(event.currentTarget.dataset.color || "");
    if (!PET_COLORS.some((option) => option.value === color)) return;
    haptic("light");
    this.persistSelection({ color });
  },
  onPetEnabledChange(event: WechatMiniprogram.SwitchChange) {
    haptic("light");
    this.persistSelection({ enabled: event.detail.value });
  },
  onPetEnhancedChange(event: WechatMiniprogram.SwitchChange) {
    haptic("light");
    this.persistSelection({ enhanced: event.detail.value });
  },
  persistSelection(patch: SelectionPatch) {
    const account = getSession()?.user.account || "";
    if (!account) return;
    const shape = patch.shape ?? this.data.selectedShape;
    const color = patch.color ?? this.data.selectedColor;
    const enabled = patch.enabled ?? this.data.draftEnabled;
    const enhanced = patch.enhanced ?? this.data.draftEnhanced;
    const preferences = savePetSelection(account, {
      shape,
      color,
      enabled,
      enhanced,
    });
    uploadLocalCompanionPreferences(account);
    this.setData({
      selectedShape: preferences.shape,
      selectedColor: preferences.color,
      draftEnabled: preferences.enabled,
      draftEnhanced: preferences.enhanced,
      petSelected: preferences.selected,
      petEnabled: preferences.enabled,
      canSkip: false,
    });
  },
  skipSetup() {
    if (this.data.source === "profile") return;
    const account = getSession()?.user.account || "";
    if (!account) return;
    skipPetSetup(account);
    uploadLocalCompanionPreferences(account);
    haptic("light");
    this.finishSetup();
  },
  finishSetup() {
    if (this.data.source === "profile" || this.data.source === "home") {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/home/index" }),
      });
      return;
    }
    wx.switchTab({ url: "/pages/home/index" });
  },
  noop() {},
});
