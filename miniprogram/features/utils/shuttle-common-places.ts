import type { CampusShuttleMap, NamedPoint } from "../../types/shuttle";
import { groupPoint, placeGroups } from "./shuttle-place-groups";
import { placeShortName } from "./shuttle-place-names";
import { distanceMeters } from "../../utils/shuttle-geo";

export interface CommonPlace extends NamedPoint {
  key: string;
  shortName: string;
  placeId?: string;
}
const prefix = "easy-swu:shuttle:common-places:";
const canonicalMaps = new WeakMap<CampusShuttleMap, Map<string, CommonPlace>>();
export function canonicalCommonPlace(
  map: CampusShuttleMap,
  saved: CommonPlace,
): CommonPlace {
  let places = canonicalMaps.get(map);
  if (!places) {
    places = new Map();
    for (const group of placeGroups(map)) {
      const value = commonPlace(groupPoint(group), group.id);
      for (const member of group.members) places.set(member.id, value);
    }
    canonicalMaps.set(map, places);
  }
  const existing = places.get(saved.placeId || "");
  if (existing) return existing;
  // Restored directional stops can replace an old group ID. Preserve the user's saved place.
  const restored = placeGroups(map).find(
    (group) =>
      (group.name === saved.name || group.shortName === saved.shortName) &&
      distanceMeters(groupPoint(group), saved) <= 250,
  );
  return restored ? commonPlace(groupPoint(restored), restored.id) : saved;
}
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
