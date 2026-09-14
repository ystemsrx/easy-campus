const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
const dorm = read(
  "miniprogram/features/pages/auto-dorm-check-payment/index.ts",
);
const grab = read("miniprogram/features/pages/course-grab/payment.ts")
  .replace(
    /function definePaymentPage[\s\S]*?export const courseGrabPaymentPage = definePaymentPage\(/,
    "Page(",
  )
  .replace(
    '"../../services/course-grab-payment"',
    '"../../../services/auto-dorm-check"',
  )
  .replace(
    '"../../store/course-grab-payment"',
    '"../../../store/auto-dorm-check"',
  )
  .replaceAll(
    "/features/pages/course-grab-orders/index",
    "/features/pages/auto-dorm-check-orders/index",
  );
assert.equal(
  compile(grab),
  compile(dorm),
  "Payment lifecycle, cancellation, account isolation and recovery must stay identical to dorm checkout",
);
const originalStore = read("miniprogram/store/auto-dorm-check.ts");
const grabStore = read("miniprogram/features/store/course-grab-payment.ts");
const pendingFunctions = (text) =>
  compile(
    text.slice(text.indexOf("export function loadPendingAutoDormCheckPayment")),
  );
assert.equal(pendingFunctions(originalStore), pendingFunctions(grabStore));
assert.match(grabStore, /easy-swu:course-grab-payment:v1:/);
assert.match(
  read("miniprogram/features/services/course-grab-payment.ts"),
  /export \{ launchWechatPayment \} from "\.\.\/\.\.\/services\/auto-dorm-check"/,
);
const exportsObject = {};
const courseService = {};
const deletionRequests = [];
vm.runInNewContext(compile(read("miniprogram/services/course-grab.ts")), {
  exports: courseService,
  require: (name) =>
    name === "./request"
      ? {
          apiRequest: async (url, options) => {
            deletionRequests.push({ url, options });
            return {};
          },
        }
      : { captureSessionLease: () => null },
});
courseService
  .deleteCourseGrab("task-a")
  .then(() => {
    assert.equal(deletionRequests[0].options.method, "DELETE");
    assert.equal(
      JSON.stringify(deletionRequests[0].options.data),
      "{}",
      "A JSON DELETE must serialize a nonempty object body for Fastify and device signing",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
vm.runInNewContext(compile(read("miniprogram/features/utils/course-grab.ts")), {
  exports: exportsObject,
  Date,
  Intl,
  Set,
  Error,
  Math,
});
assert.deepEqual(
  Array.from(exportsObject.parseKeywords(" 英 语,，英\t语, Ａ Ｂ ")),
  ["英语", "ab"],
);
assert.throws(() => exportsObject.parseKeywords("a,b,c,d", 3));
assert.deepEqual(
  Array.from(
    exportsObject.parseKeywords(
      " 英\u200b语，体\u200c育、Ａ\u2060Ｂ､英语﹐体育︑ab ",
      3,
    ),
  ),
  ["英语", "体育", "ab"],
);
assert.deepEqual(
  Array.from(
    exportsObject.parseKeywords(
      "\u200b\u200c\u200d\u2060\ufeff\u00ad\ufe0f\u034f\u202e\u0085\u0000，､",
    ),
  ),
  [],
);
assert.deepEqual(Array.from(exportsObject.parseKeywords("ｅ\u200b\u0301")), [
  "é",
]);
assert.throws(() => exportsObject.parseKeywords("一、二､三，四", 3));
const now = new Date(2026, 8, 14, 12, 0).getTime();
assert.equal(
  exportsObject.scheduledInstant("2026-09-14", "12:01", now),
  new Date(2026, 8, 14, 12, 1).toISOString(),
);
assert.throws(() => exportsObject.scheduledInstant("2026-09-14", "12:00", now));
assert.throws(() => exportsObject.scheduledInstant("2026-09-31", "12:01", now));
const pickerAt = (date, time, hour, minute) =>
  exportsObject.timePickerState(
    date,
    time,
    new Date(2026, 8, 15, hour, minute, 30).getTime(),
  );
const midnightPicker = pickerAt("2026-09-15", "00:00", 0, 0);
assert.equal(midnightPicker.timeRange[0].length, 24);
assert.equal(midnightPicker.timeRange[0][23], "23时");
assert.equal(midnightPicker.time, "00:01");
const morningPicker = pickerAt("2026-09-15", "09:00", 0, 0);
assert.equal(morningPicker.timeRange[1].length, 60);
assert.equal(morningPicker.timeRange[1][0], "00分");
const nextDayPicker = pickerAt("2026-09-16", "00:00", 12, 34);
assert.equal(nextDayPicker.timeRange[0].length, 24);
assert.equal(nextDayPicker.timeRange[1].length, 60);
assert.equal(pickerAt("2026-09-15", "01:00", 12, 34).time, "12:35");
const rollover = pickerAt("2026-09-15", "23:59", 23, 59);
assert.equal(rollover.date, "2026-09-16");
assert.equal(rollover.time, "00:00");
for (let hour = 0; hour < 24; hour++) {
  for (const minute of [0, 29, 58, 59]) {
    const clock = new Date(2026, 8, 15, hour, minute, 30).getTime();
    const state = exportsObject.timePickerState("2026-09-15", "00:00", clock);
    for (const label of state.timeRange[0]) {
      const column = exportsObject.timePickerState(
        state.date,
        `${label.slice(0, 2)}:00`,
        clock,
      );
      const selectedHour = column.timeRange[0][column.timeIndices[0]].slice(
        0,
        2,
      );
      for (const m of column.timeRange[1]) {
        assert.ok(
          Date.parse(
            exportsObject.scheduledInstant(
              column.date,
              `${selectedHour}:${m.slice(0, 2)}`,
              clock,
            ),
          ) > clock,
        );
      }
    }
  }
}
const page = read("miniprogram/features/pages/course-grab/index.wxml");
assert.match(
  page,
  /mode="multiSelector"[^>]*range="\{\{timeRange\}\}"[^>]*value="\{\{timeIndices\}\}"/,
);
assert.doesNotMatch(page, /mode="time"|minTime/);
assert.match(page, /正向关键词/);
assert.match(page, /data-field="positive"/);
assert.match(page, /placeholder="只写课程名，例：网球, 英语"/);
assert.match(page, /课程关键词（[^）]*逗号分隔）/);
const configure = page.match(/<button[^>]*bindtap="configure"[^>]*>/)?.[0];
assert.ok(configure);
assert.doesNotMatch(configure, /remaining|reserved/);
assert.match(
  page,
  /<app-switch[^>]*data-id="\{\{item.id\}\}"[^>]*bindchange="toggle"/,
);
assert.doesNotMatch(
  page,
  /<bottom-sheet|<slot|catchtouchmove="noop"[^>]*class="grab-scroll/,
);
assert.match(
  read("miniprogram/features/pages/course-grab/index.wxss"),
  /height: calc\(104rpx \+ env\(safe-area-inset-bottom\)\)/,
);
console.log(
  "Course grab checks passed: payment parity, isolated pending orders, whitespace filters, future minutes, no-quota drafts and same-template scrolling.",
);
