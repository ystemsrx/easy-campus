import { planShuttleTrip } from "../../services/shuttle";
import { shuttleRequest as apiRequest } from "../../services/shuttle-request";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../store/session";
import { distanceMeters } from "../../utils/shuttle-geo";
import type { ShuttleJourney } from "../utils/shuttle-itinerary";
import type { GeoPoint } from "../../types/shuttle";
type Request = Parameters<typeof planShuttleTrip>[0];
interface Result {
  cached?: boolean;
  revision: string;
  planningId: string;
  plans: ShuttleJourney[];
}
interface Entry {
  request: Request;
  result: Result;
  expires: number;
}
type Walk = NonNullable<ShuttleJourney["walkLegs"]>[number];
export function forgetShuttlePlan(planningId: string): void {
  const key = `easy-swu:shuttle:plans:v1:${captureSessionLease()?.userId || "none"}`;
  try {
    const entries = wx.getStorageSync(key);
    if (Array.isArray(entries))
      wx.setStorageSync(
        key,
        entries.filter((e) => e.result?.planningId !== planningId),
      );
  } catch {
    /* Optional cache. */
  }
}
export async function cachedBoardingWalk(
  origin: GeoPoint,
  stop: GeoPoint & { id: string },
  revision: string,
  manual: boolean,
): Promise<Walk | undefined> {
  const lease = captureSessionLease(),
    key = `easy-swu:shuttle:walk:v1:${lease?.userId || "none"}`;
  let entries: {
    origin: GeoPoint;
    stop: string;
    revision: string;
    expires: number;
    leg?: Walk;
  }[] = [];
  try {
    const saved = wx.getStorageSync(key);
    if (Array.isArray(saved))
      entries = saved.filter(
        (e) => e.expires > Date.now() && e.revision === revision,
      );
  } catch {
    /* Optional cache. */
  }
  const hit = entries.find(
    (e) => e.stop === stop.id && distanceMeters(e.origin, origin) <= 10,
  );
  if (hit) return hit.leg;
  const result = await apiRequest<{ legs: (Walk & { available: boolean })[] }>(
    "/utilities/shuttle-buses/walking",
    {
      method: "POST",
      data: {
        stopIds: [stop.id],
        destination: origin,
        reverse: true,
        originMode: manual ? "manual" : "gps",
      },
      retry: false,
      timeout: 15000,
    },
  );
  const leg = result.legs?.[0]?.available ? result.legs[0] : undefined;
  if (isSessionLeaseCurrent(lease)) {
    entries.push({
      origin: { ...origin },
      stop: stop.id,
      revision,
      expires: Date.now() + (leg ? 900000 : 60000),
      leg,
    });
    try {
      wx.setStorageSync(key, entries.slice(-12));
    } catch {
      /* The fallback remains usable. */
    }
  }
  return leg;
}
export async function refreshShuttleEstimates(
  planningId: string,
): Promise<{ revision: string; plans: Partial<ShuttleJourney>[] }> {
  return apiRequest("/utilities/shuttle-buses/estimates", {
    method: "POST",
    data: { planningId },
    retry: false,
    timeout: 12000,
  });
}
/** Original anchors never move on a hit: repeated small GPS steps cannot drift across campus. */
export async function cachedShuttlePlan(
  request: Request,
  revision: string,
): Promise<Result> {
  const lease = captureSessionLease(),
    key = `easy-swu:shuttle:plans:v1:${lease?.userId || "none"}`;
  let entries: Entry[] = [];
  try {
    const saved = wx.getStorageSync(key);
    if (Array.isArray(saved))
      entries = saved.filter(
        (e: Entry) => e.expires > Date.now() && e.result?.revision === revision,
      );
  } catch {
    /* Optional geometry cache. */
  }
  const match = entries.find(
    (e) =>
      e.request.originMode === request.originMode &&
      distanceMeters(e.request.origin, request.origin) <= 10 &&
      distanceMeters(e.request.destination, request.destination) < 1 &&
      JSON.stringify(e.request.boardingIds) ===
        JSON.stringify(request.boardingIds) &&
      JSON.stringify(e.request.destinationStopIds) ===
        JSON.stringify(request.destinationStopIds),
  );
  if (match) return { ...match.result, cached: true };
  const result = await planShuttleTrip<ShuttleJourney>(request);
  if (isSessionLeaseCurrent(lease)) {
    const ttl = result.plans.some((p) =>
      p.walkLegs?.some((w) => w.source === "straight"),
    )
      ? 60000
      : 15 * 60000;
    entries = entries.filter((e) => e !== match);
    entries.push({
      request: JSON.parse(JSON.stringify(request)) as Request,
      result,
      expires: Date.now() + ttl,
    });
    try {
      wx.setStorageSync(key, entries.slice(-6));
    } catch {
      /* The current route stays usable when storage is full. */
    }
  }
  return result;
}
