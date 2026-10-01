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
    path.join(backend, "test/fixtures/legacy-shuttle.campusmap.json"),
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
    if (options.demo)
      return load("demo/shuttle").demoShuttleRequest(
        url,
        o.method || "GET",
        o.data,
      );
    calls.push(["request", url, structuredClone(o)]);
    if (options.api) return options.api(url, o);
    if (url.endsWith("/estimates") && options.estimates)
      return options.estimates(o);
    if (url.endsWith("/map")) return structuredClone(options.map || map);
    if (url.includes("/vehicle-preview/") && options.preview)
      return options.preview(url, o);
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
      getSession: () => ({
        user: { id: owner, account: options.demo ? "demo" : "real" },
      }),
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
    "demo/identity.ts": { isDemoSession: () => !!options.demo },
  };
  // Exercise page request ownership independently of transport coalescing.
  if (options.uncoalescedRequests)
    mocks["services/shuttle-request.ts"] = { shuttleRequest: api };
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
    getLocationError: () => locationError,
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
function progressFixture(h, options = {}) {
  const point = (meters) => ({
    longitude: 106.42 + meters / 96500,
    latitude: 29.82,
    accuracy: 5,
  });
  const stop = (id, meters) => ({
    ...point(meters),
    id,
    name: id,
    category: "stop",
    routeIds: ["r"],
  });
  const route = { id: "r", name: "1号线", color: "#333", stopIds: [] };
  const leg = {
    route,
    routes: [route],
    board: stop("候车站", 100),
    alight: stop("终点站", 600),
    points: [point(100), point(300), point(600)],
    rideMeters: 500,
  };
  const transfer = {
    ...leg,
    route: { ...route, id: "r2" },
    routes: [{ ...route, id: "r2" }],
    board: options.sameStop ? leg.alight : stop("换乘站", 700),
    alight: stop("第二终点站", 1200),
    points: [point(options.sameStop ? 600 : 700), point(1200)],
  };
  const plan = {
    legs: options.walk ? [] : options.transfer ? [leg, transfer] : [leg],
    walkLegs: [],
  };
  const planner = {
    journeyStops: () =>
      options.stopMeters
        ? options.stopMeters.map((meters, i) => ({
            place: stop(`途经站${i + 1}`, 100 + meters),
            meters,
          }))
        : [{ place: stop("中间站", 300), meters: 200 }],
  };
  const { ShuttleJourneyProgress } = h.load(
    "features/utils/shuttle-journey-progress",
  );
  return {
    point,
    progress: new ShuttleJourneyProgress(
      plan,
      point(options.atBoard ? 100 : 0),
      {
        ...point(options.transfer ? 1300 : 700),
        name: options.destinationName || "目的地",
      },
      planner,
    ),
  };
}
test("ride station nodes are evenly spaced while progress interpolates within the actual stop interval", () => {
  const h = harness(),
    { point, progress } = progressFixture(h, {
      atBoard: true,
      stopMeters: [50, 400],
    });
  for (const width of [200, 252, 295, 350]) {
    const view = progress.view(width),
      ride = view.segments[0];
    assert(Math.abs(view.nodes[1].x - ride.width / 3) < 1e-6);
    assert(Math.abs(view.nodes[2].x - (ride.width * 2) / 3) < 1e-6);
    assert(Math.abs(view.nodes[3].x - ride.width) < 1e-6);
  }
  let time = 1000;
  progress.update(point(100), time);
  for (const x of [130, 160, 190, 220, 250, 280, 310, 340, 350])
    progress.update(point(x), (time += 5000));
  const view = progress.view(295),
    [from, to] = view.nodes.slice(1, 3);
  assert(
    Math.abs((view.position - from.x) / (to.x - from.x) - 200 / 350) < 0.001,
  );
  assert.equal(from.reached, true);
  assert.equal(to.reached, false);
  assert(
    Math.abs(view.segments[0].fill - view.position / view.segments[0].width) <
      1e-8,
  );
  assert.equal(view.next, "下一站：途经站2");
});

test("timeline fills clip a full-length rail instead of scaling the walking dash pattern", () => {
  const wxml = fs.readFileSync(
      path.join(root, "features/pages/shuttle/index.wxml"),
      "utf8",
    ),
    css = fs.readFileSync(
      path.join(root, "features/pages/shuttle/index.wxss"),
      "utf8",
    );
  assert.match(
    wxml,
    /class="journey-fill" style="width: \{\{item.fillWidth\}\}px;/,
  );
  assert.match(
    wxml,
    /journey-rail--done[^>]*style="width: \{\{item.width\}\}px;/,
  );
  assert(!wxml.includes("scaleX({{item.fill}})"));
  assert.match(
    css,
    /\.journey-fill \{[^}]*left: 0;[^}]*top: 0;[^}]*height: 3px;[^}]*overflow: hidden;[^}]*transition: width 800ms linear;/,
  );
  assert.match(css, /\.motion-reduced \.journey-fill[^}]*transition: none/);
});

test("walking and unequal stop intervals color the travelled bent road proportionally", () => {
  const h = harness(),
    { ShuttleJourneyProgress } = h.load(
      "features/utils/shuttle-journey-progress",
    ),
    { distanceMeters } = h.load("utils/shuttle-geo");
  const p = (x, y = 0) => ({
    longitude: 106.42 + x / 96500,
    latitude: 29.82 + y / 111200,
    accuracy: 5,
  });
  const points = [p(0), p(100), p(100, 100), p(300, 100)],
    total = points
      .slice(1)
      .reduce((n, v, i) => n + distanceMeters(points[i], v), 0);
  const route = { id: "r", name: "1号线" },
    board = { ...p(0), id: "start", name: "上车站" },
    alight = { ...p(300, 100), id: "end", name: "下车站" };
  for (const ride of [false, true]) {
    const leg = {
      route,
      routes: [route],
      board,
      alight,
      points,
      rideMeters: total,
      onboard: { direction: 0, from: 0, to: total },
    };
    const plan = {
      legs: ride ? [leg] : [],
      walkLegs: ride ? [] : [{ points }],
    };
    const tracker = new ShuttleJourneyProgress(
      plan,
      p(0),
      { ...p(300, 100), name: "终点" },
      {
        onboardProgress: () => undefined,
        journeyStops: () => [
          { place: { name: "第一站" }, meters: 50 },
          { place: { name: "第二站" }, meters: 250 },
        ],
      },
    );
    let time = 1000;
    tracker.update(p(0), time);
    for (let metres = 10; metres <= 300; metres += 10) {
      const point =
        metres <= 100
          ? p(metres)
          : metres <= 200
            ? p(100, metres - 100)
            : p(metres - 100, 100);
      tracker.update(point, (time += 5000));
      const actual =
        metres <= 100
          ? distanceMeters(p(0), point)
          : metres <= 200
            ? distanceMeters(p(0), p(100)) + distanceMeters(p(100), point)
            : distanceMeters(p(0), p(100)) +
              distanceMeters(p(100), p(100, 100)) +
              distanceMeters(p(100, 100), point);
      const expected = ride
        ? (actual < 50
            ? actual / 50
            : actual < 250
              ? 1 + (actual - 50) / 200
              : 2 + (actual - 250) / (total - 250)) / 3
        : actual / total;
      for (const width of [200, 295, 350]) {
        const segment = tracker.view(width).segments[0];
        assert(
          Math.abs(segment.fill - expected) < 0.003,
          `ride=${ride}, metres=${metres}`,
        );
        assert(Math.abs(segment.fillWidth - width * expected) < 1);
      }
      const before = tracker.view(295).segments[0].fillWidth;
      tracker.update(point, (time += 1000));
      assert.equal(
        tracker.view(295).segments[0].fillWidth,
        before,
        "no progress without movement",
      );
    }
  }
});

test("walking sections are shorter without changing walking-only progress or transfer ordering", () => {
  const h = harness();
  for (const width of [200, 252, 295, 350]) {
    const view = progressFixture(h).progress.view(width);
    assert(
      Math.abs(view.segments[0].width / view.segments[1].width - 60 / 150) <
        1e-8,
    );
    assert(view.segments[0].width < (width * 76) / (150 + 76 * 2));
    assert.equal(view.segments[0].width, view.segments[2].width);
    const onlyWalk = progressFixture(h, { walk: true }).progress.view(width);
    assert.equal(onlyWalk.segments[0].width, width);
  }
  const transfer = progressFixture(h, { transfer: true }).progress.view(252);
  assert.deepEqual(
    Array.from(transfer.segments, (s) => s.walk),
    [true, false, true, false, true],
  );
  assert(transfer.segments.filter((s) => s.walk).every((s) => s.width === 60));
});

test("journey timeline follows walk ride walk and automatically completes each stage", () => {
  const h = harness(),
    { point, progress } = progressFixture(h);
  let time = 1000;
  const move = (x, dt = 5000) => {
    time += dt;
    progress.update(point(x), time);
    return progress.view(295);
  };
  assert.deepEqual(
    Array.from(progress.view(295).segments, (s) => s.walk),
    [true, false, true],
  );
  for (const x of [0, 20, 40, 60, 80, 100, 100]) move(x, 10000);
  assert.equal(progress.view(295).phase, "waiting");
  for (const x of [130, 160, 190]) move(x);
  assert.equal(progress.view(295).phase, "riding");
  assert.equal(progress.view(295).next, "下一站：中间站");
  for (let x = 220; x <= 580; x += 30) move(x);
  assert.equal(progress.view(295).next, "下一站：终点站");
  move(600);
  move(600);
  move(600);
  assert.equal(progress.view(295).phase, "walking");
  for (const x of [620, 640, 660, 680, 700, 700]) move(x, 10000);
  assert.equal(progress.view(295).phase, "arrived");
  assert(progress.view(295).nodes.every((n) => n.reached));
  assert(progress.view(295).segments.every((s) => s.fill === 1));
});
test("journey ignores GPS jumps, poor accuracy, backward fixes and pedestrian boarding", () => {
  const h = harness(),
    { point, progress } = progressFixture(h, { atBoard: true });
  assert.equal(progress.view(295).segments[0].walk, false);
  progress.update(point(100), 1000);
  progress.update(point(600), 2000);
  progress.update({ ...point(400), accuracy: 100 }, 3000);
  progress.update(point(400), 500);
  for (let i = 1; i < 8; i++)
    progress.update(point(100 + i * 5), 4000 + i * 5000);
  assert.equal(progress.view(295).phase, "waiting");
  assert.equal(progress.view(295).position, 0);
  progress.pause();
  progress.update(point(550), 200000);
  assert.equal(progress.view(295).position, 0);
});
test("walk-only progress has no artificial boarding and fixed starts omit the first walk", () => {
  const h = harness();
  const walking = progressFixture(h, { walk: true }).progress.view(240);
  assert.equal(walking.segments.length, 1);
  assert(walking.segments[0].walk);
  assert.equal(walking.phase, "walking");
  const fixed = progressFixture(h, { atBoard: true }).progress.view(240);
  assert.deepEqual(
    Array.from(fixed.segments, (s) => s.walk),
    [false, true],
  );
  assert.equal(fixed.nodes[0].name, "候车站");
});
test("transfers keep both rides and their walking connection in sequence", () => {
  const h = harness(),
    { progress, point } = progressFixture(h, { transfer: true, atBoard: true });
  assert.deepEqual(
    Array.from(progress.view(252).segments, (s) => s.walk),
    [false, true, false, true],
  );
  let time = 1000;
  const move = (x) => {
    time += 5000;
    progress.update(point(x), time);
  };
  move(100);
  for (let x = 130; x <= 580; x += 30) move(x);
  move(600);
  move(600);
  move(600);
  assert.equal(progress.view(252).phase, "walking");
  for (const x of [620, 640, 660, 680, 700, 700]) move(x);
  assert.equal(progress.view(252).phase, "waiting");
  assert.equal(progress.view(252).boardingId, "换乘站");
  for (const x of [730, 760, 790]) move(x);
  assert.equal(progress.view(252).phase, "riding");
  assert.deepEqual(Array.from(progress.view(252).routes), ["r2"]);
  progress.pause();
  time += 60000;
  progress.update(point(1100), time);
  assert(progress.view(252).segments[2].fill > 0.7);
  assert.equal(progress.view(252).segments[3].fill, 0);
});
test("journey controls require real location and end as a content-width capsule", () => {
  const h = harness(),
    page = h.page();
  page.setData({ hasOrigin: true, manualOrigin: true });
  page.startJourney();
  assert.equal(page.data.journey, "idle");
  const wxml = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxss"),
    "utf8",
  );
  assert(
    wxml.includes("authorized && hasOrigin && !manualOrigin && selectedPlanId"),
  );
  assert(!wxml.includes("我已上车"));
  assert(!wxml.includes("到站提醒已开启"));
  assert(!wxml.includes("journey-user"));
  assert(wxml.includes('name="refresh-cw"'));
  assert(wxml.includes("journey-next"));
  assert(wxml.indexOf("cancel-trip-wrap") > wxml.indexOf("journey-timeline"));
  assert.match(
    css,
    /\.cancel-trip \{[^}]*display: inline-flex;[^}]*border-radius: 999px;[^}]*background: #eeeeef;/,
  );
  assert.match(css, /\.cancel-trip-wrap \{[^}]*margin-top: 20px;/);
  page.onUnload();
});
test("same-stop transfers use one hollow interchange node without a walking segment", () => {
  const h = harness();
  const same = progressFixture(h, {
    transfer: true,
    sameStop: true,
    atBoard: true,
  }).progress.view(252);
  assert.deepEqual(
    Array.from(same.segments, (s) => s.walk),
    [false, false, true],
  );
  const interchanges = same.nodes.filter((n) => n.transfer);
  assert.equal(interchanges.length, 1);
  assert.equal(interchanges[0].name, "终点站");
  assert.equal(interchanges[0].major, true);
  assert.equal(
    progressFixture(h, { transfer: true })
      .progress.view(252)
      .nodes.filter((n) => n.transfer).length,
    0,
  );
});
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

test("active journeys freeze their selected route and stop on location loss", async () => {
  const clock = { now: Date.now() },
    h = harness({ mockStream: true, clock }),
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
  assert(page.data.selectedPlanId);
  page.startJourney();
  assert.notEqual(page.data.journey, "idle");
  assert(page.data.journeyProgress);
  const selected = page.data.selectedPlanId,
    progress = page.data.journeyProgress.position;
  page.rebuildPlans(true);
  assert.equal(page.data.selectedPlanId, selected);
  const listener = h.getListener();
  page.onHide();
  clock.now += 30000;
  listener({ ...h.raw, longitude: h.raw.longitude + 0.0005 });
  assert.equal(page.data.journeyProgress.position, progress);
  page.onShow();
  await settle();
  assert(h.getLocationError());
  h.getLocationError()({ errMsg: "location unavailable" });
  assert.equal(page.data.authorized, false);
  assert.equal(page.data.journey, "idle");
  assert.equal(page.data.journeyProgress, null);
  page.startJourney();
  assert.equal(page.data.journey, "idle");
  page.onUnload();
});

test("active walking and riding journeys restore their frozen overlays and progress after backgrounding", async () => {
  const geometry = (lines) =>
    clone(lines).map((line) => ({
      ...line,
      points: line.points.map(({ latitude, longitude }) => ({
        latitude,
        longitude,
      })),
    }));
  for (const walkOnly of [false, true])
    for (const duringReveal of [false, true]) {
      const clock = { now: 100000 },
        { point, campus } = onboardFixture(),
        h = harness({ mockStream: true, clock, map: campus, canvas: true });
      Object.assign(h.raw, point(-100, 30));
      const page = h.page();
      page.onLoad();
      page.onReady();
      page.onShow();
      await settle();
      page.showMapPick({ ...point(walkOnly ? -20 : 900, 30), name: "目的地" });
      page.confirmMapPick();
      await settle();
      const choice = page.data.plans.find(
        (p) => p.mode === (walkOnly ? "walk" : "ride"),
      );
      assert(choice);
      page.choosePlan({ currentTarget: { dataset: { id: choice.id } } });
      page.startJourney();
      clock.now += 5000;
      Object.assign(h.raw, point(-90, 30));
      h.getListener()({ ...h.raw });
      page.paintRoutes(true);
      const overlays = geometry(page.data.polylines),
        progress = page.data.journeyProgress.position,
        selected = page.data.selectedPlanId;
      assert(overlays.length > 0);
      assert(progress > 0);
      if (duringReveal) page.setData({ polylines: [], routeAnimating: true });
      const late = [...h.frames.values()];
      for (let attempt = 0; attempt < 2; attempt++) {
        page.onHide();
        clock.now += 30000;
        page.onShow();
        await settle();
        assert.deepEqual(
          geometry(page.data.polylines),
          overlays,
          `restore walk=${walkOnly}, reveal=${duringReveal}`,
        );
        assert.equal(page.data.selectedPlanId, selected);
        assert.equal(page.data.journeyProgress.position, progress);
        assert.equal(page.data.routeAnimating, false);
        late.forEach((fn) => fn(100000));
        assert.deepEqual(geometry(page.data.polylines), overlays);
      }
      page.onUnload();
    }
});

test("real directional journey stops stay between boarding and alighting visits", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const planner = new ShuttlePlanner(map);
  let stops = 0;
  for (const route of map.routes) {
    const places = route.stopIds
      .map((id) => map.places.find((p) => p.id === id))
      .filter(Boolean);
    for (const from of places.slice(0, 3))
      for (const to of places.slice(-3)) {
        for (const plan of planner.plans(from, to, [from.id], route.id, [
          to.id,
        ])) {
          const visits = planner.journeyStops(plan);
          assert(visits.length <= Math.max(0, plan.stopCount - 1));
          for (let i = 0; i < visits.length; i++) {
            assert(visits[i].meters > 0 && visits[i].meters < plan.rideMeters);
            if (i) assert(visits[i].meters >= visits[i - 1].meters);
          }
          stops += visits.length;
        }
      }
  }
  assert(stops > 10);
});

test("timeline stop visits collapse repeated platform markers, not later return visits, and exclude alighting duplicates", () => {
  const h = harness(),
    { ShuttlePlanner, countStopVisits } = h.load(
      "features/utils/shuttle-routing",
    ),
    { point, bus, campus } = onboardFixture(),
    planner = new ShuttlePlanner(campus);
  const stop = (id, name, at, location = at) => ({
    place: { ...point(location), id, name, category: "stop", routeIds: ["r2"] },
    at,
  });
  const stops = [
    stop("board", "起站", 0),
    stop("mid1", "中间站 · 东行", 100),
    stop("mid2", "中间站 · 东行", 110),
    stop("return", "中间站 · 西行", 500, 100),
    stop("end-copy", "终站 · 东行", 980),
    stop("end", "终站 · 东行", 1000),
  ].map((s, order) => ({ ...s, order }));
  const track = {
    points: [point(0), point(1000)],
    offsets: [0, 1000],
    stops,
    loop: false,
  };
  planner.directions = () => [track];
  const plan = {
    route: campus.routes[1],
    board: { ...stops[0].place, serviceOrder: 0 },
    alight: { ...stops[5].place, serviceOrder: 5 },
    rideMeters: 1000,
    points: track.points,
    stopCount: countStopVisits(track, 0, 1000),
  };
  assert.equal(plan.stopCount, 3);
  const visits = planner.journeyStops(plan);
  assert.deepEqual(clone(visits.map((v) => v.place.id)), ["mid2", "return"]);
  assert.equal(visits.length + 1, plan.stopCount);
  const onboard = { ...plan, onboard: { direction: 0, from: 300, to: 1000 } };
  assert.deepEqual(
    clone(planner.journeyStops(onboard).map((v) => v.place.id)),
    ["return"],
  );
  assert(
    !planner.journeyStops(onboard).some((v) => v.place.id.startsWith("end")),
  );
});

test("real-route timeline nodes match counted stop visits instead of raw recovered markers", () => {
  const h = harness(),
    { ShuttlePlanner, countStopVisits } = h.load(
      "features/utils/shuttle-routing",
    ),
    planner = new ShuttlePlanner(map);
  const { countStopVisits: serverCount } = require(
    path.join(backend, "src/shuttle/shuttle-routing"),
  );
  let trimmed = 0,
    checked = 0;
  for (const route of map.routes)
    for (const [direction, track] of planner.directions(route).entries()) {
      for (let a = 0; a < track.stops.length - 1; a++) {
        const b = Math.min(a + 12, track.stops.length - 1),
          board = track.stops[a],
          alight = track.stops[b];
        if (alight.at - board.at < 20) continue;
        const plan = {
          route,
          board: {
            ...board.place,
            serviceDirection: direction,
            serviceOrder: a,
          },
          alight: {
            ...alight.place,
            serviceDirection: direction,
            serviceOrder: b,
          },
        };
        const count = countStopVisits(track, board.at, alight.at),
          visits = planner.journeyStops(plan);
        assert.equal(
          count,
          serverCount(track, board.at, alight.at),
          "do not change the existing API stop-count rules",
        );
        assert(visits.length <= Math.max(0, count - 1));
        assert(
          visits.every(
            (s) => s.meters > 0 && s.meters < alight.at - board.at - 5,
          ),
        );
        const raw = track.stops.filter(
          (s) => s.at > board.at + 5 && s.at < alight.at - 5,
        );
        if (visits.length < raw.length) trimmed++;
        checked++;
      }
    }
  assert(checked > 100 && trimmed > 50);
});

test("the destination endpoint uses only the place name, without a generic destination label", () => {
  const h = harness();
  for (const options of [{}, { walk: true }, { transfer: true }]) {
    const view = progressFixture(h, {
      ...options,
      destinationName: "中心图书馆",
    }).progress.view(295);
    assert.equal(view.nodes.at(-1).name, "中心图书馆");
    assert(!view.nodes.some((node) => node.name.includes("目的地")));
  }
});

function onboardFixture() {
  const point = (x, y = 0) => ({
    longitude: 106.42 + x / 96500,
    latitude: 29.82 + y / 111200,
    accuracy: 5,
  });
  const bus = (x, id = "bus-2", lineId = "r2", y = 0) => ({
    ...point(x, y),
    id,
    lineId,
    vehicleNo: id,
    speed: 20,
    direction: 90,
    state: "",
    distance: 0,
  });
  const places = [0, 300, 600, 900].map((x) => ({
    ...point(x),
    id: `s${x}`,
    name: `站${x}`,
    category: "stop",
    routeIds: ["r1", "r2"],
  }));
  const routes = ["r1", "r2"].map((id, i) => ({
    id,
    name: `${i + 1}号线`,
    color: "#5189B5",
    stopIds: places.map((s) => s.id),
    orderedStops: places.map((s, order) => ({ stopId: s.id, order })),
    servicePattern: "out-and-back",
  }));
  const campus = {
    ...map,
    revision: "onboard-test",
    places,
    routes,
    paths: [
      {
        id: "road",
        routeIds: ["r1", "r2"],
        points: [point(0), point(900)],
        direction: "both",
        color: "#5189B5",
      },
    ],
  };
  return { point, bus, campus };
}

test("stop-pin destinations preserve nearby ride-and-walk candidates in the offline planner", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    planner = new ShuttleItineraryPlanner(map, new ShuttlePlanner(map));
  const origin = map.places.find((p) => p.name === "桃园 · 东行");
  for (const dest of map.places.filter((p) =>
    /^(经管院|资环院) ·/.test(p.name),
  )) {
    const trips = planner.plans(origin, dest, [origin.id], [dest.id], true);
    assert(
      trips.some(
        (p) =>
          p.mode === "ride" && /共青/.test(p.alight.name) && p.walkFrom < 800,
      ),
    );
  }
});

test("numeric route names collapse without losing special services", () => {
  const { routeNames } = harness().load("features/utils/shuttle-route-names");
  assert.equal(
    routeNames(["8号线", "6号线", "7号线", "6号线"].map((name) => ({ name }))),
    "6/7/8 号线",
  );
  assert.equal(
    routeNames(["3路B", "3号线", "经管专线"].map((name) => ({ name }))),
    "3号线 / 3路B / 经管专线",
  );
});

test("line 3 destination-specific through patterns agree with server plans and never retrace Huiwen", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    ServerPlanner = require(
      path.join(backend, "src/shuttle/shuttle-routing"),
    ).ShuttlePlanner,
    planner = new ShuttlePlanner(map),
    server = new ServerPlanner(map),
    get = (id) => map.places.find((p) => p.id === id),
    office = get("shuttle-stop-252548441c34"),
    orange = get("shuttle-stop-714d7ccc123d"),
    literature = get("shuttle-stop-184f7080a560"),
    taoyuan = get("shuttle-stop-8589ac725048"),
    huiwen = get("shuttle-stop-0b4106ecb45f");
  for (const [from, to, branch] of [
    [office, orange, false],
    [orange, office, false],
    [office, taoyuan, true],
    [orange, huiwen, true],
    [orange, taoyuan, true],
    [office, huiwen, true],
  ]) {
    const args = [from, to, [from.id], "242", [to.id]],
      plans = planner.plans(...args);
    assert(plans.length);
    assert.equal(JSON.stringify(plans), JSON.stringify(server.plans(...args)));
    for (const plan of plans) {
      assert.equal(plan.board.serviceDirection >= 2, branch);
      assert.equal(
        plan.points.some((p) => distanceMeters(p, literature) < 25),
        !branch,
      );
    }
  }
  for (const track of planner.directions(
    map.routes.find((r) => r.id === "242"),
  )) {
    const visits = track.stops.filter((s) =>
      [taoyuan.id, huiwen.id].includes(s.place.id),
    );
    assert(visits.length === 0 || visits.length === 2);
    if (visits.length) assert(Math.abs(visits[1].at - visits[0].at) < 100);
  }
  const transfers = planner.plans(
    office,
    huiwen,
    [office.id],
    "242",
    [huiwen.id],
    undefined,
    { point: orange, stopIds: [orange.id] },
  );
  assert.equal(transfers.length, 0);
});

test("line 3 previews approaching the fork prefer the ordinary Literature College corridor", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    planner = new ShuttlePlanner(map),
    route = map.routes.find((r) => r.id === "242"),
    literature = map.places.find((p) => p.id === "shuttle-stop-184f7080a560"),
    taoyuan = map.places.find((p) => p.id === "shuttle-stop-8589ac725048");
  let checked = 0;
  for (const track of planner.directions(route).slice(0, 2)) {
    const departure = planner.vehiclePath({
      id: "terminal",
      lineId: route.id,
      ...track.points[0],
      direction: null,
      speed: 0,
    });
    assert(departure.some((p) => distanceMeters(p, literature) < 25));
    assert(!departure.some((p) => distanceMeters(p, taoyuan) < 25));
    const start = track.stops.find(
      (s) =>
        s.place.id ===
        (track.stops[0].place.id === route.orderedStops[0].stopId
          ? "shuttle-stop-714d7ccc123d"
          : "shuttle-stop-252548441c34"),
    ).at;
    for (let i = 1; i < track.points.length; i++) {
      if (track.offsets[i] > start || track.offsets[i - 1] < start - 100)
        continue;
      const a = track.points[i - 1],
        b = track.points[i];
      if (distanceMeters(a, b) < 5) continue;
      const preview = planner.vehiclePath({
        id: "regular-preview",
        lineId: route.id,
        longitude: (a.longitude + b.longitude) / 2,
        latitude: (a.latitude + b.latitude) / 2,
        direction: headingDegrees(a, b),
      });
      assert(preview.some((p) => distanceMeters(p, literature) < 25));
      assert(!preview.some((p) => distanceMeters(p, taoyuan) < 25));
      checked++;
    }
  }
  assert(checked >= 2);
});

test("line 3 westbound previews cross History College and Taoyuan towards Orange instead of returning to Gate 5", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo");
  const planner = new ShuttlePlanner(map),
    route = map.routes.find((r) => r.id === "242"),
    road = map.paths.find((p) => p.id === "shuttle-road-008-routes-2"),
    terminals = planner.directions(route).map((t) => t.points.at(-1));
  for (const west of [true, false]) {
    const roadPoints = west ? road.points.slice().reverse() : road.points;
    for (let i = 1; i < roadPoints.length; i++)
      for (const f of [0.1, 0.5, 0.9]) {
        const a = roadPoints[i - 1],
          b = roadPoints[i],
          vehicle = {
            id: "history-direction",
            lineId: route.id,
            longitude: a.longitude + (b.longitude - a.longitude) * f,
            latitude: a.latitude + (b.latitude - a.latitude) * f,
            direction: headingDegrees(a, b),
          };
        for (const withHistory of [false, true]) {
          const preview = planner.vehiclePath({
            ...vehicle,
            ...(withHistory
              ? {
                  motion: {
                    heading: vehicle.direction,
                    status: "moving",
                    history: [{ points: [a, vehicle] }],
                  },
                }
              : {}),
          });
          assert(preview.length > 1, `missing segment ${i}, west=${west}`);
          assert(
            distanceMeters(preview.at(-1), terminals[west ? 1 : 0]) < 3,
            `wrong terminal at segment ${i}, west=${west}, history=${withHistory}`,
          );
          if (west) {
            assert(
              preview.some((p) => distanceMeters(p, road.points[0]) < 3),
              "continue through the western junction",
            );
            assert(
              !preview.some((p) => distanceMeters(p, terminals[0]) < 10),
              "never return to Gate 5",
            );
          }
        }
      }
  }
});

test("History College continuation tolerates lateral GPS error without treating the road connector as the heading", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    planner = new ShuttlePlanner(map);
  const road = map.paths.find((p) => p.id === "shuttle-road-008-routes-2"),
    end = planner
      .directions(map.routes.find((r) => r.id === "242"))[1]
      .points.at(-1);
  for (let i = 1; i < road.points.length; i++)
    for (const metres of [-10, 10]) {
      const a = road.points[i],
        b = road.points[i - 1],
        vehicle = {
          id: "history-jitter",
          lineId: "242",
          direction: headingDegrees(a, b),
          longitude: (a.longitude + b.longitude) / 2,
          latitude: (a.latitude + b.latitude) / 2 + metres / 111200,
        };
      const points = planner.vehiclePath(vehicle);
      assert(points.length > 1);
      assert(
        distanceMeters(points.at(-1), end) < 3,
        `segment ${i}, lateral ${metres}`,
      );
      assert(distanceMeters(points[0], vehicle) < 0.1);
    }
});

test("clicking a line 3 marker before and after Taoyuan paints the westbound continuation", async () => {
  const road = map.paths.find((p) => p.id === "shuttle-road-008-routes-2");
  for (const i of [3, 2, 1]) {
    const h = harness({ mockStream: true }),
      page = h.page(),
      { headingDegrees } = h.load("features/utils/shuttle-screen"),
      { distanceMeters } = h.load("utils/shuttle-geo"),
      { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
    const a = road.points[i],
      b = road.points[i - 1],
      vehicle = {
        id: "history-click",
        lineId: "242",
        lineName: "3号线",
        speed: 10,
        direction: headingDegrees(a, b),
        longitude: (a.longitude + b.longitude) / 2,
        latitude: (a.latitude + b.latitude) / 2,
      };
    const end = new ShuttlePlanner(map)
      .directions(map.routes.find((r) => r.id === "242"))[1]
      .points.at(-1);
    page.onLoad();
    page.onShow();
    page.onReady();
    await settle();
    page.receiveSnapshot({
      vehicles: [vehicle],
      fetchedAt: Date.now(),
      serverTime: Date.now(),
      stale: false,
      mapRevision: map.revision,
    });
    const marker = h.calls
      .filter((c) => c[0] === "addMarkers")
      .flatMap((c) => c[1].markers)
      .find((m) => m.id >= 10000);
    assert(marker);
    page.onMarkerTap({ detail: { markerId: marker.id } });
    const preview = page.data.polylines.find(
      (p) =>
        distanceMeters(p.points[0], vehicle) < 1 &&
        distanceMeters(p.points.at(-1), end) < 3,
    );
    assert(preview, `marker segment ${i} did not paint the continuing route`);
    assert(preview.points.some((p) => distanceMeters(p, road.points[0]) < 3));
    page.onMarkerTap({ detail: { markerId: marker.id } });
    assert.equal(page.data.selectedVehicleId, "");
    page.onUnload();
  }
});

test("line 3 previews continue beyond History College without intersecting into a short stub", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo");
  const planner = new ShuttlePlanner(map),
    route = map.routes.find((r) => r.id === "242"),
    college = map.places.find((p) => p.shortName === "历史学院");
  let checked = 0;
  for (const track of planner.directions(route))
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1],
        b = track.points[i];
      if (distanceMeters(a, college) > 130 || distanceMeters(a, b) < 5)
        continue;
      const vehicle = {
        id: "history",
        lineId: route.id,
        longitude: (a.longitude + b.longitude) / 2,
        latitude: (a.latitude + b.latitude) / 2,
        direction: headingDegrees(a, b),
      };
      const points = planner.vehiclePath(vehicle);
      const length = points
        .slice(1)
        .reduce((n, p, i) => n + distanceMeters(points[i], p), 0);
      assert(
        length > 200,
        `History College segment ${i} ends after ${length} metres`,
      );
      assert(distanceMeters(points[0], vehicle) < 0.1);
      for (let j = 2; j < points.length; j++)
        assert(
          distanceMeters(points[j], points[j - 2]) > 0.5,
          "no exact out-and-back stub",
        );
      checked++;
    }
  assert(checked > 3);
});

test("vehicle previews start at the vehicle and follow only the remaining direction", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { bus, point, campus } = onboardFixture(),
    planner = new ShuttlePlanner(campus);
  const forward = planner.vehiclePath(bus(250));
  assert(Math.abs(forward[0].longitude - point(250).longitude) < 1e-9);
  assert(Math.abs(forward.at(-1).longitude - point(900).longitude) < 1e-9);
  assert(forward.every((p) => p.longitude >= point(250).longitude - 1e-9));
  const reverse = planner.vehiclePath({ ...bus(250), direction: 270 });
  assert(Math.abs(reverse.at(-1).longitude - point(0).longitude) < 1e-9);
  assert(reverse.every((p) => p.longitude <= point(250).longitude + 1e-9));
  assert.equal(planner.vehiclePath({ ...bus(250), direction: null }).length, 0);
  assert.equal(planner.vehiclePath(bus(250, "far", "r2", 100)).length, 0);
});

test("a loop vehicle preview ends at this lap's terminal instead of adding completed roads", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { bus, point, campus } = onboardFixture();
  const points = [
    point(0),
    point(300),
    point(300, 300),
    point(0, 300),
    point(0),
  ];
  campus.places = points.slice(0, -1).map((p, i) => ({
    ...p,
    id: `loop${i}`,
    name: `loop${i}`,
    category: "stop",
    routeIds: ["r2"],
  }));
  campus.routes = [
    {
      ...campus.routes[1],
      stopIds: campus.places.map((p) => p.id),
      orderedStops: [0, 1, 2, 3, 0].map((i, order) => ({
        stopId: `loop${i}`,
        order,
      })),
    },
  ];
  campus.paths = [{ ...campus.paths[0], points, routeIds: ["r2"] }];
  const preview = new ShuttlePlanner(campus).vehiclePath(bus(150));
  assert(preview.length > 2);
  assert(Math.abs(preview.at(-1).longitude - point(0).longitude) < 1e-9);
  assert(Math.abs(preview.at(-1).latitude - point(0).latitude) < 1e-9);
  assert(
    !preview
      .slice(1, -1)
      .some(
        (p) =>
          p.latitude === point(0).latitude &&
          p.longitude < point(150).longitude,
      ),
  );
});

test("vehicle list and marker toggle one interruptible preview, restore routes and clear on hide or loss", async () => {
  const { bus, campus } = onboardFixture();
  const h = harness({ mockStream: true, canvas: true, map: campus }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const packet = {
    vehicles: [bus(250), bus(500, "other", "r1")],
    fetchedAt: Date.now(),
    serverTime: Date.now(),
    stale: false,
    mapRevision: campus.revision,
  };
  page.receiveSnapshot(packet);
  const original = JSON.stringify(page.data.polylines);
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  assert.equal(page.data.selectedVehicleId, "bus-2");
  [...h.jobs.values()]
    .filter((j) => j.delay === 0)
    .at(-1)
    .f();
  assert(page.data.routeAnimating);
  const count = h.calls.filter((c) => c[0] === "polylines").length;
  for (const t of [0, 16, 100, 500]) {
    const [id, frame] = [...h.frames].at(-1);
    h.frames.delete(id);
    frame(t);
  }
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, count);
  const stale = [...h.frames.values()].at(-1);
  const marker = h.calls
    .filter((c) => c[0] === "addMarkers")
    .flatMap((c) => c[1].markers)
    .find((m) => m.id >= 10000);
  page.onMarkerTap({ detail: { markerId: marker.id } });
  assert.equal(page.data.selectedVehicleId, "");
  assert.equal(JSON.stringify(page.data.polylines), original);
  stale(5000);
  assert.equal(JSON.stringify(page.data.polylines), original);
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  page.selectVehicle({ currentTarget: { dataset: { id: "other" } } });
  assert.equal(page.data.selectedVehicleId, "other");
  page.receiveSnapshot({ ...packet, vehicles: [bus(250)] });
  assert.equal(page.data.selectedVehicleId, "");
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  page.applySelection();
  assert.equal(page.data.selectedVehicleId, "");
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  page.onHide();
  assert.equal(page.data.selectedVehicleId, "");
  assert.equal(h.frames.size, 0);
  page.onUnload();
});

test("vehicle preview matches delayed marker heading and excludes future history at a corner", () => {
  const clock = { now: 5000 },
    h = harness({ clock });
  const { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion");
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const { bus, point, campus } = onboardFixture();
  const planner = new ShuttlePlanner(campus);
  const motion = new ShuttleMapMotion(h.native, planner, false);
  const first = {
    startsAt: 1000,
    duration: 3000,
    points: [point(250), point(300)],
  };
  const second = {
    startsAt: 4000,
    duration: 3000,
    points: [point(300), point(300, 50)],
  };
  const vehicle = {
    ...bus(300, "bus-2", "r2", 50),
    direction: 0,
    motion: {
      ...second,
      history: [first, second],
      playbackDelay: 3000,
      status: "uncertain",
      heading: 0,
      reset: false,
    },
  };
  motion.update([vehicle], 7000, false, 5000);
  assert.equal(planner.vehiclePath(vehicle).length, 0);
  const playback = motion.previewVehicle("bus-2");
  assert(Math.abs(playback.direction - 90) < 0.1);
  assert.equal(playback.longitude, motion.positions()[0].point.longitude);
  assert(
    playback.motion.history[0].points.every(
      (p) =>
        p.longitude <= playback.longitude && p.latitude === point(0).latitude,
    ),
  );
  const path = planner.vehiclePath(playback);
  assert(path.length > 1);
  assert.equal(path[0].longitude, playback.longitude);
  assert.equal(path.at(-1).longitude, point(900).longitude);
  motion.clear();
});

test("sub-five-metre GPS jitter does not override a usable bus preview heading", () => {
  const h = harness({ clock: { now: 5000 } }),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleMapMotion } = h.load("features/utils/shuttle-map-motion"),
    { bus, point, campus } = onboardFixture();
  const planner = new ShuttlePlanner(campus),
    motion = new ShuttleMapMotion(h.native, planner, false);
  const segment = {
    startsAt: 1000,
    duration: 3000,
    points: [point(250), point(250, 1)],
  };
  motion.update(
    [
      {
        ...bus(250),
        motion: {
          ...segment,
          history: [segment],
          playbackDelay: 3000,
          status: "stationary",
          heading: 90,
          reset: false,
        },
      },
    ],
    5000,
    false,
    5000,
  );
  const vehicle = motion.previewVehicle("bus-2");
  assert.equal(vehicle.direction, 90);
  assert(planner.vehiclePath(vehicle).length > 1);
  motion.clear();
});

test("vehicle preview supports dense roads and shows shared forward geometry of repeated visits", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const { bus, point, campus } = onboardFixture();
  campus.paths[0].points = Array.from({ length: 451 }, (_, i) => point(i * 2));
  let planner = new ShuttlePlanner(campus);
  let path = planner.vehiclePath(bus(250));
  assert(path.length > 2);
  assert.equal(path.at(-1).longitude, point(900).longitude);
  campus.paths[0].points = [point(0), point(900)];
  campus.routes[1].orderedStops = [
    0, 300, 600, 900, 600, 300, 0, 300, 600, 900,
  ].map((x, order) => ({ stopId: `s${x}`, order }));
  planner = new ShuttlePlanner(campus);
  path = planner.vehiclePath(bus(250));
  assert(path.length > 1);
  assert.equal(path.at(-1).longitude, point(900).longitude);
  assert(path.every((p) => p.longitude >= point(250).longitude));
  // Preview matching must never authorize unconfirmed passenger return trips.
  campus.routes[1].orderedStops = [0, 300, 600, 900].map((x, order) => ({
    stopId: `s${x}`,
    order,
  }));
  delete campus.routes[1].servicePattern;
  planner = new ShuttlePlanner(campus);
  assert(planner.vehiclePath({ ...bus(250), direction: 270 }).length > 1);
  assert.equal(
    planner.onboardPlans({ ...bus(250), direction: 270 }, point(0)).length,
    0,
  );
});

test("edge hints use the same preview toggle and a selected unresolved vehicle retries on a fresh packet", async () => {
  const { bus, campus } = onboardFixture();
  const h = harness({ mockStream: true, map: campus }),
    page = h.page();
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const packet = {
    vehicles: [{ ...bus(250), direction: null }],
    fetchedAt: Date.now(),
    serverTime: Date.now(),
    stale: false,
    mapRevision: campus.revision,
  };
  page.receiveSnapshot(packet);
  const base = JSON.stringify(page.data.polylines);
  page.focusVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  assert.equal(page.data.selectedVehicleId, "bus-2");
  assert.equal(JSON.stringify(page.data.polylines), base);
  page.receiveSnapshot({
    ...packet,
    vehicles: [bus(250)],
    fetchedAt: packet.fetchedAt + 3000,
    serverTime: packet.serverTime + 3000,
  });
  assert.equal(page.data.selectedVehicleId, "bus-2");
  assert.notEqual(JSON.stringify(page.data.polylines), base);
  assert(
    page.data.polylines.some(
      (p) => Math.abs(p.points[0].longitude - bus(250).longitude) < 1e-9,
    ),
  );
  page.focusVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  assert.equal(page.data.selectedVehicleId, "");
  assert.equal(JSON.stringify(page.data.polylines), base);
  // Loss also clears a selected vehicle that has not resolved a path yet.
  page.receiveSnapshot({
    ...packet,
    vehicles: [{ ...bus(250, "unknown"), direction: null }],
    fetchedAt: packet.fetchedAt + 4000,
  });
  page.selectVehicle({ currentTarget: { dataset: { id: "unknown" } } });
  page.receiveSnapshot({ ...packet, vehicles: [] });
  assert.equal(page.data.selectedVehicleId, "");
  page.onUnload();
});

test("confirmed return services group lines 3/4/6/7 and match Economics express reverse departures", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    planner = new ShuttlePlanner(map);
  const origins = map.places.filter((p) => /^橘园 ·/.test(p.name));
  const destinations = map.places.filter((p) => /^大礼堂 ·/.test(p.name));
  const trips = new ShuttleItineraryPlanner(map, planner).plans(
    origins[0],
    destinations[0],
    origins.map((p) => p.id),
    destinations.map((p) => p.id),
    true,
  );
  assert(
    trips.some(
      (p) =>
        p.legs.length === 1 &&
        ["242", "243", "77", "78"].every((id) =>
          p.legs[0].routes.some((r) => r.id === id),
        ),
    ),
  );
  const route = map.routes.find((r) => r.id === "293");
  const track = planner.directions(route)[1];
  const board = track.stops[0].place,
    destination = track.stops.at(-1).place;
  const plan = planner.plans(board, destination, [board.id], route.id, [
    destination.id,
  ])[0];
  assert(plan && plan.board.serviceDirection === 1);
  const i = track.offsets.findIndex((v) => v > 3);
  const heading = headingDegrees(track.points[i - 1], track.points[i]);
  const vehicle = {
    ...board,
    id: "express",
    lineId: route.id,
    speed: 0,
    direction: heading,
    motion: { status: "stationary", heading },
  };
  assert.equal(planner.arrival(vehicle, plan.board, false).preparing, true);
  vehicle.direction = vehicle.motion.heading = (heading + 180) % 360;
  assert.notEqual(planner.arrival(vehicle, plan.board, false).preparing, true);
});

test("line 5 supports both terminals and all user-confirmed campus services are bidirectional", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    planner = new ShuttlePlanner(map);
  const route = map.routes.find((r) => r.id === "244");
  const stops = route.orderedStops.map((s) =>
    map.places.find((p) => p.id === s.stopId),
  );
  for (const [board, alight, direction] of [
    [stops[0], stops.at(-1), 0],
    [stops.at(-1), stops[0], 1],
  ]) {
    const plan = planner.plans(board, alight, [board.id], route.id, [
      alight.id,
    ])[0];
    assert(plan && plan.board.serviceDirection === direction);
    assert(plan.rideMeters > 2000);
  }
  for (const route of map.routes) {
    const tracks = planner.directions(route);
    assert.equal(
      tracks.length,
      2 * (1 + (route.requestVariants?.length || 0)),
      route.name,
    );
    const board = tracks[1].stops[0].place;
    const destination = tracks[1].stops.find(
      (s) => s.at > 700 && s.place.id !== board.id,
    ).place;
    assert(
      planner
        .plans(board, destination, [board.id], route.id, [destination.id])
        .some((p) => p.board.serviceDirection === 1 && p.points.length > 1),
      route.name,
    );
  }
});

test("line 8 previews continue past Geosciences to Music College on existing roads", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    planner = new ShuttlePlanner(map);
  const route = map.routes.find((r) => r.id === "79");
  const track = planner.directions(route)[0];
  const music = map.places.find((p) => p.id === "shuttle-stop-829446d6ac10");
  const geo = map.places.find((p) => p.id === "shuttle-stop-89407d0d31e9");
  const psychology = map.places.find(
    (p) => p.id === "shuttle-stop-5e32474b6263",
  );
  const start = track.stops.find((s) => s.place.id === psychology.id).at;
  const geoAt = track.stops.find((s) => s.place.id === geo.id).at;
  for (const at of [start + 70, geoAt + 80]) {
    const i = track.offsets.findIndex((v) => v > at);
    assert(i > 0);
    const a = track.points[i - 1],
      b = track.points[i];
    const vehicle = {
      id: "line8-preview",
      lineId: route.id,
      speed: 10,
      longitude: (a.longitude + b.longitude) / 2,
      latitude: (a.latitude + b.latitude) / 2,
      direction: headingDegrees(a, b),
    };
    const points = planner.vehiclePath(vehicle);
    assert(
      points.some((p) => distanceMeters(p, music) < 3),
      "preview must reach Music College",
    );
    for (const p of points)
      assert(
        planner.graph(route.id).nearest(p).distance < 13,
        "preview remains on line 8 roads",
      );
  }
});

test("campus vehicle previews remain visible across directed track samples with matching history", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    planner = new ShuttlePlanner(map);
  for (const route of map.routes) {
    const tracks = planner.directions(route);
    for (const track of tracks) {
      const step = Math.max(1, Math.floor(track.points.length / 35));
      for (let i = 1; i < track.points.length - 1; i += step) {
        if (track.offsets[i] - track.offsets[i - 1] < 0.15) continue;
        const a = track.points[i - 1],
          b = track.points[i];
        const vehicle = {
          id: "sample",
          lineId: route.id,
          longitude: (a.longitude + b.longitude) / 2,
          latitude: (a.latitude + b.latitude) / 2,
          direction: headingDegrees(a, b),
        };
        vehicle.motion = {
          heading: vehicle.direction,
          status: "moving",
          history: [{ points: [...track.points.slice(0, i), vehicle] }],
        };
        const points = planner.vehiclePath(vehicle);
        // At an overlapping terminal, do not invent another lap without evidence.
        if (tracks.some((t) => distanceMeters(vehicle, t.points.at(-1)) < 5))
          continue;
        assert(
          points.length > 1,
          `${route.name} segment ${i} lost its preview`,
        );
        assert.equal(points[0].longitude, vehicle.longitude);
        assert.equal(points[0].latitude, vehicle.latitude);
      }
    }
  }
});

test("boarding vehicle rows prioritize waiting then historical ETA, hide passed buses and keep distance labels", async () => {
  const { campus, point, bus } = onboardFixture();
  campus.routes = [campus.routes[1]];
  const h = harness({ map: campus, mockStream: true });
  Object.assign(h.raw, point(300, 50));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900, 80), name: "终点" });
  page.confirmMapPick();
  await settle();
  const ride = page.data.plans.find((p) => p.mode === "ride");
  assert(ride);
  page.choosePlan({ currentTarget: { dataset: { id: ride.id } } });
  const board = page.liveSelection().boardingVisits[0];
  assert(board);
  const vehicle = (id, x, status, seconds) => ({
    ...bus(x, id),
    speed: status === "waiting" ? 0 : 10,
    arrivals: [
      {
        board,
        status,
        seconds,
        distance: 300 - x,
        source: seconds > 0 ? "history" : "position",
        text:
          status === "waiting"
            ? "等候中"
            : status === "unconfirmed"
              ? "待确认"
              : `约 ${seconds / 60} 分钟`,
        detail: "",
      },
    ],
  });
  const vehicles = [
    vehicle("passed", 500, "passed", null),
    vehicle("near", 200, "approaching", 240),
    vehicle("unknown", 300, "unconfirmed", null),
    vehicle("far", 100, "approaching", 60),
    vehicle("waiting", 300, "waiting", null),
  ];
  const packet = {
    vehicles,
    fetchedAt: Date.now(),
    serverTime: Date.now(),
    stale: false,
    mapRevision: campus.revision,
    selection: page.liveSelection(),
  };
  page.setData({ connection: "live" });
  page.receiveSnapshot(packet);
  assert.deepEqual(
    Array.from(page.data.vehicleRows, (r) => r.id),
    ["waiting", "far", "near"],
  );
  assert.equal(page.data.vehicleRows[0].eta, "等候中");
  assert.equal(
    page.data.plans.find((p) => p.id === ride.id).walkLabel,
    "下一辆：等候中",
  );
  assert.equal(page.data.vehicleRows[1].eta, "约 1 分钟");
  assert(page.data.vehicleRows.every((r) => /^距你 /.test(r.distanceLabel)));
  const prototype = h.load("features/utils/shuttle-routing").ShuttlePlanner
    .prototype;
  const arrival = prototype.arrival;
  try {
    prototype.arrival = () => {
      throw Error("unnecessary UI-thread pattern projection");
    };
    page.refreshRows();
  } finally {
    prototype.arrival = arrival;
  }
  // A delayed old-selection estimate must not be reused for a different platform.
  page.receiveSnapshot({
    ...packet,
    vehicles: [
      {
        ...bus(100, "wrong"),
        arrivals: [
          { ...vehicles[3].arrivals[0], board: { ...board, stopId: "s900" } },
        ],
      },
    ],
  });
  assert.equal(page.data.vehicleRows[0].eta, "正在驶来");
  page.receiveSnapshot({ ...packet, stale: true });
  assert.equal(page.data.vehicleRows.length, 0);
  page.onUnload();
});

test("late walking results preserve the itinerary trace and vehicle taps only focus while comparing routes", async () => {
  for (const preview of [false]) {
    const { campus, point, bus } = onboardFixture();
    campus.routes = [campus.routes[1]];
    const pending = [],
      clock = { now: Date.now() },
      h = harness({
        map: campus,
        mockStream: true,
        canvas: true,
        clock,
        plans: (o) =>
          new Promise((resolve, reject) =>
            pending.push({ o, resolve, reject }),
          ),
      });
    Object.assign(h.raw, point(300, 50));
    const page = h.page();
    page.onLoad();
    page.onReady();
    page.onShow();
    await settle();
    page.showMapPick({ ...point(900, 80), name: "终点" });
    page.confirmMapPick();
    await settle();
    pending.at(-1).reject(new Error("request:fail timeout"));
    await settle();
    clock.now += 21001;
    page.rebuildPlans(false);
    await settle();
    const choice = page.data.plans.find((p) => p.mode === "ride");
    assert(choice);
    page.choosePlan({ currentTarget: { dataset: { id: choice.id } } });
    page.receiveSnapshot({
      vehicles: [bus(200)],
      fetchedAt: Date.now(),
      serverTime: Date.now(),
      stale: false,
      mapRevision: campus.revision,
    });
    const beforeTap = JSON.stringify(page.data.polylines);
    page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
    assert.equal(page.data.selectedVehicleId, "");
    assert.equal(JSON.stringify(page.data.polylines), beforeTap);
    assert.equal(page.data.longitude, bus(200).longitude);
    const marker = h.calls
      .filter((c) => c[0] === "addMarkers")
      .flatMap((c) => c[1].markers)
      .find((m) => m.id >= 10000);
    page.onMarkerTap({ detail: { markerId: marker.id } });
    assert.equal(page.data.selectedVehicleId, "");
    assert.equal(JSON.stringify(page.data.polylines), beforeTap);
    [...h.jobs.values()]
      .filter((j) => j.delay === (preview ? 0 : 420))
      .at(-1)
      .f();
    const tick = (t) => {
      const [id, fn] = [...h.frames].at(-1);
      h.frames.delete(id);
      fn(t);
    };
    tick(0);
    tick(550);
    const writes = h.calls.filter((c) => c[0] === "polylines").length;
    const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
      { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
    const request = pending.at(-1).o.data;
    const plan = new ShuttleItineraryPlanner(campus, new ShuttlePlanner(campus))
      .plans(request.origin, request.destination)
      .find((p) => p.id === choice.id);
    assert(plan);
    pending.at(-1).resolve({
      revision: campus.revision,
      planningId: "late-walk",
      plans: [
        {
          ...plan,
          walkLegs: [
            {
              points: [request.origin, plan.board],
              source: "tencent",
              meters: 50,
              seconds: 40,
            },
            {
              points: [plan.alight, request.destination],
              source: "tencent",
              meters: 80,
              seconds: 70,
            },
          ],
        },
      ],
    });
    await settle();
    assert.equal(page.data.selectedVehicleId, preview ? "bus-2" : "");
    assert.equal(h.calls.filter((c) => c[0] === "polylines").length, writes);
    const before = h.calls
      .filter((c) => c[0] === "trace" && !c[1].dash.length)
      .at(-1)[1]
      .path.at(-1)[0];
    tick(700);
    tick(1100);
    const after = h.calls
      .filter((c) => c[0] === "trace" && !c[1].dash.length)
      .at(-1)[1]
      .path.at(-1)[0];
    assert(
      after > before,
      "the vehicle trace must continue instead of restarting",
    );
    assert(h.calls.some((c) => c[0] === "trace" && c[1].dash.length));
    tick(2600);
    assert(
      page.data.polylines.some(
        (p) =>
          !p.dottedLine &&
          Math.abs(
            p.points[0].longitude -
              (preview ? bus(200).longitude : plan.points[0].longitude),
          ) < 1e-9,
      ),
    );
    assert(page.data.polylines.some((p) => p.dottedLine));
    if (preview)
      page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
    assert.equal(page.data.selectedVehicleId, "");
    page.onUnload();
  }
});

test("destination planning waits for the server and prioritizes returned favorites without a score cutoff", async () => {
  const { campus, point, bus } = onboardFixture();
  campus.routes = [campus.routes[1]];
  const pending = [],
    h = harness({
      map: campus,
      mockStream: true,
      plans: (o) => new Promise((resolve) => pending.push({ o, resolve })),
    });
  Object.assign(h.raw, point(300, 50));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.receiveSnapshot({
    vehicles: [bus(200)],
    fetchedAt: Date.now(),
    serverTime: Date.now(),
    stale: false,
    mapRevision: campus.revision,
  });
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  assert.equal(page.data.selectedVehicleId, "bus-2");
  page.showMapPick({ ...point(900, 80), name: "终点" });
  page.confirmMapPick();
  await settle();
  assert.equal(page.data.planning, true);
  assert.equal(page.data.selectedVehicleId, "");
  assert.equal(page.data.plans.length, 0);
  assert.equal(page.data.polylines.length, 0);
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { togglePreferredPlan } = h.load("features/utils/shuttle-preferences");
  const request = pending.at(-1).o.data;
  const plans = new ShuttleItineraryPlanner(
    campus,
    new ShuttlePlanner(campus),
  ).plans(request.origin, request.destination);
  const ride = plans.find((p) => p.mode === "ride"),
    walk = plans.find((p) => p.mode === "walk");
  assert(ride && walk);
  togglePreferredPlan("42", ride, request.origin, request.destination);
  pending.at(-1).resolve({
    revision: campus.revision,
    planningId: "server-first",
    plans: [
      { ...walk, score: 1 },
      { ...ride, score: 10000, availability: "unavailable" },
    ],
  });
  await settle();
  assert.equal(page.data.planning, false);
  assert.equal(page.data.plans[0].id, ride.id);
  assert.equal(page.data.selectedPlanId, ride.id);
  assert(page.data.plans[0].favorite);
  assert(![...h.jobs.values()].some((j) => j.delay === 8000));
  page.onUnload();
});

test("confirmed destination switches clear the old route and automatically draw server or cached plans", async () => {
  const { campus, point } = onboardFixture();
  const destinations = ["甲馆", "乙馆", "丙馆", "丁馆", "戊馆"].map(
    (name, i) => ({
      ...point(700 + i * 70, 80 + i * 20),
      id: `destination-${i}`,
      name,
      shortName: name,
      category: "building",
      routeIds: [],
    }),
  );
  campus.places.push(...destinations);
  const clock = { now: 100000 },
    pending = [],
    storage = new Map();
  const h = harness({
    map: campus,
    clock,
    mockStream: true,
    storage,
    plans: (o) =>
      new Promise((resolve) => pending.push({ request: o.data, resolve })),
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { commonPlace } = h.load("features/utils/shuttle-common-places"),
    planner = new ShuttleItineraryPlanner(campus, new ShuttlePlanner(campus));
  const finish = async (entry) => {
    const { request, resolve } = entry;
    const walk = planner
      .plans(request.origin, request.destination)
      .find((p) => p.mode === "walk");
    assert(walk);
    resolve({
      revision: campus.revision,
      planningId: `server-${request.destination.longitude}`,
      plans: [
        {
          ...walk,
          id: `walk-${request.destination.longitude}`,
          walkLegs: [
            {
              points: [request.origin, request.destination],
              source: "tencent",
              meters: 900,
              seconds: 700,
            },
          ],
        },
      ],
    });
    await settle();
  };
  const waiting = () => {
    assert.equal(page.data.planning, true);
    assert.equal(page.data.polylines.length, 0);
    assert.equal(page.data.plans.length, 0);
    assert.equal(page.data.selectedPlanId, "");
  };
  const drawn = (destination) => {
    assert.equal(page.data.planning, false);
    assert.equal(page.data.selectedPlanId, `walk-${destination.longitude}`);
    assert(
      page.data.polylines.some((line) => {
        const last = line.points.at(-1);
        return (
          Math.abs(last.longitude - destination.longitude) < 1e-8 &&
          Math.abs(last.latitude - destination.latitude) < 1e-8
        );
      }),
      "the new destination must be drawn without tapping the plan list",
    );
  };
  const search = (place) => {
    page.openDestinationSearch();
    page.choosePlace({ currentTarget: { dataset: { id: place.id } } });
  };
  for (let i = 0; i < destinations.length; i++) {
    clock.now += 21000;
    const dest = destinations[i];
    if (i < 2) search(dest);
    else if (i < 4) {
      const saved = commonPlace(dest, i === 2 ? dest.id : undefined);
      page.setData({ commonPlaces: [saved] });
      page.selectCommonPlace({
        currentTarget: { dataset: { key: saved.key } },
      });
    } else {
      const before = JSON.stringify(page.data.polylines);
      page.showMapPick({ ...dest, name: dest.name });
      assert.equal(
        JSON.stringify(page.data.polylines),
        before,
        "an unconfirmed draft keeps the current route",
      );
      page.confirmMapPick();
    }
    await settle();
    waiting();
    await finish(pending.at(-1));
    drawn(dest);
  }
  clock.now += 21000;
  const count = pending.length;
  search(destinations[0]);
  await settle();
  assert.equal(
    pending.length,
    count,
    "returning to a cached destination needs no new planning request",
  );
  drawn(destinations[0]);
  // Rapid changes must reject the previous destination's late response.
  storage.delete("easy-swu:shuttle:plans:v6:42");
  clock.now += 21000;
  search(destinations[1]);
  await settle();
  const stale = pending.at(-1);
  clock.now += 21000;
  search(destinations[2]);
  await settle();
  waiting();
  await finish(stale);
  waiting();
  clock.now += 1001;
  for (const [id, job] of [...h.jobs])
    if (job.delay === 1000) {
      h.jobs.delete(id);
      job.f();
    }
  await settle();
  await finish(pending.at(-1));
  drawn(destinations[2]);
  // An elapsed UI deadline must not release a still-running server request.
  clock.now += 21000;
  search(destinations[3]);
  await settle();
  waiting();
  assert(![...h.jobs.values()].some((j) => j.delay === 8000));
  clock.now += 8000;
  await settle();
  waiting();
  await finish(pending.at(-1));
  assert.equal(page.data.planning, false);
  assert(page.data.selectedPlanId);
  assert(
    page.data.polylines
      .filter((line) => line.dottedLine)
      .every((line) => !line.arrowLine),
  );
  page.onUnload();
});

test("planning indicator is a circular rotating ring with reduced-motion support", () => {
  const wxml = fs.readFileSync(
      path.join(root, "features/pages/shuttle/index.wxml"),
      "utf8",
    ),
    css = fs.readFileSync(
      path.join(root, "features/pages/shuttle/index.wxss"),
      "utf8",
    );
  assert(wxml.includes('wx:if="{{planning}}" class="planning-spinner"'));
  assert.match(css, /\.planning-spinner\s*\{[^}]*border-radius:\s*50%/);
  assert.match(
    css,
    /\.planning-spinner\s*\{[^}]*animation:[^;]*linear[^;]*infinite/,
  );
  assert.match(css, /@keyframes planning-spin/);
  assert.match(
    css,
    /\.motion-reduced \.planning-spinner\s*\{[^}]*animation:\s*none/,
  );
});

test("moving GPS keeps plans anchored while explicit replanning clears the previous route", async () => {
  const { campus, point } = onboardFixture(),
    clock = { now: 100000 },
    pending = [];
  const h = harness({
    map: campus,
    clock,
    mockStream: true,
    plans: (o) =>
      new Promise((resolve) => pending.push({ request: o.data, resolve })),
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "终点" });
  page.confirmMapPick();
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    planner = new ShuttleItineraryPlanner(campus, new ShuttlePlanner(campus));
  const finish = async (index) => {
    const { request, resolve } = pending[index];
    resolve({
      revision: campus.revision,
      planningId: `anchor-${index}`,
      plans: planner.plans(request.origin, request.destination),
    });
    await settle();
    page.paintRoutes(true);
  };
  for (let i = 1; i <= 6; i++) {
    clock.now += 1000;
    h.getListener()({ ...h.raw, ...point(i * 20) });
    page.rebuildPlans(false);
    await settle();
  }
  assert.equal(pending.length, 1);
  await finish(0);
  const selected = page.data.selectedPlanId,
    geometry = JSON.stringify(page.data.polylines);
  assert(selected);
  for (let i = 7; i <= 12; i++) {
    clock.now += 1000;
    h.getListener()({ ...h.raw, ...point(i * 20) });
    page.rebuildPlans(false);
    await settle();
    assert.equal(page.data.planning, false);
    assert.equal(page.data.selectedPlanId, selected);
    assert.equal(JSON.stringify(page.data.polylines), geometry);
  }
  assert.equal(pending.length, 1);
  campus.revision = "auto-map-update";
  await page.reloadMap(false);
  await settle();
  assert.equal(pending.length, 2);
  assert.equal(page.data.planning, false);
  assert.equal(page.data.selectedPlanId, selected);
  assert.equal(JSON.stringify(page.data.polylines), geometry);
  await finish(1);
  clock.now += 6000;
  h.getListener()({ ...h.raw, ...point(280) });
  page.refreshShuttles();
  await settle();
  assert.equal(pending.length, 3);
  assert.equal(page.data.planning, true);
  assert.equal(page.data.selectedPlanId, "");
  assert.equal(page.data.polylines.length, 0);
  assert.equal(page.data.plans.length, 0);
  assert.equal(pending[2].request.origin.longitude, point(280).longitude);
  await finish(2);
  assert.equal(page.data.planning, false);
  assert.notEqual(JSON.stringify(page.data.polylines), geometry);
  page.onUnload();
});

test("changing to a custom origin clears old geometry and ignores the previous planning response", async () => {
  for (const resolved of [false, true]) {
    const { campus, point } = onboardFixture(),
      clock = { now: 100000 },
      pending = [];
    const h = harness({
      map: campus,
      clock,
      mockStream: true,
      plans: (o) =>
        new Promise((resolve) => pending.push({ request: o.data, resolve })),
    });
    Object.assign(h.raw, point(0));
    const page = h.page();
    page.onLoad();
    page.onReady();
    page.onShow();
    await settle();
    page.showMapPick({ ...point(900), name: "目的地" });
    page.confirmMapPick();
    await settle();
    const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
      { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
      planner = new ShuttleItineraryPlanner(campus, new ShuttlePlanner(campus));
    const finish = async (index) => {
      const { request, resolve } = pending[index];
      resolve({
        revision: campus.revision,
        planningId: `origin-${index}`,
        plans: planner.plans(request.origin, request.destination),
      });
      await settle();
    };
    if (resolved) {
      await finish(0);
      page.paintRoutes(true);
    }
    clock.now += 6000;
    let native;
    h.wx.chooseLocation = (o) => {
      native = o;
    };
    page.openSearch("board");
    page.chooseOnMap();
    native.success({ ...point(400, 50), name: "自定义起点" });
    await settle();
    assert.equal(page.data.polylines.length, 0);
    assert.equal(page.data.plans.length, 0);
    assert.equal(page.data.selectedPlanId, "");
    assert.equal(page.data.originName, "自定义起点");
    if (!resolved) {
      await finish(0);
      assert.equal(page.data.polylines.length, 0);
      clock.now += 1001;
      for (const [id, job] of [...h.jobs])
        if (job.delay === 1000) {
          h.jobs.delete(id);
          job.f();
        }
      await settle();
    }
    assert.equal(pending.length, 2);
    assert.equal(pending[1].request.originMode, "manual");
    assert.equal(pending[1].request.origin.longitude, point(400, 50).longitude);
    page.paintRoutes(true);
    assert.equal(
      page.data.polylines.length,
      0,
      "no previous route or temporary GPS-to-manual bridge",
    );
    await finish(1);
    page.paintRoutes(true);
    assert(page.data.selectedPlanId);
    const firstWalk = page.data.polylines.find((p) => p.dottedLine);
    assert(firstWalk);
    assert.equal(firstWalk.points[0].longitude, point(400, 50).longitude);
    assert.equal(firstWalk.points[0].latitude, point(400, 50).latitude);
    assert(
      !page.data.polylines.some((p) =>
        p.points.some((q) => q.longitude === point(0).longitude),
      ),
    );
    page.onUnload();
  }
});

test("a real request failure preserves an explicit offline choice when a subsequent alternative arrives", async () => {
  const { campus, point } = onboardFixture();
  const pending = [],
    clock = { now: Date.now() },
    h = harness({
      map: campus,
      mockStream: true,
      clock,
      plans: (o) =>
        new Promise((resolve, reject) => pending.push({ o, resolve, reject })),
    });
  Object.assign(h.raw, point(300, 50));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900, 80), name: "终点" });
  page.confirmMapPick();
  await settle();
  assert.equal(page.data.plans.length, 0);
  pending.at(-1).reject(new Error("request:fail timeout"));
  await settle();
  assert.equal(page.data.planning, false);
  const selected = page.data.selectedPlanId;
  assert(selected);
  page.choosePlan({ currentTarget: { dataset: { id: selected } } });
  const before = JSON.stringify(page.data.polylines);
  clock.now += 21001;
  page.rebuildPlans(false);
  await settle();
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const request = pending.at(-1).o.data;
  const plans = new ShuttleItineraryPlanner(
    campus,
    new ShuttlePlanner(campus),
  ).plans(request.origin, request.destination);
  pending.at(-1).resolve({
    revision: campus.revision,
    planningId: "late-alternative",
    plans: plans.filter((p) => p.id !== selected),
  });
  await settle();
  assert.equal(page.data.selectedPlanId, selected);
  assert.equal(JSON.stringify(page.data.polylines), before);
  page.onUnload();
});

test("a slow initial request stays in planning without a provisional straight walk and paints the server ride once", async () => {
  const { campus, point } = onboardFixture();
  campus.planningMode = "adaptive";
  const pending = [],
    clock = { now: Date.now() },
    h = harness({
      map: campus,
      mockStream: true,
      clock,
      plans: (o) => new Promise((resolve) => pending.push({ o, resolve })),
    });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "终点" });
  page.confirmMapPick();
  await settle();
  assert(![...h.jobs.values()].some((j) => j.delay === 8000));
  clock.now += 15000;
  page.rebuildPlans(false);
  await settle();
  assert(page.data.planning);
  assert.equal(page.data.selectedPlanId, "");
  assert.equal(page.data.polylines.length, 0);
  assert.equal(pending.length, 1);
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const legacy = { ...campus, planningMode: undefined },
    request = pending[0].o.data;
  const ride = new ShuttleItineraryPlanner(legacy, new ShuttlePlanner(legacy))
    .plans(request.origin, request.destination)
    .find((p) => p.mode === "ride");
  assert(ride);
  pending[0].resolve({
    revision: campus.revision,
    planningId: "late-valid-ride",
    plans: [ride],
  });
  await settle();
  assert.equal(page.data.selectedPlanId, ride.id);
  assert.equal(page.data.walking, false);
  assert(page.data.polylines.some((p) => !p.dottedLine && p.arrowLine));
  page.onUnload();
});

test("directional destination markers use the served platform and map markers retain both actual sides", async () => {
  const { campus, point } = onboardFixture();
  const correct = campus.places.at(-1);
  correct.name = "田家炳·东北行";
  correct.platformHeading = 90;
  const opposite = {
    ...correct,
    ...point(900, 20),
    id: "opposite",
    name: "田家炳·西南行",
    platformHeading: 270,
  };
  campus.places.push(opposite);
  const h = harness({
    map: campus,
    mockStream: true,
    plans: async (o) => {
      const { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
      const leg = new ShuttlePlanner(campus).plans(
        o.data.origin,
        correct,
        [],
        "r1",
        [correct.id],
      )[0];
      assert(leg);
      return {
        revision: campus.revision,
        planningId: "platform",
        plans: [
          {
            ...leg,
            mode: "ride",
            legs: [{ ...leg, routes: [leg.route] }],
            score: 0,
            destinationPoint: {
              longitude: correct.longitude,
              latitude: correct.latitude,
            },
          },
        ],
      };
    },
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.openDestinationSearch();
  page.choosePlace({ currentTarget: { dataset: { id: opposite.id } } });
  await settle();
  const marker = h.calls
    .filter((c) => c[0] === "addMarkers")
    .flatMap((c) => c[1].markers)
    .filter((m) => m.id === 2)
    .at(-1);
  assert(marker);
  assert.equal(marker.longitude, correct.longitude);
  assert.equal(marker.latitude, correct.latitude);
  const physical = h.calls
    .filter((c) => c[0] === "addMarkers")
    .flatMap((c) => c[1].markers)
    .filter((m) => m.id >= 100 && m.id < 10000);
  for (const p of [correct, opposite])
    assert(
      physical.some(
        (m) => m.longitude === p.longitude && m.latitude === p.latitude,
      ),
    );
  page.onUnload();
});

test("new destinations are paced at one second with a twenty-per-minute ceiling and unchanged failure backoff", async () => {
  const clock = { now: 100000 },
    h = harness({ clock, api: async () => ({ ok: true }) }),
    { shuttleRequest } = h.load("services/shuttle-request");
  for (let i = 0; i < 20; i++) {
    await shuttleRequest("/shuttle/plans", { data: { destination: i } });
    clock.now += 1000;
  }
  await assert.rejects(
    shuttleRequest("/shuttle/plans", { data: { destination: 20 } }),
    (e) => e.code === "SHUTTLE_REFRESH_DEFERRED" && e.retryAfterMs === 40000,
  );
  assert.equal(h.calls.filter((c) => c[0] === "request").length, 20);
  clock.now += 40000;
  await shuttleRequest("/shuttle/plans", { data: { destination: 21 } });
  assert.equal(h.calls.filter((c) => c[0] === "request").length, 21);
});

test("default map keeps exactly the latest nearest ten markers without retaining older snapshot vehicles", async () => {
  const { campus, point, bus } = onboardFixture();
  const h = harness({ map: campus, mockStream: true });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  const active = new Set();
  let cursor = h.calls.length;
  const collect = () => {
    for (const [name, payload] of h.calls.slice(cursor)) {
      if (name === "addMarkers")
        for (const m of payload.markers) if (m.id >= 10000) active.add(m.id);
      if (name === "removeMarkers")
        for (const id of payload.markerIds) active.delete(id);
    }
    cursor = h.calls.length;
  };
  for (let tick = 0; tick < 4; tick++) {
    const vehicles = Array.from({ length: 15 }, (_, i) =>
      bus((15 - i) * 10, `${tick}-${15 - i}`),
    );
    page.receiveSnapshot({
      vehicles,
      fetchedAt: Date.now() + tick * 3000,
      serverTime: Date.now() + tick * 3000,
      stale: false,
      mapRevision: campus.revision,
    });
    collect();
    assert.equal(active.size, 10);
    assert.equal(page.data.vehicles.length, 10);
    assert.deepEqual(
      Array.from(page.data.vehicles, (v) => v.id),
      Array.from({ length: 10 }, (_, i) => `${tick}-${i + 1}`),
    );
  }
  page.onUnload();
});

test("boarding only changes the nearby-bus radius to 20m and keeps the original speed-only fallback", () => {
  const h = harness();
  for (const offset of [19, 21]) {
    const { point, progress } = progressFixture(h, { atBoard: true });
    let time = 1000;
    for (const x of [100, 130, 140, 150, 160]) {
      progress.update(point(x), time, [
        { ...point(x + offset), id: "bus", lineId: "r", speed: 10 },
      ]);
      time += 5000;
    }
    assert.equal(progress.view(295).phase, offset < 20 ? "riding" : "waiting");
  }
  const { point, progress } = progressFixture(h, { atBoard: true });
  for (let i = 0; i < 5; i++)
    progress.update(point(100 + i * 30), 1000 + i * 5000);
  assert.equal(progress.view(295).phase, "riding");
});

test("frequent fixes accumulate boarding movement and GPS evidence survives intermittent vehicle proximity", () => {
  for (const speed of [2, 4]) {
    const h = harness(),
      { point, progress } = progressFixture(h, { atBoard: true });
    for (let i = 0; i <= 40; i++) {
      const x = 100 + i * speed;
      const vehicles =
        speed === 2 || i % 6 < 3
          ? [{ ...point(x), id: "bus", lineId: "r", speed: 10, direction: 90 }]
          : [];
      progress.update(point(x), 1000 + i * 1000, vehicles);
    }
    const view = progress.view(295);
    assert.equal(view.phase, "riding");
    assert(Math.abs(view.segments[0].fill - (40 * speed) / 200 / 2) < 0.002);
  }
});

test("confirmed boarding advances a missed walking endpoint but rejects opposite or unrelated rides", () => {
  const h = harness(),
    { point, progress } = progressFixture(h);
  const vehicle = { ...point(250), id: "bus", lineId: "r", direction: 90 };
  assert.equal(progress.confirmOnboard({ ...vehicle, direction: 270 }), false);
  assert.equal(progress.confirmOnboard({ ...vehicle, lineId: "other" }), false);
  assert.equal(progress.view(295).phase, "walking");
  assert.equal(progress.confirmOnboard(vehicle), true);
  const view = progress.view(295);
  assert.equal(view.phase, "riding");
  assert.equal(view.segments[0].fill, 1);
  assert(Math.abs(view.segments[1].fill - 0.375) < 0.002);
  progress.update(point(250), 100000);
  progress.update(point(260), 101000);
  assert(progress.view(295).segments[1].fill > view.segments[1].fill);
});

test("boarding co-motion aligns delayed observations without enlarging the 20m radius", () => {
  const h = harness(),
    { ShuttleOnboardDetector } = h.load("features/utils/shuttle-onboard"),
    { point, bus } = onboardFixture();
  for (const offset of [0, 21]) {
    const detector = new ShuttleOnboardDetector();
    let match;
    for (let i = 0; i <= 30; i++) {
      const time = 100000 + i * 1000;
      const observedAt = 100000 + Math.floor(i / 3) * 3000 - 3000;
      const vehicle = {
        ...bus(((observedAt - 100000) / 1000) * 9 + offset),
        motion: { status: "moving", reset: false, playbackDelay: 3000 },
      };
      match =
        detector.update(
          point(i * 9),
          time,
          observedAt,
          [vehicle],
          observedAt,
        ) || match;
    }
    assert.equal(!!match, offset < 20);
    if (match)
      assert(Math.abs(match.longitude - point(270).longitude) < 0.000001);
  }
});

test("delayed boarding evidence never returns a bad current GPS fix", () => {
  const h = harness(),
    { ShuttleOnboardDetector } = h.load("features/utils/shuttle-onboard"),
    { point, bus } = onboardFixture();
  for (const invalid of [{ ...point(180), accuracy: 80 }, point(900)]) {
    const detector = new ShuttleOnboardDetector();
    for (let i = 0; i < 6; i++)
      detector.update(
        point(i * 27),
        100000 + i * 3000,
        97000 + i * 3000,
        [bus((i - 1) * 27)],
        97000 + i * 3000,
      );
    assert.equal(
      detector.update(invalid, 118000, 115000, [bus(135)], 115000),
      undefined,
    );
  }
});

test("automatic line switching uses a 20m radius and preserves directional co-motion", () => {
  const h = harness(),
    { ShuttleOnboardDetector } = h.load("features/utils/shuttle-onboard"),
    { point, bus } = onboardFixture();
  for (const offset of [19, 21]) {
    const detector = new ShuttleOnboardDetector();
    let match;
    for (let i = 0; i <= 5; i++)
      match = detector.update(point(i * 18), 1000 + i * 3000, 1000 + i * 3000, [
        bus(i * 18 + offset),
      ]);
    assert.equal(!!match, offset < 20);
  }
  const detector = new ShuttleOnboardDetector();
  for (let i = 0; i < 8; i++)
    assert.equal(
      detector.update(point(i * 10), 1000 + i * 3000, 1000 + i * 3000, [
        bus(20 - i * 10),
      ]),
      undefined,
    );
});

test("onboard detection requires sustained fresh unambiguous co-motion and has a switch cooldown", () => {
  const h = harness(),
    { ShuttleOnboardDetector } = h.load("features/utils/shuttle-onboard"),
    { point, bus } = onboardFixture(),
    detector = new ShuttleOnboardDetector();
  let match;
  for (let i = 0; i <= 5; i++) {
    match = detector.update(point(i * 18), 1000 + i * 3000, 1000 + i * 3000, [
      bus(i * 18),
    ]);
    if (i < 5) assert.equal(match, undefined);
  }
  assert.equal(match.lineId, "r2");
  assert.equal(match.direction, 90);
  detector.switched(16000);
  for (let i = 0; i < 6; i++)
    assert.equal(
      detector.update(point(100 + i * 18), 19000 + i * 3000, 19000 + i * 3000, [
        bus(100 + i * 18, "other", "r1"),
      ]),
      undefined,
    );
  detector.pause();
  assert.equal(
    detector.update(point(400), 60000, 60000, [bus(400)]),
    undefined,
  );
});

test("passing buses, walking, parallel buses, jumps and repeated observations cannot switch a journey", () => {
  const h = harness(),
    { ShuttleOnboardDetector } = h.load("features/utils/shuttle-onboard"),
    { point, bus } = onboardFixture();
  const scenarios = [
    (i) => [point(0), [bus(i * 18)]],
    (i) => [point(i * 3), [bus(i * 3)]],
    (i) => [point(i * 18), [bus(i * 18), bus(i * 18 + 5, "parallel", "r1")]],
    (i) => [point(i * 180), [bus(i * 180)]],
    (i) => [{ ...point(i * 18), accuracy: 60 }, [bus(i * 18)]],
    (i) => [point(i * 18), [bus(180 - i * 18)]],
    (i) => [point(i * 18), [bus(0)]],
  ];
  for (const scenario of scenarios) {
    const detector = new ShuttleOnboardDetector();
    for (let i = 0; i < 10; i++) {
      const [fix, fleet] = scenario(i);
      assert.equal(
        detector.update(fix, 1000 + i * 3000, 1000 + i * 3000, fleet),
        undefined,
      );
    }
  }
  const detector = new ShuttleOnboardDetector();
  for (let i = 0; i < 10; i++)
    assert.equal(
      detector.update(point(i * 18), 1000 + i * 3000, 1000, [bus(i * 18)]),
      undefined,
    );
});

test("onboard planning follows the actual direction without walking back and retains intermediate stops", () => {
  const h = harness(),
    { point, bus, campus } = onboardFixture(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { ShuttleJourneyProgress } = h.load(
      "features/utils/shuttle-journey-progress",
    ),
    planner = new ShuttlePlanner(campus),
    itinerary = new ShuttleItineraryPlanner(campus, planner);
  const plan = itinerary.onboard(bus(90), point(900));
  assert.equal(plan.route.id, "r2");
  assert.equal(plan.walkTo, 0);
  assert.equal(plan.alight.id, "s900");
  assert(plan.points[0].longitude >= point(89).longitude);
  assert(plan.points.every((p) => p.longitude >= point(89).longitude));
  assert.deepEqual(
    clone(planner.journeyStops(plan.legs[0]).map((s) => s.place.id)),
    ["s300", "s600"],
  );
  const tracker = new ShuttleJourneyProgress(
    plan,
    point(90),
    { ...point(900), name: "目的地" },
    planner,
  );
  assert.equal(tracker.view(280).phase, "riding");
  assert.equal(tracker.view(280).segments[0].walk, false);
  tracker.update(point(90), 1000);
  tracker.update(point(110), 5000);
  assert(tracker.view(280).position > 0);
  const reverse = itinerary.onboard({ ...bus(810), direction: 270 }, point(0));
  assert.equal(reverse.alight.id, "s0");
  assert.equal(reverse.legs[0].onboard.direction, 1);
  assert(reverse.points.every((p) => p.longitude <= point(811).longitude));
  assert.equal(
    itinerary.onboard({ ...bus(90), direction: null }, point(900)),
    undefined,
  );
  assert.equal(
    itinerary.onboard(bus(90, "bad", "unknown"), point(900)),
    undefined,
  );
  assert.equal(
    itinerary.onboard(bus(90, "far", "r2", 100), point(900)),
    undefined,
  );
});

test("rerouted progress starts proportionally between the preceding and next directional stations", () => {
  const h = harness(),
    { point, bus, campus } = onboardFixture(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { ShuttleJourneyProgress } = h.load(
      "features/utils/shuttle-journey-progress",
    ),
    planner = new ShuttlePlanner(campus),
    itinerary = new ShuttleItineraryPlanner(campus, planner);
  for (const [x, direction, previous, next, ratio, end] of [
    [75, 90, "站0", "站300", 0.25, 900],
    [450, 90, "站300", "站600", 0.5, 900],
    [299, 90, "站0", "站300", 299 / 300, 900],
    [450, 270, "站600", "站300", 0.5, 0],
    [225, 270, "站300", "站0", 0.25, 0],
  ]) {
    const plan = itinerary.onboard({ ...bus(x), direction }, point(end));
    const geometry = clone(plan.points);
    const progress = new ShuttleJourneyProgress(
      plan,
      point(x),
      { ...point(end), name: "目的地" },
      planner,
    );
    const view = progress.view(280),
      previousNode = view.nodes[0],
      nextNode = view.nodes.find((n) => n.name === next);
    assert.equal(previousNode.name, previous);
    assert(nextNode);
    assert(
      Math.abs(
        (view.position - previousNode.x) / (nextNode.x - previousNode.x) -
          ratio,
      ) < 0.002,
    );
    assert(view.position > 0);
    assert(previousNode.reached && !nextNode.reached);
    assert.equal(view.phase, "riding");
    assert.equal(view.segments[0].walk, false);
    assert.deepEqual(
      clone(plan.points),
      geometry,
      "timeline must not prepend travelled roads to the map itinerary",
    );
    progress.update(point(x), 1000);
    assert(Math.abs(progress.view(280).position - view.position) < 0.01);
    progress.pause();
    progress.update(point(x), 61000);
    assert(Math.abs(progress.view(280).position - view.position) < 0.01);
    progress.update(point(x + (direction === 90 ? 10 : -10)), 65000);
    assert(progress.view(280).position > view.position);
  }
});

test("rerouted progress measures the road around a bend, then reaches the next stage normally", () => {
  const h = harness(),
    { point, bus, campus } = onboardFixture(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { ShuttleJourneyProgress } = h.load(
      "features/utils/shuttle-journey-progress",
    );
  campus.places = [point(0), point(100, 100), point(100, 300)].map((p, i) => ({
    ...p,
    id: `s${i}`,
    name: `站${i}`,
    category: "stop",
    routeIds: ["r2"],
  }));
  campus.routes = [
    {
      ...campus.routes[1],
      stopIds: ["s0", "s1", "s2"],
      orderedStops: [0, 1, 2].map((i) => ({ stopId: `s${i}`, order: i })),
    },
  ];
  campus.paths = [
    {
      ...campus.paths[0],
      routeIds: ["r2"],
      points: [point(0), point(100), point(100, 100), point(100, 300)],
    },
  ];
  const planner = new ShuttlePlanner(campus),
    itinerary = new ShuttleItineraryPlanner(campus, planner);
  const plan = itinerary.onboard(
    { ...bus(100, "b", "r2", 50), direction: 0 },
    point(100, 300),
    ["s2"],
  );
  const tracker = new ShuttleJourneyProgress(
    plan,
    point(100, 50),
    { ...point(100, 300), name: "目的地" },
    planner,
  );
  const view = tracker.view(280),
    next = view.nodes.find((n) => n.name === "站1");
  assert(
    Math.abs(view.position / next.x - 0.75) < 0.003,
    "use travelled road distance, not the diagonal to the prior station",
  );
  let time = 1000;
  tracker.update(point(100, 50), time);
  for (let y = 70; y <= 290; y += 20)
    tracker.update(point(100, y), (time += 5000));
  tracker.update(point(100, 300), (time += 5000));
  tracker.update(point(100, 300), (time += 5000));
  assert.equal(tracker.view(280).phase, "arrived");
  assert(tracker.view(280).segments.every((s) => s.fill === 1));
});

test("onboard routing can retain a required destination stop through a forward transfer", () => {
  const h = harness(),
    { point, bus, campus } = onboardFixture(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  campus.places.push({
    ...point(600, 900),
    id: "end",
    name: "目的站",
    category: "stop",
    routeIds: ["r3"],
  });
  campus.places.find((p) => p.id === "s600").routeIds.push("r3");
  campus.routes.push({
    id: "r3",
    name: "3号线",
    color: "#333",
    stopIds: ["s600", "end"],
    orderedStops: [
      { stopId: "s600", order: 0 },
      { stopId: "end", order: 1 },
    ],
  });
  campus.paths.push({
    id: "transfer-road",
    routeIds: ["r3"],
    points: [point(600), point(600, 900)],
    direction: "both",
    color: "#333",
  });
  const planner = new ShuttlePlanner(campus),
    itinerary = new ShuttleItineraryPlanner(campus, planner);
  const plan = itinerary.onboard(bus(90), point(600, 900), ["end"]);
  assert(plan);
  assert.equal(plan.legs[0].route.id, "r2");
  assert.equal(plan.legs[1].route.id, "r3");
  assert.equal(plan.alight.id, "end");
  assert.equal(plan.legs[0].alight.id, plan.legs[1].board.id);
  assert.equal(
    itinerary.onboard(bus(90), point(600, 900), ["missing"]),
    undefined,
  );
});

test("onboard loop continuation follows the road around its seam instead of drawing a chord", () => {
  const h = harness(),
    { point, bus, campus } = onboardFixture(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const coords = [point(0), point(300), point(300, 300), point(0, 300)];
  campus.places = coords.map((p, i) => ({
    ...p,
    id: `s${i}`,
    name: `站${i}`,
    category: "stop",
    routeIds: ["loop"],
  }));
  campus.routes = [
    {
      id: "loop",
      name: "环线",
      color: "#333",
      stopIds: campus.places.map((p) => p.id),
      orderedStops: [0, 1, 2, 3, 0].map((i, order) => ({
        stopId: `s${i}`,
        order,
      })),
    },
  ];
  campus.paths = [
    {
      id: "loop-road",
      routeIds: ["loop"],
      points: [...coords, coords[0]],
      direction: "forward",
      color: "#333",
    },
  ];
  const planner = new ShuttlePlanner(campus);
  const plans = planner.onboardPlans(
    { ...bus(0, "loop-bus", "loop", 150), direction: 180 },
    point(300),
  );
  const plan = plans.find((p) => p.alight.id === "s1");
  assert(plan);
  assert(
    plan.points.some(
      (p) =>
        Math.abs(p.longitude - point(0).longitude) < 1e-7 &&
        Math.abs(p.latitude - point(0).latitude) < 1e-7,
    ),
  );
  assert.equal(plan.points.at(-1).longitude, point(300).longitude);
  assert(planner.journeyStops(plan).some((s) => s.place.id === "s0"));
});

test("real campus onboard plans keep route direction and usable forward stop geometry", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary"),
    { headingDegrees } = h.load("features/utils/shuttle-screen"),
    { distanceMeters } = h.load("utils/shuttle-geo"),
    planner = new ShuttlePlanner(map),
    itinerary = new ShuttleItineraryPlanner(map, planner);
  let checked = 0;
  for (const route of map.routes) {
    const track = planner.track(route);
    if (!track) continue;
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1],
        b = track.points[i];
      if (distanceMeters(a, b) < 20) continue;
      const vehicle = {
        ...a,
        longitude: (a.longitude + b.longitude) / 2,
        latitude: (a.latitude + b.latitude) / 2,
        id: route.id,
        lineId: route.id,
        direction: headingDegrees(a, b),
      };
      const exits = planner.onboardPlans(vehicle, track.stops.at(-1).place);
      if (!exits.length) continue;
      const plan = itinerary.onboard(vehicle, exits[0].alight, [
        exits[0].alight.id,
      ]);
      assert(plan);
      assert.equal(plan.legs[0].route.id, route.id);
      assert.equal(plan.walkTo, 0);
      assert(distanceMeters(plan.legs[0].points[0], vehicle) <= 30);
      assert(plan.legs.every((l) => l.points.length >= 2 && l.rideMeters > 0));
      assert(
        planner
          .journeyStops(plan.legs[0])
          .every((s) => s.meters > 0 && s.meters < plan.legs[0].rideMeters),
      );
      checked++;
      break;
    }
  }
  assert.equal(checked, map.routes.length);
});

test("active page silently switches the actual line, keeps its destination, and restores filtering on end", async () => {
  const { point, bus, campus } = onboardFixture(),
    clock = { now: 100000 },
    h = harness({ mockStream: true, clock, map: campus }),
    page = h.page();
  Object.assign(h.raw, point(0));
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "原目的地" });
  page.confirmMapPick();
  await settle();
  assert(page.data.selectedPlanId);
  page.startJourney();
  assert.deepEqual(clone(page.liveSelection()), {});
  const before = page.data.selectedPlanId,
    destination = page.data.destinationName;
  const stream = h.calls.find((c) => c[0] === "streamConstruct")[1];
  stream.handlers.state("live");
  const update = (i, overrides = {}) => {
    clock.now = 103000 + i * 3000;
    stream.handlers.snapshot({
      type: "snapshot",
      protocol: 2,
      serverTime: clock.now,
      fetchedAt: clock.now,
      stale: false,
      available: true,
      mapRevision: campus.revision,
      selectionValid: true,
      selection: { routeIds: [], filtered: false },
      vehicles: [bus(i * 18)],
      ...overrides,
    });
    h.getListener()({ ...h.raw, ...point(i * 18) });
  };
  const silentStart = h.calls.length;
  for (let i = 0; i <= 5; i++) {
    const callsBefore = h.calls.length;
    update(i);
    if (i < 5) assert.equal(page.data.selectedPlanId, before);
    else
      assert(
        !h.calls
          .slice(callsBefore)
          .some((c) =>
            ["toast", "modal", "includePoints", "moveToLocation"].includes(
              c[0],
            ),
          ),
      );
  }
  assert.notEqual(page.data.selectedPlanId, before);
  assert.equal(page.data.routeId, "r2");
  assert.equal(page.data.destinationName, destination);
  assert.equal(page.data.journey, "riding");
  assert.equal(page.data.journeyProgress.segments[0].walk, false);
  const nextStation = page.data.journeyProgress.nodes.find(
    (n) => n.name === "站300",
  );
  assert(
    nextStation &&
      Math.abs(page.data.journeyProgress.position / nextStation.x - 0.3) <
        0.002,
  );
  assert.equal(page.data.routeAnimating, false);
  assert.equal(page.data.plans[0].routeName, "2号线");
  // Reminder events before confirmation may be valid; the switch itself must add none.
  const after = h.calls.length;
  update(6);
  assert(
    !h.calls
      .slice(after)
      .some((c) =>
        ["toast", "modal", "includePoints", "moveToLocation"].includes(c[0]),
      ),
  );
  assert(!h.calls.slice(silentStart).some((c) => c[0] === "modal"));
  assert(
    page.data.polylines.some(
      (p) => !p.dottedLine && p.points[0].longitude >= point(89).longitude,
    ),
  );
  const frozen = page.data.selectedPlanId;
  page.rebuildPlans(true);
  assert.equal(page.data.selectedPlanId, frozen);
  page.cancelJourney();
  assert.equal(page.data.journey, "idle");
  assert(!page.data.selectedPlanId.startsWith("onboard:"));
  assert(page.liveSelection().routeIds?.length);
  page.onUnload();
});

test("the selected line boards from time-aligned live data even when its marker trails by three seconds", async () => {
  const { point, bus, campus } = onboardFixture(),
    clock = { now: 100000 },
    h = harness({ mockStream: true, clock, map: campus }),
    page = h.page();
  Object.assign(h.raw, point(0));
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "目的地" });
  page.confirmMapPick();
  await settle();
  const selected = page.data.selectedPlanId;
  page.startJourney();
  const stream = h.calls.find((c) => c[0] === "streamConstruct")[1];
  stream.handlers.state("live");
  for (let i = 0; i <= 30; i++) {
    clock.now = 100000 + i * 1000;
    if (i % 3 === 0)
      stream.handlers.snapshot({
        type: "snapshot",
        protocol: 2,
        serverTime: clock.now,
        fetchedAt: clock.now - 3000,
        stale: false,
        available: true,
        selectionValid: true,
        mapRevision: campus.revision,
        selection: { routeIds: [], filtered: false },
        vehicles: [
          {
            ...bus(Math.max(0, (i - 3) * 9), "bus-1", "r1"),
            motion: {
              startsAt: clock.now - 6000,
              duration: 3000,
              points: [
                point(Math.max(0, (i - 6) * 9)),
                point(Math.max(0, (i - 3) * 9)),
              ],
              heading: 90,
              status: "moving",
              reset: false,
              playbackDelay: 3000,
            },
          },
        ],
      });
    h.getListener()({ ...h.raw, ...point(i * 9) });
  }
  assert.equal(page.data.selectedPlanId, selected);
  assert.equal(page.data.journey, "riding");
  const next = page.data.journeyProgress.nodes.find((n) => n.name === "站300");
  assert(Math.abs(page.data.journeyProgress.position / next.x - 0.9) < 0.002);
  page.onUnload();
});

test("stale or hidden-page fleet observations do not auto-reroute", async () => {
  const { point, bus, campus } = onboardFixture(),
    clock = { now: 100000 },
    h = harness({ mockStream: true, clock, map: campus }),
    page = h.page();
  Object.assign(h.raw, point(0));
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "目的地" });
  page.confirmMapPick();
  await settle();
  page.startJourney();
  const before = page.data.selectedPlanId;
  const stream = h.calls.find((c) => c[0] === "streamConstruct")[1];
  stream.handlers.state("live");
  for (let i = 0; i < 8; i++) {
    clock.now += 3000;
    stream.handlers.snapshot({
      type: "snapshot",
      protocol: 2,
      serverTime: clock.now,
      fetchedAt: clock.now,
      stale: true,
      available: true,
      mapRevision: campus.revision,
      selectionValid: true,
      selection: { routeIds: [], filtered: false },
      vehicles: [bus(i * 18)],
    });
    h.getListener()({ ...h.raw, ...point(i * 18) });
  }
  assert.equal(page.data.selectedPlanId, before);
  const listener = h.getListener();
  page.onHide();
  for (let i = 0; i < 8; i++) {
    clock.now += 3000;
    listener({ ...h.raw, ...point(150 + i * 18) });
  }
  assert.equal(page.data.selectedPlanId, before);
  page.onUnload();
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
  const storage = new Map([["easy-swu:shuttle:map:v2", structuredClone(map)]]);
  storage.set("easy-swu:shuttle:map:v1", { revision: "unsafe-old-directions" });
  storage.set("easy-swu:shuttle:locations:fixture", { preserved: true });
  const h = harness({
    storage,
    api: async () => {
      throw Error("offline");
    },
  });
  const service = h.load("services/shuttle");
  assert(!storage.has("easy-swu:shuttle:map:v1"));
  assert(storage.get("easy-swu:shuttle:locations:fixture").preserved);
  assert.equal((await service.getShuttleMap()).revision, map.revision);
  await settle();
  await assert.rejects(
    service.getShuttleMap(true),
    (e) => e.code === "SHUTTLE_REFRESH_DEFERRED",
  );
  assert.equal(h.calls.filter((c) => c[0] === "request").length, 1);
  assert.equal(storage.get("easy-swu:shuttle:map:v2").revision, map.revision);
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
        ["easy-swu:shuttle:map:v2", old],
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

test("empty nearby drawers are shorter without shrinking plans or expanded content", () => {
  const h = harness(),
    page = h.page();
  for (const height of [568, 667, 800, 932]) {
    for (const safeBottom of [0, 34]) {
      page.setData({
        windowHeight: height,
        safeBottom,
        vehicles: [],
        destinationName: "",
        journey: "idle",
      });
      page.layout(false);
      const compact = page.data.sheetHeight;
      const expanded = page.targetSheetHeight(true);
      assert(compact >= 160 + safeBottom);
      page.setData({ vehicles: [{ id: "bus" }] });
      const normal = page.targetSheetHeight(false);
      assert(compact < normal);
      assert(normal - compact <= 48);
      assert.equal(page.targetSheetHeight(true), expanded);
      page.setData({ vehicles: [], destinationName: "大礼堂" });
      assert.equal(page.targetSheetHeight(false), normal);
      page.setData({ destinationName: "", journey: "waiting" });
      assert.equal(
        page.targetSheetHeight(false),
        Math.round(
          Math.min(
            256 + safeBottom,
            Math.max(160, height - page.data.headerHeight - 105),
          ),
        ),
      );
      page.setData({ journey: "idle", motionClass: "motion-reduced" });
      page.springSheet(false);
      assert.equal(page.data.sheetHeight, compact);
    }
  }
  const wxml = fs.readFileSync(
    path.join(root, "features/pages/shuttle/index.wxml"),
    "utf8",
  );
  assert(!wxml.includes("预计时间包含"));
  assert(!wxml.includes("sheet-footnote"));
  page.onUnload();
});

test("nearby drawer height follows fleet transitions but does not interrupt dragging", () => {
  const h = harness(),
    page = h.page();
  page.refreshRows = () => {};
  page.layout(false);
  const compact = page.data.sheetHeight;
  const packet = {
    vehicles: [{ id: "bus" }],
    fetchedAt: Date.now(),
    stale: false,
  };
  page.receiveSnapshot(packet);
  assert(page.data.sheetHeight > compact);
  page.receiveSnapshot({ ...packet, vehicles: [] });
  assert.equal(page.data.sheetHeight, compact);
  page.setData({ sheetDragging: true, sheetHeight: 275 });
  page.receiveSnapshot(packet);
  assert.equal(page.data.sheetHeight, 275);
  page.setData({ sheetDragging: false });
  page.layout(true);
  const expanded = page.data.sheetHeight;
  page.receiveSnapshot({ ...packet, vehicles: [] });
  assert.equal(page.data.sheetHeight, expanded);
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
  await settle();
  assert(page.data.plans.length > 0);
  const routeNumber = /^(\d+)号线$/.exec(r.name)?.[1];
  assert(
    page.data.plans.some((p) =>
      routeNumber
        ? new RegExp(`(?:^|/| → )${routeNumber}(?=/| ?号线)`).test(p.routeName)
        : p.routeName.includes(r.name),
    ),
  );
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
  assert(h.calls.some((c) => c[0] === "trace" && c[1].dash?.length));
  assert(![...h.jobs.values()].some((j) => j.delay > 9000 && j.delay <= 10000));
  tick(2600);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, before + 1);
  const walk = page.data.polylines
    .filter((p) => p.dottedLine && p.color !== "#FFFFFF")
    .at(-1);
  assert(walk);
  assert.equal(walk.points.length, 2);
  const ride = page.data.polylines
    .filter((p) => !p.dottedLine && p.color !== "#FFFFFF")
    .at(-1);
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
  await settle();
  assert(page.data.plans.length >= 1);
  const initial = JSON.stringify(page.data.polylines),
    selected = page.data.selectedPlanId;
  [...h.jobs.values()]
    .filter((j) => j.delay === 200)
    .at(-1)
    ?.f();
  assert.equal(
    page.data.polylines.filter((p) => !p.dottedLine && p.color !== "#FFFFFF")
      .length,
    selected.split("|").length,
  );
  assert(
    page.data.polylines.some(
      (p) => !p.dottedLine && p.color !== "#FFFFFF" && p.arrowLine,
    ),
  );
  assert(
    page.data.polylines
      .filter((p) => p.dottedLine || p.color === "#FFFFFF")
      .every((p) => !p.arrowLine),
  );
  assert(
    page.data.polylines
      .filter((p) => p.dottedLine)
      .every((p) => p.points.length >= 2),
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
  await settle();
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
    { distanceMeters } = h.load("utils/shuttle-geo"),
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
        p.legs[0].board.id === from.id &&
        Math.abs(p.walkFrom - distanceMeters(p.legs.at(-1).alight, to)) < 1,
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
  await settle();
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
  assert(![...h.jobs.values()].some((j) => j.delay > 9000 && j.delay <= 10000));
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
  assert(result[0].points.length >= 2);
  assert.equal(result[0].points[0].longitude, h.raw.longitude);
  assert.equal(result[0].points.at(-1).longitude, h.raw.longitude + 0.0005);
  assert.equal(result[0].walkLegs[0].source, "campus");
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
test("walking routes keep their planned origin while the user marker moves and live success is silent", async () => {
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
  assert(![...h.jobs.values()].some((j) => j.delay > 9000 && j.delay <= 10000));
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
  assert.equal(walks[0].points[0].longitude, h.raw.longitude);
  assert.notEqual(walks[0].points[0].longitude, user.longitude);
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
  await settle();
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
    clock = { now: Date.now() },
    h = harness({
      mockStream: true,
      canvas: true,
      clock,
      plans: (o) =>
        new Promise((resolve, reject) => pending.push({ o, resolve, reject })),
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
  pending.at(-1).reject(new Error("request:fail timeout"));
  await settle();
  clock.now += 21001;
  page.rebuildPlans(false);
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

test("switching cached itineraries replays walk-ride-walk in order without another planning request", async () => {
  const storage = new Map();
  const h = harness({ mockStream: true, canvas: true, storage });
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const { ShuttleItineraryPlanner } = h.load(
    "features/utils/shuttle-itinerary",
  );
  const planner = new ShuttleItineraryPlanner(map, new ShuttlePlanner(map));
  const usable = (p) =>
    p.mode === "ride" &&
    p.legs.length === 1 &&
    p.walkTo > 10 &&
    p.walkFrom > 10;
  const destination = map.places.find((p) =>
    planner.plans(h.raw, p).some(usable),
  );
  const ride = planner.plans(h.raw, destination).find(usable);
  let from = h.raw;
  const walks = [];
  for (const leg of ride.legs) {
    walks.push({
      points: [from, leg.board],
      meters: 100,
      seconds: 90,
      source: "tencent",
    });
    from = leg.alight;
  }
  walks.push({
    points: [from, destination],
    meters: 100,
    seconds: 90,
    source: "tencent",
  });
  // Distinct choices can share their bus geometry and even all walking geometry.
  const plans = ["cached-a", "cached-b"].map((id) => ({
    ...ride,
    id,
    walkLegs: walks,
  }));
  storage.set("easy-swu:shuttle:plans:v3:42", [{ obsolete: true }]);
  storage.set("easy-swu:shuttle:plans:v4:42", [{ obsolete: true }]);
  storage.set("easy-swu:shuttle:plans:v6:42", [
    {
      request: {
        origin: h.raw,
        destination,
        originMode: "gps",
        boardingIds: [],
        destinationStopIds: [],
      },
      result: { revision: map.revision, planningId: "cached", plans },
      expires: Date.now() + 900000,
    },
  ]);
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({
    longitude: destination.longitude,
    latitude: destination.latitude,
    name: "目标",
  });
  page.confirmMapPick();
  await settle();
  assert(page.data.plans.some((p) => p.id === "cached-a"));
  assert(!storage.has("easy-swu:shuttle:plans:v3:42"));
  assert(!storage.has("easy-swu:shuttle:plans:v4:42"));
  const tick = (time) => {
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(time);
  };
  const runJob = (delay) => {
    const [id, job] = [...h.jobs].filter(([, j]) => j.delay === delay).at(-1);
    h.jobs.delete(id);
    job.f();
  };
  for (const id of ["cached-a", "cached-b", "cached-a"]) {
    page.choosePlan({ currentTarget: { dataset: { id } } });
    runJob(420);
    const frames = (time) => {
      const offset = h.calls.length;
      tick(time);
      return h.calls
        .slice(offset)
        .filter((c) => c[0] === "trace" && c[1].color !== "#FFFFFF");
    };
    assert.equal(page.data.polylines.length, 0);
    frames(0);
    const first = frames(200);
    assert.equal(first.length, 1);
    assert(first[0][1].dash.length);
    const middle = frames(1300);
    assert.equal(middle.length, 2);
    assert.equal(middle[1][1].dash.length, 0);
    assert.notDeepEqual(first[0][1].path.at(-1), middle[0][1].path.at(-1));
    assert.equal(frames(2200).length, 2);
    const partial = frames(2400);
    assert.equal(partial.length, 3);
    assert(partial[2][1].dash.length);
    const full = frames(2600);
    assert.equal(full.length, 3);
    assert.deepEqual(full[0][1].path, middle[0][1].path);
    assert.notDeepEqual(full[2][1].path.at(-1), partial[2][1].path.at(-1));
    runJob(160);
    assert.equal(page.data.routeAnimating, false);
    assert(page.data.polylines.some((p) => p.dottedLine));
  }
  assert(!h.calls.some((c) => c[0] === "request" && c[1].endsWith("/plans")));
  page.onUnload();
});

test("cached transfers keep itinerary order and walking-only trips do not wait for a bus clock", () => {
  const h = harness({ canvas: true });
  const { ShuttleRouteReveal, orderedTraces } = h.load(
    "features/utils/shuttle-route-reveal",
  );
  const parts = orderedTraces(
    Array.from({ length: 5 }, (_, index) => ({
      points: [index, index + 1].map((x) => ({
        longitude: 106 + x / 10000,
        latitude: 29,
      })),
      color: String(index),
      width: 3,
      dotted: index % 2 === 0,
    })),
  );
  const reveal = new ShuttleRouteReveal(h.canvas, h.canvasContext);
  let complete = 0;
  const start = () =>
    reveal.start(
      [],
      (p) => ({ x: p.longitude, y: p.latitude }),
      320,
      400,
      () => complete++,
    );
  const tick = (time) => {
    const offset = h.calls.length;
    const [id, fn] = [...h.frames].at(-1);
    h.frames.delete(id);
    fn(time);
    return h.calls
      .slice(offset)
      .filter((c) => c[0] === "trace" && c[1].color !== "#FFFFFF");
  };
  start();
  reveal.updateJourney(parts);
  tick(0);
  [133, 716, 1300, 1883, 2466].forEach((time, index) => {
    assert.deepEqual(
      tick(time).map((c) => c[1].color),
      Array.from({ length: index + 1 }, (_, n) => String(n)),
    );
    reveal.updateWalking(
      parts.filter((p) => p.dotted),
      true,
    );
  });
  assert.equal(complete, 0);
  tick(2610);
  assert.equal(complete, 1);
  start();
  reveal.updateJourney([parts[0]]);
  assert.equal(tick(0).length, 0);
  const partial = tick(400);
  assert.equal(partial.length, 1);
  assert(partial[0][1].path.at(-1)[0] < parts[0].points.at(-1).longitude);
  tick(800);
  assert.equal(complete, 2);
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
  assert.equal(walks, 1, "GPS updates must not restart even a failed lookup");
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
    "下一辆：等候中",
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

test("adaptive tracks retain exact station visits and remap worker-local direction indices", () => {
  const current = new CampusMapStore().current;
  const { BehaviorModel } = require(
    path.join(backend, "src/shuttle/behavior-model"),
  );
  const { AdaptivePlanner } = require(
    path.join(backend, "src/shuttle/adaptive-planner"),
  );
  const model = new BehaviorModel(current),
    server = new AdaptivePlanner(current, model);
  const adaptive = server.publicMap(current),
    h = harness({ map: adaptive });
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    client = new ShuttlePlanner(adaptive);
  const track = Object.values(adaptive.serviceTracks)
    .flat()
    .find((t) => t.stops.length >= 4);
  assert(track);
  const route = current.routes.find((r) =>
    adaptive.serviceTracks[r.id]?.includes(track),
  );
  const first = track.stops[0],
    last = track.stops[3];
  const leg = {
    route,
    board: { ...first.place, serviceOrder: first.order, serviceDirection: 900 },
    alight: { ...last.place, serviceOrder: last.order, serviceDirection: 900 },
    serviceTrack: { ...track, id: "request-track" },
    points: track.points,
    rideMeters: last.at - first.at,
  };
  client.installPlans([{ legs: [leg] }]);
  assert(leg.board.serviceDirection !== 900);
  assert.equal(
    adaptive.serviceTracks[route.id][leg.board.serviceDirection].id,
    "request-track",
  );
  const visits = client.journeyStops(leg);
  assert(visits.length >= 1);
  assert(visits.every((s) => s.meters < leg.rideMeters));
  const count = adaptive.serviceTracks[route.id].length;
  client.installPlans([{ legs: [leg] }]);
  assert.equal(adaptive.serviceTracks[route.id].length, count);
  assert(
    adaptive.paths.every(
      (p) => p.color === current.paths.find((q) => q.id === p.id).color,
    ),
  );
});

test("departure labels consume only confident server durations and expire quietly", () => {
  const h = harness(),
    { departureLabel } = h.load("features/utils/shuttle-departure.ts");
  assert.equal(departureLabel(210), "预计 4 分钟后出发");
  assert.equal(departureLabel(210, 60), "预计 3 分钟后出发");
  for (const value of [undefined, null, NaN, Infinity, 10, 3700])
    assert.equal(departureLabel(value), "等候中");
  assert.equal(departureLabel(210, 91), "等候中");
});

test("departure predictions arrive silently after route selection without repainting or blocking planning", async () => {
  const { campus, point, bus } = onboardFixture(),
    clock = { now: Date.now() };
  let ride;
  const h = harness({
    map: campus,
    clock,
    mockStream: true,
    canvas: true,
    plans: async (o) => {
      const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
        { ShuttleItineraryPlanner } = h.load(
          "features/utils/shuttle-itinerary",
        );
      ride = new ShuttleItineraryPlanner(campus, new ShuttlePlanner(campus))
        .plans(o.data.origin, o.data.destination)
        .find((p) => p.mode === "ride");
      return {
        revision: campus.revision,
        planningId: "silent-departure",
        plans: [
          {
            ...ride,
            nextDepartureState: "preparing",
            nextDepartureSeconds: null,
          },
        ],
      };
    },
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "终点" });
  page.confirmMapPick();
  await settle();
  assert(ride);
  assert.equal(page.data.planning, false);
  page.setData({ connection: "live" });
  const before = JSON.stringify(page.data.polylines),
    selected = page.data.selectedPlanId;
  const board = {
    stopId: ride.board.id,
    serviceDirection: ride.board.serviceDirection,
    serviceOrder: ride.board.serviceOrder,
  };
  const packet = {
    fetchedAt: clock.now,
    serverTime: clock.now,
    stale: false,
    mapRevision: campus.revision,
    selection: page.liveSelection(),
    vehicles: [
      {
        ...bus(0),
        id: "unknown",
        lineId: ride.route.id,
        arrivals: [
          {
            board,
            status: "waiting",
            seconds: null,
            departureSeconds: null,
            stops: 0,
            text: "等候中",
          },
        ],
      },
      {
        ...bus(0),
        id: "predicted",
        lineId: ride.route.id,
        arrivals: [
          {
            board,
            status: "waiting",
            seconds: null,
            departureSeconds: 210,
            stops: 0,
            text: "预计 4 分钟后出发",
          },
        ],
      },
    ],
  };
  page.receiveSnapshot(packet);
  assert.equal(
    page.walkLabel({ ...ride, nextDepartureState: "preparing" }),
    "下一辆：预计 4 分钟后出发",
  );
  assert.equal(page.data.selectedPlanId, selected);
  assert.equal(JSON.stringify(page.data.polylines), before);
  page.receiveSnapshot({
    ...packet,
    vehicles: packet.vehicles.map((v) => ({
      ...v,
      arrivals: v.arrivals.map((a) => ({ ...a, departureSeconds: null })),
    })),
  });
  assert.equal(
    page.walkLabel({ ...ride, nextDepartureState: "preparing" }),
    "下一辆：等候中",
  );
  assert.equal(JSON.stringify(page.data.polylines), before);
  page.onUnload();
});

test("merged recommendation next vehicle aggregates all line visits, but ignores a narrower fleet packet", async () => {
  const { campus, point, bus } = onboardFixture(),
    clock = { now: Date.now() };
  const h = harness({ map: campus, mockStream: true, clock }),
    page = h.page();
  Object.assign(h.raw, point(0));
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.setData({ connection: "live" });
  const variants = campus.routes.map((route, index) => ({
    route,
    board: { ...campus.places[0], serviceDirection: index, serviceOrder: 0 },
  }));
  const visits = variants.map((v) => ({
    routeId: v.route.id,
    stopId: v.board.id,
    serviceDirection: v.board.serviceDirection,
    serviceOrder: 0,
  }));
  const ride = {
    mode: "ride",
    legs: [{ ...variants[0], variants, routes: campus.routes }],
    nextArrivalSeconds: 240,
    nextStops: 2,
    availability: "live",
    walkTo: 0,
    walkFrom: 0,
  };
  const packet = {
    fetchedAt: clock.now,
    serverTime: clock.now,
    stale: false,
    mapRevision: campus.revision,
    selection: {
      routeIds: campus.routes.map((r) => r.id),
      boardingVisits: visits,
    },
    vehicles: visits.map((board, index) => ({
      ...bus(100, `bus${index}`, board.routeId),
      arrivals: [
        {
          board,
          status: "approaching",
          seconds: index ? 60 : 480,
          stops: index ? 1 : 4,
        },
      ],
    })),
  };
  page.receiveSnapshot(packet);
  assert.equal(page.walkLabel(ride), "下一辆：1 站（约 1 分钟）");
  page.receiveSnapshot({
    ...packet,
    vehicles: [
      packet.vehicles[0],
      {
        ...packet.vehicles[1],
        arrivals: [
          {
            board: visits[1],
            status: "waiting",
            seconds: null,
            departureSeconds: 180,
          },
        ],
      },
    ],
  });
  assert.equal(page.walkLabel(ride), "下一辆：预计 3 分钟后出发");
  page.receiveSnapshot({
    ...packet,
    selection: { routeIds: ["r1"], boardingVisits: [visits[0]] },
    vehicles: [packet.vehicles[0]],
  });
  assert.equal(
    page.walkLabel(ride),
    "下一辆：2 站（约 4 分钟）",
    "retain the server's all-line estimate, not one line's 8 minutes",
  );
  page.receiveSnapshot({
    ...packet,
    vehicles: [
      {
        ...packet.vehicles[1],
        arrivals: [
          {
            board: { ...visits[1], serviceDirection: 999 },
            status: "approaching",
            seconds: 0,
          },
        ],
      },
    ],
  });
  assert.equal(
    page.walkLabel(ride),
    "下一辆：2 站（约 4 分钟）",
    "opposite visit does not win the pooled estimate",
  );
  page.onUnload();
});

test("adaptive walking fallback uses road bends bidirectionally and only uses a chord for disconnected endpoints", () => {
  const { campus, point } = onboardFixture(),
    h = harness();
  const { ShuttleItineraryPlanner } = h.load(
    "features/utils/shuttle-itinerary",
  );
  const m = {
    ...campus,
    planningMode: "adaptive",
    paths: [
      {
        ...campus.paths[0],
        direction: "forward",
        points: [point(0), point(100), point(100, 100)],
      },
    ],
  };
  const planner = new ShuttleItineraryPlanner(m, {
    plans: () => {
      throw Error("bus inference on UI");
    },
  });
  const walk = planner.plans(point(100, 100), point(0), [], [], true)[0];
  assert.equal(walk.walkLegs[0].source, "campus");
  assert.equal(walk.walkLegs[0].points.length, 3);
  assert(walk.walkTo > 190 && walk.walkTo < 210);
  const disconnected = planner.walk(point(1000), point(0));
  assert.equal(disconnected.source, "straight");
});

test("an uncertain adaptive preview response cannot truncate an in-flight reveal", async () => {
  const { campus, point, bus } = onboardFixture(),
    clock = { now: Date.now() };
  campus.planningMode = "adaptive";
  let queries = 0;
  const points = [point(250), point(600), point(900)];
  const h = harness({
      map: campus,
      canvas: true,
      mockStream: true,
      clock,
      preview: async () => ({
        revision: campus.revision,
        lineId: "r2",
        points: ++queries === 1 ? points : [],
      }),
    }),
    page = h.page();
  Object.assign(h.raw, point(250));
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  const packet = {
    vehicles: [bus(250)],
    fetchedAt: clock.now,
    serverTime: clock.now,
    stale: false,
    mapRevision: campus.revision,
  };
  page.receiveSnapshot(packet);
  page.selectVehicle({ currentTarget: { dataset: { id: "bus-2" } } });
  await settle();
  [...h.jobs.values()]
    .filter((j) => j.delay === 0)
    .at(-1)
    .f();
  const frame = (time) => {
    const [id, callback] = [...h.frames].at(-1);
    h.frames.delete(id);
    callback(time);
  };
  frame(0);
  frame(1100);
  const requests = h.calls.filter((c) => c[0] === "polylines").length;
  clock.now += 7000;
  page.receiveSnapshot({
    ...packet,
    fetchedAt: clock.now,
    serverTime: clock.now,
  });
  page.refreshVehiclePreview();
  await settle();
  assert.equal(queries, 2);
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, requests);
  frame(2200);
  const line = page.data.polylines.find((p) => p.color !== "#FFFFFF");
  assert(line);
  assert.equal(line.points.at(-1).longitude, points.at(-1).longitude);
  page.onUnload();
});

test("reselecting the same vehicle rejects its old preview and retains the new request owner", async () => {
  const { campus, point, bus } = onboardFixture(),
    clock = { now: Date.now() },
    requests = [];
  campus.planningMode = "adaptive";
  const h = harness({
      map: campus,
      canvas: true,
      mockStream: true,
      uncoalescedRequests: true,
      clock,
      preview: () => new Promise((resolve) => requests.push(resolve)),
    }),
    page = h.page();
  Object.assign(h.raw, point(250));
  page.onLoad();
  page.onShow();
  page.onReady();
  await settle();
  page.receiveSnapshot({
    vehicles: [bus(250)],
    fetchedAt: clock.now,
    serverTime: clock.now,
    stale: false,
    mapRevision: campus.revision,
  });
  const tap = { currentTarget: { dataset: { id: "bus-2" } } };
  page.selectVehicle(tap);
  assert.equal(page.data.selectedVehicleId, "bus-2", "initial selection");
  assert.equal(requests.length, 1, "initial request");
  await settle();
  page.selectVehicle(tap);
  assert.equal(page.data.selectedVehicleId, "", "cancel selection");
  await settle();
  page.selectVehicle(tap);
  assert.equal(page.data.selectedVehicleId, "bus-2", "new selection");
  await settle();
  assert.equal(requests.length, 2);
  const paints = h.calls.filter((c) => c[0] === "polylines").length;
  requests[0]({
    revision: campus.revision,
    lineId: "r2",
    points: [point(250), point(400)],
  });
  await settle();
  assert.equal(h.calls.filter((c) => c[0] === "polylines").length, paints);
  clock.now += 7000;
  page.refreshVehiclePreview();
  await settle();
  assert.equal(requests.length, 2, "old finally cannot clear the new request");
  const points = [point(250), point(600), point(900)];
  requests[1]({ revision: campus.revision, lineId: "r2", points });
  await settle();
  [...h.jobs.values()]
    .filter((j) => j.delay === 0)
    .at(-1)
    .f();
  page.finishRouteAnimation();
  const line = page.data.polylines.find((p) => p.color !== "#FFFFFF");
  assert(line);
  assert.equal(line.points.at(-1).longitude, points.at(-1).longitude);
  page.onUnload();
});

test("adaptive timeout fallback never solves dynamic bus paths on the UI thread", () => {
  const h = harness(),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const campus = { ...map, planningMode: "adaptive" };
  const planner = {
    plans: () => {
      throw Error("blocking client inference");
    },
  };
  const from = map.center,
    to = { ...from, longitude: from.longitude + 0.005 };
  const start = performance.now();
  const plans = new ShuttleItineraryPlanner(campus, planner).plans(
    from,
    to,
    [],
    [],
    true,
  );
  assert.deepEqual(
    Array.from(plans, (p) => p.mode),
    ["walk"],
  );
  assert(performance.now() - start < 100);
});
test("repeated adaptive plan changes retain only baseline and current request tracks", () => {
  const h = harness(),
    { ShuttlePlanner } = h.load("features/utils/shuttle-routing");
  const route = map.routes[0],
    p = map.places[0];
  const baseline = {
    id: "base",
    points: [p],
    offsets: [0],
    stops: [{ place: p, order: 0, at: 0 }],
    loop: false,
  };
  const campus = {
    ...map,
    planningMode: "adaptive",
    serviceTracks: { [route.id]: [baseline] },
  };
  const planner = new ShuttlePlanner(campus);
  for (let i = 0; i < 100; i++) {
    const track = { ...baseline, id: `request-${i}` },
      leg = { route, board: { ...p }, alight: { ...p }, serviceTrack: track };
    planner.installPlans([{ legs: [leg] }]);
    assert.equal(campus.serviceTracks[route.id].length, 2);
    assert.equal(
      campus.serviceTracks[route.id][leg.board.serviceDirection].id,
      track.id,
    );
  }
});

test("review shuttle preview opens locally, shows exactly one bus and never persists location", async () => {
  const h = harness({ demo: true });
  Object.assign(h.raw, { longitude: 116.4, latitude: 39.9 });
  const preview = h.component();
  await preview.activate();
  await settle();
  assert.equal(
    preview.data.markers.filter((m) => m.id >= 100 && m.id < 200).length,
    1,
  );
  assert.equal(preview.data.status, "校车预览");
  await preview.openShuttle();
  assert(
    h.calls.some((c) => c[0] === "navigateTo" && c[1].includes("shuttle")),
  );
  preview.deactivate();
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  assert.equal(page.data.authorized, true);
  assert(h.calls.some((c) => c[0] === "getLocation"));
  assert.equal(page.data.vehicles.length, 1);
  const { demoShuttlePosition } = h.load("demo/shuttle");
  assert.equal(page.data.longitude, demoShuttlePosition().longitude);
  assert(!h.calls.some((c) => c[0] === "connectSocket" || c[0] === "request"));
  h.getListener()({ ...h.raw, longitude: 116.5 });
  await settle();
  page.onHide();
  await settle();
  assert(
    ![...h.storage.keys()].some((k) =>
      k.startsWith("easy-swu:shuttle:outbox:"),
    ),
  );
  assert(!h.storage.has("easy-swu:shuttle:map:v2"));
  page.onUnload();
});

test("review GPS denial retains a manual orange-garden origin without authorizing GPS", async () => {
  const h = harness({ demo: true, deny: true, permission: false }),
    page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  assert.equal(page.data.authorized, false);
  assert.equal(page.data.manualOrigin, true);
  assert.equal(page.data.originName, "橘园");
  assert.equal(page.data.vehicles.length, 1);
  page.startJourney();
  assert.equal(page.data.journey, "idle");
  assert(!h.calls.some((c) => c[0] === "connectSocket" || c[0] === "request"));
  page.onUnload();
});

test("idle selected routes restore after hiding without restarting a reveal", async () => {
  for (const mode of ["ride", "walk"]) {
    const { campus, point } = onboardFixture(),
      h = harness({ map: campus, mockStream: true, canvas: true });
    const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
      { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
    Object.assign(h.raw, point(0));
    const destination = point(900, 50),
      plans = new ShuttleItineraryPlanner(
        campus,
        new ShuttlePlanner(campus),
      ).plans(h.raw, destination);
    h.storage.set("easy-swu:shuttle:plans:v6:42", [
      {
        request: {
          origin: h.raw,
          destination,
          originMode: "gps",
          boardingIds: [],
          destinationStopIds: [],
        },
        result: { revision: campus.revision, planningId: "restore", plans },
        expires: Date.now() + 60000,
      },
    ]);
    const page = h.page();
    page.onLoad();
    page.onReady();
    page.onShow();
    await settle();
    page.showMapPick({ ...destination, name: "目标" });
    page.confirmMapPick();
    await settle();
    const choice = page.data.plans.find((p) => p.mode === mode);
    assert(choice);
    page.choosePlan({ currentTarget: { dataset: { id: choice.id } } });
    const jobsBefore = [...h.jobs.values()].filter(
      (j) => j.delay === 420,
    ).length;
    assert(jobsBefore);
    page.onHide();
    const final = JSON.stringify(page.data.polylines);
    assert(page.data.polylines.length);
    page.onShow();
    await settle();
    assert.equal(page.data.selectedPlanId, choice.id);
    assert.equal(JSON.stringify(page.data.polylines), final);
    assert.equal(page.data.routeAnimating, false);
    assert.equal(h.frames.size, 0);
    assert(![...h.jobs.values()].some((j) => j.delay === 420));
    page.onUnload();
  }
});

test("late estimate responses cannot replace a manual ride or restart its reveal", async () => {
  const { campus, point } = onboardFixture(),
    clock = { now: Date.now() },
    pending = [];
  const h = harness({
    map: campus,
    mockStream: true,
    clock,
    estimates: (o) => new Promise((resolve) => pending.push({ o, resolve })),
  });
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  Object.assign(h.raw, point(0));
  const destination = point(900, 60),
    plans = new ShuttleItineraryPlanner(
      campus,
      new ShuttlePlanner(campus),
    ).plans(h.raw, destination);
  h.storage.set("easy-swu:shuttle:plans:v6:42", [
    {
      request: {
        origin: h.raw,
        destination,
        originMode: "gps",
        boardingIds: [],
        destinationStopIds: [],
      },
      result: { revision: campus.revision, planningId: "accepted", plans },
      expires: clock.now + 60000,
    },
  ]);
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...destination, name: "目标" });
  page.confirmMapPick();
  await settle();
  const choice = page.data.plans.find((p) => p.mode === "ride");
  assert(choice);
  page.choosePlan({ currentTarget: { dataset: { id: choice.id } } });
  const before = JSON.stringify(page.data.polylines),
    frames = h.frames.size;
  // A malformed or incomplete timing response is timing-only, never new geometry.
  clock.now += 21000;
  page.rebuildPlans(false);
  await settle();
  assert(pending.length);
  pending.at(-1).resolve({
    revision: campus.revision,
    plans: [
      {
        id: choice.id,
        mode: "walk",
        legs: [],
        points: [point(0), point(10)],
        totalSeconds: 300,
      },
    ],
  });
  await settle();
  assert.equal(page.data.selectedPlanId, choice.id);
  assert.equal(page.data.walking, false);
  assert.equal(JSON.stringify(page.data.polylines), before);
  assert.equal(h.frames.size, frames);
  page.onUnload();
});

test("regenerated server plan IDs do not replay identical directed geometry", async () => {
  const { campus, point } = onboardFixture(),
    clock = { now: Date.now() };
  let version = 0;
  const h = harness({
    map: campus,
    mockStream: true,
    canvas: true,
    clock,
    estimates: async () => {
      throw { statusCode: 404 };
    },
    plans: async (o) => {
      const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
        { ShuttleItineraryPlanner } = h.load(
          "features/utils/shuttle-itinerary",
        );
      const p = new ShuttleItineraryPlanner(
        campus,
        new ShuttlePlanner(campus),
      ).plans(o.data.origin, o.data.destination);
      return {
        revision: campus.revision,
        planningId: `generation-${++version}`,
        plans: p.map((p) => ({ ...p, id: `gen-${version}-${p.id}` })),
      };
    },
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900, 40), name: "目标" });
  page.confirmMapPick();
  await settle();
  const [id, start] = [...h.jobs].find(([, j]) => j.delay === 420);
  h.jobs.delete(id);
  start.f();
  const frames = [...h.frames.keys()];
  assert(frames.length);
  clock.now += 21000;
  page.rebuildPlans(false);
  await settle();
  clock.now += 21000;
  page.rebuildPlans(false);
  await settle();
  assert.equal(version, 2);
  assert(
    page.data.selectedPlanId.startsWith("gen-1-"),
    "accepted geometry and selection survive regenerated server IDs",
  );
  assert.deepEqual([...h.frames.keys()], frames);
  assert(![...h.jobs.values()].some((j) => j.delay === 420));
  page.onUnload();
});

test("automatic accepted rides cannot change mode or geometry on timing refresh during their reveal", async () => {
  const { campus, point } = onboardFixture(),
    clock = { now: Date.now() };
  const h = harness({
    map: campus,
    mockStream: true,
    canvas: true,
    clock,
    estimates: async () => ({
      revision: campus.revision,
      plans: [{ id: "auto-ride", mode: "walk", legs: [], totalSeconds: 500 }],
    }),
    plans: async (o) => {
      const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
        { ShuttleItineraryPlanner } = h.load(
          "features/utils/shuttle-itinerary",
        );
      const ride = new ShuttleItineraryPlanner(
        campus,
        new ShuttlePlanner(campus),
      )
        .plans(o.data.origin, o.data.destination)
        .find((p) => p.mode === "ride");
      return {
        revision: campus.revision,
        planningId: "accepted-auto",
        plans: [{ ...ride, id: "auto-ride" }],
      };
    },
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900, 40), name: "终点" });
  page.confirmMapPick();
  await settle();
  const [timer, start] = [...h.jobs].find(([, j]) => j.delay === 420);
  h.jobs.delete(timer);
  start.f();
  assert(page.data.routeAnimating);
  const frames = [...h.frames.keys()],
    before = JSON.stringify(page.data.polylines);
  clock.now += 21000;
  page.rebuildPlans(false);
  await settle();
  assert.equal(page.data.selectedPlanId, "auto-ride");
  assert(!page.data.walking);
  assert.equal(JSON.stringify(page.data.polylines), before);
  assert.deepEqual([...h.frames.keys()], frames);
  page.onUnload();
});

test("an offline recovery ride waits until the fallback walking reveal finishes before taking over", async () => {
  const { campus, point } = onboardFixture();
  campus.planningMode = "adaptive";
  let resolve, reject;
  const clock = { now: Date.now() };
  const h = harness({
    map: campus,
    mockStream: true,
    canvas: true,
    clock,
    plans: () =>
      new Promise((r, fail) => {
        resolve = r;
        reject = fail;
      }),
  });
  Object.assign(h.raw, point(0));
  const page = h.page();
  page.onLoad();
  page.onReady();
  page.onShow();
  await settle();
  page.showMapPick({ ...point(900), name: "终点" });
  page.confirmMapPick();
  await settle();
  reject(new Error("request:fail timeout"));
  await settle();
  clock.now += 21001;
  page.rebuildPlans(false);
  await settle();
  const [timer, start] = [...h.jobs].find(([, j]) => j.delay === 420);
  h.jobs.delete(timer);
  start.f();
  assert(page.data.routeAnimating);
  assert.equal(page.data.selectedPlanId, "walk");
  const { ShuttlePlanner } = h.load("features/utils/shuttle-routing"),
    { ShuttleItineraryPlanner } = h.load("features/utils/shuttle-itinerary");
  const legacy = { ...campus, planningMode: undefined };
  const ride = new ShuttleItineraryPlanner(legacy, new ShuttlePlanner(legacy))
    .plans(point(0), point(900))
    .find((p) => p.mode === "ride");
  resolve({ revision: campus.revision, planningId: "late", plans: [ride] });
  await settle();
  assert.equal(page.data.selectedPlanId, "walk", "no mid-reveal reselect");
  page.finishRouteAnimation();
  const [handoff, job] = [...h.jobs].find(([, j]) => j.delay === 160);
  h.jobs.delete(handoff);
  job.f();
  await settle();
  assert.equal(page.data.selectedPlanId, ride.id);
  assert(!page.data.walking);
  page.onUnload();
});

(async () => {
  for (const [name, run] of tests) {
    if (
      process.env.SHUTTLE_TEST_FILTER &&
      !new RegExp(process.env.SHUTTLE_TEST_FILTER).test(name)
    )
      continue;
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
