import { getNoticeDetail } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import { resolveAppearance } from "../../../utils/appearance";
import { formatDateTime } from "../../../utils/date";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import type { NoticeContentBlock, NoticeDetail } from "../../../types/api";
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
  if (detail.contentBlocks?.length) return detail.contentBlocks;
  return detail.contentHtml
    ? [
        {
          key: "html-fallback",
          type: "html",
          contentHtml: detail.contentHtml,
        },
      ]
    : [];
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    id: "",
    title: "学校通知",
    publisher: "",
    publishedAt: "",
    displayTime: "",
    contentHtml: "",
    contentBlocks: [] as NoticeContentBlock[],
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
      this.setData({
        title: detail.title || this.data.title,
        publisher: detail.publisher || "",
        publishedAt,
        displayTime: publishedAt ? formatDateTime(publishedAt) : "",
        contentHtml: detail.contentHtml,
        contentBlocks: resolveContentBlocks(detail),
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
  copyLink() {
    if (!this.data.url) return;
    wx.setClipboardData({
      data: this.data.url,
      success: () => haptic("medium"),
    });
  },
});
