import { distanceMeters } from "../../utils/shuttle-geo";
import type {
  GeoPoint,
  ShuttlePolyline,
  ShuttleRoute,
} from "../../types/shuttle";
import type { ShuttlePlan } from "./shuttle-routing";

export function routePalette(routes: ShuttleRoute[]): Map<string, string> {
  const colors = new Map<string, string>(),
    used = new Set<string>();
  const alternatives = [
    "#2563EB",
    "#087F6B",
    "#9345AC",
    "#C96716",
    "#C83761",
    "#607C20",
    "#5264B8",
    "#087D9A",
    "#98552E",
    "#7D5F9F",
  ];
  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (colors.has(route.id)) continue;
    const original = route.color.toUpperCase();
    const color = used.has(original)
      ? alternatives.find((c) => !used.has(c))!
      : original;
    colors.set(route.id, color);
    used.add(color);
  }
  return colors;
}

/** Clip by distance so short and long edges reveal at the same speed. */
export function revealPoints(points: GeoPoint[], progress: number): GeoPoint[] {
  if (progress <= 0 || points.length < 2) return [];
  if (progress >= 1) return points;
  const lengths = points.slice(1).map((p, i) => distanceMeters(points[i], p));
  let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
  const result = [points[0]];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining >= lengths[i]) {
      result.push(points[i + 1]);
      remaining -= lengths[i];
    } else {
      const t = remaining / lengths[i],
        a = points[i],
        b = points[i + 1];
      result.push({
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        latitude: a.latitude + (b.latitude - a.latitude) * t,
      });
      break;
    }
  }
  return result;
}

export function planPolylines(
  plans: ShuttlePlan[],
  selectedId: string,
  progress: number,
  colors = routePalette(plans.map((plan) => plan.route)),
): ShuttlePolyline[] {
  const lines = [...plans]
    .sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))
    .map((plan) => ({
      points: revealPoints(plan.points, progress),
      color: colors.get(plan.route.id) || plan.route.color,
      width: plan.id === selectedId ? 5 : 3,
      dottedLine: false,
      borderWidth: 0,
      arrowLine: false,
    }))
    .filter((line) => line.points.length > 1);
  return [
    ...lines.map((line) => ({
      ...line,
      color: "#FFFFFF",
      width: line.width + 2,
      arrowLine: false,
    })),
    ...lines,
  ];
}

export interface TracePart {
  points: GeoPoint[];
  color: string;
  width: number;
  dotted: boolean;
  start: number;
  length: number;
  total: number;
}
export function orderedTraces(
  parts: {
    points: GeoPoint[];
    color: string;
    width: number;
    dotted: boolean;
  }[],
): TracePart[] {
  let offset = 0;
  const result = parts
    .filter((p) => p.points.length > 1)
    .map((p) => {
      const length = p.points
        .slice(1)
        .reduce((n, q, i) => n + distanceMeters(p.points[i], q), 0);
      const part = { ...p, start: offset, length, total: 0 };
      offset += length;
      return part;
    });
  return result.map((p) => ({ ...p, total: offset }));
}
export function tripTraces(
  plans: ShuttlePlan[],
  selectedId: string,
  walking: GeoPoint[] = [],
  colors = routePalette(plans.map((p) => p.route)),
): TracePart[] {
  const length = (points: GeoPoint[]): number =>
    points
      .slice(1)
      .reduce((sum, p, i) => sum + distanceMeters(points[i], p), 0);
  return [...plans]
    .sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId))
    .flatMap((plan) => {
      const ride = length(plan.points),
        walk = plan.id === selectedId ? length(walking) : 0;
      const part = {
        points: plan.points,
        color: colors.get(plan.route.id) || plan.route.color,
        width: plan.id === selectedId ? 5 : 3,
        dotted: false,
        start: 0,
        length: ride,
        total: ride + walk,
      };
      return walk > 0
        ? [
            part,
            {
              ...part,
              points: walking,
              width: 3,
              dotted: true,
              start: ride,
              length: walk,
            },
          ]
        : [part];
    });
}
export function tracePolylines(
  parts: TracePart[],
  progress = 1,
  stableSlots = false,
): ShuttlePolyline[] {
  const lines = parts
    .map((p) => ({
      ...p,
      points: revealPoints(
        p.points,
        p.length
          ? Math.max(0, Math.min(1, (progress * p.total - p.start) / p.length))
          : 0,
      ),
    }))
    .filter((p) => stableSlots || p.points.length > 1)
    .map((p) => ({
      points: p.points,
      width: p.width,
      color: p.color,
      borderWidth: 0,
      dottedLine: p.dotted,
      arrowLine: false,
    }));
  return [
    ...lines.map((p) => ({
      ...p,
      color: "#FFFFFF",
      width: p.width + 2,
      arrowLine: false,
    })),
    ...lines,
  ];
}
// A single transparent canvas owns all animation frames. The native map receives
// only the completed geometry, avoiding bridge updates that recreate map overlays.
export interface TraceContext {
  lineWidth: number;
  strokeStyle: string;
  lineCap: string;
  lineJoin: string;
  globalCompositeOperation: string;
  fillStyle: string;
  save(): void;
  restore(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setLineDash(values: number[]): void;
}
export interface TraceCanvas {
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
}
export class ShuttleRouteReveal {
  private frame?: number;
  private generation = 0;
  private walking = new Map<string, { part: TracePart; started?: number }>();
  private journey?: {
    part: TracePart;
    started?: number;
    duration: number;
    lengths: number[];
  }[];
  /** Ready geometry follows the itinerary; each selection gets fresh clocks. */
  updateJourney(parts: TracePart[]): void {
    const walks = parts.filter((part) => part.dotted).length;
    const rides = parts.length - walks;
    this.journey = parts.map((part, index) => {
      const previous = this.journey?.[index];
      return {
        part,
        started: previous?.started,
        duration: part.dotted ? 800 / walks : 1800 / rides,
        lengths: part.points
          .slice(1)
          .map((q, i) => distanceMeters(part.points[i], q)),
      };
    });
  }
  private walkingReady = true;
  /** Walking responses have their own clocks; they never restart the bus trace. */
  updateWalking(parts: TracePart[], ready: boolean): void {
    if (this.journey) {
      let index = 0;
      this.journey = this.journey.map((entry) => {
        if (!entry.part.dotted) return entry;
        const part = parts[index++] || entry.part;
        return {
          ...entry,
          part,
          lengths: part.points
            .slice(1)
            .map((q, i) => distanceMeters(part.points[i], q)),
        };
      });
      return;
    }
    const next = new Map<string, { part: TracePart; started?: number }>();
    for (const part of parts) {
      const key = JSON.stringify([part.points, part.color]);
      next.set(key, this.walking.get(key) || { part });
    }
    this.walking = next;
    this.walkingReady = ready;
  }
  constructor(
    private canvas: TraceCanvas,
    private context: TraceContext,
  ) {}
  start(
    parts: TracePart[],
    project: (p: GeoPoint) => { x: number; y: number },
    width: number,
    height: number,
    complete: () => void,
    cameraFrame?: () => boolean | void,
    waitingForWalk = false,
    revealed = false,
    markerMasks?: () => { point: GeoPoint; radius: number }[],
  ): void {
    this.stop();
    this.journey = undefined;
    this.walking.clear();
    this.walkingReady = !waitingForWalk;
    const generation = this.generation,
      ctx = this.context;
    const duration = 2200;
    // Measure geographic distances once. Projection stays live while the camera moves.
    const traces = parts.map((p) => ({
      ...p,
      lengths: p.points.slice(1).map((q, i) => distanceMeters(p.points[i], q)),
    }));
    let started: number | undefined;
    const tick = (time: number): void => {
      if (generation !== this.generation) return;
      if (started === undefined) started = time - (revealed ? duration : 0);
      const t = Math.max(0, Math.min(1, (time - started) / duration));
      const progress = t;
      const cameraReady = cameraFrame?.() !== false;
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let walkingDone = this.walkingReady;
      const walks = [...this.walking.values()].map((entry) => {
        if (entry.started === undefined) entry.started = time;
        const ratio = Math.min(1, (time - entry.started) / 900);
        if (ratio < 1) walkingDone = false;
        const p = entry.part;
        return {
          ...p,
          start: 0,
          total: p.length,
          progress: ratio,
          lengths: p.points
            .slice(1)
            .map((q, i) => distanceMeters(p.points[i], q)),
        };
      });
      let journeyDone = true;
      let nextStart: number | undefined;
      const journeyParts = this.journey?.map((entry, index) => {
        const part = entry.part;
        const segmentDuration = entry.duration;
        if (
          entry.started === undefined &&
          (index === 0 || nextStart !== undefined)
        )
          entry.started = nextStart ?? time;
        const ratio =
          entry.started === undefined
            ? 0
            : Math.max(
                0,
                Math.min(1, (time - entry.started) / segmentDuration),
              );
        nextStart = ratio >= 1 ? entry.started! + segmentDuration : undefined;
        if (ratio < 1) journeyDone = false;
        return {
          ...part,
          start: 0,
          total: part.length,
          progress: ratio,
          lengths: entry.lengths,
        };
      });
      const paths = (
        journeyParts || [...traces.map((p) => ({ ...p, progress })), ...walks]
      ).map((p) => {
        const screen = p.points.map(project);
        let remaining = Math.max(
          0,
          Math.min(p.length, p.progress * p.total - p.start),
        );
        const points = remaining > 0 ? [screen[0]] : [];
        for (let i = 0; remaining > 0 && i < p.lengths.length; i++) {
          const a = screen[i],
            b = screen[i + 1],
            fraction =
              p.lengths[i] > 0 ? Math.min(1, remaining / p.lengths[i]) : 1;
          points.push({
            x: a.x + (b.x - a.x) * fraction,
            y: a.y + (b.y - a.y) * fraction,
          });
          remaining -= p.lengths[i];
        }
        return { ...p, points };
      });
      for (const casing of [true, false])
        for (const path of paths) {
          if (path.points.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(path.points[0].x, path.points[0].y);
          path.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.lineWidth = path.width + (casing ? 2 : 0);
          ctx.strokeStyle = casing ? "#FFFFFF" : path.color;
          ctx.setLineDash(path.dotted ? [3, 6] : []);
          ctx.stroke();
        }
      // Native markers live inside the map, beneath its sibling canvas. Punch out
      // only their visible circular footprints so traces never paint over them.
      // Vehicle footprints use the same playback clock as native moveAlong.
      if (markerMasks) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "#000000";
        for (const mask of markerMasks()) {
          const p = project(mask.point);
          ctx.beginPath();
          ctx.arc(p.x, p.y, mask.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if ((this.journey ? !journeyDone : t < 1 || !walkingDone) || !cameraReady)
        this.frame = this.canvas.requestAnimationFrame(tick);
      else {
        this.frame = undefined;
        complete();
      }
    };
    this.frame = this.canvas.requestAnimationFrame(tick);
  }
  stop(): void {
    this.generation++;
    if (this.frame !== undefined) this.canvas.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
}
