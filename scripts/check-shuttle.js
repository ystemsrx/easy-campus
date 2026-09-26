/* Tests the actual TypeScript modules in a deterministic WeChat host, not a replacement implementation.
 * Native rendering and real permission dialogs still require WeChat DevTools and physical devices. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const backend =
  process.env.SHUTTLE_BACKEND_ROOT || path.resolve(__dirname, "../../backend");
const { CampusMapStore } = require(path.join(backend, "src/shuttle/map-store"));
const map = new CampusMapStore({
  file:
    process.env.SHUTTLE_MAP_FILE ||
    path.join(backend, "data/campus-shuttle.campusmap.json"),
}).current;
let passed = 0;
const tests = [];
function test(name, run) {
  tests.push([name, run]);
}
function harness(options = {}) {
  const cache = new Map(),
    storage = options.storage || new Map(),
    calls = [],
    jobs = new Map(),
    frames = new Map();
  let frameId = 0;
  const canvasContext = {
    scale() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
  };
  const canvas = {
    getContext: () => canvasContext,
    requestAnimationFrame(fn) {
      frames.set(++frameId, fn);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  let id = 0,
    pageOptions,
    componentOptions,
    owner = "42",
    listener,
    locationError;
  const lease = () => ({ userId: owner, sessionId: "session-" + owner });
  const raw = {
    longitude: 106.423456789,
    latitude: 29.821234567,
    accuracy: 5,
    altitude: 320,
    speed: 0,
    horizontalAccuracy: 6,
    verticalAccuracy: 0,
    unknownField: { exact: true },
  };
  const native = {
    addMarkers(o) {
      calls.push(["addMarkers", o]);
    },
    removeMarkers(o) {
      calls.push(["removeMarkers", o]);
    },
    moveAlong(o) {
      calls.push(["moveAlong", o]);
    },
    translateMarker(o) {
      calls.push(["translateMarker", o]);
    },
    includePoints(o) {
      calls.push(["includePoints", o]);
    },
    getRegion(o) {
      o.success({
        southwest: { longitude: 106.413, latitude: 29.812 },
        northeast: { longitude: 106.434, latitude: 29.83 },
      });
      o.complete?.();
    },
  };
  const toast = {
    show(v) {
      calls.push(["toast", v]);
    },
  };
  const wx = {
    getStorageSync(k) {
      return storage.has(k) ? structuredClone(storage.get(k)) : undefined;
    },
    setStorageSync(k, v) {
      storage.set(k, structuredClone(v));
    },
    removeStorageSync(k) {
      storage.delete(k);
    },
    getSetting(o) {
      calls.push(["getSetting"]);
      o.success({
        authSetting: {
          "scope.userLocation": Object.hasOwn(options, "permission")
            ? options.permission
            : true,
        },
      });
    },
    getPrivacySetting(o) {
      o.success({
        needAuthorization: options.privacyNeeded ?? false,
        privacyContractName: "测试隐私保护指引",
      });
    },
    requirePrivacyAuthorize(o) {
      calls.push(["privacy"]);
      o.success();
    },
    authorize(o) {
      calls.push(["authorize"]);
      options.deny ? o.fail({ errMsg: "auth deny" }) : o.success();
    },
    openSetting(o) {
      calls.push(["openSetting"]);
      o.success({ authSetting: { "scope.userLocation": !options.deny } });
    },
    showModal(o) {
      calls.push(["modal", o]);
      for (const key of ["confirmText", "cancelText"]) {
        if (o[key] && Array.from(o[key]).length > 4) {
          o.fail?.({ errMsg: "showModal:fail " + key + " length exceeds 4" });
          return;
        }
      }
      o.success({ confirm: !options.deny, cancel: !!options.deny });
    },
    hideKeyboard() {},
    getLocation(o) {
      calls.push(["getLocation"]);
      if (options.deferLocation) options.deferLocation(o);
      else if (options.locationError) o.fail(options.locationError);
      else o.success(structuredClone(raw));
    },
    onLocationChange(fn) {
      listener = fn;
      calls.push(["onLocationChange"]);
    },
    offLocationChange(fn) {
      assert.equal(fn, listener);
      listener = undefined;
      calls.push(["offLocationChange"]);
    },
    onLocationChangeError(fn) {
      locationError = fn;
    },
    offLocationChangeError(fn) {
      if (locationError === fn) locationError = undefined;
    },
    startLocationUpdate(o) {
      calls.push(["startLocationUpdate"]);
      o.success();
    },
    stopLocationUpdate() {
      calls.push(["stopLocationUpdate"]);
    },
    getWindowInfo() {
      return {
        windowWidth: 375,
        windowHeight: 812,
        screenHeight: 812,
        statusBarHeight: 44,
        safeArea: { bottom: 778 },
      };
    },
    createMapContext() {
      return native;
    },
    connectSocket() {
      throw Error("Unexpected client websocket");
    },
    navigateBack(o) {
      calls.push(["navigateBack"]);
      o.success?.();
    },
    switchTab(o) {
      calls.push(["switchTab", o]);
    },
  };
  const api = async (url, o = {}) => {
    calls.push(["request", url, structuredClone(o)]);
    if (options.api) return options.api(url, o);
    if (url.endsWith("/map")) return structuredClone(map);
    if (url.endsWith("/walking") && options.walking) return options.walking(o);
    if (url.endsWith("/walking"))
      return {
        revision: map.revision,
        legs: [{ stopId: o.data.stopIds[0], available: false }],
      };
    if (url.endsWith("/consent"))
      return {
        accepted: options.consent ?? true,
        version: "shuttle-location-v1",
      };
    if (url.endsWith("/locations"))
      return o.method === "DELETE"
        ? { deleted: true }
        : {
            accepted: o.data.points.map((p) => ({
              captureSession: p.captureSession,
              seq: p.seq,
            })),
          };
    if (url.endsWith("/nearby"))
      return {
        type: "snapshot",
        protocol: 2,
        serverTime: Date.now(),
        fetchedAt: Date.now(),
        stale: false,
        available: true,
        mapRevision: map.revision,
        selectionValid: true,
        selection: { routeIds: [], filtered: false },
        vehicles: [],
        accepted: [o.data.point],
      };
    throw Error("Unexpected request " + url);
  };
  const mocks = {
    "store/session.ts": {
      captureSessionLease: lease,
      isSessionLeaseCurrent: (v) => v?.userId === owner,
      getSession: () => ({ user: { id: owner, account: "real" } }),
    },
    "services/request.ts": {
      apiRequest: api,
      getErrorMessage: (e, f) => e?.message || f,
    },
    "config/index.ts": {
      getApiUrl: (p) => "https://example.invalid/api/v1" + p,
    },
    "utils/app-share.ts": { buildAppShare: () => ({}) },
    "utils/appearance.ts": {
      syncWindowBackground: () => {},
      resolveAppearance: () => ({
        themeClass: "theme-light",
        motionClass: "motion-normal",
      }),
    },
    "utils/haptics.ts": { haptic: () => {} },
    "utils/navigation.ts": {
      ensureAuthenticated: () => true,
      navigateTo: async (url) => {
        calls.push(["navigateTo", url]);
        return true;
      },
    },
    "demo/identity.ts": { isDemoSession: () => false },
  };
  if (options.mockStream)
    mocks["features/services/shuttle-stream.ts"] = {
      ShuttleStream: class {
        constructor(point, handlers, manualOrigin) {
          this.manualOrigin = manualOrigin;
          this.point = point;
          this.handlers = handlers;
          calls.push(["streamConstruct", this]);
        }
        start(s) {
          calls.push(["streamStart", s]);
        }
        stop() {
          calls.push(["streamStop"]);
        }
        select(s) {
          calls.push(["streamSelect", s]);
        }
      },
    };
  function load(relative) {
    let file = path.resolve(root, relative);
    if (!file.endsWith(".ts")) file += ".ts";
    const rel = path.relative(root, file).replaceAll("\\", "/");
    if (mocks[rel]) return mocks[rel];
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const source = fs.readFileSync(file, "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    const context = {
      module: mod,
      exports: mod.exports,
      console,
      Date: options.clock
        ? class extends Date {
            static now() {
              return options.clock.now;
            }
          }
        : Date,
      Math,
      Promise,
      JSON,
      Map,
      Set,
      WeakMap,
      Error,
      Number,
      Array,
      Object,
      String,
      Boolean,
      wx,
      getCurrentPages: () => [
        { selectComponent: () => toast },
        { selectComponent: () => toast },
      ],
      getApp: () => ({ globalData: { preferences: { haptics: false } } }),
      Page: (o) => {
        pageOptions = o;
      },
      Component: (o) => {
        componentOptions = o;
      },
      setTimeout: (f, delay) => {
        jobs.set(++id, { f, delay, interval: false });
        return id;
      },
      clearTimeout: (n) => jobs.delete(n),
      setInterval: (f, delay) => {
        jobs.set(++id, { f, delay, interval: true });
        return id;
      },
      clearInterval: (n) => jobs.delete(n),
      require: (request) =>
        request.startsWith(".")
          ? load(path.resolve(path.dirname(file), request))
          : require(request),
    };
    vm.runInNewContext(js, context, { filename: file });
    return mod.exports;
  }
  function host(config, isComponent = false) {
    const h = {
      data: structuredClone(config.data),
      properties: { active: true, theme: "light" },
      setData(values) {
        if (Object.hasOwn(values, "polylines"))
          calls.push(["polylines", structuredClone(values.polylines)]);
        Object.assign(this.data, structuredClone(values));
      },
      selectComponent: () => toast,
      createSelectorQuery: () => ({
        select(selector) {
          this.selector = selector;
          return this;
        },
        fields(_options, cb) {
          if (options.canvas) cb({ node: canvas });
          return this;
        },
        boundingClientRect(cb) {
          cb({ height: this.selector === "#shuttle-navigation" ? 80 : 180 });
          return this;
        },
        exec() {},
      }),
    };
    const methods = isComponent ? config.methods : config;
    for (const [name, fn] of Object.entries(methods))
      if (typeof fn === "function") h[name] = fn.bind(h);
    return h;
  }
  return {
    load,
    wx,
    raw,
    calls,
    jobs,
    frames,
    canvas,
    canvasContext,
    storage,
    native,
    lease,
    changeUser: (v) => {
      owner = v;
    },
    getListener: () => listener,
    page(file = "features/pages/shuttle/index") {
      load(file);
      return host(pageOptions);
    },
    component() {
      load("components/shuttle-preview/index");
      return host(componentOptions, true);
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const clone = (v) => JSON.parse(JSON.stringify(v));
test("native location success registers consent without custom modals", async () => {
  const h = harness({ consent: false, permission: undefined });
  const raw = await h
    .load("features/utils/shuttle-authorization")
    .authorizeShuttleLocation();
  assert.equal(raw.longitude, h.raw.longitude);
  assert(
    !h.calls.some((c) => ["modal", "authorize", "privacy"].includes(c[0])),
  );
  const get = h.calls.findIndex((c) => c[0] === "getLocation");
  const post = h.calls.findIndex(
    (c) =>
      c[0] === "request" && c[1].endsWith("/consent") && c[2].method === "POST",
  );
  assert(get >= 0 && post > get);
});

test("native privacy failure logs the real error without registering consent or sending coordinates", async () => {
  const errMsg = "getLocation:fail privacy permission is not authorized";
  const h = harness({ consent: false, locationError: { errMsg } }),
    logs = [],
    original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    await assert.rejects(
      h.load("features/utils/shuttle-authorization").authorizeShuttleLocation(),
      /隐私/,
    );
  } finally {
    console.error = original;
  }
  assert(logs.some((a) => a.includes("getLocation") && a.includes(errMsg)));
  assert(!logs.flat().includes(h.raw.longitude));
  assert(
    !h.calls.some(
      (c) => c[0] === "modal" || (c[0] === "request" && c[2].method === "POST"),
    ),
  );
});

test("shuttle uses the shared navigation/theme and removes help actions from map controls", () => {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const wxml = read("features/pages/shuttle/index.wxml"),
    css = read("features/pages/shuttle/index.wxss");
  assert(
    wxml.includes(
      '<navigation-bar title="小易校车" back transparent theme="{{theme}}"',
    ),
  );
  assert(wxml.includes('class="page shuttle-page '));
  assert(!wxml.includes("西南大学 · 北碚校区"));
  assert(!wxml.includes('bindtap="showHelp"'));
  assert(!wxml.includes('bindtap="selectRoute"'));
  assert(wxml.includes('bindtap="openCommonSearch"'));
  assert.match(
    css,
    /\.search-entry\s*\{[^}]*height: 40px;[^}]*border-radius: 999px;/,
  );
  assert.match(css, /\.map-header\s*\{[^}]*background: var\(--color-bg\)/);
  assert(
    !read("pages/legal/index.wxml").includes('bindtap="deleteShuttleRecords"'),
  );
});
test("white road casings stay below continuous centerlines without losing or inventing edges", () => {
  const { roadPolylines } = harness().load("utils/shuttle-geo");
  const edgeKey = (a, b) =>
    [JSON.stringify(a), JSON.stringify(b)].sort().join("|");
  const edges = (lines) =>
    lines
      .flatMap((l) => l.points.slice(1).map((p, i) => edgeKey(l.points[i], p)))
      .sort();
  const before = JSON.stringify(map);
  for (const ids of [undefined, ...map.routes.map((r) => [r.id])]) {
    const lines = roadPolylines(map, ids, true);
    const colored = lines.filter((l) => l.color !== "#FFFFFF");
    const casings = lines.slice(0, colored.length);
    assert.equal(lines.length, colored.length * 2);
    casings.forEach((c, i) => {
      assert.equal(c.color, "#FFFFFF");
      assert.equal(c.width, colored[i].width + 2);
      assert.deepEqual(clone(c.points), clone(colored[i].points));
    });
    assert.deepEqual(clone(edges(colored)), edges(map.paths));
    assert(lines.every((l) => l.dottedLine === false && l.borderWidth === 0));
    assert(lines.length < map.paths.length);
    if (ids) {
      const selected = map.paths.filter((p) =>
        p.routeIds.some((id) => ids.includes(id)),
      );
      assert.deepEqual(
        clone(edges(colored.filter((l) => l.width === 2))),
        edges(selected),
      );
    }
  }
  assert.equal(JSON.stringify(map), before);
});
test("denied native location never creates application consent", async () => {
  const h = harness({
    permission: undefined,
    consent: false,
    locationError: { errMsg: "getLocation:fail auth deny" },
  });
  await assert.rejects(
    h.load("features/utils/shuttle-authorization").authorizeShuttleLocation(),
    /允许位置/,
  );
  assert(
    !h.calls.some(
      (c) => c[0] === "modal" || (c[0] === "request" && c[2].method === "POST"),
    ),
  );
});

test("native privacy rejection keeps search usable and explicit retry resumes positioning", async () => {
  const options = {
      mockStream: true,
      locationError: {
        errMsg: "getLocation:fail privacy permission is not authorized",
      },
    },
    h = harness(options),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert.equal(page.data.authorized, false);
  assert(page.data.polylines.length);
  page.openDestinationSearch();
  assert.equal(page.data.searchMounted, true);
  [...h.jobs.values()]
    .filter((j) => j.delay === 20)
    .at(-1)
    .f();
  page.onSearchInput({ detail: { value: "图书馆" } });
  assert(page.data.searchResults.length > 0);
  page.closeSearch();
  page.onHide();
  const count = h.calls.filter((c) => c[0] === "getLocation").length;
  page.onShow();
  await settle();
  assert.equal(h.calls.filter((c) => c[0] === "getLocation").length, count);
  options.locationError = undefined;
  page.retryActivation();
  await settle();
  assert.equal(page.data.authorized, true);
  assert.equal(h.calls.filter((c) => c[0] === "streamStart").length, 1);
  page.onUnload();
});

test("previous location denial exposes settings and enabling it resumes the same page", async () => {
  const options = { permission: false, mockStream: true },
    h = harness(options),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert.equal(page.data.gateAction, "settings");
  assert.equal(page.data.authorized, false);
  assert(page.data.polylines.length > 0);
  assert(
    !h.calls.some((c) =>
      ["getLocation", "authorize", "streamStart", "navigateBack"].includes(
        c[0],
      ),
    ),
  );
  options.permission = true;
  page.onLocationSettings({
    detail: { authSetting: { "scope.userLocation": true } },
  });
  await settle();
  assert.equal(page.data.authorized, true);
  page.onHide();
});
test("platform configuration failures and OS permissions are distinguished from refusal", async () => {
  const h = harness(),
    mod = h.load("features/utils/shuttle-authorization");
  assert.equal(
    mod.locationFailure(
      { errMsg: "getLocation:fail system permission denied" },
      "getLocation",
    ).action,
    "system",
  );
  const missing = mod.locationFailure(
    {
      errMsg:
        "getLocation:fail api scope is not declared in the privacy agreement",
      errno: 112,
    },
    "getLocation",
  );
  assert.equal(missing.action, "retry");
  assert(!missing.message.includes("未授权"));
  h.wx.getLocation = (o) =>
    o.fail({
      errno: 112,
      errMsg:
        "getLocation:fail api scope is not declared in the privacy agreement",
    });
  await assert.rejects(mod.authorizeShuttleLocation(), /当前版本暂时无法定位/);
  assert(!h.calls.some((c) => c[0] === "request" && c[2].method === "POST"));
});
test("hiding during native authorization never starts tracking or grants consent", async () => {
  let pending;
  const options = {
      mockStream: true,
      consent: false,
      deferLocation: (o) => (pending = o),
    },
    h = harness(options),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert(pending);
  page.onHide();
  pending.success(h.raw);
  await settle();
  assert.equal(page.data.locating, false);
  assert(
    !h.calls.some(
      (c) =>
        c[0] === "startLocationUpdate" ||
        (c[0] === "request" && c[2].method === "POST"),
    ),
  );
  options.deferLocation = undefined;
  page.onShow();
  page.retryActivation();
  await settle();
  assert.equal(page.data.authorized, true);
  page.onUnload();
});

test("settings recovery remains native and custom privacy dialogs are absent", () => {
  const wxml = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  assert(!wxml.includes("privacy-mask"));
  assert(!wxml.includes("agreePrivacyAuthorization"));
  assert(wxml.includes('open-type="openSetting"'));
  assert(wxml.includes('bindopensetting="onLocationSettings"'));
  assert(wxml.includes('bindkeyboardheightchange="onSearchKeyboard"'));
});

test("all 10 real routes produce valid ordered, connected tracks", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  for (const route of map.routes) {
    const track = planner.track(route);
    assert(track, route.name);
    assert.equal(track.stops.length, route.orderedStops.length);
    assert(
      track.points.every(
        (p) => Number.isFinite(p.longitude) && Number.isFinite(p.latitude),
      ),
    );
  }
});
test("a direct plan has downstream stops; a far-away destination never fabricates a route", () => {
  const { ShuttlePlanner } = harness().load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  for (const route of map.routes) {
    const a = map.places.find((p) => p.id === route.orderedStops[0].stopId),
      b = map.places.find((p) => p.id === route.orderedStops[3].stopId);
    assert(planner.plans(a, b, a.id, route.id).length > 0, route.name);
  }
  assert.equal(
    planner.plans(map.center, { longitude: 0, latitude: 0 }).length,
    0,
  );
});
test("large missing roads are not silently connected by the six-metre endpoint tolerance", () => {
  const { ShuttleRoadGraph } = harness().load("features/utils/shuttle-routing");
  const p = (x) => ({ longitude: 106 + x, latitude: 29 });
  const graph = new ShuttleRoadGraph(
    {
      paths: [
        { routeIds: ["r"], points: [p(0), p(0.001)], direction: "both" },
        { routeIds: ["r"], points: [p(0.005), p(0.006)], direction: "both" },
      ],
    },
    "r",
  );
  assert.equal(graph.path(p(0.0001), p(0.0059)), null);
});
test("no ETA on stale positions or missing direction", () => {
  const { ShuttlePlanner } = harness().load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map),
    route = map.routes[0],
    board = map.places.find((p) => p.id === route.stopIds[0]);
  const bus = { ...board, id: "b", lineId: route.id, direction: null };
  assert.equal(planner.arrival(bus, board, false).seconds, null);
  assert.equal(
    planner.arrival({ ...bus, direction: 90 }, board, true).seconds,
    null,
  );
});
test("edge indicators disappear inside the viewport and always intersect a true edge outside", () => {
  const { edgeIntersection } = harness().load("features/utils/shuttle-screen"),
    r = { left: 20, right: 350, top: 70, bottom: 420 };
  assert.equal(edgeIntersection({ x: 100, y: 150 }, r), null);
  for (const p of [
    { x: -100, y: 300 },
    { x: 800, y: 50 },
    { x: 100, y: -60 },
    { x: 250, y: 1000 },
  ]) {
    const q = edgeIntersection(p, r);
    assert(q);
    assert(
      Math.abs(q.x - r.left) < 1e-6 ||
        Math.abs(q.x - r.right) < 1e-6 ||
        Math.abs(q.y - r.top) < 1e-6 ||
        Math.abs(q.y - r.bottom) < 1e-6,
    );
  }
});
test("vehicle IDs survive reordered snapshots; crossings never move or shrink their map icons", () => {
  const h = harness(),
    { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion");
  const animation = new ShuttleMapMotion(
    h.native,
    { motionPath: (_r, a, b) => [a, b] },
    false,
  );
  const a = {
      id: "a",
      vehicleNo: "1",
      lineId: "r",
      longitude: 106,
      latitude: 29,
      direction: 0,
    },
    b = { ...a, id: "b", vehicleNo: "2", longitude: 106.0001 };
  animation.update([a, b], 100, false);
  const ids = animation.positions().map((v) => [v.bus.id, v.id]);
  animation.update(
    [
      { ...b, longitude: 106 },
      { ...a, longitude: 106.0001 },
    ],
    200,
    false,
  );
  assert.deepEqual(
    clone(animation.positions().map((v) => [v.bus.id, v.id])),
    clone(ids),
  );
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 4);
  assert(
    h.calls
      .filter((c) => c[0] === "addMarkers")
      .flatMap((c) => c[1].markers)
      .filter((m) => m.id < 100000)
      .every((m) => m.width === 32),
  );
  animation.update([a, b], 200, false);
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 4);
  animation.freeze();
  assert(animation.positions().every((v) => Number.isFinite(v.point.latitude)));
  animation.clear();
  assert.equal(animation.positions().length, 0);
});
test("a single GPS outlier never draws a long fictional drive", () => {
  const h = harness(),
    { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion"),
    m = new ShuttleMapMotion(
      h.native,
      { motionPath: (_r, a, b) => [a, b] },
      false,
    );
  const bus = {
    id: "a",
    lineId: "r",
    vehicleNo: "1",
    longitude: 106,
    latitude: 29,
    direction: 0,
  };
  m.update([bus], 1, false);
  m.update([{ ...bus, longitude: 108 }], 2, false);
  assert.equal(m.positions()[0].point.longitude, 106);
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 0);
});
test("outbox retains every callback and all raw fields until acknowledged", async () => {
  const h = harness(),
    { ShuttleLocationRecorder } = h.load("utils/shuttle-location");
  const rec = new ShuttleLocationRecorder({
    status() {},
    fatal: (m) => {
      throw Error(m);
    },
  });
  rec.start();
  const a = rec.record(h.raw, "change"),
    b = rec.record(h.raw, "change");
  assert.notEqual(a.seq, b.seq);
  assert.equal([...h.storage.values()][0].length, 2);
  assert.deepEqual(clone(a.raw), h.raw);
  await rec.flush();
  assert.equal([...h.storage.values()][0].length, 0);
  rec.stop();
});
test("home-to-map overlap cannot erase newly captured samples with an old ACK", async () => {
  let release;
  const h = harness({
    api: (url, o) =>
      url.endsWith("/locations")
        ? new Promise((resolve) => {
            release = () => resolve({ accepted: o.data.points });
          })
        : Promise.reject(Error(url)),
  });
  const { ShuttleLocationRecorder } = h.load("utils/shuttle-location"),
    cb = {
      status() {},
      fatal: (m) => {
        throw Error(m);
      },
    },
    home = new ShuttleLocationRecorder(cb);
  home.start();
  home.record(h.raw, "preview");
  const flight = home.flush();
  const mapRec = new ShuttleLocationRecorder(cb);
  mapRec.start();
  const b = mapRec.record({ ...h.raw, longitude: 107 }, "change");
  release();
  await flight;
  const remaining = [...h.storage.values()][0];
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].captureSession, b.captureSession);
  home.stop();
  mapRec.discard();
});
test("failed upload stays durable; another account cannot upload the previous account's queue", async () => {
  const h = harness({
      api: async () => {
        throw Error("offline");
      },
    }),
    { ShuttleLocationRecorder } = h.load("utils/shuttle-location");
  const rec = new ShuttleLocationRecorder({ status() {}, fatal() {} });
  rec.start();
  rec.record(h.raw, "change");
  await rec.flush();
  assert.equal([...h.storage.values()][0].length, 1);
  const count = h.calls.filter((c) => c[0] === "request").length;
  h.changeUser("99");
  await rec.flush();
  assert.equal(h.calls.filter((c) => c[0] === "request").length, count);
  rec.stop();
});
test("unauthorized home preview performs no getLocation, authorize, nearby fetch or client WebSocket", async () => {
  const h = harness({ permission: false }),
    component = h.component();
  await component.activate();
  assert.equal(component.data.loaded, true);
  assert.equal(component.data.authorized, false);
  assert.equal(
    h.calls.filter((c) =>
      ["getLocation", "authorize", "privacy"].includes(c[0]),
    ).length,
    0,
  );
  assert(!h.calls.some((c) => c[0] === "request" && c[1].endsWith("/nearby")));
  component.deactivate();
  assert.equal(h.jobs.size, 0);
});
test("authorized home preview uses nearby HTTP and schedules ten-second refresh without WebSocket", async () => {
  const h = harness(),
    component = h.component();
  await component.activate();
  await settle();
  assert(h.calls.some((c) => c[0] === "request" && c[1].endsWith("/nearby")));
  assert(
    [...h.jobs.values()].some(
      (j) => !j.interval && j.delay >= 9500 && j.delay <= 10000,
    ),
  );
  component.deactivate();
});
test("a denied home click opens the route map without any permission or location request", async () => {
  const h = harness({ permission: false, deny: true }),
    component = h.component();
  await component.openShuttle();
  assert(h.calls.some((c) => c[0] === "navigateTo"));
  assert(
    !h.calls.some((c) =>
      ["getSetting", "privacy", "authorize", "getLocation", "toast"].includes(
        c[0],
      ),
    ),
  );
});
test("a late preview location callback after hiding is still recorded, but cannot update UI", async () => {
  let pending;
  const h = harness({
      deferLocation: (o) => {
        pending = o;
      },
    }),
    component = h.component();
  await component.activate();
  await settle();
  assert(pending);
  component.deactivate();
  pending.success(h.raw);
  await settle();
  assert(
    h.calls.some(
      (c) =>
        c[0] === "request" &&
        c[1].endsWith("/locations") &&
        c[2].data.points.length === 1,
    ),
  );
  assert(!h.calls.some((c) => c[0] === "request" && c[1].endsWith("/nearby")));
});
test("map lifecycle requests foreground updates, owns one stream, and detaches everything on hide", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  assert.equal(page.data.authorized, true);
  assert.equal(h.calls.filter((c) => c[0] === "streamStart").length, 1);
  assert.equal(h.calls.filter((c) => c[0] === "startLocationUpdate").length, 1);
  const listener = h.getListener();
  assert(listener);
  listener({ ...h.raw, longitude: 106.424, extraNewField: 42 });
  await settle();
  page.onHide();
  assert(!h.getListener());
  assert.equal(h.calls.filter((c) => c[0] === "streamStop").length, 1);
  assert(h.calls.some((c) => c[0] === "stopLocationUpdate"));
  page.onUnload();
});
test("a queued native map callback after onHide is durably stored without reopening tracking", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  const listener = h.getListener();
  page.onHide();
  await settle();
  const before = h.calls.filter((c) => c[0] === "streamStart").length;
  listener({ ...h.raw, bridgeQueuedField: "retained" });
  await settle();
  assert(
    h.calls.some(
      (c) =>
        c[0] === "request" &&
        c[1].endsWith("/locations") &&
        c[2].data?.points?.some((p) => p.raw.bridgeQueuedField === "retained"),
    ),
  );
  assert.equal(h.calls.filter((c) => c[0] === "streamStart").length, before);
  assert(!h.getListener());
  page.onUnload();
});
test("a pending deletion from an older client completes before native authorization and does not deadlock the map", async () => {
  let attempts = 0;
  const storage = new Map([["easy-swu:shuttle:deleting:42", true]]);
  const h = harness({
      storage,
      mockStream: true,
      api: async (url, o) => {
        if (url.endsWith("/map")) return structuredClone(map);
        if (url.endsWith("/consent")) return { accepted: true };
        if (o.method === "DELETE") {
          if (++attempts === 1) throw Error("offline");
          return { deleted: true };
        }
        if (url.endsWith("/locations")) return { accepted: [] };
        throw Error(url);
      },
    }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert.equal(page.data.authorized, false);
  assert.equal(storage.get("easy-swu:shuttle:deleting:42"), true);
  assert(!h.calls.some((c) => c[0] === "getLocation"));
  page.retryActivation();
  await settle();
  assert.equal(page.data.authorized, true);
  assert.equal(attempts, 2);
  assert(!storage.has("easy-swu:shuttle:deleting:42"));
  page.onUnload();
});

test("all WXML handlers exist on the real page", () => {
  const h = harness(),
    page = h.page(),
    source = fs.readFileSync(
      path.join(root, "features/pages/shuttle/index.wxml"),
      "utf8",
    );
  for (const [, name] of source.matchAll(
    /(?:bind|catch)[a-z-]+="([A-Za-z]\w*)"/g,
  ))
    assert.equal(typeof page[name], "function", name);
});

test("a cached campus map renders offline and a forced refresh preserves the last valid map", async () => {
  const storage = new Map([["easy-swu:shuttle:map:v1", structuredClone(map)]]);
  const h = harness({
    storage,
    api: async () => {
      throw Error("offline");
    },
  });
  const service = h.load("services/shuttle");
  assert.equal((await service.getShuttleMap()).revision, map.revision);
  await settle();
  await assert.rejects(service.getShuttleMap(true), /offline/);
  assert.equal(storage.get("easy-swu:shuttle:map:v1").revision, map.revision);
});
test("new map metadata replaces an old cached map after location denial without clearing saved places", async () => {
  const old = structuredClone(map),
    target = map.places.find((p) => p.shortName === "计信院");
  old.revision = "legacy-map";
  old.places.forEach((p) => {
    delete p.shortName;
    delete p.aliases;
  });
  const h = harness({
      permission: false,
      mockStream: true,
      storage: new Map([
        ["easy-swu:shuttle:map:v1", old],
        [
          "easy-swu:shuttle:common-places:42",
          [
            {
              ...target,
              shortName: undefined,
              key: `place:${target.id}`,
              placeId: target.id,
            },
          ],
        ],
      ]),
    }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert.equal(page.data.authorized, false);
  assert.equal(page.data.commonPlaces.length, 1);
  assert.equal(page.data.commonPlaces[0].shortName, "计信院");
  page.openCommonSearch();
  page.onSearchInput({ detail: { value: "计信" } });
  assert(page.data.searchResults.some((p) => p.id === target.id));
  page.onUnload();
});
test("switching accounts while native permission is pending never grants consent to the next account", async () => {
  let native;
  const h = harness({ consent: false, deferLocation: (o) => (native = o) });
  const pending = h
    .load("features/utils/shuttle-authorization")
    .authorizeShuttleLocation();
  await settle();
  assert(native);
  h.changeUser("99");
  native.success(h.raw);
  await assert.rejects(pending, /登录状态已变化/);
  assert(!h.calls.some((c) => c[0] === "request" && c[2].method === "POST"));
});

test("location storage failure blocks further observations", () => {
  const h = harness();
  let failed = 0;
  const { ShuttleLocationRecorder } = h.load("utils/shuttle-location");
  const recorder = new ShuttleLocationRecorder({
    status() {},
    fatal() {
      failed++;
    },
  });
  h.wx.setStorageSync = () => {
    throw Error("full");
  };
  assert.equal(recorder.record(h.raw, "initial"), null);
  assert.equal(recorder.record(h.raw, "change"), null);
  assert.equal(failed, 1);
});
test("a map picker callback after unload cannot revive the page", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  let picker;
  h.wx.chooseLocation = (value) => {
    picker = value;
  };
  const pending = page.chooseOnMap();
  page.onHide();
  page.onUnload();
  const count = h.calls.length;
  picker.success({ ...h.raw, name: "测试地点" });
  await pending;
  await settle();
  assert(
    !h.calls
      .slice(count)
      .some((c) => c[0] === "streamStart" || c[0] === "startLocationUpdate"),
  );
});
test("short screens leave map controls visible and ending a trip disables reminders", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.onResize({ size: { windowWidth: 320, windowHeight: 568 } });
  page.layout(true);
  assert(page.data.sheetHeight + page.data.headerHeight + 105 <= 568);
  page.setData({ journey: "waiting", reminderEnabled: true });
  page.cancelJourney();
  assert.equal(page.data.journey, "idle");
  assert.equal(page.data.reminderEnabled, false);
  page.onUnload();
});
test("real SocketTask reconnects with a fresh ticket and ignores callbacks from a closed socket", async () => {
  let tickets = 0;
  const sockets = [],
    states = [];
  const h = harness({
    api: async (url) => {
      assert(url.endsWith("/ticket"));
      return { ticket: "ticket-" + ++tickets };
    },
  });
  h.wx.connectSocket = (options) => {
    assert.equal(
      options.url,
      "wss://example.invalid/api/v1/utilities/shuttle-buses/stream",
    );
    const task = {
      sent: [],
      onOpen(fn) {
        this.open = fn;
      },
      onMessage(fn) {
        this.message = fn;
      },
      onError(fn) {
        this.error = fn;
      },
      onClose(fn) {
        this.closed = fn;
      },
      send(o) {
        this.sent.push(o);
      },
      close() {
        this.closed?.({ code: 1000 });
      },
    };
    sockets.push(task);
    return task;
  };
  const { ShuttleStream } = h.load("features/services/shuttle-stream");
  const stream = new ShuttleStream(
    () => ({ captureSession: "stream_capture", seq: 1, raw: h.raw }),
    {
      snapshot() {},
      receipt() {},
      state(v) {
        states.push(v);
      },
      fatal(m) {
        throw Error(m);
      },
      selectionInvalid() {},
    },
  );
  stream.start({ routeId: "239" });
  await settle();
  sockets[0].open();
  assert.equal(JSON.parse(sockets[0].sent[0].data).ticket, "ticket-1");
  sockets[0].message({ data: JSON.stringify({ type: "ready", accepted: [] }) });
  sockets[0].error();
  const timer = [...h.jobs.values()].find(
    (j) => !j.interval && j.delay === 1000,
  );
  assert(timer);
  timer.f();
  await settle();
  sockets[1].open();
  assert.equal(tickets, 2);
  const before = states.length;
  sockets[0].sent[0].fail();
  assert.equal(states.length, before);
  stream.stop();
  sockets[1].message({ data: JSON.stringify({ type: "ready" }) });
  assert(![...h.jobs.values()].some((j) => j.interval));
});

test("search works without location and keyboard preserves space for results", async () => {
  const h = harness({ permission: false, mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  page.openDestinationSearch();
  assert.equal(page.data.searchMounted, true);
  page.onSearchInput({ detail: { value: "图书馆" } });
  [...h.jobs.values()]
    .filter((j) => j.delay === 20)
    .at(-1)
    .f();
  assert.equal(page.data.searchOpen, true);
  assert(page.data.searchResults.length > 0);
  assert(page.data.searchResults.every((p) => p.name.includes("图书馆")));
  page.onResize({ size: { windowWidth: 320, windowHeight: 568 } });
  page.onSearchKeyboard({ detail: { height: 300 } });
  const fullHeight = page.data.windowHeight;
  assert(page.data.searchPanelHeight >= 180);
  assert(page.data.searchPanelHeight <= 568);
  assert(page.data.searchPanelHeight - 300 >= 150);
  const keyboardPanelHeight = page.data.searchPanelHeight;
  page.onResize({ size: { windowWidth: 320, windowHeight: 268 } });
  assert.equal(page.data.windowHeight, fullHeight);
  page.onSearchKeyboard({ detail: { height: 0 } });
  assert.equal(page.data.searchPanelHeight, keyboardPanelHeight);
  page.onResize({ size: { windowWidth: 320, windowHeight: 268 } });
  assert.equal(page.data.windowHeight, fullHeight);
  assert.equal(
    page.data.searchPanelHeight,
    Math.min(fullHeight * 0.82, fullHeight - page.data.mapTop - 12),
  );
  page.onSearchInput({ detail: { value: "不存在的测试地点987" } });
  assert.equal(page.data.searchResults.length, 0);
  page.closeSearch();
  assert.equal(page.data.keyboardHeight, 0);
  page.onUnload();
});
test("short-name chips persist per account and manual boarding plans work after location denial", async () => {
  const h = harness({ permission: false, mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const r = map.routes[0],
    start = map.places.find((p) => p.id === r.orderedStops[0].stopId),
    end = map.places.find((p) => p.id === r.orderedStops[3].stopId);
  page.openCommonSearch();
  page.choosePlace({ currentTarget: { dataset: { id: end.id } } });
  assert.equal(page.data.commonPlaces.length, 1);
  assert.equal(page.data.commonPlaces[0].shortName, end.shortName);
  assert.equal(page.data.destinationName, end.shortName);
  page.openBoardingSearch();
  page.choosePlace({ currentTarget: { dataset: { id: start.id } } });
  assert(page.data.plans.length > 0);
  assert(page.data.plans.some((p) => p.routeName.includes(r.name)));
  assert.equal(page.data.authorized, false);
  assert.equal(page.data.hasOrigin, true);
  assert.equal(page.data.manualOrigin, true);
  const stream = h.calls.find((c) => c[0] === "streamConstruct")[1];
  assert.equal(stream.point(), null);
  assert(stream.manualOrigin());
  assert(!h.calls.some((c) => c[0] === "startLocationUpdate"));
  assert(
    !h.calls.some((c) => c[0] === "request" && c[1].endsWith("/locations")),
  );
  const nativeRequests = h.calls.filter((c) => c[0] === "getLocation").length;
  page.onHide();
  page.onShow();
  await settle();
  assert.equal(
    h.calls.filter((c) => c[0] === "getLocation").length,
    nativeRequests,
  );
  assert.equal(h.calls.filter((c) => c[0] === "streamStart").length, 2);
  const common = h.load("features/utils/shuttle-common-places");
  assert.equal(common.loadCommonPlaces("42").length, 1);
  assert.equal(common.loadCommonPlaces("99").length, 0);
  page.clearDestination();
  page.selectCommonPlace({
    currentTarget: { dataset: { key: page.data.commonPlaces[0].key } },
  });
  assert.equal(page.data.destinationName, end.shortName);
  page.onUnload();
});
test("place search matches every full name, short name and any optional alias without rewriting data", () => {
  const { matchesPlace, placeShortName } = harness().load(
    "features/utils/shuttle-place-names",
  );
  for (const p of map.places) {
    assert(matchesPlace(p, p.name), p.name);
    assert(matchesPlace(p, p.shortName), p.shortName);
    assert(Array.from(placeShortName(p)).length <= 4);
  }
  const point = {
    ...map.places[0],
    aliases: ["独立别名", "ＬＩＢ 9", "另一个别名"],
  };
  for (const q of ["独立", "lib9", "另一个", "  "])
    assert(matchesPlace(point, q));
  assert(!matchesPlace(point, "不存在123"));
  assert.equal(placeShortName({ name: "旧名称很长 · 东行" }), "旧名称很");
  assert(map.places.every((p) => !p.aliases));
});
test("inline add expands beside plus, fits keyboard, selects short name and cancels focus on hide", async () => {
  const h = harness({ mockStream: true, permission: false }),
    page = h.page();
  const place = map.places.find((p) => p.shortName === "计信院");
  // A saved favorite from an older map is resolved to the current source label.
  h.storage.set("easy-swu:shuttle:common-places:42", [
    {
      key: `place:${place.id}`,
      placeId: place.id,
      name: place.name,
      longitude: place.longitude,
      latitude: place.latitude,
    },
  ]);
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert.equal(page.data.commonPlaces[0].shortName, "计信院");
  page.openCommonSearch();
  assert.equal(page.data.searchMounted, false);
  assert.equal(page.data.commonMounted, true);
  assert.equal(page.data.commonOpen, false);
  [...h.jobs.values()].find((j) => j.delay === 20).f();
  assert.equal(page.data.commonOpen, true);
  const focus = [...h.jobs.values()].find((j) => j.delay === 260).f;
  focus();
  assert.equal(page.data.commonFocus, true);
  page.onResize({ size: { windowWidth: 320, windowHeight: 568 } });
  page.onSearchKeyboard({ detail: { height: 300 } });
  assert(page.data.commonListHeight >= 48);
  assert(page.data.commonListHeight + page.data.headerHeight + 300 + 12 <= 568);
  page.onSearchInput({ detail: { value: "计信" } });
  assert(
    page.data.searchResults.some(
      (p) => p.id === place.id && p.shortName === "计信院",
    ),
  );
  page.choosePlace({ currentTarget: { dataset: { id: place.id } } });
  assert.equal(page.data.commonOpen, false);
  assert.equal(page.data.commonPlaces.length, 1);
  assert.equal(page.data.keyboardHeight, 0);
  page.onHide();
  focus();
  assert.equal(page.data.commonMounted, false);
  assert.equal(page.data.commonFocus, false);
  page.onUnload();
});
test("common place validation deduplicates corrupted storage and failed writes preserve existing chips", async () => {
  const h = harness({ mockStream: true }),
    common = h.load("features/utils/shuttle-common-places"),
    p = common.commonPlace({ ...h.raw, name: "测试点" }, "test");
  h.storage.set("easy-swu:shuttle:common-places:42", [
    p,
    p,
    { key: "bad", name: "无效", longitude: NaN, latitude: 90 },
  ]);
  assert.equal(common.loadCommonPlaces("42").length, 1);
  const page = h.page();
  page.onLoad();
  h.wx.setStorageSync = () => {
    throw Error("full");
  };
  assert.equal(
    page.addCommonPlace(
      common.commonPlace({ ...h.raw, name: "另一个点" }, "other"),
    ),
    false,
  );
  assert.equal(page.data.commonPlaces.length, 1);
  page.onUnload();
});
test("route alternatives have distinct colors and distance-based reveal preserves the full ordered path", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map),
    { planPolylines, revealPoints } = h.load(
      "features/utils/shuttle-route-reveal",
    );
  const destination = map.places.find(
    (p) => planner.plans(h.raw, p).length > 1,
  );
  assert(destination);
  const plans = planner.plans(h.raw, destination),
    selected = plans[0].id;
  assert.equal(planPolylines(plans, selected, 0).length, 0);
  const partial = planPolylines(plans, selected, 0.35).filter(
      (p) => p.color !== "#FFFFFF",
    ),
    full = planPolylines(plans, selected, 1).filter(
      (p) => p.color !== "#FFFFFF",
    );
  assert.equal(full.length, plans.length);
  assert.equal(new Set(full.map((p) => p.color)).size, plans.length);
  for (let i = 0; i < full.length; i++) {
    assert.deepEqual(clone(partial[i].points[0]), clone(full[i].points[0]));
    assert.notDeepEqual(
      clone(partial[i].points.at(-1)),
      clone(full[i].points.at(-1)),
    );
  }
  assert.deepEqual(clone(full.at(-1).points), clone(plans[0].points));
  const p = [
    { longitude: 106, latitude: 29 },
    { longitude: 106.001, latitude: 29 },
    { longitude: 106.011, latitude: 29 },
  ];
  const half = revealPoints(p, 0.5);
  assert(half.at(-1).longitude > 106.005 && half.at(-1).longitude < 106.006);
});
test("canvas trace grows by distance, follows road corners and starts walking only after the bus leg", () => {
  const h = harness({ canvas: true }),
    { ShuttleRouteReveal } = h.load("features/utils/shuttle-route-reveal");
  const strokes = [];
  let path = [],
    dash = [];
  Object.assign(h.canvasContext, {
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push([x, y]);
    },
    lineTo(x, y) {
      path.push([x, y]);
    },
    setLineDash(d) {
      dash = d;
    },
    stroke() {
      strokes.push({ path: structuredClone(path), dash: clone(dash) });
    },
  });
  const p = (x, y) => ({
    longitude: x / 100000 + 106,
    latitude: y / 100000 + 29,
  });
  const ride = [p(0, 0), p(20, 0)],
    walk = [p(20, 0), p(20, 10), p(30, 10)];
  const { distanceMeters } = h.load("utils/shuttle-geo"),
    rideLength = distanceMeters(...ride),
    walkLength =
      distanceMeters(walk[0], walk[1]) + distanceMeters(walk[1], walk[2]);
  const parts = [
    {
      points: ride,
      color: "blue",
      width: 5,
      dotted: false,
      start: 0,
      length: rideLength,
      total: rideLength + walkLength,
    },
    {
      points: walk,
      color: "blue",
      width: 3,
      dotted: true,
      start: rideLength,
      length: walkLength,
      total: rideLength + walkLength,
    },
  ];
  let complete = 0;
  const reveal = new ShuttleRouteReveal(h.canvas, h.canvasContext);
  reveal.start(
    parts,
    (q) => ({ x: q.longitude, y: q.latitude }),
    375,
    400,
    () => complete++,
  );
  const tick = (time) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(time);
  };
  tick(0);
  tick(150);
  assert(strokes.length);
  assert(!strokes.some((s) => s.dash.length));
  strokes.length = 0;
  tick(1300);
  assert(strokes.some((s) => s.dash.length));
  assert.equal(h.canvasContext.lineCap, "round");
  assert.equal(h.canvasContext.lineJoin, "round");
  const late = [...h.frames.values()].at(-1);
  reveal.stop();
  const before = strokes.length;
  late(2000);
  assert.equal(strokes.length, before);
  assert.equal(complete, 0);
  reveal.start(
    parts,
    (q) => ({ x: q.longitude, y: q.latitude }),
    375,
    400,
    () => complete++,
  );
  tick(0);
  tick(3000);
  assert.equal(complete, 1);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(strokes.at(-1).path.at(-1), [
    walk.at(-1).longitude,
    walk.at(-1).latitude,
  ]);
});
test("canvas animation never rebuilds native polylines per frame and stale callbacks cannot restore an older route", async () => {
  const h = harness({ mockStream: true, canvas: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  const dest = map.places.find(
    (p) => p.category !== "stop" && planner.plans(h.raw, p).length > 1,
  );
  page.openDestinationSearch();
  page.choosePlace({ currentTarget: { dataset: { id: dest.id } } });
  await settle();
  const timer = [...h.jobs.values()].filter((j) => j.delay === 420).at(-1);
  assert(timer);
  timer.f();
  assert(page.data.routeAnimating);
  const count = h.calls.filter((c) => c[0] === "polylines").length;
  for (const time of [0, 16, 32, 48, 64, 160, 320, 640]) {
    const [id, frame] = [...h.frames].at(-1);
    h.frames.delete(id);
    frame(time);
  }
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, count);
  const stale = [...h.frames.values()].at(-1);
  page.clearDestination();
  const before = JSON.stringify(page.data.polylines);
  stale(4000);
  timer.f();
  assert.equal(JSON.stringify(page.data.polylines), before);
  page.choosePlace({ currentTarget: { dataset: { id: dest.id } } });
  await settle();
  const late = [...h.jobs.values()].filter((j) => j.delay === 420).at(-1).f;
  page.onHide();
  const hidden = JSON.stringify(page.data.polylines);
  late();
  assert.equal(JSON.stringify(page.data.polylines), hidden);
  assert.equal(h.frames.size, 0);
  page.onUnload();
});
test("grouped stop choices precede ordinary places and preserve every member's aliases for search", async () => {
  const h = harness({ permission: false, mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const { placeGroups, findPlaceGroups } = h.load(
      "features/utils/shuttle-place-groups",
    ),
    groups = placeGroups(map);
  assert(groups.filter((g) => g.stop).length < 55);
  assert.equal(
    groups.reduce((n, g) => n + g.members.length, 0),
    map.places.length,
  );
  assert(
    groups.filter((g) => g.stop).every((g) => !/[东西南北]行/.test(g.name)),
  );
  const mixed = structuredClone(map),
    member = groups.find((g) => g.members.length > 1).members[1];
  mixed.places.find((p) => p.id === member.id).aliases = ["独有别称"];
  assert.equal(findPlaceGroups(mixed, "独有别称", false).length, 1);
  page.openDestinationSearch();
  assert(page.data.searchStopRows.length);
  assert(page.data.searchPlaceRows.length);
  assert(
    [...page.data.searchStopRows, ...page.data.searchPlaceRows].every(
      (row) => row.places.length <= 2,
    ),
  );
  const firstOrdinary = page.data.searchResults.findIndex((p) => !p.stop);
  assert(page.data.searchResults.slice(firstOrdinary).every((p) => !p.stop));
  const template = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  assert(!/<input[^>]*class="place-search-input"[^>]*focus=/.test(template));
  assert(template.includes('class="search-results-wrap"'));
  page.onUnload();
});
test("manual SocketTask authentication sends only a stop ID and updates its origin without GPS", async () => {
  const h = harness({ api: async () => ({ ticket: "manual-ticket" }) });
  let socket,
    origin = "stop-a";
  h.wx.connectSocket = () =>
    (socket = {
      sent: [],
      onOpen(fn) {
        this.open = fn;
      },
      onMessage(fn) {
        this.message = fn;
      },
      onError() {},
      onClose() {},
      send(o) {
        this.sent.push(JSON.parse(o.data));
      },
      close() {},
    });
  const { ShuttleStream } = h.load("features/services/shuttle-stream");
  const stream = new ShuttleStream(
    () => null,
    {
      state() {},
      snapshot() {},
      receipt() {},
      fatal(m) {
        throw Error(m);
      },
      selectionInvalid() {},
    },
    () => origin,
  );
  stream.start({});
  await settle();
  socket.open();
  assert.deepEqual(socket.sent[0], {
    type: "auth",
    protocol: 2,
    ticket: "manual-ticket",
    origin: { stopId: "stop-a" },
    selection: {},
  });
  socket.message({ data: JSON.stringify({ type: "ready", accepted: [] }) });
  origin = "stop-b";
  stream.select({ boardingId: origin });
  assert.equal(socket.sent.at(-1).type, "origin");
  assert.equal(socket.sent.at(-1).origin.stopId, "stop-b");
  assert(!socket.sent.some((s) => s.point));
  stream.stop();
});

test("manual selection wins over an in-flight native permission request", async () => {
  let pending;
  const h = harness({ mockStream: true, deferLocation: (o) => (pending = o) }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  assert(pending);
  const stop = map.places.find((p) => p.category === "stop");
  page.openBoardingSearch();
  page.choosePlace({ currentTarget: { dataset: { id: stop.id } } });
  assert(page.data.hasOrigin);
  assert(page.data.manualOrigin);
  pending.fail({ errMsg: "getLocation:fail auth deny" });
  await settle();
  assert(page.data.hasOrigin);
  assert.equal(page.data.authorized, false);
  assert.equal(h.calls.filter((c) => c[0] === "streamStart").length, 1);
  assert(!h.calls.some((c) => c[0] === "request" && c[1].endsWith("/consent")));
  page.onUnload();
});
test("straight walking links join the bus path, native handoff happens once and live refresh does not restart it", async () => {
  let requests = 0;
  const h = harness({
      mockStream: true,
      canvas: true,
      walking: async (o) => {
        requests++;
        const start = map.places.find((p) => p.id === o.data.stopIds[0]),
          end = o.data.destination;
        return {
          revision: map.revision,
          legs: [
            {
              stopId: start.id,
              available: true,
              meters: 240,
              seconds: 200,
              destination: end,
              points: [
                { longitude: start.longitude, latitude: start.latitude },
                { longitude: end.longitude, latitude: start.latitude },
                end,
              ],
            },
          ],
        };
      },
    }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  const dest = map.places.find(
    (p) => p.category !== "stop" && planner.plans(h.raw, p).length,
  );
  page.openDestinationSearch();
  page.choosePlace({ currentTarget: { dataset: { id: dest.id } } });
  await settle();
  [...h.jobs.values()]
    .filter((j) => j.delay === 420)
    .at(-1)
    .f();
  const tick = (t) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(t);
  };
  tick(0);
  const before = h.calls.filter((c) => c[0] === "polylines").length;
  tick(4000);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, before + 1);
  const walk = page.data.polylines
    .filter((p) => p.dottedLine && p.color !== "#FFFFFF")
    .at(-1);
  assert(walk);
  assert.equal(walk.points.length, 2);
  const ride = page.data.polylines.filter((p) => p.arrowLine).at(-1);
  assert.deepEqual(
    [ride.points.at(-1).longitude, ride.points.at(-1).latitude],
    [walk.points[0].longitude, walk.points[0].latitude],
  );
  assert.equal(walk.points.at(-1).longitude, dest.longitude);
  assert(
    page.data.plans
      .find((p) => p.id === page.data.selectedPlanId)
      .walkLabel.includes("步行约"),
  );
  const count = h.calls.filter((c) => c[0] === "polylines").length;
  page.refreshRows();
  page.rebuildPlans(false);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, count);
  assert.equal(requests, 0);
  [...h.jobs.values()]
    .filter((j) => j.delay === 160)
    .at(-1)
    .f();
  assert.equal(page.data.routeAnimating, false);
  page.onUnload();
});

test("only one itinerary is painted; closing and choosing a draft destination preserves it until confirmation", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  const destinations = map.places.filter(
    (p) => p.category !== "stop" && planner.plans(h.raw, p).length > 1,
  );
  page.openDestinationSearch();
  page.choosePlace({ currentTarget: { dataset: { id: destinations[0].id } } });
  assert(page.data.plans.length > 1);
  const initial = JSON.stringify(page.data.polylines),
    selected = page.data.selectedPlanId;
  [...h.jobs.values()]
    .filter((j) => j.delay === 240)
    .at(-1)
    ?.f();
  assert.equal(
    page.data.polylines.filter((p) => p.arrowLine).length,
    selected.split("|").length,
  );
  assert(
    page.data.polylines
      .filter((p) => p.dottedLine)
      .every((p) => p.points.length === 2),
  );
  page.closeTripSheet();
  assert(!page.data.sheetOpen);
  assert.equal(JSON.stringify(page.data.polylines), initial);
  page.onMapTap({
    detail: { ...destinations[1], name: destinations[1].shortName },
  });
  assert(page.data.sheetOpen);
  assert.equal(page.data.selectedPlanId, "");
  assert.equal(JSON.stringify(page.data.polylines), initial);
  page.choosePlan({
    currentTarget: { dataset: { id: page.data.plans[0].id } },
  });
  assert(page.data.selectedPlanId);
  assert.notEqual(JSON.stringify(page.data.polylines), initial);
  assert(page.data.authorized);
  assert(!page.data.manualOrigin);
  page.onUnload();
});
test("ordinary manual origins work without GPS; map marker taps choose destinations", async () => {
  const h = harness({ permission: false, mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const place = map.places.find((p) => p.category !== "stop");
  page.openBoardingSearch();
  assert(page.data.searchPlaceRows.length);
  page.choosePlace({ currentTarget: { dataset: { id: place.id } } });
  assert(page.data.hasOrigin && page.data.manualOrigin);
  assert.equal(page.data.originName, place.shortName);
  const stream = h.calls.find((c) => c[0] === "streamConstruct")[1];
  assert.equal(stream.point(), null);
  assert.equal(stream.manualOrigin().longitude, place.longitude);
  const before = page.data.originName;
  page.onMarkerTap({ detail: { markerId: 100 } });
  assert(page.data.destinationName);
  assert.equal(page.data.originName, before);
  assert(!h.calls.some((c) => c[0] === "startLocationUpdate"));
  page.onUnload();
});
test("ordered trace distances keep every later leg invisible until earlier legs finish", () => {
  const h = harness({ canvas: true }),
    { orderedTraces, ShuttleRouteReveal } = h.load(
      "features/utils/shuttle-route-reveal",
    );
  const p = (x) => ({ longitude: 106 + x * 0.001, latitude: 29.8 });
  const parts = orderedTraces([
    { points: [p(0), p(1)], color: "walk", width: 3, dotted: true },
    { points: [p(1), p(3)], color: "first", width: 4, dotted: false },
    { points: [p(3), p(5)], color: "second", width: 4, dotted: false },
  ]);
  assert.equal(parts[0].start, 0);
  assert.equal(parts[1].start, parts[0].length);
  assert.equal(parts[2].start, parts[0].length + parts[1].length);
  let colors = [];
  h.canvasContext.stroke = function () {
    colors.push(this.strokeStyle);
  };
  const reveal = new ShuttleRouteReveal(h.canvas, h.canvasContext);
  reveal.start(
    parts,
    (q) => ({ x: q.longitude, y: q.latitude }),
    375,
    500,
    () => {},
  );
  const tick = (t) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    colors = [];
    fn(t);
  };
  tick(0);
  tick(50);
  assert(!colors.includes("first") && !colors.includes("second"));
  tick(4000);
  assert(colors.includes("first") && colors.includes("second"));
});
test("same directional ride geometry merges route labels and transfer plans remain ordered", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const planner = new ShuttlePlanner(map),
    itinerary = new ShuttleItineraryPlanner(map, planner);
  const route = map.routes[0],
    from = map.places.find((p) => p.id === route.orderedStops[0].stopId),
    to = map.places.find((p) => p.id === route.orderedStops[3].stopId);
  const direct = planner.plans(from, to, [from.id], "", [to.id]);
  const duplicate = {
    ...direct[0],
    id: "duplicate",
    route: { ...direct[0].route, id: "duplicate", name: "同路线路" },
  };
  const fake = {
    plans(a, b) {
      return b === to ? [direct[0], duplicate] : [];
    },
  };
  const merged = new ShuttleItineraryPlanner(map, fake).plans(
    from,
    to,
    [from.id],
    [to.id],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].legs[0].routes.length, 2);
  const plans = itinerary.plans(from, to, [from.id], [to.id]);
  assert(plans.length);
  assert(plans.every((p, i) => !i || p.score >= plans[i - 1].score));
  assert(
    plans.every(
      (p) =>
        p.legs[0].board.id === from.id && p.legs.at(-1).alight.id === to.id,
    ),
  );
});

(async () => {
  for (const [name, run] of tests) {
    try {
      await run();
      console.log("PASS", name);
      passed++;
    } catch (error) {
      console.error("FAIL", name, error);
      process.exitCode = 1;
    }
  }
  console.log(`Shuttle checks: ${passed}/${tests.length} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
