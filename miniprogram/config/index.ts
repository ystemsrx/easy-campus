type EnvironmentVersion = "develop" | "trial" | "release";

const API_ORIGINS: Record<EnvironmentVersion, string> = {
  develop: "http://127.0.0.1:3000",
  trial: "https://easy-api.lazycampus.com",
  release: "https://easy-api.lazycampus.com",
};

const DEVELOPMENT_OVERRIDE_KEY = "easy-swu:development-api-origin";

function getEnvironmentVersion(): EnvironmentVersion {
  try {
    const version = wx.getAccountInfoSync().miniProgram.envVersion;
    if (version === "trial" || version === "release") {
      return version;
    }
  } catch {
    // 开发者工具的早期基础库可能没有 getAccountInfoSync，按 develop 处理。
  }

  return "develop";
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export function getApiOrigin(): string {
  const environment = getEnvironmentVersion();
  if (environment === "develop") {
    const override = wx.getStorageSync(DEVELOPMENT_OVERRIDE_KEY);
    if (typeof override === "string" && /^https?:\/\//.test(override.trim())) {
      return normalizeOrigin(override);
    }
  }

  return normalizeOrigin(API_ORIGINS[environment]);
}

export function getApiBaseUrl(): string {
  return `${getApiOrigin()}/api/v1`;
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.trim();
  if (/^https?:\/\//.test(normalizedPath)) {
    return normalizedPath;
  }
  if (normalizedPath === "/api/v1" || normalizedPath.startsWith("/api/v1/")) {
    return `${getApiOrigin()}${normalizedPath}`;
  }
  return `${getApiBaseUrl()}/${normalizedPath.replace(/^\/+/, "")}`;
}

export function setDevelopmentApiOrigin(origin: string): void {
  const normalized = normalizeOrigin(origin);
  if (!/^https?:\/\//.test(normalized)) {
    throw new Error("API 地址必须以 http:// 或 https:// 开头。");
  }
  wx.setStorageSync(DEVELOPMENT_OVERRIDE_KEY, normalized);
}

export function clearDevelopmentApiOrigin(): void {
  wx.removeStorageSync(DEVELOPMENT_OVERRIDE_KEY);
}
