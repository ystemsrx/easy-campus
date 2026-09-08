const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const compiled = new Map();
const target = "/teaching/timetable?automatic=true";

function runtime(options = {}) {
  let serverNow = Date.parse("2026-09-08T00:00:00Z");
  let clientNow = serverNow + (options.offsetMs || 0);
  let origin = "https://api.example.test";
  const storage = new Map();
  const modules = new Map();
  const requests = [];
  const nonces = new Set();
  const feedback = [];
  const session = {
    token: "session-a",
    signedInAt: 1,
    user: { id: "7", account: "test-account" },
    device: { id: "13", algorithm: "Ed25519" },
    credential: { status: "verified" },
  };
  const advance = (milliseconds) => {
    clientNow += milliseconds;
    serverNow += milliseconds;
  };
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    async getRandomValues({ length }) {
      return {
        randomValues: Uint8Array.from(crypto.randomBytes(length)).buffer,
      };
    },
    arrayBufferToBase64: (value) => Buffer.from(value).toString("base64"),
    base64ToArrayBuffer: (value) =>
      Uint8Array.from(Buffer.from(value, "base64")).buffer,
    showToast: (value) => feedback.push(value),
    request(request) {
      requests.push(request);
      const index = requests.length - 1;
      advance(options.delays?.[index] || 0);
      let code = options.errors?.[index];
      if (request.header.Authorization) {
        const headers = request.header;
        const timestamp = Number(headers["X-Device-Timestamp"]);
        const nonce = headers["X-Device-Nonce"];
        const canonical = [
          "easy-swu-device-proof-v2",
          "13",
          crypto.createHash("sha512").update("session-a").digest("hex"),
          request.method,
          new URL(request.url).pathname + new URL(request.url).search,
          crypto.createHash("sha512").update("").digest("hex"),
          String(timestamp),
          nonce,
        ].join("\n");
        const key = storage.get("easy-swu:device-key:v1");
        const publicKey = crypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(key.publicKey, "base64"),
          ]),
          format: "der",
          type: "spki",
        });
        assert.ok(
          crypto.verify(
            null,
            Buffer.from(canonical),
            publicKey,
            Buffer.from(headers["X-Device-Signature"], "base64"),
          ),
        );
        if (Math.abs(timestamp - serverNow) > 300_000) {
          code ||= "DEVICE_TIMESTAMP_OUT_OF_RANGE";
        } else if (nonces.has(nonce)) {
          code ||= "DEVICE_REPLAY_DETECTED";
        } else if (!code) {
          nonces.add(nonce);
        }
      }
      if (options.dropFirstResponse && index === 0) {
        request.fail({ errMsg: "request:fail timeout" });
        return;
      }
      if (options.switchSession) session.token = "session-b";
      request.success({
        statusCode: code ? 401 : 200,
        header: { dAtE: new Date(serverNow).toUTCString() },
        data: code
          ? { success: false, error: { code, message: code } }
          : { success: true, data: { courses: [] }, meta: { cached: true } },
      });
    },
  };
  const stubs = {
    "config/index": {
      getApiUrl: (value) => `${origin}/api/v1/${value.replace(/^\//, "")}`,
    },
    "utils/navigation": { goToLogin: () => feedback.push("login") },
    "store/session": {
      getSession: () => session,
      captureSessionLease: () => ({
        token: session.token,
        signedInAt: 1,
        account: "test-account",
      }),
      isSessionLeaseCurrent: (lease) => lease?.token === session.token,
      sessionLeaseKey: (lease) => lease.token,
      clearSession: () => feedback.push("clear"),
      clearSessionIfCurrent: () => {
        feedback.push("clear");
        return true;
      },
    },
  };
  function load(name) {
    if (stubs[name]) return stubs[name];
    if (name === "vendor/tweetnacl")
      return require(path.join(root, name + ".js"));
    if (modules.has(name)) return modules.get(name);
    if (!compiled.has(name)) {
      compiled.set(
        name,
        ts.transpileModule(
          fs.readFileSync(path.join(root, name + ".ts"), "utf8"),
          {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2020,
            },
          },
        ).outputText,
      );
    }
    const module = { exports: {} };
    modules.set(name, module.exports);
    new Function(
      "module",
      "exports",
      "require",
      "wx",
      "Date",
      "setTimeout",
      "getCurrentPages",
      compiled.get(name),
    )(
      module,
      module.exports,
      (specifier) =>
        load(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(name), specifier),
          ),
        ),
      wx,
      class extends Date {
        static now() {
          return clientNow;
        }
      },
      (callback, delay) => {
        advance(delay);
        queueMicrotask(callback);
        return 1;
      },
      () => [],
    );
    return module.exports;
  }
  return {
    request: load("services/request"),
    proof: load("services/device-proof"),
    requests,
    feedback,
    session,
    clientNow: () => clientNow,
    serverNow: () => serverNow,
    changeOrigin: () => {
      origin = "https://another.example.test";
    },
  };
}

async function signedTimestamp(fixture) {
  const headers = await fixture.proof.createDeviceProofHeaders({
    deviceKeyId: "13",
    sessionToken: "session-a",
    method: "GET",
    requestTarget: "/api/v1" + target,
    bodyHash: fixture.proof.hashRequestData(),
  });
  return Number(headers["X-Device-Timestamp"]);
}

async function main() {
  for (const offsetMs of [-448_548, 448_548]) {
    const fixture = runtime({ offsetMs });
    await fixture.request.teachingRequest(target);
    assert.equal(fixture.requests.length, 2, "clock skew retries once");
    assert.notEqual(
      fixture.requests[0].header["X-Device-Nonce"],
      fixture.requests[1].header["X-Device-Nonce"],
    );
    assert.ok(
      Math.abs((await signedTimestamp(fixture)) - fixture.serverNow()) < 1000,
    );
    await fixture.request.teachingRequest(target);
    assert.equal(
      fixture.requests.length,
      3,
      "later requests reuse the calibrated clock",
    );
    assert.deepEqual(fixture.feedback, []);
    assert.equal(fixture.session.token, "session-a");
  }
  const login = runtime({ offsetMs: -448_548 });
  await login.request.apiRequest("/auth/login", { authenticated: false });
  await login.request.teachingRequest(target);
  assert.equal(
    login.requests.length,
    2,
    "login response calibrates before the first signed request",
  );

  const suspended = runtime({ delays: [448_548] });
  await suspended.request.teachingRequest(target);
  assert.equal(
    suspended.requests.length,
    2,
    "a paused old signature is regenerated",
  );
  assert.ok(
    Math.abs((await signedTimestamp(suspended)) - suspended.serverNow()) < 1000,
  );

  const lostResponse = runtime({ dropFirstResponse: true });
  await lostResponse.request.teachingRequest(target);
  assert.equal(lostResponse.requests.length, 2);
  assert.notEqual(
    lostResponse.requests[0].header["X-Device-Nonce"],
    lostResponse.requests[1].header["X-Device-Nonce"],
  );

  for (const [options, requestOptions, expected, code] of [
    [
      { offsetMs: -448_548 },
      { retry: false },
      1,
      "DEVICE_TIMESTAMP_OUT_OF_RANGE",
    ],
    [
      {
        errors: [
          "DEVICE_TIMESTAMP_OUT_OF_RANGE",
          "DEVICE_TIMESTAMP_OUT_OF_RANGE",
        ],
      },
      {},
      2,
      "DEVICE_TIMESTAMP_OUT_OF_RANGE",
    ],
    [{ errors: ["DEVICE_REPLAY_DETECTED"] }, {}, 1, "DEVICE_REPLAY_DETECTED"],
    [{ offsetMs: -448_548, switchSession: true }, {}, 1, "STALE_SESSION"],
  ]) {
    const fixture = runtime(options);
    await assert.rejects(
      fixture.request.teachingRequest(target, requestOptions),
      (error) => error.code === code,
    );
    assert.equal(fixture.requests.length, expected);
    assert.deepEqual(fixture.feedback, []);
    if (code === "STALE_SESSION")
      assert.equal(await signedTimestamp(fixture), fixture.clientNow());
  }

  const clock = runtime({ offsetMs: -448_548 });
  const date = new Date(clock.serverNow()).toUTCString();
  for (const [headers, startedAt, url] of [
    [
      { Date: "invalid" },
      clock.clientNow(),
      "https://api.example.test/api/v1/auth/me",
    ],
    [
      { Date: date, Age: "60" },
      clock.clientNow(),
      "https://api.example.test/api/v1/auth/me",
    ],
    [
      { Date: date },
      clock.clientNow() - 11_000,
      "https://api.example.test/api/v1/auth/me",
    ],
    [
      { Date: date },
      clock.clientNow() + 1,
      "https://api.example.test/api/v1/auth/me",
    ],
    [{ Date: date }, clock.clientNow(), "https://external.example.test/file"],
  ]) {
    clock.proof.synchronizeDeviceProofClock(headers, startedAt, url);
    assert.equal(
      await signedTimestamp(clock),
      clock.clientNow(),
      "unreliable time samples are ignored",
    );
  }
  clock.proof.synchronizeDeviceProofClock(
    { Date: date },
    clock.clientNow(),
    "https://api.example.test/api/v1/auth/me",
  );
  assert.equal(await signedTimestamp(clock), clock.serverNow());
  clock.changeOrigin();
  assert.equal(
    await signedTimestamp(clock),
    clock.clientNow(),
    "clock offsets cannot cross API origins",
  );
  console.log(
    "Request clock recovery, fresh signatures, replay rejection and session isolation checks passed.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
