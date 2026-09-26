import type {
  GeoPoint,
  ShuttleMarker,
  ShuttleVehicle,
} from "../../types/shuttle";
import { distanceMeters, vehicleMarker } from "../../utils/shuttle-geo";
import { ShuttlePlanner } from "./shuttle-routing";
interface Motion {
  bus: ShuttleVehicle;
  id: number;
  path: GeoPoint[];
  lengths: number[];
  total: number;
  start: number;
  duration: number;
  outlier: GeoPoint | null;
}
export class ShuttleMapMotion {
  private vehicles = new Map<string, Motion>();
  private ids = new Map<string, number>();
  private nextId = 10000;
  private lastTimestamp = 0;
  private nativeAlong = true;
  constructor(
    private context: WechatMiniprogram.MapContext,
    private planner: ShuttlePlanner,
    private reducedMotion: boolean,
  ) {}
  setPlanner(planner: ShuttlePlanner): void {
    this.planner = planner;
  }
  markerId(busId: string): number {
    return this.ids.get(busId) || 0;
  }
  busForMarker(id: number): string | null {
    return (
      [...this.ids].find(
        (entry) => entry[1] === id || entry[1] + 100000 === id,
      )?.[0] || null
    );
  }
  positions(
    now = Date.now(),
  ): { bus: ShuttleVehicle; point: GeoPoint; id: number }[] {
    return [...this.vehicles.values()].map((motion) => ({
      bus: motion.bus,
      point: this.position(motion, now),
      id: motion.id,
    }));
  }
  private position(motion: Motion, now: number): GeoPoint {
    if (motion.path.length < 2 || !motion.total)
      return motion.path[motion.path.length - 1];
    const progress = Math.min(
        1,
        Math.max(0, (now - motion.start) / Math.max(1, motion.duration)),
      ),
      distance = progress * motion.total;
    let i = 1;
    while (i < motion.lengths.length - 1 && motion.lengths[i] < distance)
      i += 1;
    const span = motion.lengths[i] - motion.lengths[i - 1],
      t = span ? (distance - motion.lengths[i - 1]) / span : 1;
    const a = motion.path[i - 1],
      b = motion.path[i];
    return {
      longitude: a.longitude + (b.longitude - a.longitude) * t,
      latitude: a.latitude + (b.latitude - a.latitude) * t,
    };
  }
  update(buses: ShuttleVehicle[], fetchedAt: number, stale: boolean): void {
    const now = Date.now(),
      present = new Set(buses.map((b) => b.id));
    const remove: number[] = [];
    for (const [busId, motion] of this.vehicles)
      if (!present.has(busId)) {
        remove.push(motion.id, motion.id + 100000);
        this.vehicles.delete(busId);
      }
    if (remove.length) this.context.removeMarkers({ markerIds: remove });
    const moved = fetchedAt > this.lastTimestamp;
    const duration = this.reducedMotion ? 1 : 3000;
    // Stable IDs/order; vehicles never repel, swap or shrink when they cross.
    buses
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((bus) => {
        let existing = this.vehicles.get(bus.id);
        if (!existing) {
          if (!this.ids.has(bus.id)) this.ids.set(bus.id, this.nextId++);
          const id = this.ids.get(bus.id)!;
          existing = {
            bus,
            id,
            path: [bus],
            lengths: [0],
            total: 0,
            start: now,
            duration,
            outlier: null,
          };
          this.vehicles.set(bus.id, existing);
          this.context.addMarkers({
            markers: [vehicleMarker(bus, id), this.arrow(bus, id + 100000)],
          });
          return;
        }
        existing.bus = bus;
        if (!moved || stale) return; // Never restart animation from an unchanged/stale upstream snapshot.
        const from = this.position(existing, now),
          displacement = distanceMeters(from, bus);
        if (
          displacement > 250 &&
          (!existing.outlier || distanceMeters(existing.outlier, bus) > 70)
        ) {
          existing.outlier = bus;
          return;
        }
        const relocation = displacement > 250;
        existing.outlier = null;
        const path = relocation
          ? [bus]
          : this.planner.motionPath(bus.lineId, from, bus);
        const lengths = [0];
        for (let i = 1; i < path.length; i += 1)
          lengths.push(lengths[i - 1] + distanceMeters(path[i - 1], path[i]));
        Object.assign(existing, {
          path,
          lengths,
          total: lengths[lengths.length - 1],
          start: now,
          duration,
        });
        if (relocation || this.reducedMotion) {
          this.context.addMarkers({
            markers: [
              vehicleMarker(bus, existing.id),
              this.arrow(bus, existing.id + 100000),
            ],
          });
        } else if (path.length > 1 && existing.total > 0.5) {
          this.move(existing.id, path, duration, false);
          this.move(existing.id + 100000, path, duration, true);
        }
      });
    if (moved) this.lastTimestamp = fetchedAt;
  }
  private arrow(bus: ShuttleVehicle, id: number): ShuttleMarker {
    return {
      id,
      longitude: bus.longitude,
      latitude: bus.latitude,
      iconPath: "/features/assets/shuttle/heading.png",
      width: 44,
      height: 44,
      anchor: { x: 0.5, y: 0.5 },
      zIndex: 900,
      rotate: bus.direction || 0,
    };
  }
  private move(
    id: number,
    path: GeoPoint[],
    duration: number,
    autoRotate: boolean,
  ): void {
    if (this.nativeAlong && typeof this.context.moveAlong === "function") {
      this.context.moveAlong({
        markerId: id,
        path,
        duration,
        autoRotate,
        // The generated 5.x typings incorrectly declare precision as IAnyObject; native API uses metres.
        precision: 1 as unknown as WechatMiniprogram.IAnyObject,
        fail: () => {
          this.nativeAlong = false;
          this.fallback(id, path, duration, autoRotate);
        },
      });
    } else this.fallback(id, path, duration, autoRotate);
  }
  private fallback(
    id: number,
    path: GeoPoint[],
    duration: number,
    autoRotate: boolean,
  ): void {
    const owner = [...this.vehicles.values()].find(
      (motion) => motion.id === id || motion.id + 100000 === id,
    );
    if (owner && owner.path.length > 2) {
      const direct = [owner.path[0], owner.path[owner.path.length - 1]],
        total = distanceMeters(direct[0], direct[1]);
      Object.assign(owner, { path: direct, lengths: [0, total], total });
    }
    // Older runtimes still animate natively rather than high-frequency marker-array replacement.
    this.context.translateMarker({
      markerId: id,
      destination: path[path.length - 1],
      duration,
      autoRotate,
      rotate: 0,
    });
  }
  freeze(): void {
    const now = Date.now();
    for (const motion of this.vehicles.values()) {
      if (motion.total === 0) continue;
      const point = this.position(motion, now);
      Object.assign(motion, {
        path: [point],
        lengths: [0],
        total: 0,
        start: now,
        duration: 1,
      });
      this.context.addMarkers({
        markers: [
          vehicleMarker({ ...motion.bus, ...point }, motion.id),
          this.arrow({ ...motion.bus, ...point }, motion.id + 100000),
        ],
      });
    }
  }
  clear(): void {
    const markerIds = [...this.vehicles.values()].flatMap((m) => [
      m.id,
      m.id + 100000,
    ]);
    if (markerIds.length) this.context.removeMarkers({ markerIds });
    this.vehicles.clear();
    this.lastTimestamp = 0;
  }
}
