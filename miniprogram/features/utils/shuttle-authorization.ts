import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../store/session";
import {
  acceptShuttleConsent,
  getShuttleConsent,
  deleteShuttleHistory,
} from "../../services/shuttle";
import {
  readLocation,
  isShuttleDeletionPending,
  setShuttleDeletionPending,
  ShuttleLocationRecorder,
  type LocationResult,
} from "../../utils/shuttle-location";

export type LocationAction = "privacy" | "settings" | "system" | "retry";
export class ShuttlePermissionError extends Error {
  constructor(
    message: string,
    public action: LocationAction = "retry",
  ) {
    super(message);
  }
}

export function locationFailure(
  error: unknown,
  stage: string,
): ShuttlePermissionError {
  if (error instanceof ShuttlePermissionError) return error;
  const details = error as {
    errMsg?: string;
    errno?: number;
    errCode?: number;
  };
  const message = String(details?.errMsg || "");
  // Diagnostic codes only: never log coordinates or the full location result.
  console.error(
    "[shuttle-location]",
    stage,
    details?.errno ?? details?.errCode,
    message,
  );
  if (
    /not declared|not declare|not in.*privacy|no permission|api scope|permission.*config/i.test(
      message,
    ) ||
    details?.errno === 112
  )
    return new ShuttlePermissionError("当前版本暂时无法定位，可先查看线路");
  if (
    /system permission|system auth|location service|gps.*disabled/i.test(
      message,
    )
  )
    return new ShuttlePermissionError(
      "请在手机设置中允许微信使用位置",
      "system",
    );
  if (/privacy.*(deny|denied|not authorized|reject)/i.test(message))
    return new ShuttlePermissionError("请阅读并同意隐私保护指引", "privacy");
  if (/auth deny|auth denied|authorize.*deny|permission denied/i.test(message))
    return new ShuttlePermissionError("允许位置后可查看附近校车", "settings");
  return new ShuttlePermissionError(
    stage === "privacy"
      ? "暂时无法读取隐私设置，请重试"
      : "暂时无法定位，请检查手机定位服务后重试",
  );
}

/** WeChat owns privacy/location prompts. Never replace native consent with a custom modal. */
export async function authorizeShuttleLocation(
  current: () => boolean = () => true,
): Promise<LocationResult> {
  const lease = captureSessionLease();
  const assertOwner = (): void => {
    if (!isSessionLeaseCurrent(lease))
      throw new Error("登录状态已变化，请重新进入");
    if (!current()) throw new Error("已暂停定位");
  };
  if (isShuttleDeletionPending()) {
    // Finish an already-requested deletion from older clients before resuming.
    new ShuttleLocationRecorder({ status() {}, fatal() {} }).discard();
    await deleteShuttleHistory();
    assertOwner();
    setShuttleDeletionPending(false);
  }
  const settings =
    await new Promise<WechatMiniprogram.GetSettingSuccessCallbackResult>(
      (resolve, reject) =>
        wx.getSetting({
          success: resolve,
          fail: () =>
            reject(new ShuttlePermissionError("暂时无法读取位置权限，请重试")),
        }),
    );
  assertOwner();
  if (settings.authSetting["scope.userLocation"] === false)
    throw new ShuttlePermissionError("允许位置后可查看附近校车", "settings");
  if (wx.getAppAuthorizeSetting?.().locationAuthorized === "denied")
    throw new ShuttlePermissionError(
      "请在手机设置中允许微信使用位置",
      "system",
    );
  if (wx.getSystemSetting?.().locationEnabled === false)
    throw new ShuttlePermissionError("请打开手机定位服务后重试");

  assertOwner();
  let raw: LocationResult;
  try {
    // getLocation itself requests scope.userLocation on first use. Do not add a
    // separate authorize call that can fail before the real location API runs.
    raw = await readLocation();
  } catch (error) {
    throw locationFailure(error, "getLocation");
  }
  assertOwner();
  // Register the platform-authorized use only after native privacy/location succeeds.
  // No location is recorded or uploaded before this completes.
  const consent = await getShuttleConsent();
  assertOwner();
  if (!consent.accepted) {
    await acceptShuttleConsent();
    assertOwner();
  }
  return raw;
}
