import { shuttleRequest as apiRequest } from "../../services/shuttle-request";
import { getApiUrl } from "../../config/index";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  type SessionLease,
  getSession,
} from "../../store/session";
import { isDemoSession } from "../../demo/identity";
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
  private connectedSince = 0;
  private lease: SessionLease | null;
  private selection: ShuttleSelection = {};
  private polling = false;
  private pollVersion = 0;
  private offline = false;
  private pollFailures = 0;
  private nextProbeAt = 0;
  private selectionKey = "";
  private networkChanged = (event: { isConnected: boolean }): void => {
    if (!this.active || this.offline === !event.isConnected) return;
    this.offline = !event.isConnected;
    this.generation++;
    this.ready = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close({ code: 1000, reason: "network changed" });
    if (this.offline) this.callbacks.state("offline");
    else {
      this.attempts = 0;
      this.pollFailures = 0;
      this.polling = false;
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          void this.connect();
        },
        300 + Math.random() * 500,
      );
    }
  };
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
    this.stop();
    this.polling = false;
    this.attempts = 0;
    this.pollFailures = 0;
    this.offline = false;
    this.lease = captureSessionLease();
    this.selection = selection;
    this.selectionKey = JSON.stringify([selection, this.originPayload()]);
    this.active = true;
    if (isDemoSession(getSession())) {
      this.polling = true;
      this.nextProbeAt = Infinity;
      void this.poll();
      return;
    }
    wx.onNetworkStatusChange?.(this.networkChanged);
    void this.connect();
  }
  select(selection: ShuttleSelection): void {
    const key = JSON.stringify([selection, this.originPayload()]);
    if (key === this.selectionKey) return;
    this.selectionKey = key;
    this.selection = selection;
    this.pollVersion++;
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
    wx.offNetworkStatusChange?.(
      this
        .networkChanged as unknown as WechatMiniprogram.OffNetworkStatusChangeCallback,
    );
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
    if (!isSessionLeaseCurrent(this.lease)) {
      this.stop();
      return;
    }
    if (!this.active || this.offline || this.retryTimer) return;
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
    if (this.attempts >= 1) {
      this.polling = true;
      this.nextProbeAt = Date.now() + 60000;
      void this.poll();
      return;
    }
    const delay =
      Math.min(20000, 1000 * 2 ** Math.min(5, this.attempts++)) +
      Math.random() * 500;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }
  private async connect(): Promise<void> {
    const generation = ++this.generation;
    if (!this.active || this.offline) return;
    if (!isSessionLeaseCurrent(this.lease)) {
      this.stop();
      return;
    }
    this.callbacks.state(this.attempts ? "reconnecting" : "connecting");
    try {
      const { ticket } = await apiRequest<{ ticket: string }>(
        `${ROOT}/ticket`,
        { method: "POST", data: {}, retry: false, timeout: 10000 },
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
      let authenticatedSelection = "";
      const current = (): boolean => {
        if (this.active && !isSessionLeaseCurrent(this.lease)) this.stop();
        return (
          this.active &&
          this.socket === socket &&
          generation === this.generation
        );
      };
      this.authTimer = setTimeout(() => {
        if (current()) this.reconnect();
      }, 12000);
      socket.onOpen(() => {
        if (!current()) {
          socket.close({});
          return;
        }
        this.lastMessageAt = Date.now();
        this.connectedSince = this.lastMessageAt;
        authenticatedSelection = this.selectionKey;
        this.send({
          type: "auth",
          protocol: 2,
          ticket,
          ...(this.manualOrigin()
            ? { origin: this.originPayload() }
            : { point: this.point() || point }),
          selection: this.selection,
        });
        if (this.authTimer) clearTimeout(this.authTimer);
        this.authTimer = setTimeout(() => {
          if (current()) this.reconnect();
        }, 7000);
      });
      socket.onMessage((event) => {
        if (!current() || typeof event.data !== "string") return;
        try {
          const data = JSON.parse(event.data) as ShuttleSnapshot & {
            message?: string;
            code?: string;
          };
          const type = (data as unknown as { type: string }).type;
          if (!["ready", "snapshot", "pong", "error"].includes(type)) return;
          this.lastMessageAt = Date.now();
          if (type === "ready") {
            if (this.ready) return;
            if (this.authTimer) clearTimeout(this.authTimer);
            this.authTimer = null;
            this.ready = true;
            this.polling = false;
            if (data.accepted) this.callbacks.receipt(data.accepted);
            this.callbacks.state("live");
            // A selection may have changed while the initial authentication was in flight.
            if (authenticatedSelection !== this.selectionKey) {
              this.selectionKey = "";
              this.select(this.selection);
            }
            if (this.heartbeat) clearInterval(this.heartbeat);
            this.heartbeat = setInterval(() => {
              if (!isSessionLeaseCurrent(this.lease)) {
                this.stop();
                return;
              }
              if (Date.now() - this.lastMessageAt > 15000) this.reconnect();
              else this.send({ type: "ping" });
            }, 5000);
          } else if (
            type === "snapshot" &&
            data.protocol === 2 &&
            Array.isArray(data.vehicles)
          ) {
            // One successful frame is not a stable connection: retain backoff
            // across flapping sockets instead of reopening every second.
            if (Date.now() - this.connectedSince >= 30000) this.attempts = 0;
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
      socket.onError((error) => {
        console.warn(
          "[shuttle-stream] socket",
          error?.errMsg || "SOCKET_FAILED",
        );
        if (current()) this.reconnect();
      });
      socket.onClose((event) => {
        if (!current()) return;
        if ([4001, 4003, 4008, 4009, 1008].includes(event.code)) {
          this.stop();
          this.callbacks.state("closed");
          this.callbacks.fatal(
            event.code === 4009
              ? "已在另一个校车页面连接"
              : event.code === 4003
                ? "位置记录授权已撤回"
                : event.code === 4008
                  ? "校车页面连接过多，请关闭其他设备后重试"
                  : "连接验证失败，请返回后重试",
          );
        } else this.reconnect();
      });
    } catch (error) {
      console.warn(
        "[shuttle-stream] ticket",
        (error as { code?: string }).code || "REQUEST_FAILED",
      );
      if (generation === this.generation) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401 || status === 403) {
          this.stop();
          this.callbacks.fatal("连接验证失败，请返回后重试");
        } else this.reconnect();
      }
    }
  }
  private async poll(): Promise<void> {
    if (!isSessionLeaseCurrent(this.lease)) {
      this.stop();
      return;
    }
    const generation = this.generation,
      version = this.pollVersion;
    const current = (): boolean =>
      this.active &&
      !this.offline &&
      this.polling &&
      generation === this.generation &&
      isSessionLeaseCurrent(this.lease);
    if (!current()) return;
    if (Date.now() >= this.nextProbeAt) {
      this.polling = false;
      void this.connect();
      return;
    }
    try {
      const point = this.point();
      if (!point && !this.manualOrigin()) return;
      const packet = await apiRequest<ShuttleSnapshot>(`${ROOT}/snapshot`, {
        method: "POST",
        data: {
          ...(this.manualOrigin()
            ? { origin: this.originPayload() }
            : { point }),
          selection: this.selection,
        },
        retry: false,
        timeout: 10000,
      });
      if (!current()) return;
      this.pollFailures = 0;
      if (packet.accepted) this.callbacks.receipt(packet.accepted);
      if (version === this.pollVersion) {
        this.callbacks.state("live");
        this.callbacks.snapshot(packet);
        if (!packet.selectionValid) this.callbacks.selectionInvalid();
      }
    } catch (error) {
      if (!current()) return;
      const failure = error as { code?: string; statusCode?: number };
      console.warn(
        "[shuttle-stream] snapshot",
        failure.code || "REQUEST_FAILED",
      );
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.stop();
        this.callbacks.fatal("连接验证失败，请返回后重试");
        return;
      }
      if (failure.code === "SELECTION_INVALID")
        this.callbacks.selectionInvalid();
      this.callbacks.state("offline");
      this.pollFailures++;
    } finally {
      if (current())
        this.retryTimer = setTimeout(
          () => {
            this.retryTimer = null;
            void this.poll();
          },
          this.pollFailures
            ? Math.min(30000, 3000 * 2 ** Math.min(4, this.pollFailures)) +
                Math.random() * 500
            : version === this.pollVersion
              ? 3000
              : 300,
        );
    }
  }
}
