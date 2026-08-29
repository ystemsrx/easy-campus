import nacl = require("../vendor/tweetnacl");
import { getApiUrl } from "../config/index";

const DEVICE_KEY_STORAGE = "easy-swu:device-key:v1";
const DEVICE_PROOF_VERSION = "easy-swu-device-proof-v2";

interface StoredDeviceKey {
  version: 1;
  algorithm: "Ed25519";
  publicKey: string;
  secretKey: string;
  createdAt: number;
}

export interface DeviceProofHeaders extends Record<string, string> {
  "X-Device-Key-ID": string;
  "X-Device-Timestamp": string;
  "X-Device-Nonce": string;
  "X-Device-Signature": string;
}

let keyPromise: Promise<StoredDeviceKey> | null = null;
let sessionHashCache: { token: string; hash: string } | null = null;

export async function getDevicePublicKey(): Promise<string> {
  return (await getOrCreateDeviceKey()).publicKey;
}

export function canonicalRequestTarget(path: string): string {
  const url = getApiUrl(path);
  return url.replace(/^https?:\/\/[^/]+/i, "");
}

export function hashRequestData(
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer,
): string {
  const bytes = isArrayBuffer(data)
    ? new Uint8Array(data)
    : utf8Bytes(data === undefined ? "" : stableJson(data));
  return hex(nacl.hash(bytes));
}

export async function createDeviceProofHeaders(input: {
  deviceKeyId: string;
  sessionToken: string;
  method: string;
  requestTarget: string;
  bodyHash: string;
}): Promise<DeviceProofHeaders> {
  const key = await getOrCreateDeviceKey();
  if (!input.deviceKeyId || !input.sessionToken) {
    throw new Error("设备校验上下文不匹配。");
  }
  const random = await wx.getRandomValues({ length: 32 });
  const nonce = toBase64Url(new Uint8Array(random.randomValues));
  const timestamp = Date.now();
  const sessionHash = hashSessionToken(input.sessionToken);
  const canonical = [
    DEVICE_PROOF_VERSION,
    input.deviceKeyId,
    sessionHash,
    input.method.toUpperCase(),
    input.requestTarget,
    input.bodyHash,
    String(timestamp),
    nonce,
  ].join("\n");
  const signature = nacl.sign.detached(
    utf8Bytes(canonical),
    fromBase64(key.secretKey),
  );
  return {
    "X-Device-Key-ID": input.deviceKeyId,
    "X-Device-Timestamp": String(timestamp),
    "X-Device-Nonce": nonce,
    "X-Device-Signature": toBase64(signature),
  };
}

function hashSessionToken(sessionToken: string): string {
  if (sessionHashCache?.token === sessionToken) {
    return sessionHashCache.hash;
  }
  const hash = hex(nacl.hash(utf8Bytes(sessionToken)));
  sessionHashCache = { token: sessionToken, hash };
  return hash;
}

async function getOrCreateDeviceKey(): Promise<StoredDeviceKey> {
  const stored = readStoredKey();
  if (stored) return stored;
  if (keyPromise) return keyPromise;
  keyPromise = createDeviceKey();
  try {
    return await keyPromise;
  } finally {
    keyPromise = null;
  }
}

async function createDeviceKey(): Promise<StoredDeviceKey> {
  const random = await wx.getRandomValues({ length: 32 });
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(random.randomValues));
  const key: StoredDeviceKey = {
    version: 1,
    algorithm: "Ed25519",
    publicKey: toBase64(pair.publicKey),
    secretKey: toBase64(pair.secretKey),
    createdAt: Date.now(),
  };
  wx.setStorageSync(DEVICE_KEY_STORAGE, key);
  return key;
}

function readStoredKey(): StoredDeviceKey | null {
  try {
    const stored = wx.getStorageSync(DEVICE_KEY_STORAGE) as
      Partial<StoredDeviceKey> | undefined;
    const publicKey =
      typeof stored?.publicKey === "string"
        ? fromBase64(stored.publicKey)
        : new Uint8Array();
    const secretKey =
      typeof stored?.secretKey === "string"
        ? fromBase64(stored.secretKey)
        : new Uint8Array();
    if (
      stored?.version !== 1 ||
      stored.algorithm !== "Ed25519" ||
      publicKey.length !== 32 ||
      secretKey.length !== 64 ||
      !sameBytes(publicKey, secretKey.slice(32))
    ) {
      if (stored) wx.removeStorageSync(DEVICE_KEY_STORAGE);
      return null;
    }
    return stored as StoredDeviceKey;
  } catch {
    wx.removeStorageSync(DEVICE_KEY_STORAGE);
    return null;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : stableJson(item)))
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function utf8Bytes(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return new Uint8Array(bytes);
}

function toBase64(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return wx.arrayBufferToBase64(copy.buffer);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(wx.base64ToArrayBuffer(value));
}

function hex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}
