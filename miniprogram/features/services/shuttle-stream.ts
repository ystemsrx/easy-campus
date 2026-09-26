import { apiRequest } from "../../services/request";
import { getApiUrl } from "../../config/index";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  type SessionLease,
} from "../../store/session";
import type {
  GeoPoint,
  LocationSample,
  SampleReceipt,
  ShuttleSelection,
  ShuttleSnapshot,
} from "../../types/shuttle";
const ROOT = "/utilities/shuttle-buses";
export type ShuttleConnectionState =
  "connecting" | "live" | "reconnecting" | "offline" | "closed";
interface StreamCallbacks {
  snapshot(value: ShuttleSnapshot): void;
  receipt(value: SampleReceipt[]): void;
  state(value: ShuttleConnectionState): void;
  fatal(message: string): void;
  selectionInvalid(): void;
}
/** Exactly one SocketTask owned by a visible map page. Tickets never appear in URLs. */
export class ShuttleStream {
  private socket: WechatMiniprogram.SocketTask | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private attempts = 0;
  private active = false;
  private ready = false;
  private lastMessageAt = 0;
  private lease: SessionLease | null;
  private selection: ShuttleSelection = {};
  constructor(
    private point: () => LocationSample | null,
    private callbacks: StreamCallbacks,
    private manualOrigin: () => string | GeoPoint | undefined = () => undefined,
  ) {
    this.lease = captureSessionLease();
  }
  private originPayload(): unknown {
    const origin = this.manualOrigin();
    return typeof origin === "string"
      ? { stopId: origin }
      : {
          point: origin && {
            longitude: origin.longitude,
            latitude: origin.latitude,
          },
        };
  }
  start(selection: ShuttleSelection): void {
    this.selection = selection;
    this.active = true;
    void this.connect();
  }
  select(selection: ShuttleSelection): void {
    this.selection = selection;
    if (this.ready)
      this.send(
        this.manualOrigin()
          ? {
              type: "origin",
              origin: this.originPayload(),
              selection,
            }
          : { type: "select", selection },
      );
  }
  stop(): void {
    this.active = false;
    this.generation += 1;
    this.ready = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close({ code: 1000, reason: "page hidden" });
  }
  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.retryTimer = null;
    this.heartbeat = null;
    this.authTimer = null;
  }
  private send(data: unknown): void {
    const socket = this.socket;
    socket?.send({
      data: JSON.stringify(data),
      fail: () => {
        if (this.socket === socket) this.reconnect();
      },
    });
  }
  private reconnect(): void {
    if (!this.active || this.retryTimer || !isSessionLeaseCurrent(this.lease))
      return;
    this.generation += 1;
    this.ready = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.heartbeat = null;
    this.authTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close({ code: 1000, reason: "reconnect" });
    this.callbacks.state("reconnecting");
    const delay = Math.min(20000, 1000 * 2 ** Math.min(5, this.attempts++));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }
  private async connect(): Promise<void> {
    const generation = ++this.generation;
    if (!this.active || !isSessionLeaseCurrent(this.lease)) return;
    this.callbacks.state(this.attempts ? "reconnecting" : "connecting");
    try {
      const { ticket } = await apiRequest<{ ticket: string }>(
        `${ROOT}/ticket`,
        { method: "POST", retry: false, timeout: 10000 },
      );
      const point = this.point();
      if (
        (!point && !this.manualOrigin()) ||
        !this.active ||
        generation !== this.generation ||
        !isSessionLeaseCurrent(this.lease)
      )
        return;
      const socket = wx.connectSocket({
        url: getApiUrl(`${ROOT}/stream`).replace(/^http/, "ws"),
        timeout: 12000,
        complete: () => undefined,
      });
      this.socket = socket;
      const current = (): boolean =>
        this.active &&
        this.socket === socket &&
        generation === this.generation &&
        isSessionLeaseCurrent(this.lease);
      socket.onOpen(() => {
        if (!current()) {
          socket.close({});
          return;
        }
        this.lastMessageAt = Date.now();
        this.send({
          type: "auth",
          protocol: 2,
          ticket,
          ...(this.manualOrigin()
            ? { origin: this.originPayload() }
            : { point: this.point() || point }),
          selection: this.selection,
        });
        this.authTimer = setTimeout(() => this.reconnect(), 7000);
      });
      socket.onMessage((event) => {
        if (!current() || typeof event.data !== "string") return;
        this.lastMessageAt = Date.now();
        try {
          const data = JSON.parse(event.data) as ShuttleSnapshot & {
            message?: string;
            code?: string;
          };
          const type = (data as unknown as { type: string }).type;
          if (type === "ready") {
            if (this.authTimer) clearTimeout(this.authTimer);
            this.authTimer = null;
            this.ready = true;
            this.attempts = 0;
            if (data.accepted) this.callbacks.receipt(data.accepted);
            this.callbacks.state("live");
            // A selection may have changed while the initial authentication was in flight.
            this.select(this.selection);
            this.heartbeat = setInterval(() => {
              if (Date.now() - this.lastMessageAt > 15000) this.reconnect();
              else this.send({ type: "ping" });
            }, 5000);
          } else if (
            type === "snapshot" &&
            data.protocol === 2 &&
            Array.isArray(data.vehicles)
          ) {
            this.callbacks.snapshot({
              ...data,
              vehicles: data.vehicles.slice(0, 10),
            });
            if (!data.selectionValid) this.callbacks.selectionInvalid();
          } else if (type === "error" && data.code === "SELECTION_INVALID")
            this.callbacks.selectionInvalid();
        } catch {
          /* Ignore malformed frames; heartbeat watchdog reconnects a silent connection. */
        }
      });
      socket.onError(() => {
        if (current()) this.reconnect();
      });
      socket.onClose((event) => {
        if (!current()) return;
        if ([4001, 4003, 4008, 1008].includes(event.code)) {
          this.stop();
          this.callbacks.state("closed");
          this.callbacks.fatal(
            event.code === 4003
              ? "位置记录授权已撤回"
              : event.code === 4008
                ? "校车页面连接过多，请关闭其他设备后重试"
                : "连接验证失败，请返回后重试",
          );
        } else this.reconnect();
      });
    } catch {
      if (generation === this.generation) this.reconnect();
    }
  }
}
