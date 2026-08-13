const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const scenarios = {
  "Asia/Shanghai": {
    schoolTimestamp: "8月13日 06:08",
    utcTimestamp: "8月13日 09:02",
    examDate: "1月12日 周一",
    examTime: "09:00",
  },
  "America/New_York": {
    schoolTimestamp: "8月12日 18:08",
    utcTimestamp: "8月12日 21:02",
    examDate: "1月11日 周日",
    examTime: "20:00",
  },
  "Europe/London": {
    schoolTimestamp: "8月12日 23:08",
    utcTimestamp: "8月13日 02:02",
    examDate: "1月12日 周一",
    examTime: "01:00",
  },
};

function loadDateUtilities() {
  const sourcePath = path.resolve(__dirname, "..", "miniprogram", "utils", "date.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );
  return moduleRecord.exports;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

if (process.argv[2] === "child") {
  const expected = scenarios[process.env.TZ];
  const date = loadDateUtilities();
  assertEqual(
    date.formatDateTime("2026-08-13 06:08:54"),
    expected.schoolTimestamp,
    "plain school timestamp",
  );
  assertEqual(
    date.formatDateTime("2026-08-13T01:02:03.000Z"),
    expected.utcTimestamp,
    "UTC timestamp",
  );
  assertEqual(
    date.formatTimestampDate("2026-01-12T09:00:00+08:00"),
    expected.examDate,
    "exam date",
  );
  assertEqual(
    date.formatTimestampTime("2026-01-12T09:00:00+08:00"),
    expected.examTime,
    "exam time",
  );
  process.exit(0);
}

for (const zone of Object.keys(scenarios)) {
  const result = spawnSync(process.execPath, [__filename, "child"], {
    env: { ...process.env, TZ: zone },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log("User timezone conversion checks passed.");
