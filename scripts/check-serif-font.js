const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const fontModule = fs.readFileSync(
  path.join(root, "miniprogram/utils/serif-font.ts"),
  "utf8",
);
const appModule = fs.readFileSync(
  path.join(root, "miniprogram/app.ts"),
  "utf8",
);
const compiled = ts.transpileModule(fontModule, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const apiBase = "https://easy-api.lazycampus.com/api/v1/";
const manifestUrl = `${apiBase}assets/fonts/serif-font-manifest`;
const fontUrl = `${apiBase}assets/fonts/source-han-serif-cn-semibold-v2.woff`;
const cachePath = "wxfile://user/easy-swu-serif.woff";
const stagingPath = "wxfile://user/easy-swu-serif.download.woff";
const backupPath = "wxfile://user/easy-swu-serif.backup.woff";
const legacyCachePath = "wxfile://user/easy-swu-serif-v3.woff";
const storageKey = "easy-swu:serif-font-manifest:v1";
const manifest = Object.freeze({
  version: "2",
  sha256: "dae545de9f93ebc14fce6d28ba8531609208fbcd789be3e2631414c9cf017f44",
  size: 2371652,
  path: "assets/fonts/source-han-serif-cn-semibold-v2.woff",
});

function fontBytes(size = manifest.size) {
  const data = new ArrayBuffer(size);
  if (size >= 4) new Uint8Array(data).set([119, 79, 70, 70]);
  return data;
}

function harness({
  files = new Map(),
  storage = new Map(),
  digest = manifest.sha256,
} = {}) {
  const requests = [];
  const registrations = [];
  const warnings = [];
  const exports = {};
  const fileSystem = {
    readFileSync(filePath) {
      if (!files.has(filePath)) throw new Error("not found");
      return files.get(filePath);
    },
    writeFileSync(filePath, data) {
      files.set(filePath, data);
    },
    unlinkSync(filePath) {
      files.delete(filePath);
    },
    renameSync(oldPath, newPath) {
      if (!files.has(oldPath)) throw new Error("not found");
      files.set(newPath, files.get(oldPath));
      files.delete(oldPath);
    },
    getFileInfo(options) {
      if (!files.has(options.filePath)) {
        options.fail({ errMsg: "not found" });
        return;
      }
      assert.equal(options.digestAlgorithm, "sha256");
      options.success({
        size: files.get(options.filePath).byteLength,
        digest,
      });
    },
  };
  const context = {
    ArrayBuffer,
    Date,
    Number,
    Uint8Array,
    exports,
    console: {
      warn(...args) {
        warnings.push(args);
      },
    },
    require(name) {
      assert.equal(name, "../config/index");
      return { getApiUrl: (value) => `${apiBase}${value}` };
    },
    wx: {
      env: { USER_DATA_PATH: "wxfile://user" },
      getFileSystemManager() {
        return fileSystem;
      },
      getStorageSync(key) {
        return storage.get(key);
      },
      setStorageSync(key, value) {
        storage.set(key, value);
      },
      request(options) {
        requests.push(options);
      },
      loadFontFace(options) {
        registrations.push(options);
      },
      arrayBufferToBase64() {
        return "AAECAw==";
      },
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    ensure: exports.ensureSerifFontLoaded,
    prime: exports.primeSerifFontFromCache,
    files,
    storage,
    requests,
    registrations,
    warnings,
  };
}

function respondWithManifest(runtime, value = manifest) {
  runtime.requests[0].success({
    statusCode: 200,
    data: { success: true, data: value },
  });
}

{
  const first = harness();
  first.prime();
  assert.equal(first.requests.length, 0, "startup first checks local cache");
  first.ensure();
  first.ensure();
  assert.equal(first.requests.length, 1, "manifest requests are deduplicated");
  assert.equal(first.requests[0].url, manifestUrl);
  assert.equal(first.requests[0].responseType, undefined);
  respondWithManifest(first);
  assert.equal(first.requests.length, 2);
  assert.equal(first.requests[1].url, fontUrl);
  assert.equal(first.requests[1].responseType, "arraybuffer");
  first.requests[1].success({ statusCode: 200, data: fontBytes() });
  assert.equal(first.registrations.length, 1);
  assert.equal(first.registrations[0].family, "Easy SWU Serif");
  assert.equal(first.registrations[0].global, true);
  assert.deepEqual(Array.from(first.registrations[0].scopes), ["skyline"]);
  assert.equal(
    first.registrations[0].source,
    'url("data:font/woff;base64,AAECAw==")',
  );
  assert.equal(
    first.files.has(cachePath),
    false,
    "unregistered font stays staged",
  );
  first.registrations[0].success();
  assert.equal(first.files.get(cachePath).byteLength, manifest.size);
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.storage.get(storageKey))),
    manifest,
  );
  assert.equal(first.files.has(stagingPath), false);
  assert.equal(first.files.has(backupPath), false);
  first.ensure();
  assert.equal(
    first.requests.length,
    2,
    "one launch only checks manifest once",
  );

  const nextLaunch = harness({ files: first.files, storage: first.storage });
  nextLaunch.prime();
  assert.equal(
    nextLaunch.registrations.length,
    1,
    "cached font loads immediately",
  );
  assert.equal(nextLaunch.requests.length, 0);
  nextLaunch.registrations[0].fail({
    errCode: 99,
    errMsg: "page is not ready",
  });
  assert.equal(nextLaunch.files.has(cachePath), true);
  nextLaunch.ensure();
  assert.equal(
    nextLaunch.registrations.length,
    2,
    "route-ready load retries cache",
  );
  assert.equal(
    nextLaunch.requests.length,
    1,
    "each launch checks fixed manifest",
  );
  nextLaunch.registrations[1].success();
  respondWithManifest(nextLaunch);
  assert.equal(
    nextLaunch.requests.length,
    1,
    "unchanged manifest does not download the font",
  );
}

{
  const oldFont = fontBytes(128);
  const oldManifest = {
    version: "1",
    sha256: "1".repeat(64),
    size: 128,
    path: "assets/fonts/source-han-serif-cn-semibold-v1.woff",
  };
  const runtime = harness({
    files: new Map([[cachePath, oldFont]]),
    storage: new Map([[storageKey, oldManifest]]),
  });
  runtime.prime();
  runtime.registrations[0].success();
  runtime.ensure();
  respondWithManifest(runtime);
  runtime.requests[1].fail({ errMsg: "network unavailable" });
  assert.equal(runtime.files.get(cachePath), oldFont);
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.storage.get(storageKey))),
    oldManifest,
  );
}

{
  const oldFont = fontBytes(128);
  const oldManifest = {
    version: "1",
    sha256: "1".repeat(64),
    size: 128,
    path: "assets/fonts/source-han-serif-cn-semibold-v1.woff",
  };
  const runtime = harness({
    files: new Map([[cachePath, oldFont]]),
    storage: new Map([[storageKey, oldManifest]]),
    digest: "0".repeat(64),
  });
  runtime.ensure();
  runtime.registrations[0].success();
  respondWithManifest(runtime);
  runtime.requests[1].success({ statusCode: 200, data: fontBytes() });
  assert.equal(
    runtime.files.get(cachePath),
    oldFont,
    "hash mismatch preserves old cache",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.storage.get(storageKey))),
    oldManifest,
  );
  assert.equal(runtime.files.has(stagingPath), false);
}

{
  const oldFont = fontBytes(128);
  const runtime = harness({
    files: new Map([[legacyCachePath, oldFont]]),
  });
  runtime.prime();
  assert.equal(runtime.registrations.length, 1);
  assert.equal(runtime.files.get(cachePath), oldFont);
  assert.equal(runtime.files.has(legacyCachePath), false);
}

{
  const oldFont = fontBytes(128);
  const runtime = harness({ files: new Map([[cachePath, oldFont]]) });
  runtime.ensure();
  runtime.registrations[0].success();
  respondWithManifest(runtime, {
    ...manifest,
    path: "https://untrusted.example/font.woff",
  });
  assert.equal(
    runtime.requests.length,
    1,
    "invalid manifest cannot start a download",
  );
  assert.equal(runtime.files.get(cachePath), oldFont);
}

assert.match(appModule, /wx\.onAppRouteDone\(ensureSerifFontLoaded\)/);
assert.match(appModule, /setTimeout\(ensureSerifFontLoaded, 1000\)/);
assert.match(appModule, /primeSerifFontFromCache\(\)/);
assert.match(
  appModule,
  /primeSerifFontFromCache\(\);\s*ensureSerifFontLoaded\(\);/,
);
console.log("Serif font manifest, validation and persistence checks passed.");
