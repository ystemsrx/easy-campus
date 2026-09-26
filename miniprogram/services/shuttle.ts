import { apiRequest } from "./request";
import type {
  CampusShuttleMap,
  LocationSample,
  SampleReceipt,
  ShuttleSnapshot,
  GeoPoint,
  ShuttleWalkingLeg,
} from "../types/shuttle";

const ROOT = "/utilities/shuttle-buses";
export const SHUTTLE_CONSENT_VERSION = "shuttle-location-v1";
const MAP_CACHE_KEY = "easy-swu:shuttle:map:v1";
let cachedMap: CampusShuttleMap | null = null;
try {
  const saved = wx.getStorageSync(MAP_CACHE_KEY) as
    CampusShuttleMap | undefined;
  if (
    saved?.crs === "gcj02" &&
    Array.isArray(saved.routes) &&
    Array.isArray(saved.paths) &&
    Array.isArray(saved.places)
  )
    cachedMap = saved;
} catch {
  /* A missing cache never blocks the network request. */
}
let cachedAt = 0;
let mapFlight: Promise<CampusShuttleMap> | null = null;
export function getShuttleMap(force = false): Promise<CampusShuttleMap> {
  if (!force && cachedMap && Date.now() - cachedAt < 60000)
    return Promise.resolve(cachedMap);
  if (mapFlight) return mapFlight;
  mapFlight = apiRequest<CampusShuttleMap>(`${ROOT}/map`, {
    retry: false,
    timeout: 12000,
  })
    .then((map) => {
      if (
        map.crs !== "gcj02" ||
        !Array.isArray(map.paths) ||
        !Array.isArray(map.places)
      )
        throw new Error("校园地图格式不正确");
      cachedMap = map;
      try {
        wx.setStorageSync(MAP_CACHE_KEY, map);
      } catch {
        /* Map caching is optional. */
      }
      cachedAt = Date.now();
      return map;
    })
    .finally(() => {
      mapFlight = null;
    });
  if (!force && cachedMap) {
    void mapFlight.catch(() => undefined);
    return Promise.resolve(cachedMap);
  }
  return mapFlight;
}
export function getShuttleConsent(): Promise<{
  accepted: boolean;
  version: string;
}> {
  return apiRequest(`${ROOT}/consent`, { retry: false, timeout: 10000 });
}
export function getShuttleWalking(
  stopId: string,
  destination: GeoPoint,
): Promise<{ revision: string; legs: ShuttleWalkingLeg[] }> {
  return apiRequest(`${ROOT}/walking`, {
    method: "POST",
    retry: false,
    timeout: 12000,
    data: {
      stopIds: [stopId],
      destination: {
        longitude: destination.longitude,
        latitude: destination.latitude,
      },
    },
  });
}
export function acceptShuttleConsent(): Promise<{
  accepted: boolean;
  version: string;
}> {
  return apiRequest(`${ROOT}/consent`, {
    method: "POST",
    data: { version: SHUTTLE_CONSENT_VERSION, accepted: true },
    retry: false,
  });
}
export function uploadShuttleLocations(
  points: LocationSample[],
): Promise<{ accepted: SampleReceipt[] }> {
  return apiRequest(`${ROOT}/locations`, {
    method: "POST",
    data: { points },
    retry: false,
    timeout: 12000,
  });
}
export function previewShuttles(
  point: LocationSample,
): Promise<ShuttleSnapshot> {
  return apiRequest(`${ROOT}/nearby`, {
    method: "POST",
    data: { point },
    retry: false,
    timeout: 8500,
  });
}
export function deleteShuttleHistory(): Promise<{ deleted: boolean }> {
  return apiRequest(`${ROOT}/locations`, { method: "DELETE", retry: false });
}
