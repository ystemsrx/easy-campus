import { apiRequest } from "./request";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../store/session";

const STORAGE_KEY = "easy-swu:screen-watermark:v1";

export interface WatermarkPayload {
  version: 1;
  type: 1;
  token: string;
  cellSize: number;
  strength: number;
  colorMode: "chroma";
}

interface StoredWatermark {
  userId: string;
  account: string;
  signedInAt: number;
  payload: WatermarkPayload;
}

let pending:
  { leaseKey: string; promise: Promise<WatermarkPayload | null> } | undefined;
let active: { leaseKey: string; payload: WatermarkPayload } | undefined;

export async function getScreenWatermark(): Promise<WatermarkPayload | null> {
  const session = getSession();
  const lease = captureSessionLease(session);
  if (!session || !lease) return null;
  const leaseKey = sessionLeaseKey(lease);
  if (active?.leaseKey === leaseKey) return active.payload;
  if (pending?.leaseKey === leaseKey) return pending.promise;
  const cached = readStoredWatermark();
  const promise = apiRequest<WatermarkPayload>("/auth/watermark", {
    allowInvalidCredential: true,
  })
    .then((payload) => {
      if (!isSessionLeaseCurrent(lease) || !isPayload(payload)) return null;
      const stored: StoredWatermark = {
        userId: lease.userId,
        account: lease.account,
        signedInAt: lease.signedInAt,
        payload,
      };
      active = { leaseKey, payload };
      try {
        wx.setStorageSync(STORAGE_KEY, stored);
      } catch {
        // The in-memory value still protects this app run if storage is full.
      }
      return payload;
    })
    .catch(() => {
      if (
        cached?.userId !== lease.userId ||
        cached.account !== lease.account ||
        cached.signedInAt !== lease.signedInAt ||
        !isPayload(cached.payload) ||
        !isSessionLeaseCurrent(lease)
      ) {
        return null;
      }
      active = { leaseKey, payload: cached.payload };
      return cached.payload;
    })
    .finally(() => {
      if (pending?.promise === promise) pending = undefined;
    });
  pending = { leaseKey, promise };
  return promise;
}

function readStoredWatermark(): StoredWatermark | null {
  let value: Partial<StoredWatermark>;
  try {
    value = wx.getStorageSync(STORAGE_KEY) as Partial<StoredWatermark>;
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value.userId !== "string" ||
    typeof value.account !== "string" ||
    typeof value.signedInAt !== "number" ||
    !isPayload(value.payload)
  ) {
    return null;
  }
  return value as StoredWatermark;
}

function isPayload(value: unknown): value is WatermarkPayload {
  const payload = value as Partial<WatermarkPayload> | undefined;
  return Boolean(
    payload &&
    payload.version === 1 &&
    payload.type === 1 &&
    typeof payload.token === "string" &&
    /^[0-9a-f]{32}$/i.test(payload.token) &&
    payload.colorMode === "chroma" &&
    Number.isFinite(payload.cellSize) &&
    Number.isFinite(payload.strength),
  );
}
