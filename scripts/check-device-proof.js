const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "services", "device-proof.ts"),
  "utf8",
);
const requestSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "services", "request.ts"),
  "utf8",
);
const serviceDirectory = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "services",
);
const vendoredNaclPath = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "vendor",
  "tweetnacl.js",
);
const vendoredNaclSource = fs.readFileSync(vendoredNaclPath, "utf8");
const vendoredNaclRuntime = require(vendoredNaclPath);
const vendoredNacl = Object.create(vendoredNaclRuntime);
let naclHashCallCount = 0;
vendoredNacl.hash = (value) => {
  naclHashCallCount += 1;
  return vendoredNaclRuntime.hash(value);
};
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleRecord = { exports: {} };
const storage = new Map();
storage.set("easy-swu:device-key:v1", {
  version: 1,
  algorithm: "Ed25519",
  publicKey: Buffer.alloc(32, 1).toString("base64"),
  secretKey: Buffer.alloc(64, 2).toString("base64"),
  createdAt: 1,
});
const previousWx = global.wx;
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  async getRandomValues({ length }) {
    const values = new Uint8Array(length);
    values.fill(7);
    return { randomValues: values.buffer, errMsg: "getRandomValues:ok" };
  },
  arrayBufferToBase64(value) {
    return Buffer.from(value).toString("base64");
  },
  base64ToArrayBuffer(value) {
    const bytes = Buffer.from(value, "base64");
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.length,
    );
  },
};

new Function("module", "exports", "require", compiled)(
  moduleRecord,
  moduleRecord.exports,
  (specifier) => {
    if (specifier === "../vendor/tweetnacl") return vendoredNacl;
    if (specifier === "../config/index") {
      return {
        getApiUrl(requestPath) {
          const normalizedPath = String(requestPath);
          return normalizedPath.startsWith("/api/v1/")
            ? `https://api.example.test${normalizedPath}`
            : `https://api.example.test/api/v1/${normalizedPath.replace(/^\/+/, "")}`;
        },
      };
    }
    throw new Error(`Unexpected device proof dependency: ${specifier}`);
  },
);

assert.equal(compiled.includes('require("tweetnacl")'), false);
assert.equal(compiled.includes('require("../vendor/tweetnacl")'), true);
assert.equal(fs.existsSync(vendoredNaclPath), true);
assert.doesNotMatch(
  vendoredNaclSource,
  /\brequire\s*\(\s*["'](?:node:)?crypto["']\s*\)/,
  "The mini program TweetNaCl build must not load Node's crypto module",
);
assert.equal(requestSource.includes("/auth/challenge"), false);
assert.match(requestSource, /createDeviceProofHeaders/);
for (const fileName of fs.readdirSync(serviceDirectory)) {
  if (!fileName.endsWith(".ts")) continue;
  const serviceSource = fs.readFileSync(
    path.join(serviceDirectory, fileName),
    "utf8",
  );
  if (!serviceSource.includes("wx.downloadFile(")) continue;
  assert.match(
    serviceSource,
    /createAuthenticatedRequestHeaders/,
    `${fileName} must add a device proof to authenticated downloads`,
  );
  assert.match(
    serviceSource,
    /header:\s*headers/,
    `${fileName} must pass the signed headers to wx.downloadFile`,
  );
}

void (async () => {
  try {
    const deviceProof = moduleRecord.exports;
    const publicKey = await deviceProof.getDevicePublicKey();
    assert.equal(Buffer.from(publicKey, "base64").length, 32);
    assert.equal(await deviceProof.getDevicePublicKey(), publicKey);
    assert.equal(
      deviceProof.canonicalRequestTarget("/auth/me"),
      "/api/v1/auth/me",
    );
    assert.equal(
      deviceProof.canonicalRequestTarget(
        "/api/v1/content/media/123e4567-e89b-12d3-a456-426614174000",
      ),
      "/api/v1/content/media/123e4567-e89b-12d3-a456-426614174000",
    );
    assert.equal(
      deviceProof.canonicalRequestTarget(
        "/teaching/calendar/image?academicYear=2026&refresh=true",
      ),
      "/api/v1/teaching/calendar/image?academicYear=2026&refresh=true",
    );
    const bodyHash = deviceProof.hashRequestData({ b: 2, a: "值" });
    assert.equal(
      bodyHash,
      crypto
        .createHash("sha512")
        .update('{"a":"值","b":2}', "utf8")
        .digest("hex"),
    );
    assert.equal(naclHashCallCount, 1);
    const sessionToken = "signed-session-token";
    const beforeSigning = Date.now();
    const headers = await deviceProof.createDeviceProofHeaders({
      deviceKeyId: "13",
      sessionToken,
      method: "POST",
      requestTarget: "/api/v1/feedback",
      bodyHash,
    });
    const afterSigning = Date.now();
    assert.equal(naclHashCallCount, 2);
    const timestamp = Number(headers["X-Device-Timestamp"]);
    assert.ok(timestamp >= beforeSigning && timestamp <= afterSigning);
    assert.match(headers["X-Device-Nonce"], /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(Object.keys(headers).sort(), [
      "X-Device-Key-ID",
      "X-Device-Nonce",
      "X-Device-Signature",
      "X-Device-Timestamp",
    ]);
    const canonical = [
      "easy-swu-device-proof-v2",
      "13",
      crypto.createHash("sha512").update(sessionToken).digest("hex"),
      "POST",
      "/api/v1/feedback",
      bodyHash,
      String(timestamp),
      headers["X-Device-Nonce"],
    ].join("\n");
    const publicKeyObject = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKey, "base64"),
      ]),
      format: "der",
      type: "spki",
    });
    assert.equal(
      crypto.verify(
        null,
        Buffer.from(canonical),
        publicKeyObject,
        Buffer.from(headers["X-Device-Signature"], "base64"),
      ),
      true,
    );
    await deviceProof.createDeviceProofHeaders({
      deviceKeyId: "13",
      sessionToken,
      method: "GET",
      requestTarget: "/api/v1/auth/heartbeat",
      bodyHash: deviceProof.hashRequestData(),
    });
    assert.equal(
      naclHashCallCount,
      3,
      "The same session token should reuse its cached SHA-512 hash",
    );
    await deviceProof.createDeviceProofHeaders({
      deviceKeyId: "13",
      sessionToken: "rotated-session-token",
      method: "GET",
      requestTarget: "/api/v1/auth/heartbeat",
      bodyHash: deviceProof.hashRequestData(),
    });
    assert.equal(
      naclHashCallCount,
      5,
      "A changed session token should replace the cached SHA-512 hash",
    );
    console.log("Device request proof checks passed.");
  } finally {
    global.wx = previousWx;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
