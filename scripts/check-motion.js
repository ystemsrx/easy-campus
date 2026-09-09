const { readSource } = require("./read-source");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const read = (file) => readSource(path.join(root, file), "utf8");

// Render commits, nextTick and timers are separate queues. These tests validate
// ordering and cancellation, not Skyline frame rate or hit testing on a device.
function runtime() {
  let now = 0;
  const renders = [],
    ticks = [],
    timers = [],
    navigations = [],
    notices = [];
  const modules = new Map();
  const preferences = {
    theme: "light",
    visualTheme: "default",
    reducedMotion: false,
  };
  const wx = {
    nextTick: (fn) => ticks.push(fn),
    getWindowInfo: () => ({ windowWidth: 320, windowHeight: 568 }),
    switchTab: (args) => navigations.push(args),
    showToast: (args) => notices.push(args),
  };
  const setTimer = (fn, delay) => {
    const timer = { fn, at: now + delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cancelled = true;
  };
  function render() {
    while (renders.length || ticks.length) {
      while (renders.length) renders.shift()();
      while (ticks.length) ticks.shift()();
    }
  }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = timers
        .filter((t) => !t.cancelled && t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.cancelled = true;
      next.fn();
      render();
    }
    now = end;
  }
  function load(relative) {
    relative = relative.replace(/\\/g, "/").replace(/\.ts$/, "");
    if (relative === "utils/haptics") return { haptic() {} };
    if (relative === "store/preferences")
      return { loadPreferences: () => preferences };
    if (relative === "store/session")
      return { getSession: () => ({ token: "test" }) };
    if (modules.has(relative)) return modules.get(relative);
    const exports = {};
    modules.set(relative, exports);
    const code = ts.transpileModule(read(relative + ".ts"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    new Function(
      "exports",
      "require",
      "Component",
      "wx",
      "getApp",
      "setTimeout",
      "clearTimeout",
      code,
    )(
      exports,
      (name) =>
        load(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(relative), name),
          ),
        ),
      (definition) => {
        exports.definition = definition;
      },
      wx,
      () => ({ globalData: { preferences } }),
      setTimer,
      clearTimer,
    );
    return exports;
  }
  function host(data = {}) {
    return {
      data,
      updates: [],
      setData(patch, callback) {
        this.updates.push(structuredClone(patch));
        Object.assign(this.data, structuredClone(patch));
        if (callback) renders.push(callback);
      },
    };
  }
  function component(file) {
    const { definition } = load(file);
    const data = Object.fromEntries(
      Object.entries(definition.properties || {}).map(([key, value]) => [
        key,
        value.value,
      ]),
    );
    Object.assign(data, structuredClone(definition.data));
    const instance = Object.assign(host(data), definition.methods);
    instance.events = [];
    instance.triggerEvent = (...args) => instance.events.push(args);
    instance.detach = () => definition.lifetimes?.detached?.call(instance);
    instance.hide = () => definition.pageLifetimes?.hide?.call(instance);
    return instance;
  }
  return {
    load,
    host,
    component,
    render,
    advance,
    timers,
    renders,
    ticks,
    navigations,
    notices,
    setTimer,
    clearTimer,
  };
}

const rt = runtime();
const { setPresence, cancelPresence, MOTION } = rt.load("utils/motion");
const sheet = rt.component("components/bottom-sheet/bottom-sheet");
function visibility(value) {
  sheet.data.visible = value;
  sheet.syncVisibility(value);
}
visibility(true);
assert.equal(sheet.data.mounted, true);
assert.equal(sheet.data.active, false, "closed state must commit before entry");
visibility(false);
rt.render();
assert.equal(
  sheet.data.active,
  false,
  "closing before first render must cancel reveal",
);
rt.advance(MOTION.sheetExit);
assert.equal(sheet.data.mounted, false);
visibility(true);
rt.render();
visibility(false);
rt.render();
const staleExit = rt.timers.at(-1);
rt.advance(80);
visibility(true);
staleExit.fn();
rt.render();
assert.equal(
  sheet.data.mounted,
  true,
  "a stale exit cannot remove a reopened drawer",
);
assert.equal(sheet.data.active, true);
sheet.data.reducedMotion = true;
visibility(false);
rt.render();
rt.advance(MOTION.fade - 1);
assert.equal(sheet.data.mounted, true);
rt.advance(1);
assert.equal(sheet.data.mounted, false);
visibility(true);
sheet.detach();
const updates = sheet.updates.length;
rt.render();
rt.advance(1000);
assert.equal(
  sheet.updates.length,
  updates,
  "detached components reject pending render callbacks",
);
const independent = rt.host({
  mounted: false,
  active: false,
  secondMounted: false,
  secondActive: false,
});
setPresence(independent, true);
setPresence(independent, true, {
  mounted: "secondMounted",
  active: "secondActive",
});
cancelPresence(independent, "mounted");
rt.render();
assert.equal(independent.data.active, false);
assert.equal(independent.data.secondActive, true);

const menu = rt.component("components/grade-sort-filter/grade-sort-filter");
menu.toggle({ bottom: 55, right: 300 });
rt.render();
menu.select({ currentTarget: { dataset: { value: "score-desc" } } });
assert.deepEqual(
  menu.events,
  [["change", { value: "score-desc" }]],
  "selection applies before visual exit finishes",
);
assert.equal(menu.data.mounted, true);
assert.equal(menu.data.visible, false);
menu.toggle({ bottom: 55, right: 300 });
rt.render();
rt.advance(300);
assert.equal(menu.data.active, true);
menu.hide();
rt.render();
assert.equal(menu.data.mounted, false);

const statistics = rt.component("components/pass-rate-card/pass-rate-card");
statistics.data.statistics = {
  passRate: 75,
  totalCount: 100,
  passedCount: 75,
  failedCount: 25,
  distribution: [{ band: "70–79", count: 100 }],
  scores: [{ score: 75, count: 100 }],
};
statistics.refreshStatistics();
assert.ok(
  decodeURIComponent(statistics.data.passRingSource).includes('dur=".24s"'),
);
statistics.data.reducedMotion = true;
statistics.refreshStatistics();
assert.ok(
  !decodeURIComponent(statistics.data.passRingSource).includes("<animate"),
);
assert.equal(statistics.data.passedLabel, "75 人");

for (const file of ["rate-limit-toast", "refresh-confirmation"]) {
  const toast = rt.component(`components/${file}/${file}`);
  toast.show("first");
  assert.equal(toast.data.visible, false);
  rt.render();
  assert.equal(toast.data.visible, true);
  rt.advance(3000);
  assert.equal(toast.data.visible, false);
  toast.show("second");
  rt.render();
  rt.advance(160);
  assert.equal(toast.data.mounted, true);
  assert.equal(toast.data.message, "second");
  rt.advance(2840);
  rt.advance(160);
  assert.equal(toast.data.mounted, false);
  toast.show();
  toast.detach();
  const count = toast.updates.length;
  rt.render();
  rt.advance(5000);
  assert.equal(toast.updates.length, count);
}

const tabs = rt.component("custom-tab-bar/index");
const tap = (index) => tabs.onSelect({ currentTarget: { dataset: { index } } });
tap(1);
tap(1);
assert.equal(
  rt.navigations.length,
  1,
  "pending navigation must not be duplicated",
);
assert.equal(tabs.data.selected, 1);
rt.navigations[0].fail();
assert.equal(tabs.data.selected, 0);
tap(2);
tabs.setSelected(1);
rt.navigations[1].fail();
assert.equal(
  tabs.data.selected,
  1,
  "an old failure must not override the visible page",
);
tap(2);
rt.navigations[2].success();
assert.equal(tabs.data.selected, 2);

// Execute the actual home completion methods with isolated schedule storage.
const homeSource = read("pages/home/index.ts");
const ast = ts.createSourceFile(
  "home.ts",
  homeSource,
  ts.ScriptTarget.Latest,
  true,
);
const declarations = ast.statements.filter(
  (node) =>
    (ts.isFunctionDeclaration(node) &&
      node.name?.text === "clearPlanTransitionTimers") ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((declaration) =>
        [
          "PLAN_COMPLETION_ACK_MS",
          "PLAN_REMOVAL_TRANSITION_MS",
          "planCompletionTimers",
        ].includes(declaration.name.getText(ast)),
      )),
);
const page = ast.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "Page",
).expression.arguments[0];
const methods = page.properties.filter((node) =>
  ["completePlan", "settlePlanTransition"].includes(node.name?.getText(ast)),
);
const homeCode = ts.transpileModule(
  declarations.map((node) => node.getText(ast)).join("\n") +
    "\nreturn {" +
    methods.map((node) => node.getText(ast)).join(",") +
    "};",
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;
let plans = ["a", "b", "c", "d"].map((id) => ({ id, done: false }));
let uploads = 0;
const previews = () => plans.filter((plan) => !plan.done).slice(0, 2);
const home = Object.assign(
  rt.host({
    plans: previews(),
    planCompletion: {},
    motionClass: "motion-normal",
  }),
  new Function(
    "captureSessionLease",
    "isSessionLeaseCurrent",
    "loadScheduleData",
    "saveScheduleData",
    "loadPlanPreviews",
    "planCardHeight",
    "markHomeSourcesHydrated",
    "putLocalSchedule",
    "haptic",
    "homeVisible",
    "getSession",
    "planPreviewPatch",
    "setTimeout",
    "clearTimeout",
    homeCode,
  )(
    () => ({ account: "a" }),
    () => true,
    () => ({ plans }),
    (_account, next) => {
      plans = next;
      return { plans };
    },
    previews,
    (count) => count * 104,
    () => {},
    async () => {
      uploads++;
    },
    () => {},
    true,
    () => ({ user: { account: "a" } }),
    () => ({ plans: previews() }),
    rt.setTimer,
    rt.clearTimer,
  ),
);
const complete = (id) =>
  home.completePlan({ currentTarget: { dataset: { id } } });
complete("a");
complete("b");
complete("a");
assert.equal(uploads, 2);
assert.equal(
  plans.filter((plan) => plan.done).length,
  2,
  "two distinct rows can complete before either animation ends",
);
rt.render();
rt.advance(100);
assert.equal(home.data.planCompletion.a, "leaving");
assert.equal(home.data.planCompletion.b, "leaving");
rt.advance(160);
assert.deepEqual(
  home.data.plans.map((plan) => plan.id),
  ["c", "d"],
);
assert.deepEqual(home.data.planCompletion, {});
complete("c");
home.settlePlanTransition();
rt.render();
rt.advance(1000);
assert.deepEqual(
  home.data.plans.map((plan) => plan.id),
  ["d"],
  "hide settles saved state and cancels callbacks",
);
home.data.motionClass = "motion-reduced";
complete("d");
assert.deepEqual(home.data.plans, []);

const motionCss = read("motion.wxss");
assert.ok(motionCss.includes(`transform ${MOTION.sheetExit}ms`));
assert.ok(motionCss.includes(`transition-duration: ${MOTION.sheetEnter}ms`));
assert.ok(motionCss.includes(`opacity ${MOTION.fade}ms`));
assert.ok(motionCss.includes(".motion-layer { pointer-events: none; }"));
assert.ok(
  motionCss.includes(".motion-layer--active { pointer-events: auto; }"),
);
const config = JSON.parse(read("app.json"));
const pages = [
  ...config.pages,
  ...config.subPackages.flatMap((group) =>
    group.pages.map((page) => group.root + "/" + page),
  ),
];
for (const page of pages) {
  const template = read(page + ".wxml");
  for (const tag of template.match(
    /<(?:bottom-sheet|rate-limit-toast|grade-sort-filter|loading-view|pass-rate-card)\b[^>]*>/g,
  ) || []) {
    assert.ok(
      tag.includes("reduced-motion="),
      `${page}: component needs an explicit motion preference`,
    );
  }
  assert.ok(
    !template.includes("stagger-item"),
    `${page}: no repeated row entrance`,
  );
}
for (const page of ["inbox", "timetable"]) {
  assert.ok(
    read(`features/pages/${page}/index.wxml`).includes(
      "motionClass === 'motion-reduced' ? 0 : 240",
    ),
  );
}
assert.ok(!read("app.wxss").includes("animation-name: blob-drift"));
assert.ok(!read("pages/home/index.wxml").includes("page-enter"));
console.log(
  "Motion lifecycle, feedback, navigation, concurrent completion and preference checks passed.",
);
