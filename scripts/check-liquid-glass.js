const { readSource } = require("./read-source");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const read = (file) => readSource(path.join(root, file), "utf8");

const storage = new Map();
const modules = new Map();
const app = { globalData: {} };
let systemTheme = "light";
const wx = {
  getStorageSync: (key) => structuredClone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  getWindowInfo: () => ({ windowWidth: 375 }),
  getAppBaseInfo: () => ({ theme: systemTheme }),
};
function load(file) {
  file = file.replace(/\\/g, "/").replace(/\.ts$/, "");
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const code = ts.transpileModule(read(`${file}.ts`), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function(
    "exports",
    "require",
    "wx",
    "getApp",
    "Behavior",
    "Component",
    code,
  )(
    exports,
    (name) =>
      load(
        path.posix.normalize(path.posix.join(path.posix.dirname(file), name)),
      ),
    wx,
    () => app,
    (definition) => definition,
    (definition) => {
      exports.definition = definition;
    },
  );
  return exports;
}
const { DEFAULT_PREFERENCES } = load("types/app");
const store = load("store/preferences");
const { resolveAppearance } = load("utils/appearance");
app.globalData.preferences = store.loadPreferences();
assert.equal(app.globalData.preferences.liquidGlass, false);
assert.equal(resolveAppearance().liquidGlassClass, "");
for (const value of [undefined, null, 1, "true", {}, []]) {
  storage.set("easy-swu:preferences", {
    theme: "dark",
    haptics: true,
    liquidGlass: value,
  });
  const preferences = store.loadPreferences();
  assert.equal(
    preferences.liquidGlass,
    false,
    "old/invalid preferences must stay opted out",
  );
  assert.equal(preferences.theme, "dark");
  assert.equal(preferences.haptics, true);
}
storage.clear();

function component() {
  const { definition } = load("components/app-switch/app-switch");
  const definitions = [...definition.behaviors, definition];
  const instance = { data: {}, events: [], updates: [] };
  instance.trackWidth = 104 * 0.5 * 0.82;
  instance.createSelectorQuery = () => measuredQuery(instance.trackWidth);
  instance.setData = function (patch) {
    this.updates.push(patch);
    Object.assign(this.data, structuredClone(patch));
  };
  instance.triggerEvent = function (name, detail) {
    this.events.push({ name, detail });
  };
  for (const item of definitions) {
    for (const [key, property] of Object.entries(item.properties || {}))
      instance.data[key] = property.value;
    Object.assign(instance.data, structuredClone(item.data || {}));
    Object.assign(instance, item.methods);
  }
  instance.attach = () =>
    definitions.forEach((item) => item.lifetimes?.attached?.call(instance));
  instance.detach = () =>
    definitions.forEach((item) => item.lifetimes?.detached?.call(instance));
  instance.hide = () =>
    definitions.forEach((item) => item.pageLifetimes?.hide?.call(instance));
  instance.show = () =>
    definitions.forEach((item) => item.pageLifetimes?.show?.call(instance));
  instance.attach();
  return instance;
}
function measuredQuery(width) {
  let callback;
  const query = {
    select() {
      return query;
    },
    boundingClientRect(fn) {
      callback = fn;
      return query;
    },
    exec() {
      callback({ width });
    },
  };
  return query;
}
const first = component();
const second = component();
assert.equal(first.data.liquidGlass, false);
store.updatePreferences({ liquidGlass: true });
assert.equal(
  store.loadPreferences().liquidGlass,
  true,
  "material selection persists after reload",
);
assert.equal(first.data.liquidGlass, true);
assert.equal(second.data.liquidGlass, true, "mounted controls update together");
store.updatePreferences({ theme: "system", reducedMotion: true });
systemTheme = "dark";
first.show();
assert.equal(first.data.glassThemeClass, "theme-dark");
assert.equal(first.data.glassMotionClass, "motion-reduced");
const touch = (x, y = 0, id = 1) => ({
  identifier: id,
  clientX: x,
  clientY: y,
});
const start = (control, x = 0, y = 0) =>
  control.onTouchStart({ touches: [touch(x, y)] });
const move = (control, x, y = 0) =>
  control.onTouchMove({ touches: [touch(x, y)] });
const end = (control, x = 0, y = 0) =>
  control.onTouchEnd({ changedTouches: [touch(x, y)] });
start(first);
assert.equal(first.data.pressed, true);
assert.equal(first.events.length, 0, "holding only enlarges the lens");
end(first);
assert.deepEqual(first.events, [{ name: "change", detail: { value: true } }]);
first.onTap();
assert.equal(
  first.events.length,
  1,
  "release plus synthetic tap toggles only once",
);
assert.equal(
  first.data.checked,
  false,
  "parent remains authoritative for deferred/rejected changes",
);
first.events = [];
start(first);
move(first, 30);
assert.equal(first.data.dragging, true);
assert.match(first.data.dragStyle, /translateX\(38rpx\)/);
end(first, 30);
first.onTap();
assert.deepEqual(first.events, [{ name: "change", detail: { value: true } }]);
first.data.checked = true;
first.events = [];
start(first, 30);
move(first, 0);
end(first, 0);
first.onTap();
assert.deepEqual(first.events, [{ name: "change", detail: { value: false } }]);

// Native coordinates, scaled tracks, reversals and clamping, beyond simple taps.
for (const coordinates of ["client", "page", "local"]) {
  const point = (x) => ({
    identifier: 1,
    ...(coordinates === "local"
      ? { x, y: 0 }
      : { [`${coordinates}X`]: x, [`${coordinates}Y`]: 0 }),
  });
  first.events = [];
  first.data.checked = false;
  first.onTouchStart({ touches: [point(100)] });
  first.onTouchMove({ touches: [point(108)] });
  assert.match(
    first.data.dragStyle,
    /translateX\(19\.5/,
    "thumb must track rendered pixels after the original .82 scale",
  );
  first.onTouchEnd({ changedTouches: [point(108)] });
  first.onTap();
  assert.deepEqual(first.events, [{ name: "change", detail: { value: true } }]);
}
first.data.checked = false;
first.events = [];
start(first, 100);
move(first, 200);
move(first, 102);
end(first, 102);
first.onTap();
assert.equal(
  first.events.length,
  0,
  "dragging back before release must retain the original state",
);

// Preview track colors continuously in both directions without saving mid-gesture.
const trackColor = (control) => {
  const match = control.data.dragTrackStyle.match(/rgba\(([^)]+)\)/);
  assert.ok(match, "dragging must provide a live track color");
  return match[1].split(",").map(Number);
};
for (const theme of ["theme-light", "theme-dark"]) {
  first.data.glassThemeClass = theme;
  for (const initial of [false, true]) {
    first.data.checked = initial;
    first.events = [];
    const travel = (first.trackWidth * 38) / 104;
    const position = (progress) => 100 + (progress - Number(initial)) * travel;
    start(first, 100);
    move(first, position(initial ? -1 : 2));
    assert.deepEqual(
      trackColor(first),
      initial
        ? [125, 137, 116, 0.2]
        : theme === "theme-dark"
          ? [172, 190, 151, 1]
          : [125, 143, 110, 1],
      "dragging beyond the track must clamp to the resting colors",
    );
    for (const [progress, alpha] of [
      [0.25, 0.4],
      [0.5, 0.6],
      [0.75, 0.8],
      [0.5, 0.6],
    ]) {
      move(first, position(progress));
      assert.equal(trackColor(first)[3], alpha);
      assert.equal(first.data.checked, initial);
      assert.equal(
        first.events.length,
        0,
        "color previews must not save settings",
      );
    }
    move(first, position(0.75));
    end(first, position(0.75));
    assert.equal(
      first.data.dragTrackStyle,
      "",
      "release restores parent styling",
    );
    assert.equal(
      first.data.checked,
      initial,
      "deferred changes stay controlled",
    );
    assert.deepEqual(
      first.events,
      initial ? [] : [{ name: "change", detail: { value: true } }],
    );
    first.onTap();
  }
}
first.events = [];
start(first, 30);
move(first, 20);
assert.notEqual(first.data.dragTrackStyle, "");
first.cancelGesture();
assert.equal(first.data.dragTrackStyle, "", "cancellation clears the preview");
end(first, 20);
first.onTap();
assert.equal(first.events.length, 0);

for (const cancel of [
  (control) => control.cancelGesture(),
  (control) => move(control, 2, 40),
  (control) => control.onTouchMove({ touches: [touch(1), touch(2, 0, 2)] }),
  (control) => control.hide(),
  (control) => {
    control.data.disabled = true;
    control.cancelGesture();
  },
]) {
  first.data.disabled = false;
  first.data.checked = false;
  first.events = [];
  start(first);
  cancel(first);
  end(first, 30);
  first.onTap();
  assert.equal(
    first.events.length,
    0,
    "cancel/scroll/multitouch/hide/disable must not save a setting",
  );
  assert.equal(first.data.pressed, false);
}
first.events = [];
start(first);
first.onTap();
assert.equal(
  first.events.length,
  0,
  "disabled controls ignore touch and accessibility activation",
);
first.data.disabled = false;
first.onTap();
assert.equal(
  first.events.length,
  1,
  "accessibility activation works without touch events",
);

store.updatePreferences({ liquidGlass: false });
assert.equal(first.data.liquidGlass, false);
assert.equal(second.data.liquidGlassClass, "");
first.events = [];
first.onNativeChange({ detail: { value: true } });
assert.deepEqual(first.events, [{ name: "change", detail: { value: true } }]);
first.detach();
const updateCount = first.updates.length;
store.updatePreferences({ liquidGlass: true });
assert.equal(
  first.updates.length,
  updateCount,
  "detached controls unsubscribe from preferences",
);
assert.equal(second.data.liquidGlass, true);
second.detach();

const drag = load("utils/glass-drag");
const navigationCalls = [];
wx.switchTab = (options) => navigationCalls.push(options);
wx.showToast = () => {};
function selectorController(file, width) {
  let definition;
  const dependencies = {
    "utils/glass-drag": drag,
    "store/preferences": store,
    "store/session": { getSession: () => ({ token: "test" }) },
    "utils/appearance": { resolveAppearance, syncWindowBackground() {} },
    "utils/haptics": { haptic() {} },
    "utils/capsule-backdrop": {
      detachCapsuleBackdrop() {},
      invalidateCapsuleBackdrop() {},
    },
  };
  const register = (value) => {
    definition = value;
  };
  const code = ts.transpileModule(read(`${file}.ts`), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function("exports", "require", "Page", "Component", "wx", code)(
    {},
    (name) =>
      dependencies[
        path.posix.normalize(path.posix.join(path.posix.dirname(file), name))
      ] || {},
    register,
    register,
    wx,
  );
  return {
    ...definition,
    ...definition.methods,
    data: { ...structuredClone(definition.data), liquidGlass: true },
    createSelectorQuery: () => measuredQuery(width),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
}
const selectorStart = (host, x = 20) =>
  host.onSelectorTouchStart({ touches: [touch(x)] });
const selectorMove = (host, x, y = 0) =>
  host.onSelectorTouchMove({ touches: [touch(x, y)] });
const selectorEnd = (host, x) =>
  host.onSelectorTouchEnd({ changedTouches: [touch(x)] });

// Exercise the real three controller handlers; commit only after releasing.
const tabbar = selectorController("custom-tab-bar/index", 264);
selectorStart(tabbar);
selectorMove(tabbar, 190);
assert.equal(tabbar.data.selected, 0);
assert.equal(tabbar.data.selectorDragIndex, 2);
assert.equal(navigationCalls.length, 0);
selectorEnd(tabbar, 190);
assert.equal(tabbar.data.selected, 2);
assert.equal(navigationCalls.length, 1);
assert.equal(navigationCalls[0].url, "/pages/profile/index");
tabbar.onSelect({ currentTarget: { dataset: { index: 0 } } });
assert.equal(
  navigationCalls.length,
  1,
  "synthetic tap from the original tab must not undo the drag",
);
navigationCalls[0].fail();
assert.equal(
  tabbar.data.selected,
  0,
  "failed navigation restores the actual tab",
);
selectorStart(tabbar);
selectorMove(tabbar, 200);
tabbar.setSelected(1);
selectorEnd(tabbar, 200);
assert.equal(
  tabbar.data.selected,
  1,
  "platform page changes invalidate a pending drag",
);
assert.equal(navigationCalls.length, 1);

// Cached primary-tab bars must follow settings changed on another page.
const cachedTabbars = [0, 1, 2].map((selected) => {
  const host = selectorController("custom-tab-bar/index", 264);
  host.lifetimes.attached.call(host);
  host.setData({ selected, hidden: selected === 2 });
  host.pageLifetimes.hide.call(host);
  return host;
});
selectorStart(cachedTabbars[0]);
selectorMove(cachedTabbars[0], 190);
assert.equal(cachedTabbars[0].data.selectorDragging, true);
store.updatePreferences({ liquidGlass: false });
for (const [selected, host] of cachedTabbars.entries()) {
  assert.equal(
    host.data.liquidGlass,
    false,
    "disabling glass must also disable the retained tab bar's refraction anchor",
  );
  assert.equal(host.data.liquidGlassClass, "", "restore the normal material");
  assert.equal(host.data.selected, selected, "preserve the active page");
  assert.equal(host.data.hidden, selected === 2, "preserve drawer visibility");
}
assert.equal(cachedTabbars[0].data.selectorDragging, false);
assert.equal(cachedTabbars[0].data.selectorDragStyle, "");
selectorEnd(cachedTabbars[0], 190);
assert.equal(
  navigationCalls.length,
  1,
  "material changes cancel pending drags",
);
store.updatePreferences({ liquidGlass: true });
for (const host of cachedTabbars) {
  assert.equal(host.data.liquidGlass, true, "cached tab bars can enable again");
  assert.equal(host.data.liquidGlassClass, "liquid-glass");
}
// Returning also refreshes from persisted preferences and the current system theme.
const persistedPreferences = store.loadPreferences();
storage.set("easy-swu:preferences", {
  ...persistedPreferences,
  liquidGlass: false,
});
systemTheme = "light";
for (const host of cachedTabbars) {
  host.pageLifetimes.show.call(host);
  assert.equal(host.data.liquidGlass, false);
  assert.equal(host.data.liquidGlassClass, "");
  assert.equal(host.data.themeClass, "theme-light");
  host.lifetimes.detached.call(host);
}
store.updatePreferences({ liquidGlass: true });
for (const host of cachedTabbars) {
  assert.equal(host.data.liquidGlass, false, "detached tab bars stop updating");
}
systemTheme = "dark";

const inbox = selectorController("features/pages/inbox/index", 288);
const inboxLoads = [];
inbox.loadActiveTab = (index) => inboxLoads.push(index);
selectorStart(inbox);
selectorMove(inbox, 220);
assert.equal(inbox.data.activeTab, 0);
selectorEnd(inbox, 220);
assert.equal(inbox.data.activeTab, 1);
assert.deepEqual(inboxLoads, [1]);
inbox.onTabTap({ currentTarget: { dataset: { index: 0 } } });
assert.deepEqual(inboxLoads, [1]);
selectorStart(inbox, 220);
selectorMove(inbox, 20);
selectorEnd(inbox, 20);
assert.deepEqual(inboxLoads, [1, 0]);

const courseAssistant = selectorController(
  "features/pages/course-assistant/index",
  238,
);
let catalogRestores = 0;
courseAssistant.restoreCatalogCache = () => {
  catalogRestores += 1;
  return true;
};
courseAssistant.data.selectedKeyword = "讲得好";
courseAssistant.data.filterOpen = true;
courseAssistant.data.filterPanelHeight = 160;
selectorStart(courseAssistant);
selectorMove(courseAssistant, 200);
assert.equal(courseAssistant.data.courseType, "general_elective");
assert.equal(
  catalogRestores,
  0,
  "dragging previews the type without fetching courses",
);
selectorEnd(courseAssistant, 200);
assert.equal(courseAssistant.data.courseType, "physical_education");
assert.equal(catalogRestores, 1);
assert.equal(courseAssistant.data.selectedKeyword, "");
assert.equal(courseAssistant.data.filterOpen, false);
assert.equal(courseAssistant.data.filterPanelHeight, 0);
courseAssistant.selectCourseType({
  currentTarget: { dataset: { type: "general_elective" } },
});
assert.equal(
  catalogRestores,
  1,
  "the release tap cannot undo the new course type",
);
selectorStart(courseAssistant, 200);
selectorMove(courseAssistant, 20);
selectorEnd(courseAssistant, 20);
assert.equal(courseAssistant.data.courseType, "general_elective");
assert.equal(catalogRestores, 2);
selectorStart(courseAssistant);
selectorMove(courseAssistant, 200);
courseAssistant.onHide();
selectorEnd(courseAssistant, 200);
assert.equal(courseAssistant.data.courseType, "general_elective");
assert.equal(
  catalogRestores,
  2,
  "hiding the page must cancel the pending type selection",
);

const bottomStart = (host, x = 20) =>
  host.onBottomSelectorTouchStart({ touches: [touch(x)] });
const bottomMove = (host, x, y = 0) =>
  host.onBottomSelectorTouchMove({ touches: [touch(x, y)] });
const bottomEnd = (host, x) =>
  host.onBottomSelectorTouchEnd({ changedTouches: [touch(x)] });
const bottomTap = (host, tab) =>
  host.onBottomTabTap({ currentTarget: { dataset: { tab } } });

for (const glass of [false, true]) {
  const assistant = selectorController(
    "features/pages/course-assistant/index",
    225,
  );
  assistant.data.liquidGlass = glass;
  assistant.updateFilterPanelHeight = () => {};
  let mineLoads = 0;
  assistant.loadMine = () => {
    mineLoads += 1;
  };
  assistant.onCourseScroll({
    currentTarget: { dataset: { tab: "browse" } },
    detail: { scrollTop: 845 },
  });
  bottomStart(assistant);
  bottomMove(assistant, 145);
  assert.equal(assistant.data.activeTab, "browse");
  assert.equal(
    mineLoads,
    0,
    "bottom dragging must not load or navigate before release",
  );
  assert.equal(assistant.data.bottomSelector.selectorDragIndex, 1);
  assert.equal(
    assistant.data.selectorDragging,
    false,
    "the top selector must stay still",
  );
  bottomEnd(assistant, 145);
  assert.equal(assistant.data.activeTab, "publish");
  assert.equal(mineLoads, 1);
  bottomTap(assistant, "browse");
  assert.equal(
    assistant.data.activeTab,
    "publish",
    "release tap must not undo bottom navigation",
  );
  assistant.onCourseScroll({
    currentTarget: { dataset: { tab: "publish" } },
    detail: { scrollTop: 123 },
  });
  bottomStart(assistant, 180);
  bottomMove(assistant, 20);
  bottomEnd(assistant, 20);
  assert.equal(assistant.data.activeTab, "browse");
  assert.equal(assistant.data.browseScrollTop, 845);
  assert.equal(assistant.data.publishScrollTop, 123);

  for (const cancel of [
    (host) => host.onBottomSelectorTouchCancel(),
    (host) => host.onHide(),
    (host) => host.onResize(),
    (host) =>
      host.onBottomSelectorTouchMove({
        touches: [touch(100), touch(200, 0, 2)],
      }),
    (host) => selectorStart(host),
  ]) {
    bottomStart(assistant);
    bottomMove(assistant, 160);
    cancel(assistant);
    bottomEnd(assistant, 160);
    assert.equal(assistant.data.activeTab, "browse");
    assert.equal(assistant.data.bottomSelector.selectorDragging, false);
  }
  bottomStart(assistant);
  bottomMove(assistant, 21, 50);
  bottomEnd(assistant, 160);
  assert.equal(
    assistant.data.activeTab,
    "browse",
    "vertical gestures do not select a tab",
  );
  // A fresh tap still works after cancellation and a separate programmatic link.
  bottomStart(assistant, 180);
  bottomEnd(assistant, 180);
  bottomTap(assistant, "publish");
  assert.equal(assistant.data.activeTab, "publish");
  bottomStart(assistant, 180);
  bottomMove(assistant, 20);
  assistant.onBottomSelectorTouchCancel();
  assistant.switchTab({ currentTarget: { dataset: { tab: "browse" } } });
  assert.equal(assistant.data.activeTab, "browse");
}

store.updatePreferences({ theme: "light", liquidGlass: true });
const appearance = selectorController(
  "features/pages/personalization/index",
  270,
);
selectorStart(appearance);
selectorMove(appearance, 115);
assert.equal(store.loadPreferences().theme, "light");
selectorEnd(appearance, 115);
assert.equal(store.loadPreferences().theme, "dark");
appearance.selectTheme({ currentTarget: { dataset: { value: "light" } } });
assert.equal(store.loadPreferences().theme, "dark");
for (const cancel of [
  (host) => host.onSelectorTouchCancel(),
  (host) => selectorMove(host, 21, 50),
  (host) =>
    host.onSelectorTouchMove({ touches: [touch(100), touch(200, 0, 2)] }),
  (host) => host.onHide(),
]) {
  selectorStart(appearance);
  cancel(appearance);
  selectorEnd(appearance, 250);
  assert.equal(store.loadPreferences().theme, "dark");
  assert.equal(appearance.data.selectorDragging, false);
}
appearance.data.liquidGlass = false;
selectorStart(appearance);
selectorMove(appearance, 260);
selectorEnd(appearance, 260);
assert.equal(
  store.loadPreferences().theme,
  "dark",
  "disabled material preserves ordinary tap selection",
);

// Narrow tracks and late layout measurements must not leave a stale drag behind.
const narrow = selectorController("features/pages/personalization/index", 240);
let measure;
narrow.createSelectorQuery = () => ({
  select() {
    return this;
  },
  boundingClientRect(fn) {
    measure = fn;
    return this;
  },
  exec() {},
});
selectorStart(narrow);
selectorMove(narrow, 100);
narrow.onSelectorTouchCancel();
measure({ width: 240 });
assert.equal(narrow.data.selectorDragging, false);

const config = JSON.parse(read("app.json"));
const pages = [
  ...config.pages,
  ...config.subPackages.flatMap((pack) =>
    pack.pages.map((page) => `${pack.root}/${page}`),
  ),
];
for (const page of pages) {
  const source = read(`${page}.wxml`);
  assert.ok(
    source.includes("{{liquidGlassClass}}"),
    `${page} must apply the global material`,
  );
  assert.ok(!/<switch\b/.test(source), `${page} must use the shared switch`);
}
const template = read("components/app-switch/app-switch.wxml");
assert.match(template, /<switch wx:if="\{\{!liquidGlass\}\}"/);
assert.match(
  template,
  /class="glass-switch-track" style="\{\{dragTrackStyle\}\}"/,
);
assert.ok(
  template.includes('catchtouchmove="onTouchMove"'),
  "the glass switch must own its drag instead of losing it to the parent scroll-view",
);
assert.ok(template.includes('aria-disabled="{{disabled}}"'));
const styles = read("styles/liquid-glass.wxss");
for (const excluded of [
  "side-action",
  "section-action",
  "publication-bell",
  "filter-button",
  "message-type-option",
  "course-sort-trigger",
  "course-sort-option",
]) {
  assert.ok(
    !styles.includes(`.liquid-glass .${excluded}`),
    `${excluded} must retain its original style`,
  );
}
assert.match(styles, /\.header-week text\s*\{\s*color: #ffffff !important/);
assert.match(
  styles,
  /\.week-option--active \.week-option-date\s*\{\s*color: #9f9a90 !important/,
);
for (const name of [
  "tabbar-indicator",
  "week-selection-circle",
  "appearance-indicator",
  "segment-indicator",
  "campus-indicator",
  "quick-date-indicator",
]) {
  assert.ok(
    styles.includes(`.liquid-glass .${name}`),
    `${name} must receive the material`,
  );
}
assert.ok(
  read("components/app-switch/app-switch.wxss").includes(
    ".motion-reduced.glass-switch--pressed",
  ),
);
const switchStyles = read("components/app-switch/app-switch.wxss");
assert.match(
  switchStyles,
  /\.glass-switch--dragging \.glass-switch-track\s*\{\s*transition-duration: 0ms/,
  "track color follows the finger without restarting a transition on every move",
);
assert.match(
  switchStyles,
  /\.glass-switch-spinner\s*\{[^}]*animation-name:\s*glass-switch-spin/,
);
assert.match(
  switchStyles,
  /@keyframes glass-switch-spin\s*\{[^}]*rotate\(360deg\)/,
);
assert.match(
  switchStyles,
  /\.motion-reduced \.glass-switch-spinner\s*\{[^}]*animation-name:\s*none/,
);
assert.match(
  read("features/pages/personalization/index.wxml"),
  /<scroll-view[^>]*scroll-y/,
);
assert.match(
  read("features/pages/personalization/index.wxss"),
  /personalization-bottom-space[^}]*safe-area-inset-bottom/,
);
console.log(
  "Liquid glass checks passed: migration, persistence, mounted controls, dark/reduced motion, press/drag, cancellation, disabled state, native fallback and all page/selector coverage.",
);
