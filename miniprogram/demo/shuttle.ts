import { packedDemoMap as packed } from "./shuttle-map";
import { distanceMeters } from "../utils/shuttle-geo";
import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttlePlace,
  ShuttleServiceTrack,
  ShuttleSnapshot,
} from "../types/shuttle";

let map: CampusShuttleMap | undefined;
export function demoShuttleMap(): CampusShuttleMap {
  if (map) return map;
  let x = 0,
    y = 0;
  const points = packed.points.split(";").map((s) => {
    const [dx, dy] = s.split(",").map((n) => parseInt(n, 36));
    x += dx;
    y += dy;
    return { longitude: 106 + x / 1e7, latitude: 29 + y / 1e7 };
  });
  const places = packed.places.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    shortName: String(r[2]),
    category: String(r[3]),
    routeIds: r[4] as string[],
    ...points[Number(r[5])],
    ...(r[6] === null ? {} : { platformHeading: Number(r[6]) }),
  }));
  map = {
    revision: packed.revision,
    crs: "gcj02",
    name: "西南大学",
    center: points[packed.center],
    scale: packed.scale,
    planningMode: "adaptive",
    bounds: {
      southwest: points[packed.bounds[0]],
      northeast: points[packed.bounds[1]],
    },
    places,
    paths: packed.paths.map((r) => ({
      id: String(r[0]),
      routeIds: r[1] as string[],
      points: (r[2] as number[]).map((i) => points[i]),
      direction: r[3] as "both" | "forward" | "backward",
      color: "#4D8DB6",
    })),
    routes: packed.routes.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      color: String(r[2]),
      stopIds: (r[3] as number[]).map((i) => places[i].id),
      orderedStops: (r[4] as unknown as number[][]).map((s) => ({
        stopId: places[s[0]].id,
        order: s[1],
      })),
    })),
    serviceTracks: Object.fromEntries(
      Object.entries(packed.tracks).map(([id, tracks]) => [
        id,
        tracks.map((r) => {
          const geometry = (r[1] as number[]).map((i) => points[i]),
            offsets = [0];
          for (let i = 1; i < geometry.length; i++)
            offsets.push(
              offsets[i - 1] + distanceMeters(geometry[i - 1], geometry[i]),
            );
          return {
            id: String(r[0]),
            points: geometry,
            offsets,
            stops: (r[2] as number[][]).map((s) => ({
              place: places[s[0]],
              at: s[1],
              order: s[2],
            })),
            loop: Boolean(r[3]),
          };
        }),
      ]),
    ),
  };
  return map;
}
/** Review positioning is memory-only; native authorization is still required for GPS. */
export function demoShuttlePosition<T extends GeoPoint>(
  point?: T,
): T | (GeoPoint & { accuracy: number }) {
  const m = demoShuttleMap();
  if (point && distanceMeters(point, m.center) < 4000) return point;
  const orange = m.places.find((p) => p.name === "橘园") || m.center;
  return {
    longitude: orange.longitude,
    latitude: orange.latitude,
    accuracy: 0,
  };
}
let selected:
  { lineId: string; track: ShuttleServiceTrack; index: number } | undefined;
function vehicle() {
  const m = demoShuttleMap(),
    orange = demoShuttlePosition();
  if (!selected) {
    const choices = Object.entries(m.serviceTracks || {}).flatMap(
      ([lineId, tracks]) =>
        tracks
          .map((track) => {
            let index = 0;
            for (let i = 1; i < track.points.length; i++)
              if (
                distanceMeters(orange, track.points[i]) <
                distanceMeters(orange, track.points[index])
              )
                index = i;
            return { lineId, track, index };
          })
          .filter(
            (c) =>
              distanceMeters(orange, c.track.points[c.index]) < 500 &&
              c.index < c.track.points.length - 1,
          ),
    );
    selected = choices[Math.floor(Math.random() * choices.length)];
  }
  if (!selected) throw new Error("预览线路暂不可用");
  const p = selected.track.points[selected.index],
    next = selected.track.points[selected.index + 1];
  const direction =
    ((Math.atan2(
      (next.longitude - p.longitude) * Math.cos((p.latitude * Math.PI) / 180),
      next.latitude - p.latitude,
    ) *
      180) /
      Math.PI +
      360) %
    360;
  return {
    id: "demo-shuttle",
    vehicleNo: "演示",
    lineId: selected.lineId,
    ...p,
    speed: 0,
    direction,
    state: "演示",
    distance: distanceMeters(orange, p),
  };
}
const plans = new Map<string, unknown[]>();
/** Demo routes never fall through to network, tickets, location storage or production planning. */
export function demoShuttleRequest(
  route: string,
  method: string,
  body?: unknown,
): unknown {
  const m = demoShuttleMap(),
    now = Date.now();
  if (route.endsWith("/map")) return m;
  if (route.endsWith("/consent"))
    return { accepted: true, version: "shuttle-location-v1" };
  if (route.endsWith("/locations"))
    return method === "DELETE" ? { deleted: true } : { accepted: [] };
  if (route.endsWith("/snapshot") || route.endsWith("/nearby")) {
    const bus = vehicle();
    return {
      type: "snapshot",
      protocol: 2,
      serverTime: now,
      fetchedAt: now,
      stale: false,
      available: true,
      mapRevision: m.revision,
      selectionValid: true,
      selection: { routeIds: [], filtered: false },
      vehicles: [bus],
    } satisfies ShuttleSnapshot;
  }
  if (route.includes("/vehicle-preview/")) {
    vehicle();
    return {
      revision: m.revision,
      lineId: selected!.lineId,
      points: selected!.track.points.slice(selected!.index),
    };
  }
  if (route.endsWith("/walking")) return { revision: m.revision, legs: [] };
  if (route.endsWith("/plans")) {
    const input = body as { origin: GeoPoint; destination: GeoPoint },
      distance = distanceMeters(input.origin, input.destination);
    const place = (point: GeoPoint, id: string): ShuttlePlace => ({
      ...point,
      id,
      name: id === "walk-start" ? "出发点" : "目的地",
      category: "poi",
      routeIds: [],
    });
    const result: unknown[] = [
      {
        id: "walk",
        mode: "walk",
        legs: [],
        route: {
          id: "walk",
          name: "步行",
          color: "#526C64",
          stopIds: [],
          orderedStops: [],
        },
        board: place(input.origin, "walk-start"),
        alight: place(input.destination, "walk-end"),
        points: [input.origin, input.destination],
        walkTo: distance,
        walkFrom: 0,
        rideMeters: 0,
        stopCount: 0,
        score: distance / 1.2,
      },
    ];
    const bus = vehicle(),
      track = selected!.track,
      routeInfo = m.routes.find((r) => r.id === bus.lineId)!;
    const pairs = track.stops
      .flatMap((b, i) =>
        track.stops
          .slice(i + 1)
          .map((a) => ({
            b,
            a,
            walkTo: distanceMeters(input.origin, b.place),
            walkFrom: distanceMeters(input.destination, a.place),
          })),
      )
      .filter(
        (p) =>
          p.walkTo < 350 &&
          p.walkFrom < 600 &&
          p.walkTo + p.walkFrom < distance * 0.8,
      )
      .sort((a, b) => a.walkTo + a.walkFrom - b.walkTo - b.walkFrom);
    if (pairs[0]) {
      const p = pairs[0],
        geometry = track.points.filter(
          (_, i) => track.offsets[i] >= p.b.at && track.offsets[i] <= p.a.at,
        ),
        rideMeters = p.a.at - p.b.at;
      const leg = {
        id: "demo-ride",
        route: routeInfo,
        routes: [routeInfo],
        board: p.b.place,
        alight: p.a.place,
        points: [p.b.place, ...geometry, p.a.place],
        rideMeters,
        walkTo: p.walkTo,
        walkFrom: p.walkFrom,
        stopCount: track.stops.filter((s) => s.at > p.b.at && s.at <= p.a.at)
          .length,
        serviceTrack: track,
        boardAt: p.b.at,
        alightAt: p.a.at,
        trackLength: track.offsets[track.offsets.length - 1],
        wrap: false,
      };
      result.unshift({
        ...leg,
        mode: "ride",
        legs: [leg],
        score: (p.walkTo + p.walkFrom) / 1.2 + rideMeters / 4,
      });
    }
    const planningId = `demo-plan-${now}`;
    plans.clear();
    plans.set(planningId, result);
    return { revision: m.revision, planningId, plans: result };
  }
  if (route.endsWith("/estimates"))
    return {
      revision: m.revision,
      planningId: (body as { planningId: string }).planningId,
      plans: plans.get((body as { planningId: string }).planningId) || [],
    };
  throw new Error("示例账号暂不支持此操作。");
}
