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
      arrowLine: true,
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
export function tracePolylines(parts: TracePart[]): ShuttlePolyline[] {
  const lines = parts
    .filter((p) => p.points.length > 1)
    .map((p) => ({
      points: p.points,
      width: p.width,
      color: p.color,
      borderWidth: 0,
      dottedLine: p.dotted,
      arrowLine: !p.dotted,
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
  ): void {
    this.stop();
    const generation = this.generation,
      ctx = this.context;
    const duration = Math.min(
      2650,
      Math.max(1650, 1450 + Math.max(0, ...parts.map((p) => p.total)) * 0.55),
    );
    // Project and measure once; per-frame work is a prefix of each screen path.
    const traces = parts.map((p) => ({
      ...p,
      screen: p.points.map(project),
      lengths: p.points.slice(1).map((q, i) => distanceMeters(p.points[i], q)),
    }));
    let started: number | undefined;
    const tick = (time: number): void => {
      if (generation !== this.generation) return;
      if (started === undefined) started = time;
      const t = Math.max(0, Math.min(1, (time - started) / duration));
      const progress = 1 - Math.pow(1 - t, 2.5);
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const paths = traces.map((p) => {
        let remaining = Math.max(
          0,
          Math.min(p.length, progress * p.total - p.start),
        );
        const points = remaining > 0 ? [p.screen[0]] : [];
        for (let i = 0; remaining > 0 && i < p.lengths.length; i++) {
          const a = p.screen[i],
            b = p.screen[i + 1],
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
      if (t < 1) this.frame = this.canvas.requestAnimationFrame(tick);
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
