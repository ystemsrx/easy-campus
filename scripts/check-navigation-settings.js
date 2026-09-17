const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const storage = new Map();
const modules = new Map();
const timers = new Map();
const routeBuilders = new Map();
let timerId = 0,
  pageDefinition,
  componentDefinition,
  writeFails = false,
  guards = 0;
let pages = [{ route: "pages/home/index", options: {} }];
let calls = [],
  ordinaryResult = true;
const wx = {
  router: {
    addRouteBuilder: (name, builder) => routeBuilders.set(name, builder),
  },
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => {
    if (writeFails) throw new Error("disk full");
    storage.set(key, structuredClone(value));
  },
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  enableAlertBeforeUnload: () => guards++,
  disableAlertBeforeUnload: () => guards--,
  switchTab: (options) => calls.push({ type: "switch", ...options }),
  redirectTo: (options) => calls.push({ type: "redirect", ...options }),
  navigateBack: (options) => calls.push({ type: "back", ...options }),
  showToast() {},
};
const appearance = {
  theme: "light",
  themeClass: "theme-light",
  visualTheme: "default",
  visualThemeClass: "theme-style-default",
  motionClass: "motion-normal",
  liquidGlass: false,
  liquidGlassClass: "",
};
const stubs = {
  "store/preferences": {
    loadPreferences: () => ({}),
    subscribePreferences: () => () => {},
  },
  "store/session": { getSession: () => ({ token: "demo" }) },
  "utils/appearance": {
    resolveAppearance: () => appearance,
    syncWindowBackground() {},
  },
  "utils/haptics": { haptic() {} },
  "utils/navigation": {
    ensureAuthenticated: () => true,
    navigateTo: async (url, routeType) => {
      calls.push({ type: "navigate", url, routeType });
      return ordinaryResult;
    },
  },
};
function load(key) {
  key = key.replaceAll("\\", "/").replace(/\.ts$/, "");
  if (stubs[key]) return stubs[key];
  if (modules.has(key)) return modules.get(key).exports;
  const filename = path.join(root, key + ".ts");
  const record = { exports: {} };
  modules.set(key, record);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function(
    "module",
    "exports",
    "require",
    "wx",
    "Page",
    "Component",
    "getCurrentPages",
    "setTimeout",
    "clearTimeout",
    source,
  )(
    record,
    record.exports,
    (id) => load(path.relative(root, path.resolve(path.dirname(filename), id))),
    wx,
    (definition) => {
      pageDefinition = definition;
    },
    (definition) => {
      componentDefinition = definition;
    },
    () => pages,
    (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    (id) => timers.delete(id),
  );
  return record.exports;
}
function flush() {
  for (let round = 0; timers.size && round < 20; round++) {
    const work = [...timers];
    timers.clear();
    work.forEach(([, t]) => t.callback());
  }
}
const nav = load("store/navigation");
const motion = load("features/utils/navigation-editor");
const base = () => ({ items: [...nav.DEFAULT_NAVIGATION], displaced: {} });
let settings = nav.reconcileNavigation(base(), [
  "home",
  "schedule",
  "passrate",
  "profile",
]);
assert.deepEqual(
  nav.homeNavigationActions(settings).map((item) => item.id),
  ["passrate", "rooms"],
  "Adding a fourth entry must retain its home shortcut",
);
settings = nav.reconcileNavigation(settings, ["home", "profile", "passrate"]);
assert.equal(
  nav.homeNavigationActions(settings)[0].id,
  "schedule",
  "Add then remove must recover Schedule in the pass-rate slot",
);
settings = nav.reconcileNavigation(
  base(),
  ["home", "profile", "passrate"],
  "passrate",
  "schedule",
);
assert.equal(nav.homeNavigationActions(settings)[0].id, "schedule");
settings = nav.reconcileNavigation(
  settings,
  ["profile", "rooms", "passrate"],
  "rooms",
  "home",
);
assert.deepEqual(
  nav.homeNavigationActions(settings).map((item) => item.id),
  ["home", "schedule"],
);
settings = nav.reconcileNavigation(
  settings,
  ["profile", "rooms", "timetable"],
  "timetable",
  "passrate",
);
assert.deepEqual(
  nav.homeNavigationActions(settings).map((item) => item.id),
  ["passrate", "schedule", "home"],
  "Chained replacements must keep every removed native page reachable",
);
settings = nav.reconcileNavigation(
  settings,
  ["profile", "rooms", "schedule"],
  "schedule",
  "timetable",
);
assert.deepEqual(
  nav.homeNavigationActions(settings).map((item) => item.id),
  ["passrate", "home"],
);

let configurations = 0;
function enumerate(items) {
  if (items.length >= 3 && items.includes("profile")) {
    configurations++;
    const normalized = nav.reconcileNavigation(base(), items);
    assert(nav.validNavigation(normalized.items));
    for (const [index, action] of nav
      .homeNavigationActions(normalized)
      .slice(0, 2)
      .entries()) {
      // These slots retain their colors when their destination changes.
      for (const tone of [index === 0 ? "sage" : "blue", "ink", "white"]) {
        const icon = `assets/icons/${action.icon}-${tone}.svg`;
        assert(
          fs.existsSync(path.join(root, icon)),
          `Missing dynamic navigation icon: ${icon}`,
        );
      }
    }
    const missing = nav.DEFAULT_NAVIGATION.filter((id) => !items.includes(id));
    assert.deepEqual(
      Object.values(normalized.displaced).sort(),
      missing.sort(),
    );
    assert.equal(
      new Set(Object.values(normalized.displaced)).size,
      missing.length,
    );
    const reversed = [...items].reverse();
    const reordered = nav.reconcileNavigation(normalized, reversed);
    const scheduleSlot = reversed.find(
      (id) => id === "rooms" || id === "timetable",
    );
    if (!items.includes("schedule") && scheduleSlot)
      assert.equal(
        reordered.displaced[scheduleSlot],
        "schedule",
        "Schedule replaces the leftmost eligible navigation entry",
      );
    else assert.deepEqual(reordered.displaced, normalized.displaced);
    assert.deepEqual(
      nav.reconcileNavigation(normalized, [...nav.DEFAULT_NAVIGATION])
        .displaced,
      {},
    );
  }
  if (items.length === 4) return;
  for (const item of nav.NAVIGATION_ITEMS)
    if (!items.includes(item.id)) enumerate([...items, item.id]);
}
enumerate([]);
for (const items of [
  ["home", "rooms", "profile"],
  ["home", "timetable", "profile"],
  ["rooms", "timetable", "profile"],
  ["timetable", "rooms", "profile"],
]) {
  const normalized = nav.reconcileNavigation(base(), items);
  const slot = items.find((id) => id === "rooms" || id === "timetable");
  assert.equal(normalized.displaced[slot], "schedule");
}
assert.equal(
  nav.homeNavigationActions(
    nav.reconcileNavigation(base(), ["home", "timetable", "profile"]),
  )[2].id,
  "schedule",
);
for (const invalid of [
  null,
  [],
  ["home", "profile"],
  ["home", "home", "profile"],
  ["home", "schedule", "invalid"],
  nav.NAVIGATION_ITEMS.map((item) => item.id),
]) {
  storage.set("easy-swu:navigation:v1", { items: invalid });
  assert.deepEqual(nav.loadNavigation(), base());
}
storage.clear();
let notifications = 0;
const unsubscribe = nav.subscribeNavigation(() => notifications++);
nav.saveNavigation(settings);
assert.deepEqual(nav.loadNavigation(), settings);
assert.equal(notifications, 1);
writeFails = true;
assert.throws(() => nav.saveNavigation(base()));
assert.equal(notifications, 1);
assert.deepEqual(nav.loadNavigation(), settings);
writeFails = false;
unsubscribe();
storage.clear();

const hit = (items, id, x, y, previous = { kind: "none" }) =>
  motion.dropIntent({
    items,
    id,
    x,
    y,
    previous,
    nav: { left: 20, top: 100, width: 320, height: 80 },
    available: { left: 20, top: 220, width: 320, height: 192 },
    viewport: { left: 20, top: 220, width: 320, height: 180 },
    rowHeight: 64,
    availableCount: 3,
  });
assert.deepEqual(hit(base().items, "passrate", 220, 120), {
  kind: "insert",
  index: 2,
});
assert.deepEqual(
  hit(["home", "schedule", "timetable", "profile"], "passrate", 300, 120),
  { kind: "locked" },
);
assert.deepEqual(hit(base().items, "home", 230, 120), {
  kind: "reorder",
  index: 1,
});
assert.deepEqual(hit(base().items, "home", 210, 250), { kind: "blocked" });
assert.deepEqual(
  hit(["home", "schedule", "timetable", "profile"], "profile", 210, 250),
  { kind: "locked" },
);
assert.deepEqual(
  motion.navigationAfterDrop(base().items, "profile", {
    kind: "reorder",
    index: 0,
  }),
  ["profile", "home", "schedule"],
);
assert.deepEqual(
  motion.navigationAfterDrop(base().items, "profile", {
    kind: "remove",
    index: 2,
  }),
  base().items,
);
assert.deepEqual(
  motion.navigationAfterDrop(base().items, "rooms", {
    kind: "replace",
    index: 2,
  }),
  base().items,
);
assert(!nav.validNavigation(["home", "schedule", "rooms"]));
assert.deepEqual(hit(base().items, "passrate", -100, 120), { kind: "none" });
assert.deepEqual(
  hit(base().items, "passrate", 102, 120, { kind: "insert", index: 0 }),
  { kind: "insert", index: 0 },
  "Slot hysteresis prevents boundary jitter",
);

load("features/pages/navigation/index");
function editor() {
  const host = {
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
  host.onLoad();
  return host;
}
const page = editor();
page.onCardTap({ currentTarget: { dataset: { id: "passrate" } } });
page.replaceSelected({ currentTarget: { dataset: { id: "profile" } } });
assert.deepEqual(nav.loadNavigation(), base(), "My cannot be replaced");
page.replaceSelected({ currentTarget: { dataset: { id: "schedule" } } });
assert.equal(
  nav.homeNavigationActions()[0].id,
  "schedule",
  "Changes apply immediately",
);
page.undo();
assert.deepEqual(nav.loadNavigation(), base());
page.onCardTap({ currentTarget: { dataset: { id: "profile" } } });
page.removeSelected();
assert.deepEqual(nav.loadNavigation(), base(), "My cannot be removed");
assert(!page.data.replacementChoices.some((item) => item.id === "profile"));
page.onCardTap({ currentTarget: { dataset: { id: "passrate" } } });
page.addSelected();
assert.equal(page.data.count, 4);
assert.equal(nav.loadNavigation().items.length, 4);
writeFails = true;
page.reset();
assert.equal(page.data.count, 4);
assert.equal(nav.loadNavigation().items.length, 4);
writeFails = false;
page.reset();
assert.equal(page.data.count, 3);
page.undo();
assert.equal(page.data.count, 4);
assert.equal(nav.loadNavigation().items.length, 4);
page.onHide();
assert.equal(page.data.proxies.length, 0);
flush();
page.onUnload();
assert.equal(timers.size, 0);

// Exercise the real release loop, including its final render acknowledgement.
const realNow = Date.now;
const beforeLanding = nav.loadNavigation();
let now = 10000;
Date.now = () => now;
try {
  storage.clear();
  const landing = editor();
  const renderCallbacks = [];
  landing.setData = function (patch, callback) {
    Object.assign(this.data, patch);
    if (callback) renderCallbacks.push(callback);
  };
  const step = () => {
    now += 16;
    const frames = [...timers].filter(([, timer]) => timer.delay === 16);
    frames.forEach(([id, timer]) => {
      timers.delete(id);
      timer.callback();
    });
  };
  const release = (id, origin, toNav, cancel = false) => {
    const navRect = { left: 55, top: 100, width: 264, height: 50 };
    const listRect = { left: 18, top: 230, width: 339, height: 192 };
    const source =
      origin === "nav"
        ? { left: 150, top: 105, width: 85, height: 40 }
        : { left: 18, top: 294, width: 339, height: 56 };
    landing.createSelectorQuery = () => {
      const query = {
        select: () => query,
        boundingClientRect: () => query,
        exec: (callback) => callback([navRect, listRect, listRect, source]),
      };
      return query;
    };
    const event = (x, y) => {
      const touch = { identifier: 1, clientX: x, clientY: y };
      return {
        currentTarget: { dataset: { id, origin } },
        touches: [touch],
        changedTouches: [touch],
      };
    };
    landing.onTouchStart(event(source.left + 30, source.top + 20));
    now += 32;
    landing.onTouchMove(event(210, toNav ? 125 : 260));
    landing.updateDrag();
    if (id === "profile" && !toNav) {
      assert.equal(
        landing.data.count,
        landing.data.draftItems.length,
        "Locked My keeps its navigation slot while dragged outside",
      );
    }
    landing.drop(cancel);
    let previousShadow = 1,
      previousLanding = 0;
    while (landing.data.landingOpacity < 1) {
      step();
      const { proxies, landingOpacity } = landing.data;
      assert(
        proxies.length > 0,
        "Do not remove the proxy before the destination renders",
      );
      assert(landingOpacity >= previousLanding);
      assert(proxies[0].shadowOpacity <= previousShadow);
      assert(Math.abs(proxies[0].opacity + landingOpacity - 1) < 1e-8);
      previousShadow = proxies[0].shadowOpacity;
      previousLanding = landingOpacity;
      if (landingOpacity < 1)
        renderCallbacks.splice(0).forEach((callback) => callback());
      assert(now < 20000, "Landing must finish");
    }
    assert.equal(landing.data.proxies[0].shadowOpacity, 0);
    assert.equal(landing.data.proxies[0].capsuleOpacity, 0);
    step();
    assert(
      landing.data.proxies.length,
      "Wait for the final render acknowledgement",
    );
    renderCallbacks.splice(0).forEach((callback) => callback());
    assert(
      landing.data.proxies.length,
      "Keep the final frame until the next presentation",
    );
    step();
    assert.equal(landing.data.proxies.length, 0);
  };
  release("passrate", "available", true);
  assert(landing.data.draftItems.includes("passrate"));
  release("passrate", "nav", false);
  assert(!landing.data.draftItems.includes("passrate"));
  release("profile", "nav", false);
  assert(landing.data.draftItems.includes("profile"));
  release("rooms", "available", false, true);
  landing.onUnload();
} finally {
  Date.now = realNow;
  nav.saveNavigation(beforeLanding);
}
assert.equal(timers.size, 0);
const markup = fs.readFileSync(
  path.join(root, "features/pages/navigation/index.wxml"),
  "utf8",
);
const editorStyles = fs.readFileSync(
  path.join(root, "features/pages/navigation/index.wxss"),
  "utf8",
);
const landingTransition = editorStyles.match(
  /\.editor-card--landing\s*\{[^}]*transition:\s*([^;}]+)/,
);
assert(landingTransition, "Landing keeps its position transition");
assert(
  !/\b(opacity|all)\b/.test(landingTransition[1]),
  "Do not delay frame-driven landing opacity with another CSS transition",
);
assert(!/预览|保存设置|保留 3[–-]4/.test(markup));
assert(
  markup.includes("tabbar-material nav-track"),
  "The editor reuses the actual tabbar material",
);

async function routes() {
  const router = load("utils/tab-navigation");
  let succeeded = 0,
    failed = 0;
  const ok = () => succeeded++,
    fail = () => failed++;
  router.openNavigation("passrate", ok, fail);
  await Promise.resolve();
  assert.equal(calls.at(-1).type, "navigate");
  assert.equal(calls.at(-1).routeType, router.TAB_ROUTE_TYPE);
  const routeConfig = routeBuilders.get(router.TAB_ROUTE_TYPE)();
  assert.equal(routeConfig.transitionDuration, 0);
  assert.equal(routeConfig.reverseTransitionDuration, 0);
  assert.deepEqual(routeConfig.handlePrimaryAnimation(), { opacity: 1 });
  assert.equal(succeeded, 1);
  pages = [
    { route: "pages/home/index" },
    {
      route: "features/pages/pass-rates/index",
      options: { navigationTab: "1" },
    },
  ];
  router.openNavigation("rooms", ok, fail);
  assert.equal(calls.at(-1).type, "redirect");
  calls.at(-1).success();
  router.openNavigation("profile", ok, fail);
  assert.equal(calls.at(-1).type, "switch");
  calls.at(-1).success();
  ordinaryResult = false;
  pages = [{ route: "pages/home/index" }];
  router.openNavigation("rooms", ok, fail);
  await Promise.resolve();
  assert.equal(failed, 1);
  load("custom-tab-bar/index");
  const bar = {
    ...componentDefinition.methods,
    data: {
      ...structuredClone(componentDefinition.data),
      preview: false,
      current: "",
      previewItems: [],
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent() {},
  };
  bar.syncNavigation();
  assert.equal(bar.data.items.length, 4);
  assert.equal(bar.data.selected, 0);
  bar.selectIndex(2);
  assert.equal(bar.data.selected, 2);
  await Promise.resolve();
  assert.equal(
    bar.data.selected,
    0,
    "Failed feature-tab navigation must restore the selection",
  );
  pages = [
    {
      route: "features/pages/pass-rates/index",
      options: { navigationTab: "1" },
    },
  ];
  bar.syncNavigation();
  assert.equal(bar.data.selected, 2);
  nav.saveNavigation(
    nav.reconcileNavigation(base(), ["rooms", "schedule", "profile"]),
  );
  pages = [{ route: "pages/home/index" }];
  bar.syncNavigation();
  assert.equal(
    bar.data.selected,
    -1,
    "A removed native page must not select an unrelated tab",
  );
  bar.data.autoDismiss = true;
  bar.scheduleDismiss();
  assert.equal(
    bar.data.dismissed,
    false,
    "Show the timetable bar before its exit",
  );
  flush();
  assert.equal(bar.data.dismissed, true);
  const callCount = calls.length;
  bar.selectIndex(1);
  assert.equal(
    calls.length,
    callCount,
    "Dismissed navigation must not intercept taps",
  );
  bar.data.dismissed = false;
  bar.scheduleDismiss();
  componentDefinition.lifetimes.detached.call(bar);
  assert.equal(timers.size, 0, "Cancel pending exit on detach");
  bar.data.motionClass = "motion-reduced";
  bar.scheduleDismiss();
  assert.equal(bar.data.dismissed, true);
  assert.equal(timers.size, 0);

  ordinaryResult = true;
  pages = [{ route: "pages/home/index" }];
  for (const first of nav.NAVIGATION_ITEMS.map((item) => item.id)) {
    const items =
      first === "profile"
        ? [first, "home", "schedule"]
        : [first, first === "home" ? "schedule" : "home", "profile"];
    nav.saveNavigation(nav.reconcileNavigation(base(), items));
    router.prepareLaunchNavigation("pages/home/index", {});
    const before = calls.length;
    assert.equal(
      router.openLaunchNavigation(() => assert.fail("Startup route failed")),
      first !== "home",
    );
    await Promise.resolve();
    if (first !== "home")
      assert(calls.at(-1).url.startsWith(nav.navigationItem(first).pagePath));
    else assert.equal(calls.length, before);
    const after = calls.length;
    assert.equal(
      router.openLaunchNavigation(() => {}),
      false,
    );
    assert.equal(
      calls.length,
      after,
      "Returning to overview must not reopen the first tab",
    );
  }
  for (const [path, query] of [
    ["features/pages/inbox/index", {}],
    ["pages/home/index", { companionCode: "ABC123" }],
  ]) {
    router.prepareLaunchNavigation(path, query);
    assert.equal(
      router.openLaunchNavigation(() => {}),
      false,
      "Keep explicit entry destinations",
    );
  }
  router.prepareLaunchNavigation();
  ordinaryResult = false;
  let recovered = false;
  assert(
    router.openLaunchNavigation(() => {
      recovered = true;
    }),
  );
  await Promise.resolve();
  flush();
  assert(recovered, "Failed startup navigation restores the overview");
  assert.equal(
    router.openLaunchNavigation(() => {}),
    false,
  );

  wx.getMenuButtonBoundingClientRect = () => ({
    top: 54,
    height: 32,
    bottom: 86,
    left: 280,
  });
  load("components/navigation-bar/navigation-bar");
  const header = (insetBack) => {
    const host = {
      data: { ...componentDefinition.data, back: true, insetBack },
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
    componentDefinition.lifetimes.attached.call(host);
    return host.data;
  };
  const fullHeader = header(false),
    sheetHeader = header(true);
  assert.equal(fullHeader.backLift, 0);
  assert.equal(
    sheetHeader.controlTop +
      (sheetHeader.contentHeight - 38) / 2 -
      sheetHeader.backLift,
    14,
  );
  assert(
    sheetHeader.totalHeight < fullHeader.totalHeight,
    "Sheet headers must not retain status-bar whitespace",
  );
}
routes()
  .then(() =>
    console.log(
      `Navigation settings checks passed (${configurations} valid configurations, recovery, persistence, gestures, immediate application, routing and selection rollback).`,
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
