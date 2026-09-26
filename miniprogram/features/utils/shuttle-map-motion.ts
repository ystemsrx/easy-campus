import type { GeoPoint, ShuttleVehicle } from "../../types/shuttle";
import { distanceMeters, vehicleMarker } from "../../utils/shuttle-geo";
import { headingDegrees } from "./shuttle-screen";
import type { ShuttlePlanner } from "./shuttle-routing";
interface Motion {
  bus: ShuttleVehicle;
  id: number;
  path: GeoPoint[];
  lengths: number[];
  total: number;
  start: number;
  duration: number;
  stamp: number;
  epoch: number;
  segment: number;
  seenAt: number;
  timeline: { startsAt: number; duration: number; points: GeoPoint[] }[];
  clockOffset: number;
  delay: number;
  timer?: ReturnType<typeof setTimeout>;
}
function geometry(path: GeoPoint[]): { lengths: number[]; total: number } {
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(lengths[i - 1] + distanceMeters(path[i - 1], path[i]));
  return { lengths, total: lengths[lengths.length - 1] };
}
function remaining(path: GeoPoint[], fraction: number): GeoPoint[] {
  const { lengths, total } = geometry(path);
  let left = total * Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < path.length; i++) {
    const d = lengths[i] - lengths[i - 1];
    if (left < d) {
      const f = d ? left / d : 0;
      return [
        {
          longitude:
            path[i - 1].longitude +
            (path[i].longitude - path[i - 1].longitude) * f,
          latitude:
            path[i - 1].latitude +
            (path[i].latitude - path[i - 1].latitude) * f,
        },
        ...path.slice(i),
      ];
    }
    left -= d;
  }
  return [path[path.length - 1]];
}
/** One native marker owns both bus and arrow; server-prepared paths are replayed without client route solving. */
export class ShuttleMapMotion {
  private vehicles = new Map<string, Motion>();
  private ids = new Map<string, number>();
  private nextId = 10000;
  constructor(
    private context: WechatMiniprogram.MapContext,
    _planner: ShuttlePlanner,
    private reducedMotion: boolean,
  ) {}
  setPlanner(_planner: ShuttlePlanner): void {}
  markerId(id: string): number {
    return this.ids.get(id) || 0;
  }
  busForMarker(id: number): string | null {
    return [...this.ids].find(([, value]) => value === id)?.[0] || null;
  }
  positions(
    now = Date.now(),
  ): { bus: ShuttleVehicle; point: GeoPoint; id: number }[] {
    return [...this.vehicles.values()].map((m) => ({
      bus: m.bus,
      point: remaining(m.path, (now - m.start) / m.duration)[0],
      id: m.id,
    }));
  }
  update(
    buses: ShuttleVehicle[],
    fetchedAt: number,
    stale: boolean,
    serverTime = fetchedAt,
  ): void {
    const now = Date.now();
    const present = new Set(buses.map((b) => b.id));
    for (const [id, m] of this.vehicles) {
      if (!present.has(id) && now - m.seenAt > 15000) {
        m.epoch++;
        if (m.timer) clearTimeout(m.timer);
        this.context.removeMarkers({ markerIds: [m.id] });
        this.vehicles.delete(id);
      }
    }
    for (const bus of buses) {
      const delay = bus.motion?.playbackDelay ?? 0;
      const segments = bus.motion?.history?.length
        ? bus.motion.history
        : bus.motion
          ? [
              {
                startsAt: bus.motion.startsAt,
                duration: bus.motion.duration,
                points: bus.motion.points,
              },
            ]
          : [];
      const timeline = segments
        .filter(
          (s) =>
            Number.isFinite(s.startsAt) && s.duration > 0 && s.points.length,
        )
        .slice()
        .sort((a, b) => a.startsAt - b.startsAt);
      const stamp = Math.max(
        fetchedAt,
        ...timeline.map((s) => s.startsAt + s.duration),
      );
      let m = this.vehicles.get(bus.id);
      if (!m) {
        if (!this.ids.has(bus.id)) this.ids.set(bus.id, this.nextId++);
        const at = serverTime - delay;
        const first =
          timeline.find((s) => s.startsAt + s.duration > at) ||
          timeline[timeline.length - 1];
        const point = first
          ? remaining(first.points, (at - first.startsAt) / first.duration)[0]
          : bus;
        m = {
          bus,
          id: this.ids.get(bus.id)!,
          path: [point],
          ...geometry([point]),
          start: now,
          duration: 1,
          stamp: 0,
          epoch: 0,
          segment: 0,
          seenAt: now,
          timeline: [],
          clockOffset: serverTime - now,
          delay,
        };
        this.vehicles.set(bus.id, m);
        this.context.addMarkers({
          markers: [vehicleMarker({ ...bus, ...point }, m.id)],
        });
      }
      m.seenAt = now;
      if (stale || stamp <= m.stamp) continue;
      if (
        !bus.motion &&
        distanceMeters(m.bus, bus) > 0.5 &&
        distanceMeters(m.bus, bus) <= 250
      ) {
        timeline.push({
          startsAt: serverTime,
          duration: 3000,
          points: [m.path[m.path.length - 1], bus],
        });
      }
      m.bus = bus;
      m.stamp = stamp;
      m.delay = delay;
      // A stable playback clock avoids re-starting every animation on each packet.
      const drift = serverTime - now - m.clockOffset;
      if (!bus.motion || Math.abs(drift) > 2000) m.clockOffset += drift;
      m.timeline = timeline;
      if (bus.motion?.reset) {
        m.epoch++;
        if (m.timer) clearTimeout(m.timer);
        m.timer = undefined;
        m.segment = 0;
        m.timeline = [];
        const point = { longitude: bus.longitude, latitude: bus.latitude };
        Object.assign(m, {
          path: [point],
          ...geometry([point]),
          start: now,
          duration: 1,
        });
        this.context.addMarkers({
          markers: [vehicleMarker({ ...bus, ...point }, m.id)],
        });
      } else if (!m.segment) this.play(m);
    }
  }
  private play(m: Motion): void {
    if (this.vehicles.get(m.bus.id) !== m || m.segment) return;
    if (m.timer) clearTimeout(m.timer);
    m.timer = undefined;
    const now = Date.now(),
      at = now + m.clockOffset - m.delay;
    const segment = m.timeline.find((s) => s.startsAt + s.duration > at + 5);
    if (!segment) return; // Never extrapolate beyond the latest accepted observation.
    if (segment.startsAt > at + 5) {
      m.timer = setTimeout(() => {
        m.timer = undefined;
        this.play(m);
      }, segment.startsAt - at);
      return;
    }
    const tail = remaining(
      segment.points,
      (at - segment.startsAt) / segment.duration,
    );
    const from = remaining(m.path, (now - m.start) / m.duration)[0];
    const path = [from, ...tail.slice(1)];
    if (tail.length === 1) path.push(tail[0]);
    const clean = path.filter(
      (p, i) => !i || distanceMeters(p, path[i - 1]) > 0.2,
    );
    Object.assign(m, {
      path: clean,
      ...geometry(clean),
      start: now,
      duration: Math.max(16, segment.startsAt + segment.duration - at),
      segment: 1,
    });
    const epoch = ++m.epoch;
    const done = (): void => {
      if (this.vehicles.get(m.bus.id) !== m || m.epoch !== epoch) return;
      const end = clean[clean.length - 1];
      Object.assign(m, {
        path: [end],
        ...geometry([end]),
        start: Date.now(),
        duration: 1,
        segment: 0,
        timer: undefined,
      });
      this.play(m);
    };
    // Native success can mean command accepted on some hosts. The observation
    // clock, not that callback, owns completion and prevents concurrent moves.
    m.timer = setTimeout(done, m.duration);
    if (m.total < 0.5) return;
    if (this.context.moveAlong && !this.reducedMotion) {
      this.context.moveAlong({
        markerId: m.id,
        path: clean,
        duration: m.duration,
        autoRotate: true,
        fail: () => {
          if (m.epoch !== epoch) return;
          this.context.translateMarker({
            markerId: m.id,
            destination: clean[clean.length - 1],
            duration: m.duration,
            autoRotate: true,
            rotate: headingDegrees(clean[0], clean[clean.length - 1]),
          });
        },
      } as unknown as WechatMiniprogram.MoveAlongOption);
      return;
    }
    const advance = (i: number): void => {
      if (
        this.vehicles.get(m.bus.id) !== m ||
        m.epoch !== epoch ||
        i >= clean.length
      )
        return;
      const a = clean[i - 1],
        b = clean[i];
      this.context.translateMarker({
        markerId: m.id,
        destination: b,
        autoRotate: true,
        rotate: headingDegrees(a, b),
        duration: this.reducedMotion
          ? 1
          : Math.max(
              16,
              (m.duration * (m.lengths[i] - m.lengths[i - 1])) / m.total,
            ),
        animationEnd: () => advance(i + 1),
      });
    };
    advance(1);
  }
  freeze(): void {
    for (const m of this.vehicles.values()) {
      if (m.timer) clearTimeout(m.timer);
      m.timer = undefined;
      m.timeline = [];
      if (!m.segment) continue;
      const tail = remaining(m.path, (Date.now() - m.start) / m.duration);
      const p = tail[0];
      const heading =
        tail.length > 1
          ? headingDegrees(tail[0], tail[1])
          : m.bus.motion?.heading || 0;
      m.epoch++;
      m.segment = 0;

      Object.assign(m, {
        path: [p],
        lengths: [0],
        total: 0,
        start: Date.now(),
        duration: 1,
      });
      this.context.translateMarker({
        markerId: m.id,
        destination: p,
        duration: 1,
        autoRotate: false,
        rotate: heading,
      });
    }
  }
  clear(): void {
    for (const m of this.vehicles.values()) {
      m.epoch++;
      if (m.timer) clearTimeout(m.timer);
    }
    if (this.vehicles.size)
      this.context.removeMarkers({
        markerIds: [...this.vehicles.values()].map((m) => m.id),
      });
    this.vehicles.clear();
  }
}
