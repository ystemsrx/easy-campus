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
    save() {
      this.savedComposite = this.globalCompositeOperation;
    },
    restore() {
      this.globalCompositeOperation = this.savedComposite;
    },
    arc(x, y, r) {
      this.circle = [x, y, r];
    },
    fill() {
      calls.push([
        "mask",
        { circle: this.circle, composite: this.globalCompositeOperation },
      ]);
    },
    scale() {},
    clearRect() {},
    beginPath() {
      this.path = [];
    },
    moveTo(x, y) {
      this.path.push([x, y]);
    },
    lineTo(x, y) {
      this.path.push([x, y]);
    },
    stroke() {
      calls.push([
        "trace",
        { path: [...this.path], color: this.strokeStyle, dash: this.dash },
      ]);
    },
    setLineDash(dash) {
      this.dash = dash;
    },
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
    moveToLocation(o) {
      calls.push(["moveToLocation", o]);
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
    nextTick: (callback) => callback(),
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
    if (url.endsWith("/plans") && options.plans) return options.plans(o);
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
      setData(values, callback) {
        if (Object.hasOwn(values, "polylines"))
          calls.push(["polylines", structuredClone(values.polylines)]);
        for (const [key, value] of Object.entries(structuredClone(values))) {
          const indexed = /^polylines\[(\d+)\]\.points(?:\[(\d+)\])?$/.exec(
            key,
          );
          if (indexed) {
            if (indexed[2] !== undefined)
              this.data.polylines[Number(indexed[1])].points[
                Number(indexed[2])
              ] = value;
            else this.data.polylines[Number(indexed[1])].points = value;
          } else this.data[key] = value;
        }
        callback?.();
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
      '<navigation-bar title="小易地图" back transparent theme="{{theme}}"',
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
    ?.f();
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
  const styles = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxss"),
    "utf8",
  );
  assert(!wxml.includes("privacy-mask"));
  assert(!wxml.includes("agreePrivacyAuthorization"));
  assert(wxml.includes('open-type="openSetting"'));
  assert(wxml.includes('bindopensetting="onLocationSettings"'));
  assert(wxml.includes('bindkeyboardheightchange="onSearchKeyboard"'));
  assert(wxml.includes('class="gate-actions"'));
  assert(wxml.includes(">手动选择</view>"));
  assert(!wxml.includes("选择出发点"));
  assert(styles.includes(".gate-actions .gate-button"));
  assert(styles.includes("border-radius: 999px"));
});

test("all 10 real routes produce valid ordered, connected tracks", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  for (const route of map.routes) {
    const track = planner.track(route);
    assert(track, route.name);
    assert(track.stops.length >= route.orderedStops.length);
    assert(track.stops.every((s, i) => !i || s.at >= track.stops[i - 1].at));
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
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 2);
  assert(
    h.calls
      .filter((c) => c[0] === "addMarkers")
      .flatMap((c) => c[1].markers)
      .filter((m) => m.id < 100000)
      .every((m) => m.width === 26),
  );
  animation.update([a, b], 200, false);
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 2);
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
  await assert.rejects(
    service.getShuttleMap(true),
    (e) => e.code === "SHUTTLE_REFRESH_DEFERRED",
  );
  assert.equal(h.calls.filter((c) => c[0] === "request").length, 1);
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
test("a pending map pick cannot revive an unloaded page", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...h.raw, name: "first" });
  page.showMapPick({ ...h.raw, name: "second" });
  const pending = [...h.jobs.values()].filter((j) => j.delay === 140).at(-1);
  page.onHide();
  page.onUnload();
  const count = h.calls.length;
  pending?.f();
  await settle();
  assert(
    !h.calls
      .slice(count)
      .some((c) => c[0] === "streamStart" || c[0] === "startLocationUpdate"),
  );
});
test("native location picker applies origin and destination across both lifecycle callback orders", async () => {
  for (const mode of ["board", "destination"]) {
    for (const early of [true, false]) {
      const h = harness({ mockStream: true, permission: false }),
        page = h.page();
      let native,
        opened = 0;
      h.wx.chooseLocation = (o) => {
        native = o;
        opened++;
      };
      page.onLoad();
      page.onReady();
      page.onShow();
      await settle();
      page.openSearch(mode);
      page.chooseOnMap();
      page.chooseOnMap();
      assert.equal(opened, 1);
      assert(Number.isFinite(native.latitude));
      page.onHide();
      const result = {
        ...h.raw,
        name: mode === "board" ? "官方起点" : "官方终点",
        address: "地址",
      };
      const count = h.calls.filter((c) => c[0] === "streamStart").length;
      if (early) {
        native.success(result);
        assert.equal(
          h.calls.filter((c) => c[0] === "streamStart").length,
          count,
        );
        page.onShow();
      } else {
        page.onShow();
        assert.equal(
          h.calls.filter((c) => c[0] === "streamStart").length,
          count,
        );
        native.success(result);
      }
      await settle();
      assert.equal(
        page.data[mode === "board" ? "originName" : "destinationName"],
        result.name,
      );
      assert.equal(page.data.pickMounted, false);
      if (mode === "board") {
        assert.equal(page.data.manualOrigin, true);
        const stream = h.calls
          .filter((c) => c[0] === "streamConstruct")
          .at(-1)[1];
        assert.equal(stream.manualOrigin().longitude, result.longitude);
      }
      page.onUnload();
    }
  }
});

test("native picker cancellation keeps the previous trip and permits retry without a toast", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  let native;
  h.wx.chooseLocation = (o) => {
    native = o;
  };
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.setData({ destinationName: "原目的地" });
  page.openSearch("destination");
  page.chooseOnMap();
  page.onHide();
  const before = h.calls.filter((c) => c[0] === "toast").length;
  native.fail({ errMsg: "chooseLocation:fail cancel" });
  page.onShow();
  await settle();
  assert.equal(page.data.destinationName, "原目的地");
  assert.equal(h.calls.filter((c) => c[0] === "toast").length, before);
  const old = native;
  page.chooseOnMap();
  assert.notEqual(native, old);
  native.success({ ...h.raw, name: "重选地点" });
  await settle();
  assert.equal(page.data.destinationName, "重选地点");
  page.onUnload();
});

test("native picker ignores unloaded and changed-account callbacks", async () => {
  for (const unload of [true, false]) {
    const h = harness({ mockStream: true }),
      page = h.page();
    let native;
    h.wx.chooseLocation = (o) => {
      native = o;
    };
    page.onLoad();
    page.onReady();
    page.onShow();
    await settle();
    page.openSearch("board");
    page.chooseOnMap();
    page.onHide();
    if (unload) page.onUnload();
    else h.changeUser("99");
    const count = h.calls.length;
    native.success({ ...h.raw, name: "过期选点" });
    await settle();
    assert.notEqual(page.data.originName, "过期选点");
    assert(!h.calls.slice(count).some((c) => c[0] === "streamStart"));
    if (!unload) page.onUnload();
  }
});

test("native picker failures are retryable and direct map taps retain the go-here bubble", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  let native;
  h.wx.chooseLocation = (o) => {
    native = o;
  };
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.openSearch("board");
  page.chooseOnMap();
  native.fail({ errMsg: "chooseLocation:fail auth deny" });
  assert(h.calls.some((c) => c[0] === "toast"));
  page.chooseOnMap();
  native.success({ latitude: NaN, longitude: 106, name: "错误点" });
  assert.notEqual(page.data.originName, "错误点");
  page.setData({ searchMounted: false });
  const before = page.data.destinationName;
  page.showMapPick({ ...h.raw, name: "主地图地点" });
  assert.equal(page.data.pickMounted, true);
  assert.equal(page.data.pickOrigin, false);
  assert.equal(page.data.destinationName, before);
  page.confirmMapPick();
  assert.equal(page.data.destinationName, "主地图地点");
  page.onUnload();
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
    (j) => !j.interval && j.delay >= 1000 && j.delay < 1500,
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

test("search works without location and keyboard leaves panel geometry unchanged", async () => {
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
    ?.f();
  assert.equal(page.data.searchOpen, true);
  assert(page.data.searchResults.length > 0);
  assert(page.data.searchResults.every((p) => p.name.includes("图书馆")));
  page.onResize({ size: { windowWidth: 320, windowHeight: 568 } });
  page.onSearchKeyboard({ detail: { height: 300 } });
  const fullHeight = page.data.windowHeight;
  assert(page.data.searchPanelHeight >= 180);
  assert(page.data.searchPanelHeight <= 568);
  assert.equal(page.data.keyboardHeight, 0);
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
  for (const [id, job] of [...h.jobs])
    if (job.delay === 0) {
      h.jobs.delete(id);
      job.f();
    }
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
  for (const q of ["独立", "lib9", "Ｌｉｂ\n９", " L I\tB 9 ", "另一个", "  "])
    assert(matchesPlace(point, q));
  assert(!matchesPlace(point, "不存在123"));
  assert.equal(placeShortName({ name: "旧名称很长 · 东行" }), "旧名称很");
  assert(map.places.every((p) => p.aliases?.length));
  const dorm = map.places.find((p) => p.name === "桃3");
  for (const q of ["桃三", "桃园三舍", "桃 三 舍", "桃３舍"])
    assert(matchesPlace(dorm, q));
  const building = map.places.find((p) => p.name.includes("25教-"));
  for (const q of [
    "二十五教",
    "２５号教学楼",
    "计算机与信息科学学院",
    "软件学院",
    "计信院",
  ])
    assert(matchesPlace(building, q));
  assert.equal(placeShortName(building), "计信院");
  assert.equal(placeShortName(dorm), "桃3");
  const academicQueries = [
    [
      "25教-",
      [
        "二十五号楼",
        "第２５号教学楼",
        "第二十五教学楼",
        "计科院",
        "计信",
        "软院",
        "计算机信息学院",
      ],
    ],
    ["9教-", ["九号楼", "第九号教学楼", "历文院", "民院"]],
    ["24教-", ["二十四教学楼", "教学楼24", "地理系"]],
    ["1教-", ["第一教学楼", "文院", "中文系"]],
    ["5教-", ["第五教学楼", "外院", "外语系"]],
    ["国家治理学院", ["国治", "马院", "马克思院"]],
    ["数学与统计学院", ["数统", "数院", "数学统计学院"]],
    ["电子信息工程学院", ["电信院", "电信学院", "电子学院"]],
    ["33教-", ["三十三号楼", "蚕纺院", "蚕桑学院"]],
    ["37教-", ["三十七教学楼", "农生", "农学院"]],
    ["心理学部", ["心理学院", "心理系"]],
    ["美术学院", ["美院"]],
    ["体育学院", ["体院"]],
  ];
  for (const [name, queries] of academicQueries) {
    const place = map.places.find((p) => p.name.startsWith(name));
    assert(place, name);
    for (const query of queries)
      assert(matchesPlace(place, query), `${name}: ${query}`);
  }
  const { findPlaceGroups } = harness().load(
    "features/utils/shuttle-place-groups",
  );
  const found = findPlaceGroups(map, "软院", false);
  assert(found.some((g) => g.members.some((p) => p.id === building.id)));
  assert(found.every((g) => g.shortName !== "软院" && g.name !== "软院"));
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
    true,
  );
  assert.equal(page.data.commonPlaces.length, 2);
  for (const [id, job] of [...h.jobs])
    if (job.delay === 0) {
      h.jobs.delete(id);
      job.f();
    }
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
  assert.equal(
    new Set(full.map((p) => p.color)).size,
    new Set(plans.map((p) => p.route.id)).size,
  );
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
  tick(2200);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, before);
  assert(!h.calls.some((c) => c[0] === "trace" && c[1].dash?.length));
  [...h.jobs.values()].find((j) => j.delay > 9000 && j.delay <= 10000).f();
  tick(4000);
  tick(4900);
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
  assert.equal(requests, 1); // Only the initial origin-to-boarding lookup; no per-frame or refresh lookup.
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
  assert(page.data.plans.length >= 1);
  const initial = JSON.stringify(page.data.polylines),
    selected = page.data.selectedPlanId;
  [...h.jobs.values()]
    .filter((j) => j.delay === 200)
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
  assert(!page.data.sheetOpen);
  assert(page.data.pickOpen);
  assert.equal(page.data.selectedPlanId, selected);
  assert.equal(JSON.stringify(page.data.polylines), initial);
  page.confirmMapPick();
  assert(page.data.sheetOpen);
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
  assert(!page.data.destinationName);
  assert(page.data.pickOpen);
  page.confirmMapPick();
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
  assert.equal(merged.filter((p) => p.mode === "ride").length, 1);
  assert.equal(merged[0].legs[0].routes.length, 2);
  const plans = itinerary
    .plans(from, to, [from.id], [to.id])
    .filter((p) => p.mode === "ride");
  assert(plans.length);
  assert(plans.every((p, i) => !i || p.score >= plans[i - 1].score));
  assert(
    plans.every(
      (p) =>
        p.legs[0].board.id === from.id && p.legs.at(-1).alight.id === to.id,
    ),
  );
});

test("socket failures fall back to authenticated snapshots and ignore late responses after hiding", async () => {
  let resolveSnapshot;
  const sockets = [],
    states = [],
    received = [],
    requests = [];
  const h = harness({
    api: async (url, o) => {
      requests.push([url, o]);
      if (url.endsWith("/ticket")) {
        assert.deepEqual(Object.keys(o.data), []);
        return { ticket: "test-ticket" };
      }
      return new Promise((r) => {
        resolveSnapshot = r;
      });
    },
  });
  h.wx.connectSocket = () => {
    const t = {
      onOpen(f) {
        this.open = f;
      },
      onMessage(f) {
        this.message = f;
      },
      onError(f) {
        this.error = f;
      },
      onClose(f) {
        this.closed = f;
      },
      send() {},
      close() {
        this.closed?.({ code: 1000 });
      },
    };
    sockets.push(t);
    return t;
  };
  const { ShuttleStream } = h.load("features/services/shuttle-stream");
  const stream = new ShuttleStream(
    () => null,
    {
      snapshot: (p) => received.push(p),
      receipt() {},
      state: (s) => states.push(s),
      fatal: (m) => {
        throw Error(m);
      },
      selectionInvalid() {},
    },
    () => ({ longitude: 106.42, latitude: 29.82 }),
  );
  stream.start({});
  await settle();
  sockets[0].error({ errMsg: "blocked" });
  [...h.jobs.values()].find((j) => j.delay >= 1000 && j.delay < 1500).f();
  await settle();
  sockets[1].open();
  sockets[1].message({ data: JSON.stringify({ type: "ready" }) });
  sockets[1].message({
    data: JSON.stringify({
      type: "snapshot",
      protocol: 2,
      vehicles: [],
      selectionValid: true,
    }),
  });
  assert.equal(received.length, 1);
  received.length = 0;
  sockets[1].error({ errMsg: "blocked" });
  await settle();
  assert(requests.at(-1)[0].endsWith("/snapshot"));
  assert(requests.at(-1)[1].data.origin.point);
  assert(!requests.at(-1)[1].data.point);
  resolveSnapshot({ vehicles: [], selectionValid: true, accepted: [] });
  await settle();
  assert.equal(states.at(-1), "live");
  assert.equal(received.length, 1);
  [...h.jobs.values()].find((j) => j.delay === 3000).f();
  await settle();
  stream.stop();
  resolveSnapshot({ vehicles: [], selectionValid: true });
  await settle();
  assert.equal(received.length, 1);
});
test("programmatic camera movement keeps revealing canvas paths without native overlay replacements", async () => {
  const h = harness({ mockStream: true, canvas: true }),
    p = h.page();
  p.onLoad();
  p.onReady();
  p.onShow();
  await settle();
  p.onMapTap({
    detail: {
      longitude: h.raw.longitude + 0.001,
      latitude: h.raw.latitude,
      name: "附近",
    },
  });
  p.confirmMapPick();
  p.onRegionChange({ type: "begin", detail: { causedBy: "update" } });
  [...h.jobs.values()]
    .filter((j) => j.delay === 420)
    .at(-1)
    .f();
  assert.equal(p.data.routeAnimating, true);
  const tick = (time) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(time);
  };
  [...h.jobs.values()].find((j) => j.delay > 9000 && j.delay <= 10000).f();
  tick(0);
  tick(550);
  const prefix = JSON.stringify(p.data.polylines);
  const drawn = JSON.stringify(h.calls.filter((c) => c[0] === "trace").at(-1));
  tick(800);
  assert.equal(JSON.stringify(p.data.polylines), prefix);
  assert.notEqual(
    JSON.stringify(h.calls.filter((c) => c[0] === "trace").at(-1)),
    drawn,
  );
  p.onRegionChange({ type: "end", detail: { causedBy: "update" } });
  assert(p.data.routeAnimating);
  assert(h.frames.size);
  p.layout(true);
  assert(p.data.routeAnimating);
  p.onUnload();
});
test("near destinations recommend a single walking path and do not invent a bus boarding stop", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const planner = new ShuttleItineraryPlanner(map, new ShuttlePlanner(map));
  const result = planner.plans(h.raw, {
    ...h.raw,
    longitude: h.raw.longitude + 0.0005,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].mode, "walk");
  assert.equal(result[0].legs.length, 0);
  assert.equal(result[0].points.length, 2);
});
test("directional common places normalize to one saved name and the group centroid", () => {
  const h = harness(),
    { placeGroups, groupPoint } = h.load("features/utils/shuttle-place-groups"),
    { canonicalCommonPlace, commonPlace } = h.load(
      "features/utils/shuttle-common-places",
    );
  const g = placeGroups(map).find((g) => g.members.length > 1);
  assert(g);
  const values = g.members.map((p) =>
    canonicalCommonPlace(map, commonPlace(p, p.id)),
  );
  assert.equal(new Set(values.map((p) => p.key)).size, 1);
  assert.equal(values[0].longitude, groupPoint(g).longitude);
  assert.equal(values[0].latitude, groupPoint(g).latitude);
});
test("drawer drags track the finger and search uses stable overlay scrolling with saved places", async () => {
  const h = harness({ mockStream: true }),
    p = h.page();
  p.onLoad();
  p.onReady();
  p.onShow();
  await settle();
  const initial = p.data.sheetHeight;
  p.onSheetTouchStart({ touches: [{ clientY: 500 }] });
  p.onSheetTouchMove({ touches: [{ clientY: 455 }] });
  assert(p.data.sheetDragging);
  assert.equal(p.data.sheetHeight, initial + 45);
  p.onSheetTouchEnd({ changedTouches: [{ clientY: 455 }] });
  assert(p.data.sheetDragging);
  assert(p.data.sheetHeight > initial + 45);
  assert(
    p.data.sheetHeight <
      Math.round(
        Math.min(
          p.data.windowHeight - p.data.headerHeight - 105,
          p.data.windowHeight * 0.62,
        ),
      ),
  );
  let frames = 0;
  while (p.data.sheetDragging && frames++ < 70) {
    const job = [...h.jobs].find(([, value]) => value.delay === 16);
    assert(job, "spring keeps scheduling animation frames");
    h.jobs.delete(job[0]);
    job[1].f();
  }
  assert(!p.data.sheetDragging);
  assert(p.data.sheetExpanded);
  const wxml = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  assert(!wxml.includes('class="keyboard-space"'));
  assert(!wxml.includes('hidden="{{searchMounted'));
  assert(wxml.includes('class="search-shortcuts"'));
  assert(wxml.includes('bindtap="chooseSavedPlace"'));
  assert(!wxml.includes('bindtap="refreshShuttles"'));
  assert(!wxml.includes("信号待更新"));
  assert(!wxml.includes("校车信号暂未更新"));
  p.onUnload();
});
test("transfers never ride backwards to a service available at the original stop", () => {
  const h = harness(),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const point = (id, x) => ({
    id,
    name: id,
    shortName: id,
    longitude: 106.4 + x,
    latitude: 29.82,
    category: "stop",
    routeIds: [],
  });
  const a = point("a", 0),
    t = point("t", -0.006),
    d = point("d", 0.03);
  const route = (id) => ({
    id,
    name: id,
    color: "#123456",
    stopIds: [],
    orderedStops: [],
  });
  const leg = (id, board, alight, meters) => ({
    id,
    route: route(id),
    board,
    alight,
    points: [board, alight],
    rideMeters: meters,
    walkTo: 0,
    walkFrom: 0,
    stopCount: 1,
  });
  const first = leg("away", a, t, 600),
    second = leg("return", t, d, 3500),
    direct = leg("return", a, d, 2900);
  const fake = {
    plans(origin, dest, boarding, routeId) {
      if (dest === d)
        return routeId === "return" ||
          !boarding?.length ||
          boarding.includes("a")
          ? [direct]
          : boarding.includes("t")
            ? [second]
            : [];
      return dest.id === "t" ? [first] : [];
    },
  };
  const plans = new ShuttleItineraryPlanner(
    { ...map, places: [a, t, d] },
    fake,
  ).plans(a, d, [a.id], [d.id]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].legs.length, 1);
  assert.equal(plans[0].route.id, "return");
});
test("a necessary forward transfer remains available, while overshooting a useful alighting stop is rejected", () => {
  const h = harness(),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const point = (id, x) => ({
    id,
    name: id,
    shortName: id,
    longitude: 106.4 + x,
    latitude: 29.82,
    category: "stop",
    routeIds: [],
  });
  const a = point("a", 0),
    t = point("t", 0.013),
    d = point("d", 0.03);
  const leg = (id, board, alight, meters, walkFrom = 0) => ({
    id: id + board.id + alight.id,
    route: { id, name: id, color: "#123456", stopIds: [], orderedStops: [] },
    board,
    alight,
    points: [board, alight],
    rideMeters: meters,
    walkTo: 0,
    walkFrom,
    stopCount: 1,
  });
  const first = leg("A", a, t, 1300),
    second = leg("B", t, d, 1700);
  let direct = [];
  const fake = {
    plans(origin, dest, boarding, routeId) {
      if (routeId) return [];
      if (dest === d) return boarding?.includes("t") ? [second] : direct;
      return dest.id === "t" ? [first] : [];
    },
  };
  const input = { ...map, places: [a, t, d] };
  let plans = new ShuttleItineraryPlanner(input, fake).plans(
    a,
    d,
    [a.id],
    [d.id],
  );
  assert.equal(plans.length, 1);
  assert.equal(plans[0].legs.length, 2);
  assert.equal(plans[0].legs[0].alight.id, plans[0].legs[1].board.id);
  direct = [leg("A", a, d, 600, 40)];
  plans = new ShuttleItineraryPlanner(input, fake).plans(a, d, [a.id], [d.id]);
  assert(plans.every((p) => p.legs.length === 1));
});
test("server trajectories use one attached bus/arrow, serialize updates and ignore cleared callbacks", () => {
  const clock = { now: 1000 },
    h = harness({ clock }),
    { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion");
  const motion = new ShuttleMapMotion(
    h.native,
    {
      motionPath() {
        throw Error("client must not solve vehicle paths");
      },
    },
    false,
  );
  const p = (x) => ({ longitude: 106.42 + x / 100000, latitude: 29.82 });
  const bus = {
    id: "server-bus",
    vehicleNo: "1",
    lineId: "243",
    ...p(10),
    direction: 270,
    motion: {
      startsAt: 1000,
      duration: 3000,
      points: [p(0), p(10)],
      heading: 90,
      status: "moving",
      reset: false,
    },
  };
  motion.update([bus], 1000, false, 1000);
  let moves = h.calls.filter((c) => c[0] === "moveAlong");
  assert.equal(moves.length, 1);
  assert.equal(moves[0][1].autoRotate, true);
  assert(moves[0][1].path[1].longitude > moves[0][1].path[0].longitude);
  assert.equal(
    h.calls.filter((c) => c[0] === "addMarkers").flatMap((c) => c[1].markers)
      .length,
    1,
  );
  clock.now = 2500;
  motion.update(
    [
      {
        ...bus,
        ...p(20),
        motion: { ...bus.motion, startsAt: 4000, points: [p(10), p(20)] },
      },
    ],
    4000,
    false,
    2500,
  );
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 1);
  clock.now = 4000;
  [...h.jobs.values()].find((j) => j.delay === 3000).f();
  moves = h.calls.filter((c) => c[0] === "moveAlong");
  assert.equal(moves.length, 2);
  assert.equal(motion.positions()[0].point.longitude, p(10).longitude);
  motion.clear();
  for (const job of [...h.jobs.values()]) job.f();
  assert.equal(motion.positions().length, 0);
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 2);
});
test("saved itinerary preferences apply only to nearby origins/destinations and the same account", () => {
  const h = harness(),
    { preferredPlan, togglePreferredPlan } = h.load(
      "features/utils/shuttle-preferences",
    );
  const origin = { longitude: 106.42, latitude: 29.82 },
    dest = { longitude: 106.43, latitude: 29.82 },
    plan = { mode: "ride", legs: [{ routes: [{ id: "243" }] }] };
  assert(togglePreferredPlan("42", plan, origin, dest));
  assert(
    preferredPlan("42", plan, origin, {
      ...dest,
      longitude: dest.longitude + 0.0001,
    }),
  );
  assert(!preferredPlan("43", plan, origin, dest));
  assert(
    !preferredPlan("42", plan, origin, {
      ...dest,
      latitude: dest.latitude + 0.01,
    }),
  );
  assert(
    !preferredPlan(
      "42",
      { ...plan, legs: [{ routes: [{ id: "239" }] }] },
      origin,
      dest,
    ),
  );
  assert(!togglePreferredPlan("42", plan, origin, dest));
  assert(!preferredPlan("42", plan, origin, dest));
});
test("route 4 recognizes the history museum and a stationary bus waits for departure", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  const stop = map.places.find(
    (p) => p.category === "stop" && p.name.includes("校史馆"),
  );
  assert(stop);
  const bus = {
    id: "4",
    lineId: "243",
    ...stop,
    speed: 0,
    direction: null,
    motion: { status: "stationary" },
  };
  assert.equal(planner.arrival(bus, stop, false).preparing, undefined);
  assert.equal(planner.arrival(bus, stop, false).detail, "行驶方向待确认");
  assert.notEqual(
    planner.arrival(
      { ...bus, speed: 12, motion: { status: "moving" }, direction: 90 },
      stop,
      false,
    ).detail,
    "此车不经过该候车点",
  );
});
test("a useful direct ride leads a medium-distance trip; nearby destinations still walk", () => {
  const h = harness(),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const a = {
      id: "a",
      name: "a",
      category: "stop",
      routeIds: ["r"],
      longitude: 106.42,
      latitude: 29.82,
    },
    d = { ...a, id: "d", longitude: 106.425 };
  const leg = {
    id: "r",
    route: { id: "r", name: "r" },
    board: a,
    alight: d,
    points: [a, d],
    rideMeters: 500,
    walkTo: 5,
    walkFrom: 5,
    stopCount: 1,
  };
  const fake = { plans: () => [leg] };
  const planner = new ShuttleItineraryPlanner({ ...map, places: [a, d] }, fake);
  assert.equal(planner.plans(a, d)[0].mode, "ride");
  assert.equal(
    planner.plans(a, { ...d, longitude: a.longitude + 0.001 })[0].mode,
    "walk",
  );
});
test("boarding favorites add an animated chip and sort first within the stop category", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  assert(page.data.boardName);
  page.toggleFavorite();
  assert(page.data.boardFavorite);
  assert.equal(page.data.commonPlaces.length, 1);
  assert.equal(page.data.commonEnteringKey, page.data.commonPlaces[0].key);
  page.openDestinationSearch();
  assert(page.data.searchStopRows[0].places[0].favorite);
  page.toggleFavorite();
  assert(!page.data.boardFavorite);
  assert.equal(page.data.commonPlaces.length, 0);
  page.onUnload();
});
test("walking origin updates stay anchored to the displayed user marker and live success is silent", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({
    ...h.raw,
    longitude: h.raw.longitude + 0.001,
    name: "近处",
  });
  page.confirmMapPick();
  await settle();
  [...h.jobs.values()].find((j) => j.delay > 9000 && j.delay <= 10000).f();
  const location = { ...h.raw, longitude: h.raw.longitude + 0.00008 };
  h.getListener()(location);
  await settle();
  const user = h.calls
    .filter((c) => c[0] === "addMarkers")
    .flatMap((c) => c[1].markers)
    .filter((m) => m.id === 1)
    .at(-1);
  const walks = page.data.polylines.filter((p) => p.dottedLine);
  assert(walks.length);
  assert.equal(walks[0].points[0].longitude, user.longitude);
  assert.equal(user.longitude, location.longitude);
  const wxml = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  assert(wxml.includes("hasOrigin && connection !== 'live'"));
  page.updateOverlays();
  assert.equal(page.data.edgeHints.length, 0);
  const preview = fs.readFileSync(
    path.join(root, "components/shuttle-preview/index.wxml"),
    "utf8",
  );
  assert(!preview.includes('class="preview-bottom"'));
  assert(preview.includes('bindmarkertap="openShuttle"'));
  page.onUnload();
});
test("rapid favorite reversals stay responsive and persist only the last intent", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  h.wx.setStorage = ({ key, data }) => h.storage.set(key, data);
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  const start = Date.now();
  for (let i = 0; i < 30; i++) page.toggleFavorite();
  assert(
    Date.now() - start < 2500,
    "favorite toggles must not repeatedly regroup the full map",
  );
  assert.equal(page.data.commonPlaces.length, 0);
  assert.equal(page.data.boardFavorite, false);
  for (const [id, job] of [...h.jobs])
    if (job.delay === 0) {
      h.jobs.delete(id);
      job.f();
    }
  assert.equal(
    h.load("features/utils/shuttle-common-places").loadCommonPlaces("42")
      .length,
    0,
  );
  page.openDestinationSearch();
  assert(page.data.searchStopRows.length);
  page.onUnload();
});
test("server walking geometry replaces the fallback and late planning cannot revive an unloaded page", async () => {
  const requests = [];
  const h = harness({
      mockStream: true,
      plans: (o) => new Promise((resolve) => requests.push({ o, resolve })),
    }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({
    ...h.raw,
    longitude: h.raw.longitude + 0.001,
    name: "目的地",
  });
  page.confirmMapPick();
  await settle();
  assert(requests.length);
  const request = requests.at(-1),
    { origin, destination } = request.o.data;
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const plan = new ShuttleItineraryPlanner(map, new ShuttlePlanner(map))
    .plans(origin, destination)
    .find((p) => p.mode === "walk");
  const corner = {
    longitude: origin.longitude,
    latitude: origin.latitude + 0.0003,
  };
  request.resolve({
    revision: map.revision,
    planningId: "test",
    plans: [
      {
        ...plan,
        walkLegs: [
          {
            points: [origin, corner, destination],
            meters: 180,
            seconds: 150,
            source: "tencent",
          },
        ],
        totalSeconds: 150,
      },
    ],
  });
  await settle();
  assert(
    page.data.polylines.some(
      (line) =>
        line.dottedLine &&
        line.points.some((p) => p.latitude === corner.latitude),
    ),
  );
  page.showMapPick({
    ...destination,
    longitude: destination.longitude + 0.002,
    name: "另一处",
  });
  page.confirmMapPick();
  await settle();
  const last = requests.at(-1);
  page.onUnload();
  const paints = h.calls.filter((c) => c[0] === "polylines").length;
  last.resolve({ revision: map.revision, plans: [plan] });
  await settle();
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, paints);
});
test("restoring directional stop IDs keeps a saved favorite at the matching named place", () => {
  const h = harness(),
    common = h.load("features/utils/shuttle-common-places");
  const old = map.places.find((p) => p.category === "stop");
  const saved = common.commonPlace(old, old.id);
  const restored = {
    ...map,
    places: map.places.map((p) =>
      p.id === old.id ? { ...p, id: "restored-stop-id" } : p,
    ),
  };
  const value = common.canonicalCommonPlace(restored, saved);
  assert.notEqual(value.placeId, old.id);
  assert.equal(value.shortName, saved.shortName);
});

test("delayed observation playback uses the full history clock and never races native success", () => {
  const clock = { now: 5000 },
    h = harness({ clock });
  const { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion");
  const motion = new ShuttleMapMotion(h.native, {}, false);
  const p = (x) => ({ longitude: 106.42 + x / 100000, latitude: 29.82 });
  const first = { startsAt: 1000, duration: 3000, points: [p(0), p(12)] };
  const bus = {
    id: "buffered",
    lineId: "77",
    vehicleNo: "1",
    ...p(12),
    motion: {
      ...first,
      history: [first],
      playbackDelay: 3000,
      status: "moving",
      heading: 90,
      reset: false,
    },
  };
  motion.update([bus], 4000, false, 5000);
  const move = h.calls.find((c) => c[0] === "moveAlong")[1];
  assert.equal(move.duration, 2000);
  assert(
    Math.abs(motion.positions()[0].point.longitude - p(4).longitude) < 1e-8,
  );
  const second = { startsAt: 4000, duration: 3000, points: [p(12), p(24)] };
  clock.now = 6900;
  motion.update(
    [
      {
        ...bus,
        ...p(24),
        motion: { ...bus.motion, ...second, history: [first, second] },
      },
    ],
    7000,
    false,
    6900,
  );
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 1);
  const job = [...h.jobs.entries()].find(([, j]) => j.delay === 2000);
  h.jobs.delete(job[0]);
  clock.now = 7000;
  job[1].f();
  const moves = h.calls.filter((c) => c[0] === "moveAlong");
  assert.equal(moves.length, 2);
  assert.equal(moves[1][1].duration, 3000);
  assert.equal(moves[1][1].path[0].longitude, p(12).longitude);
  motion.update([bus], 4000, false, 7000); // Out-of-order delivery cannot rewind.
  assert.equal(h.calls.filter((c) => c[0] === "moveAlong").length, 2);
  motion.clear();
  assert.equal(h.jobs.size, 0);
});
test("camera gestures and programmatic camera updates preserve native route overlays", async () => {
  const h = harness({ mockStream: true, canvas: true }),
    p = h.page();
  p.onLoad();
  p.onReady();
  p.onShow();
  await settle();
  p.onMapTap({
    detail: {
      longitude: h.raw.longitude + 0.002,
      latitude: h.raw.latitude,
      name: "目标",
    },
  });
  p.confirmMapPick();
  [...h.jobs.values()]
    .filter((j) => j.delay === 420)
    .at(-1)
    .f();
  assert(p.data.routeAnimating);
  const count = h.calls.length;
  for (const causedBy of ["gesture", "update", undefined]) {
    p.onRegionChange({ type: "begin", detail: { causedBy } });
    p.onRegionChange({ type: "end", detail: { causedBy } });
  }
  const updates = h.calls.slice(count).filter((c) => c[0] === "polylines");
  assert.equal(updates.length, 0);
  p.onUnload();
});
test("offline transport cancels ownership, pauses retries and reconnects once after recovery", async () => {
  let network,
    removed = 0,
    tickets = 0;
  const sockets = [];
  const h = harness({
    api: async () => {
      tickets++;
      return { ticket: "ticket" };
    },
  });
  h.wx.onNetworkStatusChange = (fn) => {
    network = fn;
  };
  h.wx.offNetworkStatusChange = (fn) => {
    if (fn === network) removed++;
  };
  h.wx.connectSocket = () => {
    const c = {
      sent: [],
      onOpen(fn) {
        this.open = fn;
      },
      onMessage(fn) {
        this.message = fn;
      },
      onClose(fn) {
        this.closed = fn;
      },
      onError(fn) {
        this.error = fn;
      },
      send(o) {
        this.sent.push(o);
      },
      close() {
        this.closed?.({ code: 1000 });
      },
    };
    sockets.push(c);
    return c;
  };
  const { ShuttleStream } = h.load("features/services/shuttle-stream");
  const stream = new ShuttleStream(() => ({ raw: h.raw }), {
    snapshot() {},
    receipt() {},
    state() {},
    fatal() {},
    selectionInvalid() {},
  });
  stream.start({});
  await settle();
  sockets[0].open();
  sockets[0].message({ data: JSON.stringify({ type: "ready" }) });
  sockets[0].message({ data: JSON.stringify({ type: "ready" }) });
  assert.equal([...h.jobs.values()].filter((j) => j.interval).length, 1);
  network({ isConnected: false });
  assert.equal(h.jobs.size, 0);
  assert.equal(tickets, 1);
  network({ isConnected: false });
  assert.equal(h.jobs.size, 0);
  network({ isConnected: true });
  const job = [...h.jobs.entries()][0];
  h.jobs.delete(job[0]);
  job[1].f();
  await settle();
  assert.equal(tickets, 2);
  stream.stop();
  assert(removed);
  assert.equal(h.jobs.size, 0);
  sockets[1].open();
  assert.equal(h.jobs.size, 0);
});

test("late walking geometry cannot complete or replace a reveal midway", async () => {
  const pending = [],
    h = harness({
      mockStream: true,
      canvas: true,
      plans: (o) => new Promise((resolve) => pending.push({ o, resolve })),
    }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({
    ...h.raw,
    longitude: h.raw.longitude + 0.001,
    name: "目标",
  });
  page.confirmMapPick();
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
  tick(550);
  const count = h.calls.filter((c) => c[0] === "polylines").length,
    { origin, destination } = pending.at(-1).o.data;
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const plan = new ShuttleItineraryPlanner(map, new ShuttlePlanner(map))
      .plans(origin, destination)
      .find((p) => p.mode === "walk"),
    corner = {
      longitude: origin.longitude,
      latitude: origin.latitude + 0.0002,
    };
  pending.at(-1).resolve({
    revision: map.revision,
    planningId: "late",
    plans: [
      {
        ...plan,
        walkLegs: [
          {
            points: [origin, corner, destination],
            source: "tencent",
            meters: 180,
            seconds: 150,
          },
        ],
      },
    ],
  });
  await settle();
  assert(page.data.routeAnimating);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, count);
  assert(h.frames.size);
  tick(1100);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, count);
  tick(2200);
  [...h.jobs.values()]
    .filter((j) => j.delay === 160)
    .at(-1)
    .f();
  assert(
    page.data.polylines.some((l) =>
      l.points.some((p) => p.latitude === corner.latitude),
    ),
  );
  page.onUnload();
});
test("walking geometry survives 10m GPS jitter, page recreation and account changes without anchor drift", async () => {
  const clock = { now: Date.now() };
  let planned = 0,
    estimated = 0;
  const h = harness({
    clock,
    api: async (url) => {
      if (url.endsWith("/estimates")) {
        estimated++;
        return { revision: "r", plans: [{ id: "p", totalSeconds: 200 }] };
      }
      if (url.endsWith("/plans")) {
        planned++;
        return {
          revision: "r",
          planningId: "id",
          plans: [
            {
              id: "p",
              mode: "walk",
              walkLegs: [
                { source: "tencent", points: [], meters: 200, seconds: 180 },
              ],
            },
          ],
        };
      }
      throw Error("unexpected API");
    },
  });
  const { cachedShuttlePlan } = h.load("features/services/shuttle-planning");
  const request = {
    origin: { longitude: 106.42, latitude: 29.82 },
    destination: { longitude: 106.421, latitude: 29.821 },
    originMode: "manual",
    boardingIds: [],
    destinationStopIds: [],
  };
  await cachedShuttlePlan(request, "r");
  await cachedShuttlePlan(
    { ...request, origin: { ...request.origin, latitude: 29.82008 } },
    "r",
  );
  assert.equal(planned, 1);
  assert.equal(estimated, 0); // Restore geometry immediately without waiting for any network request.
  clock.now += 5000;
  await cachedShuttlePlan(
    { ...request, origin: { ...request.origin, latitude: 29.82012 } },
    "r",
  );
  assert.equal(planned, 2);
  h.changeUser("43");
  await cachedShuttlePlan(request, "r");
  assert.equal(planned, 3);
});
test("locate is a single native camera move and later location callbacks never recenter", async () => {
  const h = harness({ mockStream: true }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.locateUser();
  assert.equal(h.calls.filter((c) => c[0] === "moveToLocation").length, 1);
  assert.equal(page.data.following, false);
  const center = [page.data.latitude, page.data.longitude];
  page.onRegionChange({ type: "begin", detail: { causedBy: "gesture" } });
  h.getListener()({ ...h.raw, longitude: h.raw.longitude + 0.0001 });
  page.onRegionChange({ type: "end", detail: { causedBy: "gesture" } });
  assert.deepEqual([page.data.latitude, page.data.longitude], center);
  assert.equal(h.calls.filter((c) => c[0] === "moveToLocation").length, 1);
  page.onUnload();
});
test("camera drag keeps the reveal clock and reprojects each frame without native prefix writes", () => {
  const h = harness({ canvas: true });
  const { ShuttleRouteReveal, orderedTraces } = h.load(
    "features/utils/shuttle-route-reveal",
  );
  const point = (x) => ({ longitude: 106 + x / 10000, latitude: 29 });
  const parts = orderedTraces([
    { points: [point(0), point(1)], color: "blue", width: 4, dotted: false },
    { points: [point(1), point(2)], color: "red", width: 4, dotted: false },
  ]);
  const reveal = new ShuttleRouteReveal(h.canvas, h.canvasContext);
  let complete = 0,
    shift = 0,
    moving = false;
  reveal.start(
    parts,
    (p) => ({ x: p.longitude + shift, y: p.latitude }),
    320,
    400,
    () => complete++,
    () => !moving,
  );
  const tick = (t) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(t);
  };
  const path = (color) =>
    h.calls.filter((c) => c[0] === "trace" && c[1].color === color).at(-1)?.[1]
      .path;
  tick(0);
  tick(550);
  const first = path("blue").at(-1)[0];
  moving = true;
  shift = 10;
  tick(1000);
  assert(path("blue").at(-1)[0] - shift > first);
  assert.equal(path("blue")[0][0], point(0).longitude + shift);
  assert.equal(path("red"), undefined);
  tick(1650);
  assert(path("red").length > 1);
  tick(2200);
  assert.equal(path("red").at(-1)[0], point(2).longitude + shift);
  assert.equal(complete, 0); // Only native handoff waits for the camera; reveal is already complete.
  moving = false;
  tick(2216);
  assert.equal(complete, 1);
  assert(!h.calls.some((c) => c[0] === "polylines"));
});

test("late walking traces have independent clocks and leave bus progress and completed walks untouched", () => {
  const h = harness({ canvas: true });
  const { ShuttleRouteReveal, orderedTraces } = h.load(
    "features/utils/shuttle-route-reveal",
  );
  const p = (x, y = 29) => ({ longitude: 106 + x / 10000, latitude: y });
  const rides = orderedTraces([
    { points: [p(0), p(10)], color: "bus", width: 4, dotted: false },
  ]);
  const walks = orderedTraces([
    {
      points: [p(10), p(10, 29.0001), p(11, 29.0001)],
      color: "walk",
      width: 3,
      dotted: true,
    },
  ]);
  const reveal = new ShuttleRouteReveal(h.canvas, h.canvasContext);
  let complete = 0;
  reveal.start(
    rides,
    (p) => ({ x: p.longitude, y: p.latitude }),
    320,
    400,
    () => complete++,
    undefined,
    true,
  );
  const tick = (t) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(t);
  };
  const last = (color) =>
    h.calls.filter((c) => c[0] === "trace" && c[1].color === color).at(-1)?.[1];
  tick(0);
  tick(550);
  const before = last("bus").path.at(-1)[0];
  assert.equal(last("walk"), undefined);
  reveal.updateWalking(walks, true);
  tick(700);
  tick(1100);
  assert(last("bus").path.at(-1)[0] > before);
  assert(last("walk").dash.length);
  const halfway = last("walk").path.at(-1);
  reveal.updateWalking(walks, true);
  tick(1600);
  assert.notDeepEqual(last("walk").path.at(-1), halfway);
  assert.equal(last("walk").path.at(-1)[0], p(11).longitude);
  assert.equal(complete, 0);
  tick(2200);
  assert.equal(complete, 1);
});

test("background map requests coalesce, pace GPS churn and honor server retry windows per account", async () => {
  const clock = { now: Date.now() };
  let release;
  let failure;
  const h = harness({
    clock,
    api: () =>
      failure
        ? Promise.reject(failure)
        : new Promise((resolve) => {
            release = resolve;
          }),
  });
  const { shuttleRequest } = h.load("services/shuttle-request");
  const first = shuttleRequest("/shuttle/walking", { data: { x: 1 } });
  const duplicate = shuttleRequest("/shuttle/walking", { data: { x: 1 } });
  assert.equal(first, duplicate);
  await assert.rejects(
    shuttleRequest("/shuttle/walking", { data: { x: 2 } }),
    (e) => e.code === "SHUTTLE_REFRESH_DEFERRED",
  );
  release({ ok: true });
  await first;
  for (let i = 1; i < 5; i++) {
    clock.now += 1000;
    await assert.rejects(
      shuttleRequest("/shuttle/walking", { data: { x: i } }),
    );
  }
  assert.equal(h.calls.filter((c) => c[0] === "request").length, 1);
  clock.now += 1000;
  failure = Object.assign(Error("rate limited"), {
    statusCode: 429,
    retryAfterMs: 90000,
  });
  await assert.rejects(
    shuttleRequest("/shuttle/walking", { data: { x: 6 } }),
    /rate limited/,
  );
  clock.now += 89000;
  await assert.rejects(
    shuttleRequest("/shuttle/walking"),
    (e) => e.retryAfterMs === 1000,
  );
  clock.now += 1000;
  await assert.rejects(shuttleRequest("/shuttle/walking"), /rate limited/);
  h.changeUser("other");
  await assert.rejects(shuttleRequest("/shuttle/walking"), /rate limited/);
  const requests = h.calls.filter((c) => c[0] === "request");
  assert.equal(requests.length, 4);
  assert(
    requests.every(
      (c) => c[2].retry === false && c[2].rateLimitFeedback === false,
    ),
  );
});

test("one minute of idle GPS updates cannot restart a failed walking lookup every second", async () => {
  const clock = { now: Date.now() };
  let walks = 0;
  const h = harness({
    clock,
    mockStream: true,
    walking: async () => {
      walks++;
      throw Error("offline");
    },
  });
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  for (let i = 0; i < 60; i++) {
    clock.now += 1000;
    h.getListener()({ ...h.raw });
    await settle();
  }
  assert(walks > 1 && walks <= 5, `unexpected walking request count ${walks}`);
  assert(!h.calls.some((c) => c[0] === "toast"));
  page.onUnload();
});

test("animated route paint exposes native vehicle and stop circles after every frame", () => {
  const h = harness({ canvas: true });
  const { ShuttleRouteReveal, orderedTraces } = h.load(
    "features/utils/shuttle-route-reveal",
  );
  const p = (x) => ({ longitude: x, latitude: 0 });
  let bus = p(2),
    shift = 0;
  h.canvasContext.globalCompositeOperation = "source-over";
  new ShuttleRouteReveal(h.canvas, h.canvasContext).start(
    orderedTraces([{ points: [p(0), p(10)], color: "blue", width: 4 }]),
    (p) => ({ x: p.longitude + shift, y: 10 }),
    320,
    400,
    () => {},
    undefined,
    false,
    false,
    () => [
      { point: bus, radius: 13 },
      { point: p(6), radius: 6.1 },
    ],
  );
  const tick = (time) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(time);
  };
  tick(0);
  tick(500);
  assert.deepEqual(h.calls.at(-2)[1].circle, [2, 10, 13]);
  assert.deepEqual(h.calls.at(-1)[1].circle, [6, 10, 6.1]);
  assert.equal(h.calls.at(-1)[1].composite, "destination-out");
  assert.equal(h.canvasContext.globalCompositeOperation, "source-over");
  bus = p(3);
  shift = 15;
  tick(1000);
  assert.deepEqual(h.calls.at(-2)[1].circle, [18, 10, 13]);
  assert.equal(h.calls.at(-3)[0], "trace");
});

test("map title and first campus-help entry agree, and preparing buses use the concise label", () => {
  const h = harness(),
    page = h.page();
  assert.equal(
    page.walkLabel({ nextDepartureState: "preparing" }),
    "下一辆：准备发车",
  );
  const wxml = fs.readFileSync(
    path.join(root, "pages/profile/content.wxml"),
    "utf8",
  );
  assert(wxml.indexOf("小易地图") < wxml.indexOf("小易选课"));
  assert(wxml.includes('bindtap="openShuttleMap"'));
  const profile = fs.readFileSync(
    path.join(root, "pages/profile/index.ts"),
    "utf8",
  );
  assert(
    profile.includes(
      'this.openProfileRoute("shuttle", "/features/pages/shuttle/index")',
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
