import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttlePlace,
  ShuttleRoute,
  ShuttleVehicle,
} from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import { ShuttlePlanner, type ShuttlePlan } from "./shuttle-routing";

export interface RideLeg extends ShuttlePlan {
  routes: ShuttleRoute[];
  /** Each merged service retains its own directional platform visits. */
  variants?: ShuttlePlan[];
}
export interface ShuttleJourney extends ShuttlePlan {
  /** Exact platform endpoint selected by the directed server plan. */
  destinationPoint?: GeoPoint;
  walkLegs?: {
    points: GeoPoint[];
    meters: number;
    seconds: number;
    source: "tencent" | "straight";
  }[];
  totalSeconds?: number;
  rideSeconds?: number;
  walkingSeconds?: number;
  wait?: number;
  nextArrivalSeconds?: number | null;
  nextStops?: number | null;
  nextDepartureState?: "preparing" | null;
  nextDepartureSeconds?: number | null;
  estimateSource?: "history" | "distance";
  estimatedAt?: number;
  availability?: "live" | "waiting" | "unknown" | "unavailable";
  mode: "walk" | "ride";
  legs: RideLeg[];
  score: number;
}
export interface WalkPath {
  points: GeoPoint[];
  meters: number;
  startGap: number;
  endGap: number;
}
const length = (points: GeoPoint[]): number =>
  points.slice(1).reduce((n, p, i) => n + distanceMeters(points[i], p), 0);
// Compare travelled geometry in order, so opposite directions never collapse together.
export function sameRide(a: ShuttlePlan, b: ShuttlePlan): boolean {
  if (
    distanceMeters(a.board, b.board) > 18 ||
    distanceMeters(a.alight, b.alight) > 18 ||
    Math.abs(a.rideMeters - b.rideMeters) > Math.max(35, a.rideMeters * 0.08)
  )
    return false;
  const sample = (p: GeoPoint[], t: number): GeoPoint => {
    let left = length(p) * t;
    for (let i = 1; i < p.length; i++) {
      const d = distanceMeters(p[i - 1], p[i]);
      if (left <= d) {
        const f = d ? left / d : 0;
        return {
          longitude:
            p[i - 1].longitude + (p[i].longitude - p[i - 1].longitude) * f,
          latitude: p[i - 1].latitude + (p[i].latitude - p[i - 1].latitude) * f,
        };
      }
      left -= d;
    }
    return p[p.length - 1];
  };
  const follows = (from: GeoPoint[], to: GeoPoint[]): boolean => {
    const total = length(from),
      other = length(to),
      offsets = [0];
    for (let i = 1; i < to.length; i++)
      offsets.push(offsets[i - 1] + distanceMeters(to[i - 1], to[i]));
    let previous = 0;
    const count = Math.max(2, Math.ceil(total / 12));
    for (let k = 0; k <= count; k++) {
      const at = (total * k) / count,
        p = sample(from, k / count),
        expected = (other * k) / count;
      let best = Infinity,
        position = previous;
      for (let i = 1; i < to.length; i++) {
        const x = to[i - 1],
          y = to[i],
          cos = Math.cos((p.latitude * Math.PI) / 180);
        const dx = (y.longitude - x.longitude) * cos,
          dy = y.latitude - x.latitude;
        const f = Math.max(
          0,
          Math.min(
            1,
            ((p.longitude - x.longitude) * cos * dx +
              (p.latitude - x.latitude) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
        const projected = offsets[i - 1] + f * (offsets[i] - offsets[i - 1]);
        if (
          projected < previous - 2 ||
          Math.abs(projected - expected) > Math.max(50, total * 0.08)
        )
          continue;
        const gap = distanceMeters(p, {
          longitude: x.longitude + (y.longitude - x.longitude) * f,
          latitude: x.latitude + (y.latitude - x.latitude) * f,
        });
        if (gap < best) {
          best = gap;
          position = projected;
        }
      }
      // Boarding/alighting markers can sit a few metres apart on the same road.
      // In the interior, a parallel road or a different branch is not shared.
      if (best > (at < 30 || total - at < 30 ? 20 : 4)) return false;
      previous = Math.max(previous, position);
    }
    return true;
  };
  // A short platform access can be encoded as junction -> stop -> junction.
  // Ignore only exact retracing for corridor comparison, never a separate road.
  const corridor = (points: GeoPoint[]): GeoPoint[] => {
    const result: GeoPoint[] = [];
    for (const point of points) {
      if (
        result.length > 1 &&
        distanceMeters(point, result[result.length - 2]) < 0.5 &&
        distanceMeters(point, result[result.length - 1]) < 20
      )
        result.pop();
      else result.push(point);
    }
    return result;
  };
  const left = corridor(a.points),
    right = corridor(b.points);
  return follows(left, right) && follows(right, left);
}
function merge(plans: ShuttlePlan[]): RideLeg[] {
  const groups: RideLeg[] = [];
  for (const plan of plans) {
    const group = groups.find((p) => sameRide(p, plan));
    if (group) {
      if (!group.routes.some((r) => r.id === plan.route.id))
        group.routes.push(plan.route);
      group.variants!.push(plan);
    } else groups.push({ ...plan, routes: [plan.route], variants: [plan] });
  }
  return groups;
}
export class ShuttleItineraryPlanner {
  private cache = new Map<string, ShuttleJourney[]>();
  constructor(
    private map: CampusShuttleMap,
    private planner: ShuttlePlanner,
  ) {}
  walk(from: GeoPoint, to: GeoPoint): WalkPath | null {
    const meters = distanceMeters(from, to);
    // User-selected interim behavior: dotted lines indicate straight walking links.
    return {
      points: meters < 1 ? [] : [from, to],
      meters,
      startGap: 0,
      endGap: 0,
    };
  }
  /** Replan forward from the actual bus; never walk back to its previous stop. */
  onboard(
    vehicle: ShuttleVehicle,
    destination: GeoPoint,
    destinationStops: string[] = [],
  ): ShuttleJourney | undefined {
    const candidates: ShuttleJourney[] = [];
    const exits = this.planner.onboardPlans(vehicle, destination);
    const stops = this.map.places.filter((p) => p.category === "stop");
    for (const exit of exits) {
      const first: RideLeg = {
        ...exit,
        routes: [exit.route],
        variants: [exit],
      };
      if (!destinationStops.length || destinationStops.includes(exit.alight.id))
        candidates.push(this.journey([first]));
      const boarding = stops
        .filter((s) => distanceMeters(s, exit.alight) <= 320)
        .map((s) => s.id);
      for (const tail of this.planner.plans(
        exit.alight,
        destination,
        boarding,
        "",
        destinationStops,
      )) {
        if (tail.route.id === exit.route.id || tail.rideMeters < 100) continue;
        candidates.push(
          this.journey([
            first,
            { ...tail, routes: [tail.route], variants: [tail] },
          ]),
        );
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const plan = candidates[0];
    if (plan) {
      // Already aboard: no initial walk or first-vehicle waiting estimate.
      plan.score = Math.max(0, plan.score - 180);
      plan.wait = 0;
    }
    return plan;
  }
  plans(
    origin: GeoPoint,
    destination: GeoPoint,
    boarding: string[] = [],
    destinationStops: string[] = [],
    all = false,
  ): ShuttleJourney[] {
    const key = JSON.stringify([
      origin.longitude.toFixed(5),
      origin.latitude.toFixed(5),
      destination.longitude.toFixed(6),
      destination.latitude.toFixed(6),
      boarding,
      destinationStops,
      all,
    ]);
    const saved = this.cache.get(key);
    if (saved) return saved;
    const walking = distanceMeters(origin, destination);
    // Dynamic service inference belongs to the server. On a timeout, a bounded
    // walking fallback must not run an exhaustive transfer search on the UI thread.
    const local = this.map.planningMode !== "adaptive";
    const direct = local
      ? merge([
          ...this.planner.plans(
            origin,
            destination,
            boarding,
            "",
            destinationStops,
          ),
          ...(destinationStops.length
            ? this.planner.plans(origin, destination, boarding)
            : []),
        ])
      : [];
    const journeys: ShuttleJourney[] = direct.map((leg) => this.journey([leg]));
    const stops = local
      ? this.map.places.filter((p) => p.category === "stop")
      : [];
    for (const stop of stops) {
      const ids = [stop.id];
      if (
        ids.some((id) => boarding.includes(id) || destinationStops.includes(id))
      )
        continue;
      const first = merge(
        this.planner.plans(origin, stop, boarding, "", ids, undefined, {
          point: destination,
          stopIds: destinationStops,
        }),
      );
      if (!first.length) continue;
      const second = merge(
        this.planner.plans(
          stop,
          destination,
          stops.filter((p) => distanceMeters(p, stop) <= 320).map((p) => p.id),
          "",
          destinationStops,
        ),
      );
      for (const a of first)
        for (const b of second) {
          const transfer = distanceMeters(a.alight, b.board);
          if (a.routes.some((r) => b.routes.some((s) => r.id === s.id)))
            continue;
          if (a.rideMeters < 180 || b.rideMeters < 180) continue;
          if (distanceMeters(a.board, b.alight) < 40) continue;
          // Do not ride away to board a service already accessible at the start.
          const originalStops = this.map.places.filter(
            (p) =>
              p.category === "stop" &&
              distanceMeters(p, origin) <=
                Math.max(180, a.walkTo + transfer + 100),
          );
          if (
            b.routes.some((r) =>
              this.planner
                .plans(
                  origin,
                  destination,
                  originalStops.map((p) => p.id),
                  r.id,
                  destinationStops,
                )
                .some(
                  (p) => p.walkTo <= Math.max(180, a.walkTo + transfer + 100),
                ),
            )
          )
            continue;
          // A later transfer must not overshoot an earlier useful alighting stop.
          if (
            direct.some(
              (p) =>
                a.routes.some((r) => p.routes.some((s) => s.id === r.id)) &&
                distanceMeters(p.board, a.board) < 40 &&
                p.rideMeters + 40 < a.rideMeters &&
                p.walkFrom <= Math.max(120, b.walkFrom + 60),
            )
          )
            continue;
          if (transfer > 320 || (transfer > 8 && !this.walk(a.alight, b.board)))
            continue;
          const candidate = this.journey([a, b]);
          if (
            direct.some(
              (p) =>
                a.routes.some((r) => p.routes.some((s) => s.id === r.id)) &&
                distanceMeters(p.board, a.board) < 40 &&
                p.walkFrom <= b.walkFrom + 20 &&
                p.rideMeters <= candidate.rideMeters + transfer + 150,
            )
          )
            continue;
          // Evaluate an earlier exit on the first vehicle independently of the final stop-ID filter.
          const earlier = this.planner.plans(
            origin,
            destination,
            [a.board.id],
            a.route.id,
          );
          if (
            earlier.some(
              (p) =>
                p.rideMeters + 40 < a.rideMeters &&
                p.walkFrom <= Math.max(180, b.walkFrom + 80),
            )
          )
            continue;
          // Avoid huge backtracking detours just to manufacture a transfer option.
          if (candidate.rideMeters > Math.max(700, walking * 2.5)) continue;
          if (
            !journeys.some(
              (j) =>
                j.legs.length === 2 &&
                sameRide(j.legs[0], a) &&
                sameRide(j.legs[1], b),
            )
          )
            journeys.push(candidate);
        }
    }
    const rides = journeys.filter(
      (p) =>
        walking > 250 &&
        p.walkTo + p.walkFrom < walking * 0.9 &&
        p.walkTo < Math.max(220, walking * 0.45),
    );
    // Selecting a destination platform does not forbid a useful final walk.
    // Keep exact-stop transfers above, and add the same alternatives as a map pin.
    if (destinationStops.length && local)
      for (const plan of this.plans(origin, destination, boarding, [], true))
        if (plan.mode === "ride" && !rides.some((p) => p.id === plan.id))
          rides.push(plan);
    // Fleet availability is evaluated on the server. A slower transfer may be
    // the usable option when the geometrically shorter direct service is absent.
    const sensible = rides;
    if (walking <= (all ? 8000 : 1800)) {
      const place = (point: GeoPoint, id: string): ShuttlePlace => ({
        ...point,
        id,
        name: id === "walk-start" ? "出发点" : "目的地",
        category: "poi",
        routeIds: [],
      });
      sensible.push({
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
        board: place(origin, "walk-start"),
        alight: place(destination, "walk-end"),
        points: [origin, destination],
        rideMeters: 0,
        walkTo: walking,
        walkFrom: 0,
        stopCount: 0,
        score: walking / 1.2,
      });
    }
    sensible.sort((a, b) =>
      walking > 300 && a.mode !== b.mode
        ? a.mode === "ride"
          ? -1
          : 1
        : a.score - b.score,
    );
    const best = sensible[0]?.score || 0;
    const result = all
      ? sensible
      : sensible
          .filter((p) => p.mode === "walk" || p.score <= best * 1.3 + 30)
          .slice(0, 3);
    // For a short trip, avoid waiting for a bus for only a marginal time saving.
    if (walking <= 300) {
      const index = result.findIndex((p) => p.mode === "walk");
      if (index > 0) result.unshift(result.splice(index, 1)[0]);
    }
    this.cache.set(key, result);
    if (this.cache.size > 25)
      this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  private journey(legs: RideLeg[]): ShuttleJourney {
    const first = legs[0],
      last = legs[legs.length - 1];
    const rideMeters = legs.reduce((n, p) => n + p.rideMeters, 0);
    return {
      ...first,
      mode: "ride",
      id: legs.map((p) => p.id).join("|"),
      legs,
      alight: last.alight,
      walkFrom: last.walkFrom,
      rideMeters,
      points: legs.flatMap((p) => p.points),
      stopCount: legs.reduce((n, p) => n + p.stopCount, 0),
      score:
        (first.walkTo + last.walkFrom) / 1.2 +
        180 +
        legs
          .slice(1)
          .reduce(
            (meters, leg, i) =>
              meters + distanceMeters(legs[i].alight, leg.board) / 1.2,
            0,
          ) +
        rideMeters / 4 +
        (legs.length - 1) * 150,
    };
  }
}
