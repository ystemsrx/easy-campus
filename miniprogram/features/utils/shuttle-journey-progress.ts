import type { GeoPoint, NamedPoint, ShuttleVehicle } from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import type { ShuttleJourney, RideLeg } from "./shuttle-itinerary";
import type { ShuttlePlanner } from "./shuttle-routing";
import { stopName } from "./shuttle-place-groups";
import { headingDegrees } from "./shuttle-screen";

type Fix = GeoPoint & { accuracy?: number; speed?: number };
interface Stage {
  kind: "walk" | "ride";
  points: GeoPoint[];
  length: number;
  from: string;
  to: string;
  stops: { name: string; meters: number }[];
  routes: string[];
  offset: number;
  width: number;
}
export interface JourneyProgressView {
  segments: {
    id: number;
    x: number;
    width: number;
    walk: boolean;
    fill: number;
    fillWidth: number;
  }[];
  nodes: {
    id: string;
    x: number;
    name: string;
    major: boolean;
    reached: boolean;
    edge: string;
    transfer: boolean;
  }[];
  position: number;
  next: string;
  phase: "waiting" | "riding" | "walking" | "arrived";
  boardingId: string;
  routes: string[];
  approaching: boolean;
  width: number;
}
const length = (points: GeoPoint[]) =>
  points.slice(1).reduce((n, p, i) => n + distanceMeters(points[i], p), 0);
const valid = (p: GeoPoint) =>
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

// Station nodes are evenly spaced; movement within each interval still follows
// actual road distance, including the initial position after a reroute.
function displayFraction(stage: Stage, meters: number): number {
  if (meters <= 0) return 0;
  if (meters >= stage.length) return 1;
  const boundaries = [0, ...stage.stops.map((s) => s.meters), stage.length];
  for (let i = 1; i < boundaries.length; i++) {
    if (meters < boundaries[i]) {
      const fraction =
        (meters - boundaries[i - 1]) / (boundaries[i] - boundaries[i - 1]);
      return (i - 1 + fraction) / (boundaries.length - 1);
    }
  }
  return 1;
}

// Project only inside the reachable distance window. Nearby parallel roads and
// later visits to the same junction must not advance the user to a future leg.
function project(p: GeoPoint, points: GeoPoint[], min = 0, max = Infinity) {
  let at = 0,
    best = { meters: min, distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      meters = distanceMeters(a, b);
    if (meters < 0.01) continue;
    const cos = Math.cos((p.latitude * Math.PI) / 180);
    const dx = (b.longitude - a.longitude) * cos,
      dy = b.latitude - a.latitude;
    const lo = Math.max(0, (min - at) / meters),
      hi = Math.min(1, (max - at) / meters);
    if (lo <= hi) {
      const t = Math.max(
        lo,
        Math.min(
          hi,
          ((p.longitude - a.longitude) * cos * dx +
            (p.latitude - a.latitude) * dy) /
            (dx * dx + dy * dy),
        ),
      );
      const distance = distanceMeters(p, {
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        latitude: a.latitude + (b.latitude - a.latitude) * t,
      });
      if (distance < best.distance)
        best = { meters: at + meters * t, distance };
    }
    at += meters;
  }
  return best;
}

/** Foreground-only, frozen itinerary; no timer advances real journey progress. */
export class ShuttleJourneyProgress {
  private stages: Stage[] = [];
  private index = 0;
  private meters = 0;
  private boarded = false;
  private finished = false;
  private previous?: { point: Fix; time: number };
  private evidence?: { since: number; samples: number; bus: string };
  private gpsEvidence?: { since: number; samples: number };
  private boardingFix?: { point: Fix; time: number; meters: number };
  private endpointSamples = 0;
  private candidateMeters = 0;
  private lastFixAt?: number;
  private boardIds: string[] = [];
  private total = 0;
  constructor(
    plan: ShuttleJourney,
    origin: GeoPoint,
    destination: NamedPoint,
    planner: ShuttlePlanner,
  ) {
    let from = origin,
      fromName = "起点",
      walkIndex = 0;
    const add = (
      kind: Stage["kind"],
      points: GeoPoint[],
      start: string,
      end: string,
      leg?: RideLeg,
    ) => {
      const onboard = leg?.onboard ? planner.onboardProgress(leg) : undefined;
      if (onboard) points = onboard.points;
      const meters = length(points);
      if (meters < 2) return;
      const completed = onboard?.completedMeters || 0;
      const stops = leg
        ? (onboard?.stops || planner.journeyStops(leg)).map((s) => ({
            name: stopName(s.place),
            meters:
              (s.meters * meters) /
              Math.max(1, onboard?.totalMeters ?? leg.rideMeters),
          }))
        : [];
      const width =
        kind === "walk" ? 60 : Math.max(150, stops.length * 16 + 50);
      this.stages.push({
        kind,
        points,
        length: meters,
        from: start,
        to: end,
        stops,
        routes: leg?.routes.map((r) => r.id) || [],
        offset: this.total,
        width,
      });
      this.boardIds.push(leg?.board.id || "");
      if (onboard && this.stages.length === 1) {
        this.meters = Math.min(meters, completed);
        this.candidateMeters = this.meters;
      }
      this.total += width;
    };
    const walk = (to: GeoPoint, name: string) => {
      const geometry = plan.walkLegs?.[walkIndex++];
      if (distanceMeters(from, to) >= 12)
        add(
          "walk",
          geometry?.points.length
            ? [from, ...geometry.points.slice(1, -1), to]
            : [from, to],
          fromName,
          name,
        );
      from = to;
      fromName = name;
    };
    for (const leg of plan.legs) {
      if (leg === plan.legs[0] && leg.onboard) walkIndex++;
      else walk(leg.board, stopName(leg.board));
      add("ride", leg.points, stopName(leg.board), stopName(leg.alight), leg);
      from = leg.alight;
      fromName = stopName(leg.alight);
    }
    walk(destination, destination.shortName || destination.name);
    this.finished = !this.stages.length;
    this.boarded = !!plan.legs[0]?.onboard;
  }
  pause() {
    this.previous = undefined;
    this.evidence = undefined;
    this.gpsEvidence = undefined;
    this.boardingFix = undefined;
    this.candidateMeters = this.meters;
    this.endpointSamples = 0;
  }
  /** Called only after sustained, time-aligned vehicle co-motion is confirmed. */
  confirmOnboard(bus: ShuttleVehicle): boolean {
    const index =
      this.stages[this.index]?.kind === "walk" ? this.index + 1 : this.index;
    const stage = this.stages[index];
    if (
      this.finished ||
      !stage ||
      stage.kind !== "ride" ||
      !stage.routes.includes(bus.lineId)
    )
      return false;
    const projection = project(bus, stage.points);
    if (
      projection.distance > 35 ||
      (index === this.index && projection.meters < this.meters - 20)
    )
      return false;
    let distance = 0;
    const segment = stage.points.findIndex((point, i) => {
      if (!i) return false;
      distance += distanceMeters(stage.points[i - 1], point);
      return distance >= projection.meters;
    });
    if (
      segment < 1 ||
      bus.direction == null ||
      Math.abs(
        ((headingDegrees(stage.points[segment - 1], stage.points[segment]) -
          bus.direction +
          540) %
          360) -
          180,
      ) >= 30
    )
      return false;
    const completed = index === this.index ? this.meters : 0;
    this.index = index;
    this.meters = Math.max(completed, projection.meters);
    this.boarded = true;
    this.pause();
    return true;
  }
  update(point: Fix, time: number, vehicles: ShuttleVehicle[] = []) {
    if (
      !valid(point) ||
      !Number.isFinite(time) ||
      (point.accuracy !== undefined &&
        (!Number.isFinite(point.accuracy) || point.accuracy > 45))
    )
      return;
    if (this.finished) return;
    const prev = this.previous;
    if (prev && time <= prev.time) return;
    const dt = prev ? (time - prev.time) / 1000 : 0;
    const displacement = prev ? distanceMeters(prev.point, point) : 0;
    if (prev && dt < 30 && displacement > 18 * dt + 25) return;
    this.previous = { point: { ...point }, time };
    const stage = this.stages[this.index];
    // First fix after resuming establishes a new baseline without skipping a leg.
    const budget = prev
      ? Math.min(dt, 30) * 16 + 20
      : this.lastFixAt !== undefined
        ? Math.max(35, ((time - this.lastFixAt) / 1000) * 16 + 20)
        : 35;
    this.lastFixAt = time;
    const projection = project(
      point,
      stage.points,
      Math.max(0, this.meters - 20),
      Math.min(
        stage.length,
        Math.max(this.meters, this.candidateMeters) + budget,
      ),
    );
    if (projection.distance > 35) {
      this.evidence = undefined;
      this.gpsEvidence = undefined;
      this.boardingFix = undefined;
      this.candidateMeters = this.meters;
      return;
    }
    const speed = prev && dt > 0 && dt <= 15 ? displacement / dt : 0;
    if (stage.kind === "ride" && !this.boarded) {
      const anchor = this.boardingFix;
      if (!anchor) {
        this.boardingFix = {
          point: { ...point },
          time,
          meters: projection.meters,
        };
        return;
      }
      const elapsed = (time - anchor.time) / 1000;
      // Frequent GPS callbacks must accumulate movement rather than reset the
      // evidence whenever one individual step is shorter than three metres.
      if (elapsed < 3) return;
      this.boardingFix = {
        point: { ...point },
        time,
        meters: projection.meters,
      };
      const boardingSpeed = distanceMeters(anchor.point, point) / elapsed;
      const bus = vehicles.find(
        (v) =>
          stage.routes.includes(v.lineId) &&
          (v.motion?.status === "moving" || (v.speed || 0) > 3) &&
          distanceMeters(v, point) < 20,
      );
      const moving =
        elapsed <= 15 &&
        projection.meters > 25 &&
        projection.meters > anchor.meters + 3;
      if (moving && boardingSpeed >= 3.2) {
        if (!this.gpsEvidence) this.gpsEvidence = { since: time, samples: 0 };
        this.gpsEvidence.samples++;
      } else this.gpsEvidence = undefined;
      if (moving && bus && boardingSpeed >= 1.8) {
        this.candidateMeters = projection.meters;
        const key = bus.id;
        if (!this.evidence || this.evidence.bus !== key)
          this.evidence = { since: time, samples: 1, bus: key };
        else this.evidence.samples++;
        if (this.evidence.samples >= 3 && time - this.evidence.since >= 6000)
          this.boarded = true;
      } else {
        this.evidence = undefined;
      }
      if (moving && boardingSpeed >= 3.2)
        this.candidateMeters = projection.meters;
      else if (!bus) this.candidateMeters = this.meters;
      if (
        this.gpsEvidence &&
        this.gpsEvidence.samples >= 3 &&
        time - this.gpsEvidence.since >= 10000
      )
        this.boarded = true;
      if (!this.boarded) return;
    }
    this.meters = Math.max(this.meters, projection.meters);
    const end = stage.points[stage.points.length - 1];
    const nearEnd =
      stage.length - this.meters < 28 && distanceMeters(point, end) < 25;
    // Require two independent fixes and a slowdown before changing a ride to a walk.
    this.endpointSamples =
      nearEnd && (stage.kind === "walk" || speed < 2.5)
        ? this.endpointSamples + 1
        : 0;
    if (this.endpointSamples >= 2) {
      this.index++;
      this.meters = 0;
      this.candidateMeters = 0;
      this.boarded = false;
      this.evidence = undefined;
      this.gpsEvidence = undefined;
      this.boardingFix = undefined;
      this.endpointSamples = 0;
      if (this.index >= this.stages.length) this.finished = true;
    }
  }
  view(availableWidth: number): JourneyProgressView {
    const width =
      this.stages.length <= 3
        ? availableWidth
        : Math.max(availableWidth, this.total);
    const scale = width / Math.max(1, this.total);
    const current = this.stages[this.index];
    const fraction = current ? displayFraction(current, this.meters) : 1;
    const done = this.finished
      ? this.total
      : current.offset + current.width * fraction;
    const nodes: JourneyProgressView["nodes"] = [];
    this.stages.forEach((s, i) => {
      if (!i)
        nodes.push({
          id: "start",
          x: 0,
          name: s.from,
          major: true,
          reached: true,
          edge: "start",
          transfer: false,
        });
      s.stops.forEach((stop, j) => {
        const x = s.offset + (s.width * (j + 1)) / (s.stops.length + 1);
        nodes.push({
          id: `${i}-${j}`,
          x: x * scale,
          name: stop.name,
          major: false,
          reached: x <= done,
          edge: "",
          transfer: false,
        });
      });
      const x = s.offset + s.width;
      nodes.push({
        id: `end-${i}`,
        x: x * scale,
        name: s.to,
        major: true,
        reached: x <= done,
        edge: i === this.stages.length - 1 ? "end" : "",
        transfer: s.kind === "ride" && this.stages[i + 1]?.kind === "ride",
      });
    });
    const nextStop = current?.stops.find((s) => s.meters > this.meters + 8);
    return {
      width,
      segments: this.stages.map((s, i) => {
        const fill = Math.max(
          0,
          Math.min(
            1,
            this.finished || i < this.index
              ? 1
              : i === this.index
                ? fraction
                : 0,
          ),
        );
        const width = s.width * scale;
        return {
          id: i,
          x: s.offset * scale,
          width,
          walk: s.kind === "walk",
          fill,
          fillWidth: width * fill,
        };
      }),
      nodes,
      position: done * scale,
      phase: this.finished
        ? "arrived"
        : current.kind === "walk"
          ? "walking"
          : this.boarded
            ? "riding"
            : "waiting",
      next: this.finished
        ? "已到达目的地"
        : current.kind === "ride" && this.boarded
          ? `下一站：${nextStop?.name || current.to}`
          : current.kind === "ride"
            ? `候车：${current.from}`
            : `步行前往${current.to}`,
      boardingId: this.boardIds[this.index] || "",
      routes: current?.routes || [],
      approaching:
        !!current &&
        current.kind === "ride" &&
        this.boarded &&
        current.length - this.meters < 120,
    };
  }
}
