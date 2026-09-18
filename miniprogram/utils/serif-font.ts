import { getApiUrl } from "../config/index";

const FAMILY = "Easy SWU Serif";
const MANIFEST_PATH = "assets/fonts/serif-font-manifest";
const CACHE_FILE = "easy-swu-serif.woff";
const STAGING_FILE = "easy-swu-serif.download.woff";
const BACKUP_FILE = "easy-swu-serif.backup.woff";
const MANIFEST_STORAGE_KEY = "easy-swu:serif-font-manifest:v1";
const LEGACY_CACHE_FILES = ["easy-swu-serif-v3.woff", "easy-swu-serif-v2.woff"];
const MAX_FONT_BYTES = 10 * 1024 * 1024;
const RETRY_DELAY_MS = 60_000;

interface FontManifest {
  version: string;
  sha256: string;
  size: number;
  path: string;
}

let loaded = false;
let registerInFlight = false;
let manifestRequestInFlight = false;
let manifestChecked = false;
let manifestRetryAt = 0;
let downloadInFlight = false;

function userFile(name: string): string {
  return `${wx.env.USER_DATA_PATH}/${name}`;
}

function cachePath(): string {
  return userFile(CACHE_FILE);
}

function isWoff(data: unknown, expectedSize?: number): data is ArrayBuffer {
  if (
    !(data instanceof ArrayBuffer) ||
    data.byteLength < 4 ||
    (expectedSize !== undefined && data.byteLength !== expectedSize)
  ) {
    return false;
  }
  const header = new Uint8Array(data, 0, 4);
  return (
    header[0] === 119 &&
    header[1] === 79 &&
    header[2] === 70 &&
    header[3] === 70
  );
}

function readFontFile(path: string, expectedSize?: number): ArrayBuffer | null {
  try {
    const data = wx.getFileSystemManager().readFileSync(path);
    return isWoff(data, expectedSize) ? data : null;
  } catch {
    return null;
  }
}

function removeFile(path: string): void {
  try {
    wx.getFileSystemManager().unlinkSync(path);
  } catch {
    // 文件不存在时无需处理。
  }
}

function migrateLegacyCache(): void {
  if (readFontFile(cachePath())) return;
  for (const name of LEGACY_CACHE_FILES) {
    const legacyPath = userFile(name);
    const legacyFont = readFontFile(legacyPath);
    if (!legacyFont) continue;
    const fileSystem = wx.getFileSystemManager();
    try {
      fileSystem.renameSync(legacyPath, cachePath());
    } catch {
      try {
        fileSystem.writeFileSync(cachePath(), legacyFont);
        removeFile(legacyPath);
      } catch (error) {
        console.warn("衬线字体旧缓存迁移失败", error);
      }
    }
    return;
  }
}

function readCachedFont(expectedSize?: number): ArrayBuffer | null {
  migrateLegacyCache();
  return readFontFile(cachePath(), expectedSize);
}

function validManifest(value: unknown): value is FontManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<FontManifest>;
  return (
    typeof manifest.version === "string" &&
    manifest.version.length > 0 &&
    typeof manifest.sha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(manifest.sha256) &&
    typeof manifest.size === "number" &&
    Number.isInteger(manifest.size) &&
    manifest.size >= 4 &&
    manifest.size <= MAX_FONT_BYTES &&
    typeof manifest.path === "string" &&
    /^assets\/fonts\/[a-z0-9._/-]+\.woff$/i.test(manifest.path)
  );
}

function readStoredManifest(): FontManifest | null {
  try {
    const stored = wx.getStorageSync(MANIFEST_STORAGE_KEY);
    return validManifest(stored) ? stored : null;
  } catch {
    return null;
  }
}

function sameManifest(left: FontManifest | null, right: FontManifest): boolean {
  return (
    left?.version === right.version &&
    left.sha256.toLowerCase() === right.sha256.toLowerCase() &&
    left.size === right.size &&
    left.path === right.path
  );
}

function pageNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { errCode?: number; errMsg?: string };
  return (
    failure.errCode === 99 || /page is not ready/i.test(failure.errMsg || "")
  );
}

function registerFont(
  source: string,
  onFailure: (error?: unknown) => void,
  onSuccess?: () => void,
): void {
  registerInFlight = true;
  try {
    wx.loadFontFace({
      family: FAMILY,
      source,
      global: true,
      scopes: ["skyline"],
      success: () => {
        loaded = true;
        registerInFlight = false;
        onSuccess?.();
      },
      fail: (error) => {
        registerInFlight = false;
        console.warn("衬线字体加载失败", error);
        onFailure(error);
      },
    });
  } catch (error) {
    registerInFlight = false;
    console.warn("衬线字体加载失败", error);
    onFailure(error);
  }
}

function registerBuffer(
  data: ArrayBuffer,
  onFailure: (error?: unknown) => void,
  onSuccess?: () => void,
): void {
  try {
    const base64 = wx.arrayBufferToBase64(data);
    registerFont(
      `url("data:font/woff;base64,${base64}")`,
      onFailure,
      onSuccess,
    );
  } catch (error) {
    console.warn("衬线字体编码失败", error);
    onFailure(error);
  }
}

function registerCachedFont(data: ArrayBuffer): void {
  registerBuffer(data, (error) => {
    if (!pageNotReady(error)) {
      console.warn("衬线字体缓存暂时无法使用，已保留供下次重试");
    }
  });
}

function replaceCachedFont(manifest: FontManifest): boolean {
  const fileSystem = wx.getFileSystemManager();
  const currentPath = cachePath();
  const stagingPath = userFile(STAGING_FILE);
  const backupPath = userFile(BACKUP_FILE);
  removeFile(backupPath);
  let backedUp = false;
  try {
    if (readFontFile(currentPath)) {
      fileSystem.renameSync(currentPath, backupPath);
      backedUp = true;
    }
    fileSystem.renameSync(stagingPath, currentPath);
    wx.setStorageSync(MANIFEST_STORAGE_KEY, manifest);
    removeFile(backupPath);
    for (const name of LEGACY_CACHE_FILES) removeFile(userFile(name));
    return true;
  } catch (error) {
    console.warn("衬线字体缓存替换失败", error);
    if (backedUp) {
      try {
        removeFile(currentPath);
        fileSystem.renameSync(backupPath, currentPath);
      } catch (restoreError) {
        console.warn("衬线字体旧缓存恢复失败", restoreError);
      }
    }
    return false;
  } finally {
    removeFile(stagingPath);
  }
}

function validateAndActivate(data: ArrayBuffer, manifest: FontManifest): void {
  const stagingPath = userFile(STAGING_FILE);
  removeFile(stagingPath);
  try {
    wx.getFileSystemManager().writeFileSync(stagingPath, data);
  } catch (error) {
    downloadInFlight = false;
    console.warn("衬线字体临时文件写入失败", error);
    return;
  }

  wx.getFileSystemManager().getFileInfo({
    filePath: stagingPath,
    digestAlgorithm: "sha256",
    success: (info) => {
      if (
        info.size !== manifest.size ||
        info.digest.toLowerCase() !== manifest.sha256.toLowerCase()
      ) {
        downloadInFlight = false;
        removeFile(stagingPath);
        console.warn("衬线字体校验失败，继续使用上一版缓存");
        return;
      }
      registerBuffer(
        data,
        () => {
          downloadInFlight = false;
          removeFile(stagingPath);
        },
        () => {
          downloadInFlight = false;
          replaceCachedFont(manifest);
        },
      );
    },
    fail: (error) => {
      downloadInFlight = false;
      removeFile(stagingPath);
      console.warn("衬线字体校验失败，继续使用上一版缓存", error);
    },
  });
}

function downloadFont(manifest: FontManifest): void {
  if (downloadInFlight) return;
  downloadInFlight = true;
  wx.request({
    url: getApiUrl(manifest.path),
    responseType: "arraybuffer",
    timeout: 20_000,
    success: (response) => {
      if (
        response.statusCode < 200 ||
        response.statusCode >= 300 ||
        !isWoff(response.data, manifest.size)
      ) {
        downloadInFlight = false;
        console.warn("衬线字体下载内容无效，继续使用上一版缓存");
        return;
      }
      validateAndActivate(response.data, manifest);
    },
    fail: (error) => {
      downloadInFlight = false;
      console.warn("衬线字体下载失败，继续使用上一版缓存", error);
    },
  });
}

function manifestFromResponse(
  response: WechatMiniprogram.RequestSuccessCallbackResult,
): FontManifest | null {
  if (response.statusCode < 200 || response.statusCode >= 300) return null;
  const body = response.data as { success?: unknown; data?: unknown };
  if (!body || body.success !== true || !validManifest(body.data)) return null;
  return {
    ...body.data,
    sha256: body.data.sha256.toLowerCase(),
  };
}

function refreshFontManifest(): void {
  if (
    manifestRequestInFlight ||
    manifestChecked ||
    Date.now() < manifestRetryAt
  ) {
    return;
  }
  manifestRequestInFlight = true;
  wx.request({
    url: getApiUrl(MANIFEST_PATH),
    timeout: 10_000,
    success: (response) => {
      manifestRequestInFlight = false;
      const manifest = manifestFromResponse(response);
      if (!manifest) {
        manifestRetryAt = Date.now() + RETRY_DELAY_MS;
        console.warn("衬线字体版本清单无效，继续使用上一版缓存");
        return;
      }
      manifestChecked = true;
      const stored = readStoredManifest();
      if (sameManifest(stored, manifest) && readCachedFont(manifest.size)) {
        return;
      }
      downloadFont(manifest);
    },
    fail: (error) => {
      manifestRequestInFlight = false;
      manifestRetryAt = Date.now() + RETRY_DELAY_MS;
      console.warn("衬线字体版本清单读取失败，继续使用上一版缓存", error);
    },
  });
}

export function ensureSerifFontLoaded(): void {
  if (!loaded && !registerInFlight) {
    const cached = readCachedFont();
    if (cached) registerCachedFont(cached);
  }
  refreshFontManifest();
}

export function primeSerifFontFromCache(): void {
  if (loaded || registerInFlight) return;
  const cached = readCachedFont();
  if (cached) registerCachedFont(cached);
}
