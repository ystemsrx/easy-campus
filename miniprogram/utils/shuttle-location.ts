import {
  captureSessionLease,
  isSessionLeaseCurrent,
  type SessionLease,
} from "../store/session";
import { getShuttleConsent, uploadShuttleLocations } from "../services/shuttle";
import type { GeoPoint, LocationSample, SampleReceipt } from "../types/shuttle";

export type LocationResult = GeoPoint & Record<string, unknown>;
const OUTBOX_PREFIX = "easy-swu:shuttle:outbox:";
const MAX_PENDING = 4000;
const deletionKey = (): string =>
  `easy-swu:shuttle:deleting:${captureSessionLease()?.userId || "none"}`;
export function isShuttleDeletionPending(): boolean {
  return wx.getStorageSync(deletionKey()) === true;
}
export function setShuttleDeletionPending(pending: boolean): void {
  if (pending) wx.setStorageSync(deletionKey(), true);
  else wx.removeStorageSync(deletionKey());
}
export function hasLocationPermission(): Promise<boolean> {
  // Only read settings. Never authorize, show a modal, or start a location listener on home.
  return new Promise((resolve) =>
    wx.getSetting({
      success: (r) => resolve(r.authSetting["scope.userLocation"] === true),
      fail: () => resolve(false),
    }),
  );
}
export function readLocation(): Promise<LocationResult> {
  return new Promise((resolve, reject) =>
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: (r) => resolve({ ...r }),
      fail: reject,
    }),
  );
}
/** Home only reads authorization; it never opens a permission dialog. */
export async function mayPreviewLocation(): Promise<boolean> {
  if (isShuttleDeletionPending()) return false;
  if (!(await hasLocationPermission())) return false;
  if (wx.getPrivacySetting) {
    const allowed = await new Promise<boolean>((resolve) =>
      wx.getPrivacySetting({
        success: (r) => resolve(!r.needAuthorization),
        fail: () => resolve(false),
      }),
    );
    if (!allowed) return false;
  }
  return (await getShuttleConsent()).accepted;
}
function sampleKey(p: SampleReceipt): string {
  return `${p.captureSession}:${p.seq}`;
}
interface RecorderCallbacks {
  status(pending: number, failed: boolean): void;
  fatal(message: string): void;
}
interface SharedOutbox {
  queue: LocationSample[];
  sending: boolean;
  epoch: number;
}
const outboxes = new Map<string, SharedOutbox>();
function loadOutbox(key: string): SharedOutbox {
  const existing = outboxes.get(key);
  if (existing) return existing;
  const saved = wx.getStorageSync(key) as unknown;
  if (saved && !Array.isArray(saved))
    throw new Error("Invalid location outbox");
  const box = {
    queue: Array.isArray(saved) ? (saved as LocationSample[]) : [],
    sending: false,
    epoch: 0,
  };
  outboxes.set(key, box);
  return box;
}
/** Account-isolated durable outbox. Identical coordinates are separate observations. */
export class ShuttleLocationRecorder {
  private lease: SessionLease | null = captureSessionLease();
  private key = `${OUTBOX_PREFIX}${this.lease?.userId || "none"}`;
  private captureSession = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 10)}`;
  private seq = 0;
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private box: SharedOutbox = { queue: [], sending: false, epoch: 0 };
  private blocked = false;
  private outboxEpoch = 0;
  private last: LocationSample | null = null;
  constructor(private callbacks: RecorderCallbacks) {
    try {
      this.box = loadOutbox(this.key);
      this.outboxEpoch = this.box.epoch;
    } catch {
      this.blocked = true;
      callbacks.fatal("无法读取待上传位置，请检查存储空间");
    }
  }
  start(): void {
    if (this.active || this.blocked) return;
    this.active = true;
    this.timer = setInterval(() => {
      void this.flush();
    }, 1500);
    void this.flush();
  }
  current(): LocationSample | null {
    return this.last;
  }
  /** Continue the entry observation's capture session without recording the same API result twice. */
  adopt(point: LocationSample): void {
    this.captureSession = point.captureSession;
    this.seq = point.seq;
    this.last = point;
  }
  record(
    raw: LocationResult,
    source: LocationSample["source"],
  ): LocationSample | null {
    if (
      this.blocked ||
      isShuttleDeletionPending() ||
      this.outboxEpoch !== this.box.epoch ||
      !isSessionLeaseCurrent(this.lease) ||
      !Number.isFinite(raw.longitude) ||
      !Number.isFinite(raw.latitude)
    )
      return null;
    // Preserve the entire API result, including unknown future fields; never round coordinates.
    const point: LocationSample = {
      captureSession: this.captureSession,
      seq: ++this.seq,
      clientTime: Date.now(),
      source,
      crs: "gcj02",
      raw: JSON.parse(JSON.stringify(raw)) as LocationResult,
    };
    this.last = point;
    this.box.queue.push(point);
    if (!this.persist()) {
      this.blocked = true;
      this.callbacks.fatal("位置暂存失败，已暂停定位，请检查存储空间");
      return null;
    }
    if (this.box.queue.length > MAX_PENDING) {
      this.blocked = true;
      this.callbacks.fatal("离线记录较多，已暂停定位，联网上传后再继续");
      return null;
    }
    this.callbacks.status(this.box.queue.length, false);
    if (!this.active) void this.flush(); // Late callbacks after onHide are still durable observations.
    return point;
  }
  acknowledge(accepted: SampleReceipt[]): void {
    if (!isSessionLeaseCurrent(this.lease)) return;
    const keys = new Set(accepted.map(sampleKey));
    this.box.queue = this.box.queue.filter((p) => !keys.has(sampleKey(p)));
    this.persist();
    this.callbacks.status(this.box.queue.length, false);
  }
  private persist(): boolean {
    try {
      wx.setStorageSync(this.key, this.box.queue);
      return true;
    } catch {
      return false;
    }
  }
  async flush(): Promise<void> {
    if (
      this.box.sending ||
      isShuttleDeletionPending() ||
      !this.box.queue.length ||
      !isSessionLeaseCurrent(this.lease)
    )
      return;
    this.box.sending = true;
    const batch = this.box.queue.slice(0, 50),
      epoch = this.box.epoch;
    try {
      const { accepted } = await uploadShuttleLocations(batch);
      if (epoch === this.box.epoch && isSessionLeaseCurrent(this.lease))
        this.acknowledge(accepted);
    } catch (error) {
      if (isSessionLeaseCurrent(this.lease)) {
        this.callbacks.status(this.box.queue.length, true);
        if ((error as { statusCode?: number }).statusCode === 403)
          this.callbacks.fatal("位置记录授权已撤回，请返回后重新进入");
      }
    } finally {
      this.box.sending = false;
    }
  }
  stop(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Durable storage was written before upload. One final batch; remainder resumes next visit.
    void this.flush();
  }
  discard(): void {
    this.blocked = true;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.box.epoch += 1;
    this.box.queue = [];
    this.last = null;
    wx.removeStorageSync(this.key);
  }
}
