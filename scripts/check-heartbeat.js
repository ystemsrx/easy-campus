const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "miniprogram");
const heartbeat = fs.readFileSync(
  path.join(root, "services", "heartbeat.ts"),
  "utf8",
);
const app = fs.readFileSync(path.join(root, "app.ts"), "utf8");
const auth = fs.readFileSync(path.join(root, "services", "auth.ts"), "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(
  heartbeat.includes("const HEARTBEAT_INTERVAL_MS = 30_000") &&
    heartbeat.includes('apiRequest<HeartbeatData>("/auth/heartbeat"') &&
    heartbeat.includes('method: "POST"') &&
    heartbeat.includes("retry: false"),
  "心跳必须每 30 秒调用一次独立认证接口，且失败时不自动重试",
);
assert(
  heartbeat.includes("if (heartbeatInFlight) return") &&
    heartbeat.includes("if (!heartbeatForeground || !getSession()?.token)"),
  "心跳必须避免并发，并且只在前台登录状态运行",
);
assert(
  app.includes("startHeartbeat();") &&
    app.includes("onHide()") &&
    app.includes("stopHeartbeat();"),
  "小程序进入前台时必须启动心跳，进入后台时必须停止",
);
assert(
  (auth.match(/syncHeartbeatSession\(\);/g) || []).length >= 2,
  "登录和退出后都必须立即同步心跳会话",
);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Heartbeat checks passed.");
}

async function verifyCredentialRecovery() {
  const strict = require("node:assert/strict");
  const ts = require("typescript");
  const compiled = ts.transpileModule(heartbeat, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const invalid = {
    status: "invalid",
    checkedAt: null,
    errorCode: "SWU_AUTH_FAILED",
  };
  const verified = {
    status: "verified",
    checkedAt: "2026-09-11T14:00:00.000Z",
    errorCode: null,
  };
  let session = { token: "session-a", credential: invalid };
  let tick;
  let resolveResponse;
  let rejectResponse;
  let writes = 0;
  const moduleRecord = { exports: {} };
  new Function(
    "module",
    "exports",
    "require",
    "setInterval",
    "clearInterval",
    compiled,
  )(
    moduleRecord,
    moduleRecord.exports,
    (specifier) => {
      if (specifier === "../store/session")
        return {
          getSession: () => session,
          captureSessionLease: () => ({ token: session.token }),
          isSessionLeaseCurrent: (lease) => lease?.token === session?.token,
          updateSessionCredential: (credential) => {
            writes += 1;
            session = { ...session, credential };
          },
        };
      if (specifier === "./request")
        return {
          apiRequest: (url, options) => {
            strict.equal(url, "/auth/heartbeat");
            strict.equal(options.allowInvalidCredential, true);
            return new Promise((resolve, reject) => {
              resolveResponse = resolve;
              rejectResponse = reject;
            });
          },
        };
      throw new Error(`Unexpected heartbeat import: ${specifier}`);
    },
    (callback) => {
      tick = callback;
      return 1;
    },
    () => {},
  );
  const respond = async (response) => {
    resolveResponse(response);
    await new Promise(setImmediate);
  };
  moduleRecord.exports.startHeartbeat();
  await respond({ alive: true, credential: verified });
  strict.equal(
    session.credential.status,
    "verified",
    "heartbeat must release the cached invalid state",
  );
  strict.equal(writes, 1);
  tick();
  await respond({ alive: true, credential: { ...verified } });
  strict.equal(
    writes,
    1,
    "unchanged heartbeats must not rewrite session storage",
  );

  session.credential = invalid;
  tick();
  session = { token: "session-b", credential: invalid };
  await respond({ alive: true, credential: verified });
  strict.equal(
    session.credential.status,
    "invalid",
    "old account response must not change the new session",
  );
  tick();
  session.credential = { ...invalid, checkedAt: "2026-09-11T14:01:00.000Z" };
  await respond({ alive: true, credential: verified });
  strict.equal(
    writes,
    1,
    "a late heartbeat must not overwrite a newer credential decision",
  );

  tick();
  await respond({ alive: true });
  strict.equal(
    writes,
    1,
    "older servers without a credential field remain compatible",
  );
  tick();
  rejectResponse(new Error("offline"));
  await new Promise(setImmediate);
  strict.equal(writes, 1);
  moduleRecord.exports.stopHeartbeat();
  console.log(
    "Heartbeat credential recovery, stale response and account isolation checks passed.",
  );
}

verifyCredentialRecovery().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
