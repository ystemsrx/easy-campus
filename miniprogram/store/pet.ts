import {
  PET_SHAPE_IDS,
  type PetShapeId,
} from "../components/geometric-pet/engine-data";
import type { CompanionPreferencesData } from "../types/api";

export interface PetColorOption {
  id: string;
  label: string;
  value: string;
}

export interface PetPreferences {
  completed: boolean;
  selected: boolean;
  skipped: boolean;
  enabled: boolean;
  enhanced: boolean;
  shape: PetShapeId;
  color: string;
  updatedAt: number;
}

export const PET_COLORS: readonly PetColorOption[] = [
  { id: "black", label: "黑色", value: "#111214" },
  { id: "red", label: "红色", value: "#ff3e51" },
  { id: "orange", label: "橙色", value: "#ff781c" },
  { id: "yellow", label: "黄色", value: "#f2a71b" },
  { id: "green", label: "绿色", value: "#00b96b" },
  { id: "cyan", label: "青色", value: "#12b5a2" },
  { id: "blue", label: "蓝色", value: "#2a92fe" },
  { id: "violet", label: "紫色", value: "#9159fe" },
  { id: "magenta", label: "粉色", value: "#f0449d" },
];

export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  completed: false,
  selected: false,
  skipped: false,
  enabled: false,
  enhanced: false,
  shape: "blob",
  color: "#111214",
  updatedAt: 0,
};

const PET_PREFERENCES_KEY_PREFIX = "easy-swu:pet:v1:";

function petStorageKey(account: string): string {
  const normalized = account.trim().toLowerCase() || "guest";
  return `${PET_PREFERENCES_KEY_PREFIX}${encodeURIComponent(normalized)}`;
}

function isPetShape(value: unknown): value is PetShapeId {
  return (
    typeof value === "string" &&
    (PET_SHAPE_IDS as readonly string[]).includes(value)
  );
}

function isPetColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PET_COLORS.some((option) => option.value === value.toLowerCase())
  );
}

export function loadPetPreferences(account: string): PetPreferences {
  const stored = wx.getStorageSync(petStorageKey(account)) as
    Partial<PetPreferences> | undefined;
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_PET_PREFERENCES };
  }

  const shape = isPetShape(stored.shape)
    ? stored.shape
    : DEFAULT_PET_PREFERENCES.shape;
  const color = isPetColor(stored.color)
    ? stored.color.toLowerCase()
    : DEFAULT_PET_PREFERENCES.color;
  // 旧版本没有 selected 字段，或会把“跳过”保存成未选择。
  // 统一迁移为已选择当前（通常为默认）样式，但保持关闭显示。
  const migratedSelection =
    stored.selected === undefined &&
    stored.completed === true &&
    (shape !== DEFAULT_PET_PREFERENCES.shape ||
      color !== DEFAULT_PET_PREFERENCES.color);
  const hiddenDefaultSelection =
    !migratedSelection &&
    stored.selected !== true &&
    (stored.skipped === true || stored.completed === true);
  const selected =
    stored.selected === true || migratedSelection || hiddenDefaultSelection;
  return {
    completed: selected,
    selected,
    skipped: false,
    enabled:
      selected && !hiddenDefaultSelection && stored.enabled !== false,
    enhanced: stored.enhanced === true,
    shape,
    color,
    updatedAt:
      typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt)
        ? stored.updatedAt
        : 0,
  };
}

export function savePetSelection(
  account: string,
  selection: Pick<PetPreferences, "shape" | "color"> &
    Partial<Pick<PetPreferences, "enabled" | "enhanced">>,
): PetPreferences {
  const current = loadPetPreferences(account);
  const next: PetPreferences = {
    completed: true,
    selected: true,
    skipped: false,
    enabled:
      typeof selection.enabled === "boolean"
        ? selection.enabled
        : current.selected
          ? current.enabled
          : true,
    enhanced:
      typeof selection.enhanced === "boolean"
        ? selection.enhanced
        : current.enhanced,
    shape: isPetShape(selection.shape)
      ? selection.shape
      : DEFAULT_PET_PREFERENCES.shape,
    color: isPetColor(selection.color)
      ? selection.color.toLowerCase()
      : DEFAULT_PET_PREFERENCES.color,
    updatedAt: Date.now(),
  };
  wx.setStorageSync(petStorageKey(account), next);
  return next;
}

export function skipPetSetup(account: string): PetPreferences {
  const current = loadPetPreferences(account);
  const next: PetPreferences = {
    ...current,
    completed: true,
    selected: true,
    skipped: false,
    enabled: false,
    updatedAt: Date.now(),
  };
  wx.setStorageSync(petStorageKey(account), next);
  return next;
}

export function setPetEnabled(
  account: string,
  enabled: boolean,
): PetPreferences {
  const current = loadPetPreferences(account);
  const next: PetPreferences = {
    ...current,
    enabled: current.selected && enabled,
    updatedAt: Date.now(),
  };
  wx.setStorageSync(petStorageKey(account), next);
  return next;
}

export function hasCompletedPetSetup(account: string): boolean {
  return loadPetPreferences(account).completed;
}

export function shouldShowPet(preferences: PetPreferences): boolean {
  return preferences.selected && preferences.enabled;
}

export function hasStoredPetPreferences(account: string): boolean {
  const stored = wx.getStorageSync(petStorageKey(account)) as unknown;
  return Boolean(stored && typeof stored === "object");
}

export function storeServerPetPreferences(
  account: string,
  preferences: CompanionPreferencesData,
): PetPreferences {
  const hiddenDefaultSelection =
    preferences.selected !== true && preferences.skipped === true;
  const selected = preferences.selected === true || hiddenDefaultSelection;
  const updatedAt = Date.parse(preferences.updatedAt || "");
  const next: PetPreferences = {
    completed: selected,
    selected,
    skipped: false,
    enabled:
      selected && !hiddenDefaultSelection && preferences.enabled === true,
    enhanced: preferences.enhanced === true,
    shape: isPetShape(preferences.shape)
      ? preferences.shape
      : DEFAULT_PET_PREFERENCES.shape,
    color: isPetColor(preferences.color)
      ? preferences.color.toLowerCase()
      : DEFAULT_PET_PREFERENCES.color,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
  wx.setStorageSync(petStorageKey(account), next);
  return next;
}
