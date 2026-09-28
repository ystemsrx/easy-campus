const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function clock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { timers.set(++nextId, { fn, at: now + delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}

function routeRuntime(supported = true) {
  const timer = clock();
  let options, listener, reveals = 0, failures = 0;
  const page = { route: "pages/home/index", revealAuthenticatedHome() { reveals++; } };
  const wx = { switchTab(value) { options = value; } };
  if (supported) Object.assign(wx, {
    onAppRouteDone(fn) { listener = fn; },
    offAppRouteDone(fn) { if (listener === fn) listener = undefined; },
  });
  const module = { exports: {} };
  new Function("module", "exports", "wx", "getCurrentPages", "setTimeout", "clearTimeout",
    compile(fs.readFileSync(path.join(root, "utils/login-reveal.ts"), "utf8")),
  )(module, module.exports, wx, () => [page], timer.setTimeout, timer.clearTimeout);
  return {
    ...timer, api: module.exports, page,
    begin() { module.exports.beginLoginReveal(); },
    start() { module.exports.switchToAuthenticatedHome(() => failures++); },
    success() { options.success(); }, fail() { options.fail(); },
    done(path = "pages/home/index") { listener?.({ path }); },
    reveals: () => reveals, failures: () => failures, listening: () => !!listener,
  };
}

for (const doneFirst of [false, true]) {
  const r = routeRuntime();
  r.begin();
  assert.equal(r.api.isLoginRevealPending(), true, "the tab bar must be held before home preparation starts");
  r.start();
  assert.equal(r.api.isLoginRevealPending(), true, "new home instances must know this is a login handoff");
  if (doneFirst) r.done(); else r.success();
  r.advance(300);
  assert.equal(r.reveals(), 0, "success alone or route-done alone must not start the fade");
  r.done("pages/login/index");
  assert.equal(r.reveals(), 0, "unrelated route events must be ignored");
  if (doneFirst) r.success(); else r.done();
  assert.equal(r.reveals(), 1);
  r.advance(2000);
  assert.equal(r.reveals(), 1, "watchdog must not replay the fade");
  assert.equal(r.listening(), false);
  r.api.completeLoginReveal();
  assert.equal(r.api.isLoginRevealPending(), false);
}
{
  const r = routeRuntime(false);
  r.start(); r.success(); r.advance(449);
  assert.equal(r.reveals(), 0, "legacy fallback must outlast the 300ms native reverse transition");
  r.advance(1); assert.equal(r.reveals(), 1);
}
{
  const r = routeRuntime();
  r.start(); r.success(); r.advance(449);
  assert.equal(r.reveals(), 0);
  r.advance(1); assert.equal(r.reveals(), 1, "missing native event must not leave the page invisible");
}
{
  const r = routeRuntime();
  r.start(); r.fail(); r.done(); r.advance(2000);
  assert.equal(r.reveals(), 0); assert.equal(r.failures(), 1);
  assert.equal(r.api.isLoginRevealPending(), false); assert.equal(r.listening(), false);
}

function tabBarRuntime(revealPending) {
  let definition;
  const mocked = {
    "../store/preferences": { loadPreferences: () => ({}), subscribePreferences: () => () => {} },
    "../store/session": { getSession: () => ({ token: "test" }) },
    "../utils/appearance": { resolveAppearance: () => ({}) },
    "../utils/haptics": { haptic() {} },
    "../store/navigation": {
      loadNavigation: () => ({ items: [] }), navigationItem: (item) => item,
      subscribeNavigation: () => () => {},
    },
    "../utils/tab-navigation": { openNavigation() {} },
    "../utils/login-reveal": { isLoginRevealPending: () => revealPending },
    "../utils/glass-drag": { GLASS_DRAG_DATA: {} },
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", "Component",
    compile(fs.readFileSync(path.join(root, "custom-tab-bar/index.ts"), "utf8")),
  )(module, module.exports, (request) => mocked[request], (value) => { definition = value; });
  const tabBar = {
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
    syncAppearance() {}, syncNavigation() {}, scheduleDismiss() {},
  };
  return { definition, tabBar };
}
{
  const { definition, tabBar } = tabBarRuntime(true);
  assert.equal(tabBar.data.hidden, true, "a new tab bar must not paint while login is handing off");
  assert.equal(tabBar.data.dismissed, true);
  definition.lifetimes.attached.call(tabBar);
  assert.equal(tabBar.data.dismissed, true, "attaching the tab bar must keep it below the screen");
  tabBar.setData({ dismissed: false });
  assert.equal(tabBar.data.hidden, false, "the home reveal may present the tab bar once");
}
{
  const { definition, tabBar } = tabBarRuntime(false);
  assert.equal(tabBar.data.hidden, false, "later authenticated launches keep the tab bar visible");
  definition.lifetimes.attached.call(tabBar);
  assert.equal(tabBar.data.dismissed, false);
}

// Execute the actual home transition methods with a delayed renderer and virtual clock.
const homeSource = fs.readFileSync(path.join(root, "pages/home/index.ts"), "utf8");
const ast = ts.createSourceFile("home.ts", homeSource, ts.ScriptTarget.Latest, true);
const pageCall = ast.statements.find((node) => ts.isExpressionStatement(node) &&
  ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "Page");
const names = new Set(["prepareForAuthenticatedReveal", "revealAuthenticatedHome", "beginAuthenticatedReveal", "finishAuthenticatedReveal"]);
const methods = pageCall.expression.arguments[0].properties.filter((node) => names.has(node.name?.getText(ast))).map((node) => node.getText(ast));
function homeRuntime(reduced = false) {
  const timer = clock(), commits = [];
  let completed = 0, activated = 0;
  const appearance = { motionClass: reduced ? "motion-reduced" : "motion-normal" };
  const deps = {
    getSession: () => ({ token: "test", user: { account: "test" } }),
    captureSessionLease: () => ({ account: "test" }), isSessionLeaseCurrent: () => true,
    cachedHomeRenderState: () => ({ dashboard: {}, appearance, patch: appearance }),
    syncWindowBackground() {}, navigationIndex: () => 0,
    detachCapsuleBackdrop() {}, attachCapsuleBackdrop() {},
    completeLoginReveal() { completed++; }, openLaunchNavigation: () => false,
  };
  const source = `
    let homeReady = false, homeVisible = false, authenticationRouteReady = false;
    let authenticationRevealPrepared = false, authenticationRevealCommitted = false;
    let authenticationRevealTimer, hydratedAccount, activeTimetable, hydratedHomeSources, lastHomeClockKey;
    const HOME_FIRST_FRAME_SETTLE_MS = 32;
    const { ${Object.keys(deps).join(",")} } = deps;
    const page = { ${methods.join(",\n")} };
    return { page, ready() { homeReady = true; page.beginAuthenticatedReveal(); },
      show() { homeVisible = true; page.beginAuthenticatedReveal(); } };
  `;
  const runtime = new Function("deps", "wx", "setTimeout", "clearTimeout", compile(source))(
    deps, { nextTick: (fn) => fn() }, timer.setTimeout, timer.clearTimeout,
  );
  const page = runtime.page;
  page.data = { authenticationRevealClass: "", ...appearance };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) commits.push(callback); };
  page.getTabBar = () => null;
  page.scheduleHomeActivation = () => activated++;
  return { ...runtime, ...timer, commit() { const callbacks = commits.splice(0); callbacks.forEach((fn) => fn()); }, completed: () => completed, activated: () => activated };
}
for (const reduced of [false, true]) {
  for (const order of [["show", "ready", "commit"], ["commit", "ready", "show"], ["ready", "commit", "show"]]) {
    const h = homeRuntime(reduced);
    h.page.prepareForAuthenticatedReveal();
    h.page.revealAuthenticatedHome();
    for (const step of order) {
      h.advance(100);
      assert.equal(h.page.data.authenticationRevealClass, "home-framework--awaiting-reveal",
        "content must remain hidden until route, onReady, onShow and renderer commit are all ready");
      h[step]();
    }
    h.advance(32);
    assert.equal(h.page.data.authenticationRevealClass, "home-framework--revealing");
    h.advance(1000);
    assert.equal(h.completed(), 0, "fade completion clock must wait for renderer commit");
    h.commit();
    h.advance(reduced ? 151 : 919);
    assert.equal(h.completed(), 0);
    h.advance(1);
    assert.equal(h.page.data.authenticationRevealClass, "");
    assert.equal(h.completed(), 1); assert.equal(h.activated(), 1);
  }
}
const styles = fs.readFileSync(path.join(root, "pages/home/index.wxss"), "utf8");
const loginStyles = fs.readFileSync(path.join(root, "pages/login/index.wxss"), "utf8");
const homeTemplate = fs.readFileSync(path.join(root, "pages/home/index.wxml"), "utf8");
const contentTemplate = fs.readFileSync(path.join(root, "pages/home/content.wxml"), "utf8");
assert.match(loginStyles, /page\s*\{\s*background-color:\s*#f7f5ef/);
assert.doesNotMatch(loginStyles, /login-page--leaving[^{]*\{\s*background-color:\s*transparent/);
for (const selector of [".page.login-page", ".login-page .page-scroll", ".login-stage"]) {
  const block = loginStyles.match(new RegExp(`${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] || "";
  assert.match(block, /background-color:\s*var\(--color-bg\)/,
    `${selector} must retain the theme background while the decoration fades`);
}
assert.match(loginStyles, /\.login-page--leaving \.login-background,[\s\S]*?animation-duration:\s*160ms/);
assert.doesNotMatch(homeTemplate.match(/<view class="page home-page [^"]+"/)?.[0] || "", /authenticationRevealClass/);
assert.match(homeTemplate, /class="page-scroll home-framework [^"]+\{\{authenticationRevealClass\}\}/);
for (const position of ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"]) {
  assert.match(contentTemplate, new RegExp(`home-entry--${position}`));
}
assert.match(styles, /\.home-framework--awaiting-reveal \.home-entry\s*\{[^}]*opacity:\s*0/);
assert.match(styles, /\.home-framework--revealing \.home-entry\s*\{[^}]*animation-name:\s*home-entry-in/);
assert.match(styles, /\.home-entry--second \{ animation-delay: 70ms; \}/);
assert.match(styles, /\.home-entry--seventh \{ animation-delay: 420ms; \}/);
assert.doesNotMatch(styles, /home-auth-reveal-cover/);
console.log("Login reveal route/renderer ordering and delayed-frame checks passed.");
