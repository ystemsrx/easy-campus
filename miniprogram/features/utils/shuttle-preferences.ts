import type { GeoPoint } from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import type { ShuttleJourney } from "./shuttle-itinerary";
interface Preference {
  origin: GeoPoint;
  destination: GeoPoint;
  mode: string;
  routes: string[][];
}
const key = (user: string): string =>
  `easy-swu:shuttle:preferred-plans:v1:${user}`;
function read(user: string): Preference[] {
  try {
    const raw: unknown = wx.getStorageSync(key(user));
    return Array.isArray(raw)
      ? raw
          .filter(
            (p): p is Preference =>
              p &&
              [p.origin, p.destination].every(
                (x) =>
                  x &&
                  Number.isFinite(x.longitude) &&
                  Number.isFinite(x.latitude),
              ) &&
              ["walk", "ride"].includes(p.mode) &&
              Array.isArray(p.routes) &&
              p.routes.every(
                (r: unknown) =>
                  Array.isArray(r) && r.every((id) => typeof id === "string"),
              ),
          )
          .slice(0, 24)
      : [];
  } catch {
    return [];
  }
}
function matches(
  p: Preference,
  journey: ShuttleJourney,
  origin: GeoPoint,
  destination: GeoPoint,
): boolean {
  return (
    distanceMeters(p.origin, origin) <= 180 &&
    distanceMeters(p.destination, destination) <= 100 &&
    p.mode === journey.mode &&
    p.routes.length === journey.legs.length &&
    p.routes.every((ids, i) =>
      journey.legs[i].routes.some((r) => ids.includes(r.id)),
    )
  );
}
export function preferredPlan(
  user: string,
  journey: ShuttleJourney,
  origin: GeoPoint,
  destination: GeoPoint,
): boolean {
  return read(user).some((p) => matches(p, journey, origin, destination));
}
export function togglePreferredPlan(
  user: string,
  journey: ShuttleJourney,
  origin: GeoPoint,
  destination: GeoPoint,
): boolean {
  const old = read(user),
    saved = !old.some((p) => matches(p, journey, origin, destination));
  const next = old.filter((p) => !matches(p, journey, origin, destination));
  if (saved)
    next.unshift({
      origin: { ...origin },
      destination: { ...destination },
      mode: journey.mode,
      routes: journey.legs.map((l) => l.routes.map((r) => r.id)),
    });
  wx.setStorageSync(key(user), next.slice(0, 24));
  return saved;
}
