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
function sliceTrack(track: RouteTrack, from: number, to: number): GeoPoint[] {
  const at = (distance: number): GeoPoint => {
    const found = track.offsets.findIndex((v) => v >= distance - 0.001);
    const i = found < 0 ? track.points.length - 1 : Math.max(1, found);
    const a = track.points[i - 1],
      b = track.points[i];
    const t = Math.max(
      0,
      Math.min(
        1,
        (distance - track.offsets[i - 1]) /
          (track.offsets[i] - track.offsets[i - 1] || 1),
      ),
    );
    return {
      longitude: a.longitude + (b.longitude - a.longitude) * t,
      latitude: a.latitude + (b.latitude - a.latitude) * t,
    };
  };
  return uniquePoints([
    at(from),
    ...track.points.filter(
      (_, i) => track.offsets[i] > from && track.offsets[i] < to,
    ),
    at(to),
  ]);
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
  isSpurStop(point: GeoPoint): boolean {
    // A registered stop at a dead-end road must be visited before retracing the
    // branch. A shortest path between through-stops would otherwise skip it.
    const hit = this.nearest(point);
    if (!hit || hit.distance > 25) return false;
    return [hit.segment.a, hit.segment.b].some(
      (id) =>
        distanceMeters(point, this.nodes.get(id)!) <= 25 &&
        new Set((this.adjacency.get(id) || []).map((e) => e.to)).size === 1,
    );
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
  preparing?: boolean;
  seconds: number | null;
  text: string;
  detail: string;
  distance: number | null;
  stops?: number;
  path?: { direction: number; from: number; to: number };
}
/** Count visits, collapsing only adjacent duplicate markers for the same platform. */
export function countStopVisits(
  track: RouteTrack,
  from: number,
  to: number,
): number {
  let count = 0;
  let previous: RouteTrack["stops"][number] | undefined;
  const total = track.offsets?.[track.offsets.length - 1] || 0;
  const stops =
    track.loop && total > 0 && to > total
      ? [
          ...track.stops,
          ...track.stops.map((s) => ({ ...s, at: s.at + total })),
        ]
      : track.stops;
  const name = (p: ShuttlePlace): string =>
    (p.shortName || p.name)
      .replace(/\s*[·•]?\s*(?:东|南|西|北|东北|东南|西北|西南)行\s*$/, "")
      .trim();
  for (const stop of stops) {
    if (stop.at <= from + 5 || stop.at > to + 1) continue;
    if (
      !previous ||
      name(stop.place) !== name(previous.place) ||
      stop.at - previous.at > 45 ||
      distanceMeters(stop.place, previous.place) > 25
    )
      count++;
    previous = stop;
  }
  return count;
}
export class ShuttlePlanner {
  private graphs = new Map<string, ShuttleRoadGraph>();
  private tracks = new Map<string, RouteTrack | null>();
  private arrivalPositions = new Map<string, { score: number; at: number }[]>();
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
    const graph = this.graph(route.id);
    const spurs = this.map.places.filter(
      (p) =>
        route.stopIds.includes(p.id) &&
        !route.sharedStopIds?.includes(p.id) &&
        graph.isSpurStop(p),
    );
    let total = 0;
    for (let i = 1; i < stops.length; i += 1) {
      let result = graph.path(stops[i - 1].place, stops[i].place);
      if (!result) {
        this.tracks.set(route.id, null);
        return null;
      }
      for (const stop of spurs) {
        if (
          distanceMeters(stop, stops[i - 1].place) < 35 ||
          distanceMeters(stop, stops[i].place) < 35
        )
          continue;
        if (result.points.some((p) => distanceMeters(p, stop) < 25)) continue;
        const before = graph.path(stops[i - 1].place, stop),
          after = graph.path(stop, stops[i].place);
        if (
          !before ||
          !after ||
          before.meters + after.meters > result.meters + 350
        )
          continue;
        positions.push({ place: stop, at: total + before.meters, order: 0 });
        result = {
          points: [...before.points, ...after.points.slice(1)],
          meters: before.meters + after.meters,
        };
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
    // A studio stop list can omit return visits. Recover only registered stops
    // actually passed by this route's geometry; keep each visit/direction separate.
    for (const place of this.map.places.filter((p) =>
      route.stopIds.includes(p.id),
    )) {
      for (let i = 1; i < points.length; i++) {
        if (offsets[i] - offsets[i - 1] < 3) continue;
        const hit = project(place, points[i - 1], points[i]);
        if (hit.distance > (route.sharedStopIds?.includes(place.id) ? 12 : 25))
          continue;
        const at = offsets[i - 1] + hit.t * (offsets[i] - offsets[i - 1]);
        if (
          positions.some(
            (s) => s.place.id === place.id && Math.abs(s.at - at) < 45,
          )
        )
          continue;
        positions.push({ place, at, order: 0 });
      }
    }
    positions.sort((a, b) => a.at - b.at);
    positions.forEach((s, order) => {
      const found = offsets.findIndex((v) => v > s.at + 3);
      const i = found < 0 ? points.length - 1 : Math.max(1, found);
      s.place = {
        ...s.place,
        platformHeading: headingDegrees(points[i - 1], points[i]),
      };
      s.order = order;
    });
    this.tracks.set(route.id, track);
    return track;
  }
  private directions(route: ShuttleRoute): RouteTrack[] {
    const forward = this.track(route);
    if (!forward) return [];
    if (route.servicePattern !== "out-and-back") return [forward];
    const total = forward.offsets[forward.offsets.length - 1];
    return [
      forward,
      {
        points: forward.points.slice().reverse(),
        offsets: forward.offsets.map((v) => total - v).reverse(),
        stops: forward.stops
          .slice()
          .reverse()
          .map((s, order) => ({
            at: total - s.at,
            order,
            place: {
              ...s.place,
              platformHeading: (s.place.platformHeading! + 180) % 360,
            },
          })),
        loop: false,
      },
    ];
  }
  plans(
    user: GeoPoint,
    destination: GeoPoint,
    boardingId: string | string[] = "",
    routeId = "",
    destinationStops: string[] = [],
    alternativeBoard?: ShuttlePlace,
  ): ShuttlePlan[] {
    const plans: ShuttlePlan[] = [];
    const boardingIds = Array.isArray(boardingId)
      ? boardingId
      : boardingId
        ? [boardingId]
        : [];
    for (const route of this.map.routes) {
      if (routeId && route.id !== routeId) continue;
      for (const [direction, track] of this.directions(route).entries()) {
        if (alternativeBoard && direction !== alternativeBoard.serviceDirection)
          continue;
        const destinationDistances = track.stops.map((s) =>
          distanceMeters(destination, s.place),
        );
        let best: ShuttlePlan | null = null,
          score = Infinity;
        for (let i = 0; i < track.stops.length; i += 1) {
          if (alternativeBoard && i !== alternativeBoard.serviceOrder) continue;
          const board = track.stops[i],
            walkTo = distanceMeters(user, board.place);
          if (
            (boardingIds.length && !boardingIds.includes(board.place.id)) ||
            (!boardingIds.length && walkTo > 1000)
          )
            continue;
          let closestEarlier = Infinity;
          for (let j = i + 1; j < track.stops.length; j += 1) {
            if (j > i + 1)
              closestEarlier = Math.min(
                closestEarlier,
                destinationDistances[j - 1],
              );
            const alight = track.stops[j],
              walkFrom = destinationDistances[j];
            if (
              destinationStops.length &&
              !destinationStops.includes(alight.place.id)
            )
              continue;
            if (walkFrom > 1800 || alight.place.id === board.place.id) continue;
            // Never pass a useful earlier stop just to shave a few metres off the final walk.
            if (
              !alternativeBoard &&
              !destinationStops.length &&
              closestEarlier <= Math.max(20, walkFrom - 15)
            )
              continue;
            const rideMeters = alight.at - board.at;
            const candidateScore = walkTo + walkFrom * 1.8 + rideMeters * 0.16;
            if (!alternativeBoard && candidateScore >= score) continue;
            score = candidateScore;
            best = {
              id: `${route.id}:${direction}:${board.place.id}:${i}:${alight.place.id}:${j}`,
              route,
              board: {
                ...board.place,
                serviceDirection: direction,
                serviceOrder: i,
              },
              alight: {
                ...alight.place,
                serviceDirection: direction,
                serviceOrder: j,
              },
              walkTo,
              walkFrom,
              rideMeters,
              points: sliceTrack(track, board.at, alight.at),
              stopCount: countStopVisits(track, board.at, alight.at),
            };
            if (alternativeBoard) plans.push(best);
          }
        }
        if (best && !alternativeBoard) plans.push(best);
      }
    }
    return plans
      .sort(
        (a, b) =>
          a.walkTo +
          a.walkFrom +
          a.rideMeters * 0.16 -
          (b.walkTo + b.walkFrom + b.rideMeters * 0.16),
      )
      .filter(
        (plan, i, sorted) =>
          !alternativeBoard ||
          !sorted
            .slice(0, i)
            .some(
              (other) =>
                distanceMeters(other.alight, plan.alight) < 18 &&
                Math.abs(other.rideMeters - plan.rideMeters) < 25,
            ),
      )
      .slice(0, alternativeBoard ? 4 : 24);
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
    const clean = (name: string): string =>
      name
        .replace(/\s*[·•]?\s*(?:东|南|西|北|东北|东南|西北|西南)行\s*$/, "")
        .trim();
    const equivalents = this.map.places.filter(
      (p) =>
        p.category === "stop" &&
        (p.id === board.id ||
          (distanceMeters(p, board) <= 25 &&
            clean(p.name) === clean(board.name) &&
            p.name.split("·")[1]?.trim() === board.name.split("·")[1]?.trim())),
    );
    const served = equivalents.filter((p) => route?.stopIds.includes(p.id));
    if (!route || !served.length) return unknown(this.nextStop(vehicle));
    const stationary =
      vehicle.motion?.status === "stationary" ||
      (!vehicle.motion && vehicle.speed === 0);
    if (stationary && distanceMeters(vehicle, board) > 45)
      return {
        seconds: null,
        text: "等待发车",
        detail: "等待发车",
        distance: null,
      };
    if (vehicle.motion?.status === "uncertain") return unknown("位置暂不稳定");
    const tracks = this.directions(route);
    const track =
      tracks[board.serviceDirection ?? -1] ||
      tracks.find((t) =>
        t.stops.some(
          (s) =>
            s.place.id === board.id &&
            (board.platformHeading === undefined ||
              Math.abs(
                ((s.place.platformHeading! - board.platformHeading + 540) %
                  360) -
                  180,
              ) < 75),
        ),
      ) ||
      tracks[0];
    if (!track) return unknown("线路站序不完整，暂不估时");
    const heading = vehicle.motion ? vehicle.motion.heading : vehicle.direction;
    if (heading === null || !Number.isFinite(heading))
      return unknown("行驶方向待确认");
    const positionKey = JSON.stringify([
      vehicle.lineId,
      tracks.indexOf(track),
      vehicle.longitude,
      vehicle.latitude,
      heading,
      vehicle.motion?.history,
    ]);
    let hits = this.arrivalPositions.get(positionKey);
    if (!hits) {
      const history = uniquePoints(
        (vehicle.motion?.history || []).flatMap((h) => h.points),
      );
      const past: { point: GeoPoint; behind: number }[] = [];
      let behind = 0,
        last: GeoPoint = vehicle;
      for (let i = history.length - 1; i >= 0; i--) {
        behind += distanceMeters(last, history[i]);
        last = history[i];
        if (behind > 120) break;
        if (behind > 3) past.push({ point: history[i], behind });
      }
      hits = [];
      for (let i = 1; i < track.points.length; i++) {
        if (track.offsets[i] - track.offsets[i - 1] < 3) continue;
        const p = project(vehicle, track.points[i - 1], track.points[i]);
        const angle = Math.abs(
          ((headingDegrees(track.points[i - 1], track.points[i]) -
            heading +
            540) %
            360) -
            180,
        );
        if (p.distance > 35 || angle > 75) continue;
        const at =
          track.offsets[i - 1] +
          p.t * (track.offsets[i] - track.offsets[i - 1]);
        let historyError = 0;
        for (const h of past) {
          const position = Math.max(0, at - h.behind);
          const expected = sliceTrack(
            track,
            Math.max(0, position - 1),
            position,
          ).slice(-1)[0];
          historyError += distanceMeters(h.point, expected);
        }
        const score =
          p.distance +
          Math.max(0, angle - 20) * 0.4 +
          historyError / Math.max(1, past.length);
        hits.push({ score, at });
      }
      hits.sort((a, b) => a.score - b.score);
      this.arrivalPositions.set(positionKey, hits);
      if (this.arrivalPositions.size > 256)
        this.arrivalPositions.delete(
          this.arrivalPositions.keys().next().value!,
        );
    }
    const best = hits[0];
    if (!best || best.score > 60) return unknown("位置或方向暂不稳定");
    // Repeated geometry cannot identify a visit from a single coordinate alone.
    // Do not turn that ambiguity into a confident long detour or a fictitious next bus.
    if (
      hits.some(
        (h) => h.score <= best.score + 3 && Math.abs(h.at - best.at) > 80,
      )
    )
      return unknown("到站时间待确认");
    let target = Infinity;
    let targetPlatform: (typeof track.stops)[number] | undefined;
    for (const stop of track.stops.filter(
      (s) =>
        served.some((p) => p.id === s.place.id) &&
        (board.serviceOrder === undefined || s.order === board.serviceOrder) &&
        (board.platformHeading === undefined ||
          Math.abs(
            ((s.place.platformHeading! - board.platformHeading + 540) % 360) -
              180,
          ) < 75),
    )) {
      let at = stop.at;
      if (at < best.at - 35 && track.loop)
        at += track.offsets[track.offsets.length - 1];
      if (at >= best.at - 35 && Math.max(best.at, at) < target) {
        target = Math.max(best.at, at);
        targetPlatform = stop;
      }
    }
    if (!Number.isFinite(target)) return unknown("已驶过，请等待下一班");
    const distance = target - best.at;
    const stops = countStopVisits(track, best.at, target);
    const path = {
      direction: tracks.indexOf(track),
      from: best.at,
      to: target,
    };
    if (stationary) {
      const platform = targetPlatform;
      if (
        distance < 55 &&
        platform?.place.platformHeading !== undefined &&
        Math.abs(
          ((platform.place.platformHeading - heading + 540) % 360) - 180,
        ) < 45
      )
        return {
          seconds: null,
          text: "准备发车",
          detail: "准备发车",
          distance,
          stops: 0,
          preparing: true,
          path,
        };
      return unknown("行驶方向待确认");
    }
    if (distance < 45)
      return {
        seconds: 0,
        text: "即将到站",
        detail: "请留意来车方向",
        distance,
        stops: 0,
        path,
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
      stops,
      path,
    };
  }
  motionPath(routeId: string, from: GeoPoint, to: GeoPoint): GeoPoint[] {
    const direct = distanceMeters(from, to);
    const path = this.graph(routeId).path(from, to, 40);
    return path && path.meters < Math.max(80, direct * 2.8)
      ? path.points
      : [from, to];
  }
  nextStop(vehicle: ShuttleVehicle): string {
    const route = this.map.routes.find((r) => r.id === vehicle.lineId);
    const tracks = route ? this.directions(route) : [];
    if (!tracks.length) return "下一站待确认";
    let best = { score: Infinity, at: 0, track: tracks[0] };
    const heading = vehicle.motion?.heading ?? vehicle.direction;
    for (const track of tracks)
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1],
          b = track.points[i];
        if (distanceMeters(a, b) < 1) continue;
        const p = project(vehicle, a, b);
        const angle =
          heading === null
            ? 0
            : Math.abs(((headingDegrees(a, b) - heading + 540) % 360) - 180);
        const score = p.distance + angle * 0.6;
        if (score < best.score)
          best = {
            score,
            track,
            at:
              track.offsets[i - 1] +
              p.t * (track.offsets[i] - track.offsets[i - 1]),
          };
      }
    const track = best.track;
    const stop =
      track.stops.find((s) => s.at > best.at + 12) ||
      (track.loop ? track.stops[0] : track.stops[track.stops.length - 1]);
    return stop
      ? "下一站 " +
          stop.place.name
            .replace(/\s*[·•]?\s*(?:东|南|西|北|东北|东南|西北|西南)行\s*$/, "")
            .trim()
      : "下一站待确认";
  }
}
