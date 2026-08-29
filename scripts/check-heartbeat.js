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
