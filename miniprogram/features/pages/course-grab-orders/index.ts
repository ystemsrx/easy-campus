import { buildAppShare } from "../../../utils/app-share";
import {
  getCourseGrabOrders,
  refundCourseGrab,
  type CourseGrabOrder,
  type RefundQuote,
} from "../../../services/course-grab";
import { apiRequest, getErrorMessage } from "../../../services/request";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../../../store/session";
import { ensureAuthenticated } from "../../../utils/navigation";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { timeLabel, uuid } from "../../utils/course-grab";
type OrderView = CourseGrabOrder & {
  timeLabel: string;
  priceLabel: string;
  statusLabel: string;
  refundLabel: string;
};
const refundStorageKey = (account: string, id: string) =>
  `easy-swu:course-grab-refund:v1:${encodeURIComponent(account)}:${id}`;
Page({
  onShareAppMessage: buildAppShare,
  data: {
    ...resolveAppearance(),
    orders: [] as OrderView[],
    loading: false,
    loaded: false,
    error: "",
    page: 0,
    hasMore: false,
    refunding: "",
    accountKey: "",
  },
  _revision: 0,
  onShow() {
    if (!ensureAuthenticated()) return;
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
    const lease = captureSessionLease();
    if (!lease) return;
    if (this.data.accountKey !== sessionLeaseKey(lease)) {
      this._revision += 1;
      this.setData({
        accountKey: sessionLeaseKey(lease),
        orders: [],
        loaded: false,
        loading: false,
        page: 0,
        hasMore: false,
        refunding: "",
      });
    }
    void this.load(false);
  },
  onUnload() {
    this._revision += 1;
  },
  async load(append = false) {
    if (this.data.loading || (append && !this.data.hasMore)) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const revision = this._revision;
    this.setData({ loading: true, error: "" });
    try {
      const result = await getCourseGrabOrders(append ? this.data.page + 1 : 1);
      if (revision !== this._revision || !isSessionLeaseCurrent(lease)) return;
      const unique = new Map(
        (append ? this.data.orders : []).map((item) => [item.id, item]),
      );
      result.items.forEach((item) =>
        unique.set(item.id, {
          ...item,
          timeLabel: timeLabel(item.paidAt || item.createdAt),
          priceLabel: `¥${(item.amountCents / 100).toFixed(2)}`,
          statusLabel: item.refundedCents
            ? "已退款"
            : item.refunds.some((r) =>
                  ["pending", "processing", "abnormal"].includes(r.status),
                )
              ? "退款处理中"
              : "已支付",
          refundLabel: item.refund.requiresApple ? "申请退款" : "退款",
        }),
      );
      for (const item of result.items) {
        if (
          this.data.refunding !== item.id &&
          item.refund.refundable &&
          item.refunds.length > 0 &&
          item.refunds.every((refund) => refund.status === "closed")
        )
          wx.removeStorageSync(refundStorageKey(lease.account, item.id));
      }
      this.setData({
        orders: [...unique.values()],
        page: result.pagination.page,
        hasMore: result.pagination.page < result.pagination.totalPages,
        loaded: true,
      });
    } catch (error) {
      if (revision === this._revision && isSessionLeaseCurrent(lease))
        this.setData({ error: getErrorMessage(error, "订单读取失败，请重试") });
    } finally {
      if (revision === this._revision && isSessionLeaseCurrent(lease))
        this.setData({ loading: false });
    }
  },
  refresh() {
    void this.load(false);
  },
  more() {
    if (!this.data.error) void this.load(true);
  },
  async refund(event: WechatMiniprogram.TouchEvent) {
    if (this.data.refunding) return;
    const id = String(event.currentTarget.dataset.id);
    const order = this.data.orders.find((item) => item.id === id);
    if (!order) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({ refunding: id });
    try {
      const quote = await apiRequest<RefundQuote>(
        `/course-grab/payment/orders/${encodeURIComponent(id)}/refund-preview`,
      );
      if (!isSessionLeaseCurrent(lease)) return;
      if (!quote.refundable) {
        await wx.showModal({
          title: "暂不可退款",
          content: quote.unavailableReason || "该次数不可退款",
          showCancel: false,
        });
        return;
      }
      if (quote.requiresApple) {
        const result = await wx.showModal({
          title: "Apple 退款",
          content: "此订单由 Apple 收款，请到 Apple 退款页面申请。",
          confirmText: "复制地址",
        });
        if (result.confirm && isSessionLeaseCurrent(lease))
          wx.setClipboardData({ data: "https://reportaproblem.apple.com/" });
        return;
      }
      const confirm = await wx.showModal({
        title: "确认退款",
        content: `退还 ¥${(quote.amountCents / 100).toFixed(2)}，并扣回此订单的 1 次抢课次数。`,
        confirmText: "退款",
      });
      if (!confirm.confirm || !isSessionLeaseCurrent(lease)) return;
      const storageKey = refundStorageKey(lease.account, id);
      let key = wx.getStorageSync(storageKey) as string;
      if (!key) {
        key = uuid();
        wx.setStorageSync(storageKey, key);
      }
      const result = await refundCourseGrab(id, quote.amountCents, key);
      if (!isSessionLeaseCurrent(lease)) return;
      if (result.status === "closed") wx.removeStorageSync(storageKey);
      wx.showModal({
        title:
          result.status === "closed"
            ? "退款未完成"
            : result.status === "success"
              ? "退款成功"
              : "退款处理中",
        content:
          result.status === "success"
            ? "款项已原路退回。"
            : result.status === "closed"
              ? "次数已恢复，可重新申请退款。"
              : "请稍后刷新订单查看结果。",
        showCancel: false,
      });
      await this.load(false);
    } catch (error) {
      if (isSessionLeaseCurrent(lease))
        wx.showModal({
          title: "提示",
          content: getErrorMessage(error, "退款结果待确认，请刷新订单后重试"),
          showCancel: false,
        });
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ refunding: "" });
    }
  },
});
