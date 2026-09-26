import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttlePlace,
  ShuttleRoute,
  ShuttleVehicle,
} from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import { headingDegrees } from "./shuttle-screen";
interface Edge {
  to: string;
  length: number;
}
interface Segment {
  a: string;
  b: string;
  from: GeoPoint;
  to: GeoPoint;
  length: number;
  forward: boolean;
  backward: boolean;
}
interface Projection {
  point: GeoPoint;
  t: number;
  distance: number;
  segment: Segment;
}
interface PathResult {
  points: GeoPoint[];
  meters: number;
}
function key(point: GeoPoint): string {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}
function project(
  point: GeoPoint,
  from: GeoPoint,
  to: GeoPoint,
): { point: GeoPoint; t: number; distance: number } {
  const cos = Math.cos((point.latitude * Math.PI) / 180),
    dx = (to.longitude - from.longitude) * cos,
    dy = to.latitude - from.latitude;
  const denominator = dx * dx + dy * dy;
  const t = denominator
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.longitude - from.longitude) * cos * dx +
            (point.latitude - from.latitude) * dy) /
            denominator,
        ),
      )
    : 0;
  const nearest = {
    longitude: from.longitude + (to.longitude - from.longitude) * t,
    latitude: from.latitude + (to.latitude - from.latitude) * t,
  };
  return { point: nearest, t, distance: distanceMeters(point, nearest) };
}
function uniquePoints(points: GeoPoint[]): GeoPoint[] {
  return points.filter(
    (point, i) => !i || distanceMeters(point, points[i - 1]) > 0.15,
  );
}
function pathLength(points: GeoPoint[]): number {
  return points.reduce(
    (sum, point, i) => sum + (i ? distanceMeters(points[i - 1], point) : 0),
    0,
  );
}
class Heap {
  private values: { id: string; cost: number }[] = [];
  get length(): number {
    return this.values.length;
  }
  push(value: { id: string; cost: number }): void {
    const a = this.values;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].cost <= value.cost) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = value;
  }
  pop(): { id: string; cost: number } {
    const a = this.values,
      first = a[0],
      last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let next = i * 2 + 1;
        if (next + 1 < a.length && a[next + 1].cost < a[next].cost) next += 1;
        if (a[next].cost >= last.cost) break;
        a[i] = a[next];
        i = next;
      }
      a[i] = last;
    }
    return first;
  }
}
/** Road topology, not a hardcoded list of campus coordinates. */
export class ShuttleRoadGraph {
  private nodes = new Map<string, GeoPoint>();
  private adjacency = new Map<string, Edge[]>();
  private segments: Segment[] = [];
  constructor(map: CampusShuttleMap, routeId: string) {
    const endpoints: GeoPoint[] = [];
    map.paths
      .filter((p) => p.routeIds.includes(routeId))
      .forEach((path) => {
        endpoints.push(path.points[0], path.points[path.points.length - 1]);
        path.points.forEach((point) => {
          const id = key(point);
          if (!this.nodes.has(id)) {
            this.nodes.set(id, point);
            this.adjacency.set(id, []);
          }
        });
        for (let i = 1; i < path.points.length; i += 1) {
          const from = path.points[i - 1],
            to = path.points[i],
            a = key(from),
            b = key(to),
            length = distanceMeters(from, to);
          if (a === b || !length) continue;
          const forward = path.direction !== "backward",
            backward = path.direction !== "forward";
          if (forward) this.adjacency.get(a)!.push({ to: b, length });
          if (backward) this.adjacency.get(b)!.push({ to: a, length });
          this.segments.push({ a, b, from, to, length, forward, backward });
        }
      });
    // Studio segments are independently rounded: a junction may land a few metres from
    // another segment or in its interior. Split and snap ENDPOINTS only, within 6 m.
    // Never bridge a real missing road, and never modify the displayed source geometry.
    const originals = this.segments.slice();
    const cuts = new Map<Segment, { t: number; point: GeoPoint }[]>();
    const joins: { from: GeoPoint; to: GeoPoint }[] = [];
    endpoints.forEach((endpoint) => {
      for (const segment of originals) {
        if (key(endpoint) === segment.a || key(endpoint) === segment.b)
          continue;
        const p = project(endpoint, segment.from, segment.to);
        if (p.distance > 6) continue;
        const values = cuts.get(segment) || [];
        values.push({ t: p.t, point: p.point });
        cuts.set(segment, values);
        if (key(endpoint) !== key(p.point))
          joins.push({ from: endpoint, to: p.point });
      }
    });
    this.nodes.clear();
    this.adjacency.clear();
    this.segments = [];
    const add = (
      from: GeoPoint,
      to: GeoPoint,
      forward: boolean,
      backward: boolean,
    ): void => {
      const a = key(from),
        b = key(to),
        length = distanceMeters(from, to);
      for (const [id, point] of [
        [a, from],
        [b, to],
      ] as [string, GeoPoint][]) {
        if (!this.nodes.has(id)) {
          this.nodes.set(id, point);
          this.adjacency.set(id, []);
        }
      }
      if (a === b || length < 0.01) return;
      if (forward) this.adjacency.get(a)!.push({ to: b, length });
      if (backward) this.adjacency.get(b)!.push({ to: a, length });
      this.segments.push({ a, b, from, to, length, forward, backward });
    };
    originals.forEach((segment) => {
      const points = [
        { t: 0, point: segment.from },
        ...(cuts.get(segment) || []),
        { t: 1, point: segment.to },
      ].sort((a, b) => a.t - b.t);
      for (let i = 1; i < points.length; i += 1)
        add(
          points[i - 1].point,
          points[i].point,
          segment.forward,
          segment.backward,
        );
    });
    joins.forEach((join) => add(join.from, join.to, true, true));
  }
  private nearest(point: GeoPoint): Projection | null {
    let best: Projection | null = null;
    this.segments.forEach((segment) => {
      const p = project(point, segment.from, segment.to);
      if (!best || p.distance < best.distance) best = { ...p, segment };
    });
    return best;
  }
  path(from: GeoPoint, to: GeoPoint, maxSnap = 90): PathResult | null {
    const start = this.nearest(from),
      end = this.nearest(to);
    if (!start || !end || start.distance > maxSnap || end.distance > maxSnap)
      return null;
    if (
      start.segment === end.segment &&
      ((end.t >= start.t && start.segment.forward) ||
        (end.t <= start.t && start.segment.backward))
    ) {
      const points = uniquePoints([from, start.point, end.point, to]);
      return { points, meters: pathLength(points) };
    }
    const distances = new Map<string, number>(),
      previous = new Map<string, string>(),
      heap = new Heap();
    const seed = (id: string, cost: number): void => {
      if (cost < (distances.get(id) ?? Infinity)) {
        distances.set(id, cost);
        heap.push({ id, cost });
      }
    };
    if (start.segment.backward)
      seed(start.segment.a, start.t * start.segment.length);
    if (start.segment.forward)
      seed(start.segment.b, (1 - start.t) * start.segment.length);
    const goals = new Map<string, number>();
    if (end.segment.forward)
      goals.set(end.segment.a, end.t * end.segment.length);
    if (end.segment.backward)
      goals.set(end.segment.b, (1 - end.t) * end.segment.length);
    let bestId = "",
      bestCost = Infinity;
    while (heap.length) {
      const item = heap.pop();
      if (item.cost !== distances.get(item.id)) continue;
      if (item.cost > bestCost) break;
      const tail = goals.get(item.id);
      if (tail !== undefined && item.cost + tail < bestCost) {
        bestCost = item.cost + tail;
        bestId = item.id;
      }
      for (const edge of this.adjacency.get(item.id) || []) {
        const next = item.cost + edge.length;
        if (next < (distances.get(edge.to) ?? Infinity)) {
          distances.set(edge.to, next);
          previous.set(edge.to, item.id);
          heap.push({ id: edge.to, cost: next });
        }
      }
    }
    if (!bestId) return null;
    const middle: GeoPoint[] = [];
    let cursor: string | undefined = bestId;
    while (cursor) {
      middle.push(this.nodes.get(cursor)!);
      cursor = previous.get(cursor);
    }
    const points = uniquePoints([
      from,
      start.point,
      ...middle.reverse(),
      end.point,
      to,
    ]);
    return { points, meters: pathLength(points) };
  }
}
interface RouteTrack {
  points: GeoPoint[];
  offsets: number[];
  stops: { place: ShuttlePlace; at: number; order: number }[];
  loop: boolean;
}
export interface ShuttlePlan {
  id: string;
  route: ShuttleRoute;
  board: ShuttlePlace;
  alight: ShuttlePlace;
  walkTo: number;
  walkFrom: number;
  rideMeters: number;
  points: GeoPoint[];
  stopCount: number;
}
export interface ArrivalEstimate {
  seconds: number | null;
  text: string;
  detail: string;
  distance: number | null;
}
export class ShuttlePlanner {
  private graphs = new Map<string, ShuttleRoadGraph>();
  private tracks = new Map<string, RouteTrack | null>();
  constructor(readonly map: CampusShuttleMap) {}
  graph(id: string): ShuttleRoadGraph {
    if (!this.graphs.has(id))
      this.graphs.set(id, new ShuttleRoadGraph(this.map, id));
    return this.graphs.get(id)!;
  }
  private track(route: ShuttleRoute): RouteTrack | null {
    if (this.tracks.has(route.id)) return this.tracks.get(route.id)!;
    const stops = route.orderedStops
      .map((entry) => ({
        ...entry,
        place: this.map.places.find((p) => p.id === entry.stopId),
      }))
      .filter(
        (
          entry,
        ): entry is { stopId: string; order: number; place: ShuttlePlace } =>
          Boolean(entry.place),
      );
    if (stops.length < 2) {
      this.tracks.set(route.id, null);
      return null;
    }
    const points: GeoPoint[] = [stops[0].place],
      positions = [{ place: stops[0].place, at: 0, order: stops[0].order }];
    let total = 0;
    for (let i = 1; i < stops.length; i += 1) {
      const result = this.graph(route.id).path(
        stops[i - 1].place,
        stops[i].place,
      );
      if (!result) {
        this.tracks.set(route.id, null);
        return null;
      }
      total += result.meters;
      points.push(...result.points.slice(1));
      positions.push({
        place: stops[i].place,
        at: total,
        order: stops[i].order,
      });
    }
    const offsets = [0];
    for (let i = 1; i < points.length; i += 1)
      offsets.push(offsets[i - 1] + distanceMeters(points[i - 1], points[i]));
    const track = {
      points,
      offsets,
      stops: positions,
      loop: distanceMeters(points[0], points[points.length - 1]) < 40,
    };
    this.tracks.set(route.id, track);
    return track;
  }
  plans(
    user: GeoPoint,
    destination: GeoPoint,
    boardingId: string | string[] = "",
    routeId = "",
    destinationStops: string[] = [],
  ): ShuttlePlan[] {
    const plans: ShuttlePlan[] = [];
    const boardingIds = Array.isArray(boardingId)
      ? boardingId
      : boardingId
        ? [boardingId]
        : [];
    for (const route of this.map.routes) {
      if (routeId && route.id !== routeId) continue;
      const track = this.track(route);
      if (!track) continue;
      let best: ShuttlePlan | null = null,
        score = Infinity;
      for (let i = 0; i < track.stops.length; i += 1) {
        const board = track.stops[i],
          walkTo = distanceMeters(user, board.place);
        if (
          (boardingIds.length && !boardingIds.includes(board.place.id)) ||
          (!boardingIds.length && walkTo > 650)
        )
          continue;
        for (let j = i + 1; j < track.stops.length; j += 1) {
          const alight = track.stops[j],
            walkFrom = distanceMeters(destination, alight.place);
          if (
            destinationStops.length &&
            !destinationStops.includes(alight.place.id)
          )
            continue;
          if (walkFrom > 450 || alight.place.id === board.place.id) continue;
          const rideMeters = alight.at - board.at;
          const candidateScore = walkTo + walkFrom * 1.2 + rideMeters * 0.16;
          if (candidateScore >= score) continue;
          score = candidateScore;
          const start = track.offsets.findIndex((v) => v >= board.at - 0.5),
            end = track.offsets.findIndex((v) => v >= alight.at - 0.5);
          best = {
            id: `${route.id}:${board.place.id}:${alight.place.id}`,
            route,
            board: board.place,
            alight: alight.place,
            walkTo,
            walkFrom,
            rideMeters,
            points: track.points.slice(
              Math.max(0, start),
              end < 0 ? undefined : end + 1,
            ),
            stopCount: j - i,
          };
        }
      }
      if (best) plans.push(best);
    }
    return plans
      .sort(
        (a, b) =>
          a.walkTo +
          a.walkFrom +
          a.rideMeters * 0.16 -
          (b.walkTo + b.walkFrom + b.rideMeters * 0.16),
      )
      .slice(0, 6);
  }
  arrival(
    vehicle: ShuttleVehicle,
    board: ShuttlePlace,
    stale: boolean,
  ): ArrivalEstimate {
    const unknown = (detail: string): ArrivalEstimate => ({
      seconds: null,
      text: "待确认",
      detail,
      distance: null,
    });
    if (stale) return unknown("信号未更新，暂不估时");
    const route = this.map.routes.find((r) => r.id === vehicle.lineId);
    if (!route || !board.routeIds.includes(route.id))
      return unknown("此车不经过该候车点");
    const track = this.track(route);
    if (!track) return unknown("线路站序不完整，暂不估时");
    if (vehicle.direction === null || !Number.isFinite(vehicle.direction))
      return unknown("行驶方向待确认");
    let best = { score: Infinity, at: 0, distance: Infinity, angle: 180 };
    for (let i = 1; i < track.points.length; i += 1) {
      if (distanceMeters(track.points[i - 1], track.points[i]) < 3) continue;
      const p = project(vehicle, track.points[i - 1], track.points[i]);
      const angle = Math.abs(
        ((headingDegrees(track.points[i - 1], track.points[i]) -
          vehicle.direction +
          540) %
          360) -
          180,
      );
      const score = p.distance + Math.max(0, angle - 25) * 0.4;
      if (score < best.score)
        best = {
          score,
          at:
            track.offsets[i - 1] +
            p.t * (track.offsets[i] - track.offsets[i - 1]),
          distance: p.distance,
          angle,
        };
    }
    if (best.distance > 55 || best.angle > 85)
      return unknown("位置或方向暂不稳定");
    let distance = Infinity;
    for (const stop of track.stops.filter((s) => s.place.id === board.id)) {
      let delta = stop.at - best.at;
      if (delta < -35 && track.loop)
        delta += track.offsets[track.offsets.length - 1];
      if (delta >= -35) distance = Math.min(distance, Math.max(0, delta));
    }
    if (!Number.isFinite(distance)) return unknown("已驶过，请等待下一班");
    if (distance < 45)
      return {
        seconds: 0,
        text: "即将到站",
        detail: "请留意来车方向",
        distance,
      };
    // Upstream speed units are not documented. Use an explicit rough model, never pretend an official ETA.
    const seconds = distance / 4 + 25;
    const low = Math.max(1, Math.floor((seconds * 0.8) / 60)),
      high = Math.max(low + 1, Math.ceil((seconds * 1.4) / 60));
    return {
      seconds,
      text: `约 ${low}–${high} 分钟`,
      detail: "按线路距离估算",
      distance,
    };
  }
  motionPath(routeId: string, from: GeoPoint, to: GeoPoint): GeoPoint[] {
    const direct = distanceMeters(from, to);
    const path = this.graph(routeId).path(from, to, 40);
    return path && path.meters < Math.max(80, direct * 2.8)
      ? path.points
      : [from, to];
  }
}
