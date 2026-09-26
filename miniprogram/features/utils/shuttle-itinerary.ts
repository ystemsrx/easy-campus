import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttleRoute,
} from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import { ShuttlePlanner, type ShuttlePlan } from "./shuttle-routing";
import { placeGroups } from "./shuttle-place-groups";

export interface RideLeg extends ShuttlePlan {
  routes: ShuttleRoute[];
}
export interface ShuttleJourney extends ShuttlePlan {
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
function sameRide(a: ShuttlePlan, b: ShuttlePlan): boolean {
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
  return [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].every(
    (t) => distanceMeters(sample(a.points, t), sample(b.points, t)) < 22,
  );
}
function merge(plans: ShuttlePlan[]): RideLeg[] {
  const groups: RideLeg[] = [];
  for (const plan of plans) {
    const group = groups.find((p) => sameRide(p, plan));
    if (group) {
      if (!group.routes.some((r) => r.id === plan.route.id))
        group.routes.push(plan.route);
    } else groups.push({ ...plan, routes: [plan.route] });
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
  plans(
    origin: GeoPoint,
    destination: GeoPoint,
    boarding: string[] = [],
    destinationStops: string[] = [],
  ): ShuttleJourney[] {
    const key = JSON.stringify([
      origin.longitude.toFixed(5),
      origin.latitude.toFixed(5),
      destination.longitude.toFixed(6),
      destination.latitude.toFixed(6),
      boarding,
      destinationStops,
    ]);
    const saved = this.cache.get(key);
    if (saved) return saved;
    const direct = merge(
      this.planner.plans(origin, destination, boarding, "", destinationStops),
    );
    const journeys: ShuttleJourney[] = direct.map((leg) => this.journey([leg]));
    const groups = placeGroups(this.map).filter((g) => g.stop);
    for (const group of groups) {
      const ids = group.members.map((p) => p.id);
      if (
        ids.some((id) => boarding.includes(id) || destinationStops.includes(id))
      )
        continue;
      const first = merge(
        this.planner.plans(origin, group.members[0], boarding, "", ids),
      );
      if (!first.length) continue;
      const second = merge(
        this.planner.plans(
          group.members[0],
          destination,
          ids,
          "",
          destinationStops,
        ),
      );
      for (const a of first)
        for (const b of second) {
          if (a.routes.some((r) => b.routes.some((s) => r.id === s.id)))
            continue;
          if (distanceMeters(a.board, b.alight) < 40) continue;
          const transfer = distanceMeters(a.alight, b.board);
          if (transfer > 100 || (transfer > 8 && !this.walk(a.alight, b.board)))
            continue;
          const candidate = this.journey([a, b]);
          // Avoid huge backtracking detours just to manufacture a transfer option.
          if (
            candidate.rideMeters >
            Math.max(900, distanceMeters(origin, destination) * 4)
          )
            continue;
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
    const result = journeys.sort((a, b) => a.score - b.score).slice(0, 4);
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
      id: legs.map((p) => p.id).join("|"),
      legs,
      alight: last.alight,
      walkFrom: last.walkFrom,
      rideMeters,
      points: legs.flatMap((p) => p.points),
      stopCount: legs.reduce((n, p) => n + p.stopCount, 0),
      score:
        first.walkTo +
        last.walkFrom * 1.2 +
        legs
          .slice(1)
          .reduce(
            (meters, leg, i) =>
              meters + distanceMeters(legs[i].alight, leg.board),
            0,
          ) +
        rideMeters * 0.16 +
        (legs.length - 1) * 220,
    };
  }
}
