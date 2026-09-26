import type { NamedPoint } from "../../types/shuttle";
import { placeShortName } from "./shuttle-place-names";

export interface CommonPlace extends NamedPoint {
  key: string;
  shortName: string;
  placeId?: string;
}
const prefix = "easy-swu:shuttle:common-places:";
export function commonPlace(point: NamedPoint, placeId?: string): CommonPlace {
  return {
    longitude: point.longitude,
    latitude: point.latitude,
    name: point.name.slice(0, 60),
    shortName: placeShortName(point),
    key: placeId
      ? `place:${placeId}`
      : `point:${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`,
    ...(placeId ? { placeId } : {}),
  };
}
export function loadCommonPlaces(userId: string): CommonPlace[] {
  try {
    const stored: unknown = wx.getStorageSync(prefix + userId);
    if (!Array.isArray(stored)) return [];
    const valid = stored.filter(
      (p): p is CommonPlace =>
        p &&
        typeof p.key === "string" &&
        typeof p.name === "string" &&
        p.name.trim() &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.latitude) &&
        Math.abs(p.latitude) <= 90,
    );
    return [
      ...new Map(
        valid.map((p) => {
          const value = commonPlace(
            p,
            typeof p.placeId === "string" ? p.placeId : undefined,
          );
          return [value.key, value] as const;
        }),
      ).values(),
    ].slice(0, 8);
  } catch {
    return [];
  }
}
export function saveCommonPlaces(userId: string, places: CommonPlace[]): void {
  wx.setStorageSync(prefix + userId, places);
}
