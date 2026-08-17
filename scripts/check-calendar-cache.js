const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadCalendarStore() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "store",
    "calendar.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const storage = new Map([
  ["easy-swu:calendar-image:2025:123", "/saved/legacy"],
]);
const savedFiles = new Set(["/saved/legacy"]);
const removedFiles = [];
let savedSequence = 0;

global.wx = {
  getStorageSync(key) {
    return storage.get(key) || "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  getStorageInfoSync() {
    return { keys: [...storage.keys()] };
  },
  getFileSystemManager() {
    return {
      access({ path: filePath, success, fail }) {
        if (savedFiles.has(filePath)) success();
        else fail();
      },
      removeSavedFile({ filePath, complete }) {
        savedFiles.delete(filePath);
        removedFiles.push(filePath);
        complete();
      },
      saveFile({ success }) {
        const savedFilePath = `/saved/${++savedSequence}`;
        savedFiles.add(savedFilePath);
        success({ savedFilePath });
      },
    };
  },
};

function calendar(startYear, version, availableYears) {
  return {
    academicYear: `${startYear}-${startYear + 1}`,
    startYear,
    availableAcademicYears: availableYears,
    availableCalendars: availableYears.map((year) => ({
      startYear: year,
      academicYear: `${year}-${year + 1}`,
    })),
    publishedAt: `${startYear}-06-01`,
    sourcePageUrl: `https://example.test/${startYear}`,
    contentType: "image/png",
    size: 100,
    version,
    imageUrl: `/calendar/${startYear}`,
  };
}

async function main() {
  const { getCachedCalendarImage } = loadCalendarStore();
  let downloads = 0;
  const download = (name) => async () => {
    downloads += 1;
    return `/tmp/${name}`;
  };

  const latest2026 = calendar(2026, "version-1", [2026, 2025]);
  const firstPath = await getCachedCalendarImage(
    latest2026,
    download("latest-1"),
  );
  assert(firstPath === "/saved/1", "最新校历应保存为唯一持久文件");
  assert(!storage.has("easy-swu:calendar-image:2025:123"), "应迁移旧缓存键");
  assert(removedFiles.includes("/saved/legacy"), "应删除旧版缓存文件");

  const cachedPath = await getCachedCalendarImage(
    latest2026,
    download("unused"),
  );
  assert(cachedPath === firstPath, "同一版本应命中本地缓存");
  assert(downloads === 1, "命中缓存时不应再次下载");

  const historicalPath = await getCachedCalendarImage(
    calendar(2025, "historical", [2026, 2025]),
    download("historical"),
  );
  assert(historicalPath === "/tmp/historical", "旧学年只应使用临时文件");
  assert(savedSequence === 1, "旧学年不应新增持久缓存");
  assert(savedFiles.has(firstPath), "查看旧学年不应清除最新校历缓存");

  const latest2027 = calendar(2027, "version-2", [2027, 2026, 2025]);
  const secondPath = await getCachedCalendarImage(
    latest2027,
    download("latest-2"),
  );
  assert(secondPath === "/saved/2", "新校历应替换旧校历缓存");
  assert(removedFiles.includes(firstPath), "发现新校历时应删除上一张");
  assert(savedFiles.size === 1 && savedFiles.has(secondPath), "本地只能保留一张");

  console.log("Calendar image cache checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
