import { buildAppShare } from "../../../utils/app-share";
import { getNoticeDetail } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import { resolveAppearance } from "../../../utils/appearance";
import { formatDateTime } from "../../../utils/date";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import type {
  NoticeAttachment,
  NoticeContentBlock,
  NoticeContentSegment,
  NoticeDetail,
} from "../../../types/api";
import {
  canPreviewAttachment,
  downloadNoticeAttachment,
  removeAttachmentFile,
} from "../../utils/notice-attachments";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";

function safeDecode(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function domainFromUrl(url: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(url);
  return match?.[1] || "西南大学本科生院";
}

function sourceIdFromUrl(url: string): string {
  const matched = /[?&]xwbh=([^&]+)/.exec(url);
  if (matched) return safeDecode(matched[1], matched[1]);
  const publicArticle = /\/info\/(\d+)\/(\d+)\.htm(?:[?#]|$)/i.exec(url);
  return publicArticle ? `ugs:${publicArticle[1]}:${publicArticle[2]}` : "";
}

function resolveContentBlocks(detail: NoticeDetail): NoticeContentBlock[] {
  if (detail.contentBlocks?.length)
    return detail.contentBlocks.map((block) =>
      block.type === "html"
        ? { ...block, segments: resolveSegments(block) }
        : {
            ...block,
            items: block.items.map((item) => ({
              ...item,
              segments: resolveSegments(item),
            })),
          },
    );
  return detail.contentHtml
    ? [
        {
          key: "html-fallback",
          type: "html",
          contentHtml: detail.contentHtml,
          segments: resolveSegments(detail),
        },
      ]
    : [];
}

function resolveSegments(content: {
  contentHtml: string;
  segments?: NoticeContentSegment[];
}): NoticeContentSegment[] {
  return content.segments?.length
    ? content.segments
    : [
        {
          key: "html-fallback",
          type: "html",
          contentHtml: content.contentHtml,
        },
      ];
}

function collectImageUrls(blocks: NoticeContentBlock[]): string[] {
  const urls = blocks.flatMap((block) =>
    (block.type === "html"
      ? block.segments || []
      : block.items.flatMap((item) => item.segments || [])
    ).flatMap((segment) => (segment.type === "image" ? [segment.src] : [])),
  );
  return [...new Set(urls)];
}

Page({
  onShareAppMessage: buildAppShare,
  attachmentFiles: {} as Record<string, string>,
  disposed: false,
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    id: "",
    title: "学校通知",
    publisher: "",
    publishedAt: "",
    displayTime: "",
    contentHtml: "",
    contentBlocks: [] as NoticeContentBlock[],
    imageUrls: [] as string[],
    attachments: [] as NoticeAttachment[],
    attachmentBusy: false,
    selectedAttachment: null as NoticeAttachment | null,
    attachmentAction: "preview" as "preview" | "share",
    url: "",
    domain: "西南大学本科生院",
    loading: false,
    loaded: false,
    errorMessage: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!ensureAuthenticated()) return;
    const url = safeDecode(options.url, "");
    const id = safeDecode(options.id, "") || sourceIdFromUrl(url);
    const title = safeDecode(options.title, "学校通知");
    const publishedAt = safeDecode(options.publishedAt, "");
    this.setData({
      ...resolveAppearance(),
      id,
      title,
      publishedAt,
      displayTime: publishedAt ? formatDateTime(publishedAt) : "",
      url,
      domain: domainFromUrl(url),
    });
    void this.loadDetail();
  },
  onShow() {
    this.setData(resolveAppearance());
  },
  onUnload() {
    this.disposed = true;
    Object.values(this.attachmentFiles).forEach(removeAttachmentFile);
  },
  async loadDetail(refresh = false) {
    if (!this.data.id) {
      this.setData({
        loaded: true,
        errorMessage: "这条旧缓存缺少通知标识，请返回列表等待静默更新后重试。",
      });
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({
      loading: !this.data.contentHtml,
      errorMessage: "",
    });
    try {
      const result = await getNoticeDetail(this.data.id, refresh);
      if (!isSessionLeaseCurrent(lease)) return;
      const detail = result.data;
      const publishedAt = detail.publishedAt || this.data.publishedAt;
      const url = detail.link || this.data.url;
      const contentBlocks = resolveContentBlocks(detail);
      this.setData({
        title: detail.title || this.data.title,
        publisher: detail.publisher || "",
        publishedAt,
        displayTime: publishedAt ? formatDateTime(publishedAt) : "",
        contentHtml: detail.contentHtml,
        contentBlocks,
        imageUrls: collectImageUrls(contentBlocks),
        attachments: contentBlocks.flatMap((block) =>
          (block.type === "html"
            ? block.segments || []
            : block.items.flatMap((item) => item.segments || [])
          ).filter(
            (segment): segment is NoticeAttachment =>
              segment.type === "attachment",
          ),
        ),
        url,
        domain: domainFromUrl(url),
        loaded: true,
      });
      if (!refresh && result.meta.refreshing) {
        void this.loadDetail(true);
      }
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      if (refresh && this.data.contentHtml) return;
      this.setData({
        loaded: true,
        errorMessage: getErrorMessage(error, "通知正文加载失败，请稍后重试。"),
      });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ loading: false });
    }
  },
  retry() {
    haptic("light");
    void this.loadDetail(true);
  },
  previewImage(event: WechatMiniprogram.BaseEvent) {
    const src = event.currentTarget.dataset.src;
    if (typeof src !== "string" || !this.data.imageUrls.includes(src)) return;
    wx.previewImage({
      current: src,
      urls: this.data.imageUrls,
      fail: () => this.showNoticeFeedback("图片打开失败，请重试"),
    });
  },
  openAttachment(event: WechatMiniprogram.BaseEvent) {
    if (this.data.attachmentBusy) return;
    const attachment = this.data.attachments.find(
      (item) => item.url === event.currentTarget.dataset.url,
    );
    if (!attachment) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const actions = canPreviewAttachment(attachment.fileType)
      ? ["preview", "share", "copy"]
      : ["share", "copy"];
    wx.showActionSheet({
      itemList: actions.map((action) =>
        action === "preview"
          ? "预览"
          : action === "share"
            ? "转发文件"
            : "复制链接",
      ),
      success: ({ tapIndex }) => {
        if (this.disposed || !isSessionLeaseCurrent(lease)) return;
        const action = actions[tapIndex];
        if (action === "copy") {
          this.copyUrl(attachment.url);
        } else if (action === "preview" || action === "share") {
          this.setData({
            selectedAttachment: attachment,
            attachmentAction: action,
          });
          void this.performAttachmentAction();
        }
      },
    });
  },
  async performAttachmentAction() {
    const attachment = this.data.selectedAttachment;
    const action = this.data.attachmentAction;
    const lease = captureSessionLease();
    if (!attachment || !lease || this.data.attachmentBusy) return;
    this.setData({ attachmentBusy: true });
    wx.showLoading({ title: "读取中" });
    let loading = true;
    try {
      const cachedFile = this.attachmentFiles[attachment.url];
      const filePath =
        cachedFile ||
        (await downloadNoticeAttachment(this.data.id, attachment.url));
      if (this.disposed || !isSessionLeaseCurrent(lease)) {
        removeAttachmentFile(filePath);
        return;
      }
      this.attachmentFiles[attachment.url] = filePath;
      wx.hideLoading();
      loading = false;
      const fail = (error: { errMsg: string }) => {
        if (
          this.disposed ||
          !isSessionLeaseCurrent(lease) ||
          /cancel/i.test(error.errMsg)
        )
          return;
        if (action === "share" && /开发者工具|devtools/i.test(error.errMsg)) {
          this.showNoticeFeedback("请在手机微信中转发文件");
        } else if (
          action === "share" &&
          /not support|unsupported/i.test(error.errMsg)
        ) {
          this.showNoticeFeedback("当前微信不支持转发文件，请更新微信");
        } else {
          this.showNoticeFeedback(
            action === "share" ? "转发失败，请重试" : "附件预览失败，请重试",
          );
        }
      };
      if (action === "preview") {
        wx.openDocument({
          filePath,
          fileType:
            attachment.fileType as WechatMiniprogram.OpenDocumentOption["fileType"],
          showMenu: true,
          fail,
        });
      } else {
        const share = () => {
          if (this.disposed || !isSessionLeaseCurrent(lease)) return;
          if (typeof wx.shareFileMessage === "function") {
            wx.shareFileMessage({ filePath, fileName: attachment.name, fail });
          } else {
            fail({ errMsg: "unsupported" });
          }
        };
        if (cachedFile) {
          share();
        } else {
          // Downloading consumes the user gesture. The ready file must be
          // shared directly from a new tap, without another asynchronous step.
          wx.showActionSheet({
            itemList: ["转发文件"],
            success: ({ tapIndex }) => {
              if (tapIndex === 0) share();
            },
          });
        }
      }
    } catch (error) {
      if (this.disposed || !isSessionLeaseCurrent(lease)) return;
      this.showNoticeFeedback(getErrorMessage(error, "附件读取失败，请重试"));
    } finally {
      if (loading) wx.hideLoading();
      if (!this.disposed) this.setData({ attachmentBusy: false });
    }
  },
  copyLink() {
    if (!this.data.url) return;
    this.copyUrl(this.data.url);
  },
  copyUrl(url: string) {
    const lease = captureSessionLease();
    if (!lease) return;
    wx.setClipboardData({
      data: url,
      success: () => {
        if (this.disposed || !isSessionLeaseCurrent(lease)) return;
        haptic("medium");
        this.showNoticeFeedback("已复制链接");
      },
      fail: () => {
        if (!this.disposed && isSessionLeaseCurrent(lease))
          this.showNoticeFeedback("复制失败，请重试");
      },
      // Dismiss the clipboard API's own confirmation in the same callback turn.
      // Only the shared component should provide visible feedback.
      complete: () => wx.hideToast(),
    });
  },
  showNoticeFeedback(message: string) {
    const confirmation = this.selectComponent("#refresh-confirmation") as {
      show?: (message: string) => void;
    } | null;
    confirmation?.show?.(message);
  },
});
