const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..", "miniprogram");

function runtime() {
  const modules = new Map();
  const storage = new Map();
  let session = {
    user: { account: "private-account-a", name: "小林" },
    token: "private-token-a",
  };
  let definition;
  const state = {
    dimensions: [],
    exports: [],
    menus: [],
    previews: [],
    toasts: [],
    text: [],
    images: [],
    drawnImages: [],
    holdImage: false,
    imageError: false,
    coverCopies: [],
    coverCopyError: false,
    holdExport: false,
    exportError: false,
    menuError: null,
    supported: true,
  };
  const context = new Proxy(
    {
      font: "16px sans-serif",
      measureText(value) {
        return {
          width:
            Array.from(value).length *
            (Number(this.font.match(/(\d+)px/)?.[1]) || 16) *
            0.65,
        };
      },
      fillText(value) {
        state.text.push(value);
      },
      drawImage(image, ...destination) {
        state.drawnImages.push({ src: image.src, destination });
      },
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => undefined;
      },
    },
  );
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => context,
    createImage() {
      let source;
      const image = {
        get src() {
          return source;
        },
        set src(value) {
          source = value;
          assert.ok(fs.existsSync(path.join(root, value)));
          if (state.imageError) this.onerror();
          else if (!state.holdImage) this.onload();
        },
      };
      state.images.push(image);
      return image;
    },
  };
  const wx = {
    env: { USER_DATA_PATH: "wxfile://usr" },
    getFileSystemManager: () => ({
      copyFileSync(source, target) {
        if (state.coverCopyError) throw new Error("Local storage is full");
        assert.ok(fs.existsSync(path.join(root, source)));
        state.coverCopies.push({ source, target });
      },
    }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getAccountInfoSync: () => ({ miniProgram: { version: "" } }),
    setNavigationBarColor() {},
    canIUse: () => state.supported,
    createOffscreenCanvas(options) {
      state.dimensions.push(options);
      canvas.width = options.width;
      canvas.height = options.height;
      return canvas;
    },
    canvasToTempFilePath(options) {
      state.exports.push(options);
      if (state.exportError)
        options.fail({ errMsg: "canvasToTempFilePath:fail" });
      else if (!state.holdExport)
        options.success({ tempFilePath: "wxfile://personal-print.png" });
    },
    showShareImageMenu(options) {
      state.menus.push(options);
      if (state.menuError) options.fail({ errMsg: state.menuError });
      else options.success({});
    },
    previewImage(options) {
      state.previews.push(options);
      options.success({});
    },
    showToast(options) {
      state.toasts.push(options.title);
    },
  };
  const stubs = {
    "store/session.ts": {
      getSession: () => session,
      captureSessionLease: () => session,
      isSessionLeaseCurrent: (lease) => lease === session,
      loadCurrentUser: () => null,
    },
    "services/primary-tab-preload.ts": {
      getPreloadedCurrentUser: () => Promise.resolve(null),
    },
    "store/preferences.ts": { loadPreferences: () => ({}) },
    "utils/appearance.ts": {
      resolveAppearance: () => ({ theme: "light" }),
      syncWindowBackground() {},
    },
    "utils/navigation.ts": { ensureAuthenticated: () => Boolean(session) },
    "utils/haptics.ts": { haptic() {} },
  };
  function load(relativePath) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (stubs[normalized]) return stubs[normalized];
    if (modules.has(normalized)) return modules.get(normalized).exports;
    const output = ts.transpileModule(
      fs.readFileSync(path.join(root, normalized), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText;
    const record = { exports: {} };
    modules.set(normalized, record);
    new Function("module", "exports", "require", "wx", "Page", output)(
      record,
      record.exports,
      (specifier) =>
        load(
          path.relative(
            root,
            path.resolve(root, path.dirname(normalized), `${specifier}.ts`),
          ),
        ),
      wx,
      (value) => {
        definition = value;
      },
    );
    return record.exports;
  }
  load("features/pages/about/index.ts");
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onShow();
  return {
    page,
    state,
    canvas,
    setSession(value) {
      session = value;
    },
  };
}

async function check() {
  const normal = runtime();
  const nativeShare = normal.page.onShareAppMessage({ from: "menu" });
  assert.equal(nativeShare.path, "/pages/home/index");
  assert.equal(nativeShare.title, "西小易 · 便利校园");
  assert.equal(nativeShare.imageUrl, "wxfile://usr/app-share-cover-v2.jpg");
  assert.equal(normal.state.coverCopies.length, 1);
  assert.deepEqual(
    normal.page.onShareAppMessage({ from: "menu" }),
    nativeShare,
  );
  assert.equal(
    normal.state.coverCopies.length,
    1,
    "Repeated shares reuse the ready local cover",
  );
  assert.equal(
    normal.state.dimensions.length,
    0,
    "The menu share uses a ready cover without allocating a personal canvas",
  );
  assert.equal(
    normal.state.exports.length,
    0,
    "Entering About does not generate or share an image",
  );
  await normal.page.sharePoster();
  assert.equal(normal.page.data.wall.months.length, 13);
  assert.equal(normal.state.menus.length, 1);
  assert.equal(normal.state.menus[0].path, "wxfile://personal-print.png");
  assert.equal(normal.state.menus[0].entrancePath, "pages/home/index");
  assert.equal(normal.state.menus[0].needShowEntrance, true);
  assert.equal(normal.state.dimensions[0].width, 900);
  assert.equal(normal.state.dimensions[0].height, 1350);
  assert.equal(normal.state.drawnImages.length, 1);
  assert.equal(
    normal.state.drawnImages[0].src,
    "/features/assets/mini-program-code.jpg",
    "Use the original packaged mini-program code in the exported print",
  );
  assert.equal(
    normal.canvas.width,
    1,
    "Release the offscreen pixel buffer after export",
  );
  assert.equal(normal.canvas.height, 1);
  assert.ok(
    normal.state.dimensions[0].width <= 1365 &&
      normal.state.dimensions[0].height <= 1365,
    "Stay within WeChat's canvas limit",
  );
  assert.equal(
    normal.state.exports[0].destHeight,
    normal.state.dimensions[0].height,
    "Do not multiply the export by DPR",
  );
  assert.ok(
    !normal.state.text.some((text) =>
      /小林|的校园留白|private-account|private-token|次上线|上线.*次|来过，就留一抹绿/.test(
        text,
      ),
    ),
  );
  assert.equal(normal.page.data.shareBusy, false);

  const loading = runtime();
  loading.state.holdImage = true;
  const loadingPrint = loading.page.sharePoster();
  assert.equal(loading.state.exports.length, 0);
  assert.equal(loading.state.menus.length, 0);
  assert.equal(loading.page.data.shareBusy, true);
  loading.state.images[0].onload();
  await loadingPrint;
  assert.equal(loading.state.exports.length, 1);
  assert.equal(loading.state.menus.length, 1);
  assert.equal(loading.page.data.shareBusy, false);

  const imageFailed = runtime();
  imageFailed.state.imageError = true;
  await imageFailed.page.sharePoster();
  assert.equal(imageFailed.state.exports.length, 0);
  assert.equal(imageFailed.state.menus.length, 0);
  assert.equal(imageFailed.state.toasts.length, 1);
  assert.equal(imageFailed.page.data.shareBusy, false);
  assert.equal(imageFailed.canvas.width, 1);
  assert.equal(imageFailed.canvas.height, 1);
  imageFailed.state.imageError = false;
  await imageFailed.page.sharePoster();
  assert.equal(
    imageFailed.state.menus.length,
    1,
    "Image loading can be retried",
  );

  const lateImage = runtime();
  lateImage.state.holdImage = true;
  const oldPrint = lateImage.page.sharePoster();
  lateImage.setSession({ user: { account: "new-account" }, token: "new" });
  lateImage.page.onHide();
  lateImage.state.images[0].onload();
  await oldPrint;
  assert.equal(lateImage.state.menus.length, 0);
  assert.equal(lateImage.state.toasts.length, 0);
  assert.equal(lateImage.canvas.width, 1);

  const switched = runtime();
  switched.state.holdExport = true;
  const first = switched.page.sharePoster();
  const duplicate = switched.page.sharePoster();
  await Promise.resolve();
  assert.deepEqual(
    switched.page.onShareAppMessage({ from: "menu" }),
    nativeShare,
    "Native sharing remains immediately available while a personal print is pending",
  );
  assert.equal(
    switched.state.exports.length,
    1,
    "Rapid taps create only one print",
  );
  switched.setSession({
    user: { account: "private-account-b", name: "小许" },
    token: "b",
  });
  assert.deepEqual(
    switched.page.onShareAppMessage({ from: "menu" }),
    nativeShare,
  );
  switched.state.exports[0].success({
    tempFilePath: "wxfile://stale-account.png",
  });
  await Promise.all([first, duplicate]);
  assert.equal(
    switched.state.menus.length,
    0,
    "Never share a previous account's pending print",
  );
  switched.state.holdExport = false;
  await switched.page.sharePoster();
  assert.ok(
    !switched.state.text.some((text) => /小许|小林|的校园留白/.test(text)),
  );
  assert.equal(switched.state.menus.length, 1);

  const signedOut = runtime();
  signedOut.setSession(null);
  signedOut.page.data.theme = "dark";
  assert.deepEqual(
    signedOut.page.onShareAppMessage({ from: "menu" }),
    nativeShare,
    "Signing out and dark mode do not change the public card or inherit private state",
  );

  const storageFull = runtime();
  storageFull.state.coverCopyError = true;
  const fallbackCard = storageFull.page.onShareAppMessage({ from: "menu" });
  assert.equal(fallbackCard.imageUrl, "/assets/share/app-cover.jpg");
  assert.equal(fallbackCard.path, nativeShare.path);
  assert.equal(fallbackCard.title, nativeShare.title);
  assert.equal(storageFull.state.exports.length, 0);
  storageFull.state.coverCopyError = false;
  assert.deepEqual(
    storageFull.page.onShareAppMessage({ from: "menu" }),
    nativeShare,
  );

  const departed = runtime();
  departed.state.holdExport = true;
  const pending = departed.page.sharePoster();
  await Promise.resolve();
  departed.page.onHide();
  departed.page.onUnload();
  departed.state.exports[0].success({ tempFilePath: "wxfile://departed.png" });
  await pending;
  assert.equal(
    departed.state.menus.length,
    0,
    "Leaving cancels presentation of a pending image",
  );
  assert.equal(departed.state.toasts.length, 0);

  const failed = runtime();
  failed.state.exportError = true;
  await failed.page.sharePoster();
  assert.equal(failed.state.menus.length, 0);
  assert.equal(failed.page.data.shareBusy, false);
  assert.equal(failed.state.toasts.length, 1);
  failed.state.exportError = false;
  await failed.page.sharePoster();
  assert.equal(failed.state.menus.length, 1, "Failed exports can be retried");

  const cancelled = runtime();
  cancelled.state.menuError = "showShareImageMenu:fail cancel";
  await cancelled.page.sharePoster();
  assert.equal(cancelled.state.previews.length, 0);
  assert.equal(
    cancelled.state.toasts.length,
    0,
    "Cancelling sharing is not an error",
  );
  assert.equal(cancelled.page.data.shareBusy, false);

  for (const supported of [false, true]) {
    const fallback = runtime();
    fallback.state.supported = supported;
    fallback.state.menuError = "showShareImageMenu:fail not supported";
    await fallback.page.sharePoster();
    assert.equal(
      fallback.state.previews.length,
      1,
      "Unsupported clients can still preview/save the generated image",
    );
    assert.equal(fallback.state.previews[0].showmenu, true);
    assert.deepEqual(fallback.state.previews[0].urls, [
      "wxfile://personal-print.png",
    ]);
    assert.equal(fallback.state.toasts.length, 0);
  }

  console.log(
    "About sharing checks passed: user print, packaged code loading/retry, canvas limits, privacy, concurrent taps, session changes, exit, cancellation, failure and fallback.",
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
