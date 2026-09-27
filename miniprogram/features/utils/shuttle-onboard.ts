import type { GeoPoint, ShuttleVehicle } from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import { headingDegrees } from "./shuttle-screen";

type Fix = GeoPoint & { accuracy?: number };
interface Observation {
  point: Fix;
  time: number;
  fetchedAt: number;
  vehicles: ShuttleVehicle[];
}
interface Evidence {
  id: string;
  line: string;
  since: number;
  samples: number;
  meters: number;
}

/** Independent of the selected route: only fresh, unambiguous co-motion counts. */
export class ShuttleOnboardDetector {
  private previous?: Observation;
  private evidence?: Evidence;
  private cooldownUntil = 0;

  pause() {
    this.previous = undefined;
    this.evidence = undefined;
  }

  switched(time: number) {
    this.pause();
    this.cooldownUntil = time + 30000;
  }

  update(
    point: Fix,
    time: number,
    fetchedAt: number,
    vehicles: ShuttleVehicle[],
  ): ShuttleVehicle | undefined {
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      !Number.isFinite(point.accuracy) ||
      point.accuracy! < 0 ||
      point.accuracy! > 25 ||
      !Number.isFinite(time) ||
      !Number.isFinite(fetchedAt) ||
      time < this.cooldownUntil
    ) {
      this.pause();
      return;
    }
    const prev = this.previous;
    // Multiple GPS fixes against one upstream observation are not new evidence.
    if (prev && (time <= prev.time || fetchedAt <= prev.fetchedAt)) {
      if (time - prev.time > 10000) this.pause();
      return;
    }
    this.previous = { point: { ...point }, time, fetchedAt, vehicles };
    if (!prev) return;
    const dt = (time - prev.time) / 1000;
    const travel = distanceMeters(prev.point, point);
    if (dt < 1 || dt > 10 || travel / dt < 2.5 || travel / dt > 16) {
      this.evidence = undefined;
      return;
    }
    const heading = headingDegrees(prev.point, point);
    const candidates = vehicles.filter((bus) => {
      const before = prev.vehicles.find(
        (v) => v.id === bus.id && v.lineId === bus.lineId,
      );
      if (
        !before ||
        !bus.lineId ||
        bus.motion?.reset ||
        ["uncertain", "stationary"].includes(bus.motion?.status || "") ||
        distanceMeters(point, bus) > 20 ||
        distanceMeters(prev.point, before) > 20
      )
        return false;
      const moved = distanceMeters(before, bus);
      const angle = Math.abs(
        ((headingDegrees(before, bus) - heading + 540) % 360) - 180,
      );
      // Compare displacement, not undocumented upstream speed units.
      const expected = {
        latitude: before.latitude + point.latitude - prev.point.latitude,
        longitude: before.longitude + point.longitude - prev.point.longitude,
      };
      return (
        moved / dt >= 2 &&
        angle < 30 &&
        distanceMeters(expected, bus) <= Math.max(10, travel * 0.4)
      );
    });
    // Parallel buses cannot be distinguished reliably from GPS alone.
    if (candidates.length !== 1) {
      this.evidence = undefined;
      return;
    }
    const bus = candidates[0];
    if (this.evidence?.id !== bus.id || this.evidence.line !== bus.lineId)
      this.evidence = {
        id: bus.id,
        line: bus.lineId,
        since: prev.time,
        samples: 0,
        meters: 0,
      };
    this.evidence.samples++;
    this.evidence.meters += travel;
    if (
      this.evidence.samples < 5 ||
      time - this.evidence.since < 15000 ||
      this.evidence.meters < 65
    )
      return;
    // Use the user's current position/direction, not the map animation's delayed position.
    return { ...bus, ...point, direction: heading, motion: undefined };
  }
}
