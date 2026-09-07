import { getApiUrl } from "../../config/index";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../store/session";
import {
  ApiClientError,
  createAuthenticatedRequestHeaders,
  handleAuthenticationFailure,
} from "../../services/request";
import { buildQuery } from "../../utils/query";

export function canPreviewAttachment(fileType: string): boolean {
  return /^(?:docx?|xlsx?|pptx?|pdf)$/.test(fileType);
}

export function removeAttachmentFile(path: string): void {
  if (path)
    wx.getFileSystemManager().unlink({ filePath: path, fail: () => undefined });
}

export async function downloadNoticeAttachment(
  id: string,
  url: string,
): Promise<string> {
  const lease = captureSessionLease();
  if (!lease) throw new Error("请先登录");
  const path = `/teaching/notices/attachment${buildQuery({ id, url })}`;
  const header = await createAuthenticatedRequestHeaders(path, lease);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: getApiUrl(path),
      header,
      timeout: 60000,
      success(response) {
        if (!isSessionLeaseCurrent(lease)) {
          removeAttachmentFile(response.tempFilePath);
          reject(new Error("登录账号已经切换"));
          return;
        }
        if (response.statusCode === 200) {
          resolve(response.tempFilePath);
          return;
        }
        let payload: {
          error?: { code?: string; message?: string; details?: unknown };
        } = {};
        try {
          payload = JSON.parse(
            wx
              .getFileSystemManager()
              .readFileSync(response.tempFilePath, "utf8") as string,
          );
        } catch {
          /* Use a readable fallback for non-JSON gateway errors. */
        }
        removeAttachmentFile(response.tempFilePath);
        const error = new ApiClientError({
          code: payload.error?.code || "NOTICE_ATTACHMENT_DOWNLOAD_FAILED",
          message: payload.error?.message || "附件下载失败，请重试或复制链接。",
          statusCode: response.statusCode,
          details: payload.error?.details,
        });
        handleAuthenticationFailure(error, lease);
        reject(error);
      },
      fail: () => reject(new Error("附件下载失败，请重试或复制链接。")),
    });
  });
}
