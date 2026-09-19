#!/usr/bin/env node

import { randomBytes, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const DEFAULT_BUS_URL = "wss://youche.jhcampus.net:8914";
const DEFAULT_SCHOOL_ID = "189";
const DEFAULT_BUS_TIMEOUT_MS = 10_000;
const DEFAULT_LOCATION_TIMEOUT_MS = 90_000;

function parseArguments(argv) {
  const options = {
    busUrl: DEFAULT_BUS_URL,
    schoolId: DEFAULT_SCHOOL_ID,
    timeoutMs: DEFAULT_BUS_TIMEOUT_MS,
    locationTimeoutMs: DEFAULT_LOCATION_TIMEOUT_MS,
    includeUserLocation: true,
    latitude: null,
    longitude: null,
    manualCoordinateSystem: "gcj02",
    openBrowser: true,
    redact: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--bus-url") {
      options.busUrl = argv[++index];
    } else if (argument === "--school-id") {
      options.schoolId = argv[++index];
    } else if (argument === "--timeout") {
      options.timeoutMs = Number(argv[++index]);
    } else if (argument === "--location-timeout") {
      options.locationTimeoutMs = Number(argv[++index]);
    } else if (argument === "--latitude") {
      options.latitude = Number(argv[++index]);
    } else if (argument === "--longitude") {
      options.longitude = Number(argv[++index]);
    } else if (argument === "--coordinate-system") {
      options.manualCoordinateSystem = String(argv[++index] || "").toLowerCase();
    } else if (argument === "--no-user-location") {
      options.includeUserLocation = false;
    } else if (argument === "--no-open") {
      options.openBrowser = false;
    } else if (argument === "--redact") {
      options.redact = true;
    } else if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.busUrl) throw new Error("--bus-url requires a value");
  if (!options.schoolId) throw new Error("--school-id requires a value");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number of milliseconds");
  }
  if (
    !Number.isFinite(options.locationTimeoutMs) ||
    options.locationTimeoutMs <= 0
  ) {
    throw new Error(
      "--location-timeout must be a positive number of milliseconds",
    );
  }
  if (!new Set(["gcj02", "wgs84"]).has(options.manualCoordinateSystem)) {
    throw new Error('--coordinate-system must be either "gcj02" or "wgs84"');
  }

  const hasLatitude = options.latitude !== null;
  const hasLongitude = options.longitude !== null;
  if (hasLatitude !== hasLongitude) {
    throw new Error("--latitude and --longitude must be supplied together");
  }
  if (
    hasLatitude &&
    (!isValidLatitude(options.latitude) || !isValidLongitude(options.longitude))
  ) {
    throw new Error("The supplied latitude or longitude is invalid");
  }
  if (!options.includeUserLocation && hasLatitude) {
    throw new Error(
      "--no-user-location cannot be combined with --latitude/--longitude",
    );
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/reproduce-shuttle-location.mjs [options]

Options:
  --school-id <id>           School ID (default: ${DEFAULT_SCHOOL_ID}, Southwest University)
  --bus-url <url>            Shuttle WebSocket endpoint
                             (default: ${DEFAULT_BUS_URL})
  --timeout <ms>             Vehicle request timeout (default: ${DEFAULT_BUS_TIMEOUT_MS})
  --location-timeout <ms>    Browser location timeout (default: ${DEFAULT_LOCATION_TIMEOUT_MS})
  --latitude <number>        Use a supplied user latitude instead of browser location
  --longitude <number>       Use a supplied user longitude instead of browser location
  --coordinate-system <name> Coordinate system for supplied coordinates: gcj02 or wgs84
                             (default: gcj02)
  --no-user-location         Query vehicles only; do not open a location page
  --no-open                  Print the location URL instead of opening a browser
  --redact                   Verify results without printing coordinates or vehicle IDs
  -h, --help                 Show this help

No CDP connection, mini-program login, token, or package installation is needed.
Each run sends one request with a random seven-digit user ID and longitude=0,
latitude=0. It never enumerates adjacent IDs.
Browser location remains local and is never uploaded to the shuttle service.`);
}

function isValidLatitude(value) {
  return Number.isFinite(value) && Math.abs(value) <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && Math.abs(value) <= 180;
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function openWebSocket(url, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(socket), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error(`WebSocket connection failed: ${url}`)),
        { once: true },
      );
    }),
    timeoutMs,
    `Timed out connecting to ${url}`,
  );
}

function parseBusPayload(payload, schoolId) {
  const records = JSON.parse(payload);
  if (!Array.isArray(records)) {
    throw new Error("Vehicle payload is not an array");
  }

  return records.flatMap((record) => {
    const fields = String(record).split(",");
    const longitude = Number(fields[2]);
    const latitude = Number(fields[3]);
    if (
      String(fields[5]) !== String(schoolId) ||
      !isValidLongitude(longitude) ||
      !isValidLatitude(latitude) ||
      longitude === 0 ||
      latitude === 0
    ) {
      return [];
    }

    return [
      {
        id: Number(fields[0]),
        speed: Number(fields[1]),
        longitude,
        latitude,
        direction: Number(fields[6]),
        vehicleNo: fields[7] || "",
        lineId: fields[8] || "",
        state: fields[10] || "",
      },
    ];
  });
}

function hasObviousDigitRun(value) {
  for (let index = 0; index <= value.length - 3; index += 1) {
    const first = Number(value[index]);
    const second = Number(value[index + 1]);
    const third = Number(value[index + 2]);
    if (
      (first === second && second === third) ||
      (second === first + 1 && third === second + 1) ||
      (second === first - 1 && third === second - 1)
    ) {
      return true;
    }
  }
  return false;
}

function createAnonymousUserId() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(randomInt(1_000_000, 10_000_000));
    if (!hasObviousDigitRun(candidate)) return candidate;
  }
  throw new Error("Could not generate a suitable anonymous user ID");
}

async function readBusLocations(busUrl, schoolId, timeoutMs) {
  const socket = await openWebSocket(busUrl, timeoutMs);
  const anonymousUserId = createAnonymousUserId();
  const requestFrame = [
    "1",
    anonymousUserId,
    "0",
    "0",
    String(Math.floor(Date.now() / 1000)),
    schoolId,
    "0",
  ].join(",");

  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener("message", (event) => {
          const frame = String(event.data);
          if (frame === "pong") return;

          const separator = frame.indexOf("|");
          if (separator < 0 || frame.slice(0, separator) !== "5") return;

          try {
            resolve(parseBusPayload(frame.slice(separator + 1), schoolId));
          } catch (error) {
            reject(error);
          }
        });
        socket.addEventListener(
          "error",
          () => reject(new Error(`Vehicle WebSocket failed: ${busUrl}`)),
          { once: true },
        );
        socket.addEventListener(
          "close",
          () => reject(new Error("Vehicle WebSocket closed before a type-5 frame arrived")),
          { once: true },
        );
        socket.send(requestFrame);
      }),
      timeoutMs,
      "Timed out waiting for a type-5 vehicle frame",
    );
  } finally {
    socket.close();
  }
}

function transformLatitude(x, y) {
  let result =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  result +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) /
    3;
  result +=
    ((160 * Math.sin((y / 12) * Math.PI) +
      320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3;
  return result;
}

function transformLongitude(x, y) {
  let result =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  result +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) /
    3;
  result +=
    ((150 * Math.sin((x / 12) * Math.PI) +
      300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3;
  return result;
}

function isOutsideChina(latitude, longitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function wgs84ToGcj02(latitude, longitude) {
  if (isOutsideChina(latitude, longitude)) return { latitude, longitude };

  const semiMajorAxis = 6_378_245;
  const eccentricitySquared = 0.006693421622965943;
  let latitudeDelta = transformLatitude(longitude - 105, latitude - 35);
  let longitudeDelta = transformLongitude(longitude - 105, latitude - 35);
  const radians = (latitude / 180) * Math.PI;
  let magic = Math.sin(radians);
  magic = 1 - eccentricitySquared * magic * magic;
  const squareRootMagic = Math.sqrt(magic);
  latitudeDelta =
    (latitudeDelta * 180) /
    (((semiMajorAxis * (1 - eccentricitySquared)) / (magic * squareRootMagic)) *
      Math.PI);
  longitudeDelta =
    (longitudeDelta * 180) /
    ((semiMajorAxis / squareRootMagic) * Math.cos(radians) * Math.PI);
  return {
    latitude: latitude + latitudeDelta,
    longitude: longitude + longitudeDelta,
  };
}

function suppliedLocation(options) {
  if (options.latitude === null || options.longitude === null) return null;
  const converted =
    options.manualCoordinateSystem === "wgs84"
      ? wgs84ToGcj02(options.latitude, options.longitude)
      : { latitude: options.latitude, longitude: options.longitude };
  return {
    ok: true,
    source: "command-line",
    coordinateSystem: "gcj02",
    latitude: converted.latitude,
    longitude: converted.longitude,
    accuracy: null,
    rawWgs84:
      options.manualCoordinateSystem === "wgs84"
        ? { latitude: options.latitude, longitude: options.longitude }
        : null,
  };
}

function browserLocationPage(token, nonce, timeoutMs) {
  const script = `
    const status = document.getElementById("status");
    const detail = document.getElementById("detail");
    function send(path, value) {
      return fetch(path + "?token=${token}", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
    }
    if (!navigator.geolocation) {
      status.textContent = "此浏览器不支持定位";
      send("/error", { message: "navigator.geolocation is unavailable" });
    } else {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          await send("/location", {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp,
          });
          status.textContent = "定位完成";
          detail.textContent = "结果已返回脚本，可以关闭此页面。";
        },
        async (error) => {
          await send("/error", {
            code: error.code,
            message: error.message || "浏览器定位失败",
          });
          status.textContent = "定位失败";
          detail.textContent = error.message || "请允许浏览器访问位置后重试。";
        },
        { enableHighAccuracy: true, timeout: ${Math.max(1_000, timeoutMs - 5_000)}, maximumAge: 0 },
      );
    }
  `;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>获取当前位置</title>
  <style nonce="${nonce}">
    body { font: 16px/1.6 system-ui, sans-serif; max-width: 34rem; margin: 12vh auto; padding: 0 1.5rem; }
    h1 { font-size: 1.5rem; }
    p { color: #777; }
  </style>
</head>
<body>
  <h1 id="status">正在获取位置…</h1>
  <p id="detail">请在浏览器提示中允许此页面访问位置。</p>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

function readRequestBody(request, maximumBytes = 16_384) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maximumBytes) {
        reject(new Error("Location response was too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function openDefaultBrowser(url) {
  const commands = {
    win32: ["rundll32.exe", ["url.dll,FileProtocolHandler", url]],
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
  };
  const command = commands[process.platform];
  if (!command) return false;

  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function readBrowserLocation(options) {
  const token = randomBytes(24).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  let settle;
  const locationResult = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const authorized = requestUrl.searchParams.get("token") === token;

      if (request.method === "GET" && requestUrl.pathname === `/${token}`) {
        const page = browserLocationPage(token, nonce, options.locationTimeoutMs);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'`,
          "permissions-policy": "geolocation=(self)",
          "x-content-type-options": "nosniff",
        });
        response.end(page);
        return;
      }

      if (!authorized || request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }

      const body = JSON.parse(await readRequestBody(request));
      response.writeHead(204).end();

      if (requestUrl.pathname === "/error") {
        settle.reject(
          new Error(
            `Browser location failed: ${body.message || `error code ${body.code || "unknown"}`}`,
          ),
        );
        return;
      }
      if (requestUrl.pathname !== "/location") return;

      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
        settle.reject(new Error("Browser returned an invalid location"));
        return;
      }
      const converted = wgs84ToGcj02(latitude, longitude);
      settle.resolve({
        ok: true,
        source: "browser-geolocation",
        coordinateSystem: "gcj02",
        latitude: converted.latitude,
        longitude: converted.longitude,
        accuracy: Number.isFinite(Number(body.accuracy))
          ? Number(body.accuracy)
          : null,
        altitude: Number.isFinite(Number(body.altitude))
          ? Number(body.altitude)
          : null,
        speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : null,
        heading: Number.isFinite(Number(body.heading))
          ? Number(body.heading)
          : null,
        timestamp: Number.isFinite(Number(body.timestamp))
          ? Number(body.timestamp)
          : null,
        rawWgs84: { latitude, longitude },
      });
    } catch (error) {
      if (!response.headersSent) response.writeHead(400);
      response.end();
      settle.reject(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/${token}`;
  if (!options.openBrowser || !openDefaultBrowser(url)) {
    console.error(`Open this local URL to provide the user location:\n${url}`);
  }

  try {
    return await withTimeout(
      locationResult,
      options.locationTimeoutMs,
      "Timed out waiting for browser location. Allow location access and retry, or use --latitude/--longitude.",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function redactOutput(result) {
  return {
    schoolId: result.schoolId,
    protocol: result.protocol,
    userLocation: result.userLocation
      ? {
          ok: result.userLocation.ok,
          source: result.userLocation.source,
          coordinateSystem: result.userLocation.coordinateSystem,
          hasCoordinates:
            Number.isFinite(result.userLocation.latitude) &&
            Number.isFinite(result.userLocation.longitude),
          hasAccuracy: Number.isFinite(result.userLocation.accuracy),
        }
      : null,
    buses: {
      count: result.buses.length,
      fields: result.buses.length ? Object.keys(result.buses[0]) : [],
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manualLocation = suppliedLocation(options);
  const userLocationPromise = !options.includeUserLocation
    ? Promise.resolve(null)
    : manualLocation
      ? Promise.resolve(manualLocation)
      : readBrowserLocation(options);

  const [userLocation, buses] = await Promise.all([
    userLocationPromise,
    readBusLocations(options.busUrl, options.schoolId, options.timeoutMs),
  ]);

  const result = {
    schoolId: options.schoolId,
    protocol: {
      vehicleWebSocket: options.busUrl,
      requestFrame:
        "1,<randomSevenDigitUserId>,0,0,<unixSeconds>,<schoolId>,0",
      responseFrame: "5|<JSON array of comma-separated vehicle records>",
      originalUserLocationApi: 'wx.getLocation({ type: "gcj02" })',
      standaloneUserLocationApi: "navigator.geolocation (WGS-84 → GCJ-02)",
    },
    userLocation,
    buses,
  };

  console.log(JSON.stringify(options.redact ? redactOutput(result) : result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
