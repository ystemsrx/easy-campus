export const WATERMARK_GRID_SIZE = 28;
export const WATERMARK_MAX_PAYLOAD_BYTES = 16;
export const WATERMARK_LAYOUT_KEY = "easy-swu-screenmark-layout-v1";

const PACKET_BYTES = 22;
const RAW_BITS = PACKET_BYTES * 8;
const HAMMING_BITS = (RAW_BITS / 4) * 7;
const REPEAT_COUNT = 2;
const DATA_CELLS = HAMMING_BITS * REPEAT_COUNT;
const TOTAL_CELLS = WATERMARK_GRID_SIZE * WATERMARK_GRID_SIZE;
const MAGIC_0 = 0xb1;
const MAGIC_1 = 0x7d;
const VERSION = 1;

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values: number[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = values[index];
    values[index] = values[target];
    values[target] = current;
  }
}

function crc16Ccitt(bytes: Uint8Array, length = bytes.length): number {
  let crc = 0xffff;
  for (let index = 0; index < length; index += 1) {
    crc ^= bytes[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);
  let cursor = 0;
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) {
      bits[cursor] = (byte >>> shift) & 1;
      cursor += 1;
    }
  }
  return bits;
}

function nibbleToCodeword(nibble: number): Uint8Array {
  const data0 = (nibble >>> 3) & 1;
  const data1 = (nibble >>> 2) & 1;
  const data2 = (nibble >>> 1) & 1;
  const data3 = nibble & 1;
  return Uint8Array.of(
    data0 ^ data1 ^ data3,
    data0 ^ data2 ^ data3,
    data0,
    data1 ^ data2 ^ data3,
    data1,
    data2,
    data3,
  );
}

const CODEWORDS = Array.from({ length: 16 }, (_, value) =>
  nibbleToCodeword(value),
);

function hammingEncode(rawBits: Uint8Array): Uint8Array {
  const encoded = new Uint8Array((rawBits.length / 4) * 7);
  let outputCursor = 0;
  for (let index = 0; index < rawBits.length; index += 4) {
    const nibble =
      (rawBits[index] << 3) |
      (rawBits[index + 1] << 2) |
      (rawBits[index + 2] << 1) |
      rawBits[index + 3];
    encoded.set(CODEWORDS[nibble], outputCursor);
    outputCursor += 7;
  }
  return encoded;
}

function buildLayout(key: string): {
  dataPositions: Uint16Array;
  syncMask: Int8Array;
  bitMask: Uint8Array;
} {
  const seed = hash32(key);
  const positions = Array.from({ length: TOTAL_CELLS }, (_, index) => index);
  shuffle(positions, mulberry32(seed ^ 0x9e3779b9));
  const dataPositions = new Uint16Array(DATA_CELLS);
  const syncMask = new Int8Array(TOTAL_CELLS);
  const bitMask = new Uint8Array(HAMMING_BITS);
  for (let index = 0; index < DATA_CELLS; index += 1) {
    dataPositions[index] = positions[index];
  }
  const syncRandom = mulberry32(seed ^ 0xa511e9b3);
  for (let index = DATA_CELLS; index < TOTAL_CELLS; index += 1) {
    syncMask[positions[index]] = syncRandom() >= 0.5 ? 1 : -1;
  }
  const maskRandom = mulberry32(seed ^ 0x63d83595);
  for (let index = 0; index < HAMMING_BITS; index += 1) {
    bitMask[index] = maskRandom() >= 0.5 ? 1 : 0;
  }
  return { dataPositions, syncMask, bitMask };
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new TypeError("Encrypted watermark token is invalid.");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function createWatermarkPacket(
  payload: Uint8Array,
  type = 1,
): Uint8Array {
  if (payload.length > WATERMARK_MAX_PAYLOAD_BYTES) {
    throw new RangeError("Encrypted watermark payload is too long.");
  }
  const packet = new Uint8Array(PACKET_BYTES);
  packet[0] = MAGIC_0;
  packet[1] = MAGIC_1;
  packet[2] = ((VERSION & 0x0f) << 4) | (type & 0x0f);
  packet[3] = payload.length;
  packet.set(payload, 4);
  const crc = crc16Ccitt(packet, 20);
  packet[20] = (crc >>> 8) & 0xff;
  packet[21] = crc & 0xff;
  return packet;
}

export function createWatermarkTileSigns(
  packet: Uint8Array,
  key = WATERMARK_LAYOUT_KEY,
): Int8Array {
  const encoded = hammingEncode(bytesToBits(packet));
  const layout = buildLayout(key);
  const signs = new Int8Array(TOTAL_CELLS);
  for (let position = 0; position < TOTAL_CELLS; position += 1) {
    if (layout.syncMask[position]) signs[position] = layout.syncMask[position];
  }
  for (let index = 0; index < HAMMING_BITS; index += 1) {
    const sign = encoded[index] ^ layout.bitMask[index] ? 1 : -1;
    for (let repeat = 0; repeat < REPEAT_COUNT; repeat += 1) {
      signs[layout.dataPositions[index * REPEAT_COUNT + repeat]] = sign;
    }
  }
  return signs;
}
