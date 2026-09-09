const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const loaded = new Map();
const wx = { worklet: { shared: (value) => ({ value }) } };
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file + ".ts"), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  new Function("exports", "require", "wx", code)(
    exports,
    (name) =>
      name.endsWith("schedule-render")
        ? { scheduleDayIndex: (day) => Number(day) }
        : load(
            path.posix.normalize(
              path.posix.join(path.posix.dirname(file), name),
            ),
          ),
    wx,
  );
  loaded.set(file, exports);
  return exports;
}
const rim = load("utils/capsule-rim");
for (const [w, h] of [
  [225.28, 42.67],
  [264, 50],
  [290.4, 55],
]) {
  const mask = decodeURIComponent(
    rim.capsuleRimMask(w, h).match(/svg\+xml,([^"]+)/)[1],
  );
  assert.ok(mask.includes('fill="none"'));
  const strokes = [
    ...mask.matchAll(/stroke-width="([^"]+)" stroke-opacity="([^"]+)"/g),
  ].map((m) => ({ width: Number(m[1]), opacity: Number(m[2]) }));
  assert.equal(Math.max(...strokes.map((s) => s.width)), 6);
  // Sample the actual SVG's source-over alpha, including the inner boundary.
  const alpha = (depth) =>
    strokes.reduce(
      (a, s) =>
        Math.abs(depth - 3) < s.width / 2 ? a + (1 - a) * s.opacity : a,
      0,
    );
  assert.equal(alpha(-0.01), 0);
  assert.equal(alpha(6.01), 0);
  assert.equal(alpha(h / 2), 0, "the capsule centre must remain empty");
  assert.ok(
    alpha(0.05) < 0.02 && alpha(5.95) < 0.02,
    "both seams must fade out",
  );
  assert.ok(alpha(3) > 0.95, "the middle of the thin rim retains refraction");
  assert.ok(alpha(0.5) < alpha(1.5) && alpha(1.5) < alpha(3));
  assert.ok(Math.abs(alpha(1.5) - alpha(4.5)) < 1e-9);
  assert.ok(!mask.includes("<image"));
}
assert.throws(() => rim.capsuleRimMask(20, 50));
const api = load("utils/capsule-backdrop");
const tick = () => new Promise((resolve) => setTimeout(resolve, 12));
function page(data = {}) {
  let id = 0;
  const callbacks = new Map();
  const host = {
    data: {
      liquidGlass: true,
      activeTab: "browse",
      browseScrollTop: 180,
      publishScrollTop: 60,
      ...data,
    },
    queries: 0,
    callbacks,
    setData(patch, done) {
      for (const [key, value] of Object.entries(patch)) {
        if (key === "liveGlass.mounted") this.data.liveGlass.mounted = value;
        else if (key.startsWith("dayScrollTops["))
          this.data.dayScrollTops[Number(key.match(/\d+/)[0])] = value;
        else this.data[key] = value;
      }
      done?.();
    },
    createSelectorQuery() {
      this.queries++;
      const query = {
        select() {
          return query;
        },
        fields() {
          return query;
        },
        boundingClientRect() {
          return query;
        },
        exec(callback) {
          const reply = () =>
            callback(
              host.unavailable
                ? []
                : [
                    {
                      left: 0,
                      top: 80,
                      width: 375,
                      height: 650,
                      scrollTop: host.nativeScroll ?? host._capsuleOffset.value,
                    },
                    {
                      left: 0,
                      top:
                        120 - (host.nativeScroll ?? host._capsuleOffset.value),
                      width: 375,
                      height: 3000,
                    },
                  ],
            );
          if (host.defer) host.reply = reply;
          else reply();
        },
      };
      return query;
    },
    applyAnimatedStyle(selector, callback, _options, done) {
      callbacks.set(selector, callback);
      done({ styleId: ++id });
    },
    clearAnimatedStyle(selector) {
      callbacks.delete(selector);
    },
  };
  return host;
}
async function main() {
  const host = page();
  const original = host.setData;
  api.attachCapsuleBackdrop(host, "course-assistant");
  const disconnect = api.connectCapsuleSurface("course-assistant", {
    rect: { left: 55.5, top: 674, width: 264, height: 50 },
  });
  await tick();
  assert.equal(api.capsuleBackdropMetrics("course-assistant").parts, 1);
  assert.equal(host.callbacks.size, 2);
  assert.equal(host.data.liveGlass.beforeHeight, 40);
  const scene = host.callbacks.get("#capsule-live-scene");
  function matrix() {
    return scene()
      .transform.match(/matrix\((.*)\)/)[1]
      .split(",")
      .map(Number);
  }
  const initial = matrix();
  assert.equal(initial[0], 1.06);
  assert.equal(initial[3], 1.06);
  // An independent world-coordinate check distinguishes the intended 6% scale
  // from a misplaced replica, wrong transform origin or duplicated scroll offset.
  const center = { x: 55.5 + 264 / 2, y: 674 + 50 / 2 };
  for (const p of [
    { x: center.x, y: center.y },
    { x: 100, y: 800 },
    { x: 280, y: 730 },
  ]) {
    const x = 55.5 + initial[0] * p.x + initial[4];
    const y = 674 + initial[3] * (p.y - 80 + 180) + initial[5];
    assert.ok(Math.abs(x - (center.x + (p.x - center.x) * 1.06)) < 1e-9);
    assert.ok(Math.abs(y - (center.y + (p.y - center.y) * 1.06)) < 1e-9);
  }
  const queries = host.queries;
  for (let scroll = 181; scroll <= 680; scroll++)
    host._capsuleOffset.value = scroll;
  assert.ok(Math.abs(matrix()[5] - initial[5] + 500 * 1.06) < 1e-9);
  assert.equal(
    host.queries,
    queries,
    "scrolling must not query layout or rebuild rows",
  );
  host.setData({ filterPanelHeight: 210, courses: [{ name: "Live update" }] });
  await tick();
  assert.equal(
    host.queries,
    queries,
    "ordinary data changes use the existing shared template",
  );
  host.nativeScroll = 0;
  host.setData({ activeTab: "publish", publishScrollTop: 320 });
  await tick();
  assert.equal(host._capsuleOffset.value, 320);
  delete host.nativeScroll;
  assert.equal(host.callbacks.size, 2);
  host.setData({ liquidGlass: false });
  assert.equal(host.data.liveGlass.mounted, false);
  assert.equal(host.callbacks.size, 0);
  host.setData({ liquidGlass: true });
  await tick();
  assert.equal(host.callbacks.size, 2);
  disconnect();
  assert.equal(host.data.liveGlass.mounted, false);
  api.detachCapsuleBackdrop(host);
  assert.equal(host.setData, original);
  assert.equal(api.capsuleBackdropMetrics("course-assistant"), null);

  const schedule = page({
    dayPages: [0, 1, 2, 3, 4].map((slot) => ({
      slot,
      selectedDate: String(slot),
    })),
    dayScrollTops: [0, 20, 180, 80, 0],
  });
  schedule._motion = { position: wx.worklet.shared(2) };
  api.attachCapsuleBackdrop(schedule, "schedule");
  const stopSchedule = api.connectCapsuleSurface("schedule", {
    rect: { left: 55.5, top: 674, width: 264, height: 50 },
  });
  await tick();
  assert.equal(schedule.data.liveGlass.days.length, 3);
  assert.equal(
    schedule.callbacks.size,
    5,
    "three dates remain inside one masked scene",
  );
  assert.equal(api.capsuleBackdropMetrics("schedule").parts, 1);
  schedule.setData({ "dayScrollTops[2]": 260 });
  assert.equal(
    schedule.callbacks.get("#capsule-live-day-2")().transform,
    "translate(0px,-260px)",
  );
  schedule._motion.position.value = 2.5;
  assert.equal(
    schedule.callbacks.get("#capsule-live-day-2")().transform,
    "translate(-187.5px,-260px)",
  );
  stopSchedule();
  api.detachCapsuleBackdrop(schedule);

  const late = page();
  late.defer = true;
  api.attachCapsuleBackdrop(late, "home");
  const stopLate = api.connectCapsuleSurface("home", {
    rect: { left: 55.5, top: 674, width: 264, height: 50 },
  });
  await tick();
  api.detachCapsuleBackdrop(late);
  late.reply();
  assert.equal(
    late.callbacks.size,
    0,
    "a late layout response cannot remount a hidden page",
  );
  assert.ok(!late.data.liveGlass?.mounted);
  stopLate();
  const missing = page();
  missing.unavailable = true;
  api.attachCapsuleBackdrop(missing, "profile");
  const stopMissing = api.connectCapsuleSurface("profile", {
    rect: { left: 55.5, top: 674, width: 264, height: 50 },
  });
  await tick();
  assert.equal(missing.callbacks.size, 0);
  assert.equal(api.capsuleBackdropMetrics("profile").ready, false);
  stopMissing();
  api.detachCapsuleBackdrop(missing);
  console.log(
    "Single capsule rim: mask, scroll, live data, restored offsets, lifecycle and failure fallback passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
