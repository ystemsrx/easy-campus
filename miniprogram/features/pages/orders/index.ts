import { buildAppShare } from "../../../utils/app-share";
import { getAutoDormCheckLocalStatus, getAutoDormCheckPaymentOrders } from "../../../services/auto-dorm-check";
import { getCourseGrabStatus } from "../../../services/course-grab";
import { getServiceOrders } from "../../services/service-orders";
import { navigateTo } from "../../../utils/navigation";
import { orderViews } from "../../utils/auto-dorm-check-orders";
import { loadOrderHistory, saveOrderHistory } from "../../store/auto-dorm-check-orders";
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
  title?: string;
  service?: boolean;
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
    category: "",
    insetBack: false,
    navigationReady: false,
    tabs: [] as { id: string; label: string }[],
    selectedTabIndex: 0,
  },
  _revision: 0,
  onLoad(options: Record<string, string>) {
    // Navigation measures its inset once on attachment, after route options are known.
    this.setData({
      category: options.category || "",
      insetBack: options.modal === "1",
      navigationReady: true,
    });
  },
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
    void this.loadTabs();
  },
  restoreDormCache() {
    const lease = captureSessionLease();
    if (!lease || this.data.category !== "dorm" || this.data.loaded) return;
    const cached = loadOrderHistory(lease.account);
    if (!cached) return;
    this.setData({ orders: orderViews(cached.items).map((item) => ({ ...item,
      title: item.planName, timeLabel: item.paidLabel, priceLabel: `¥${item.amountLabel}`,
      refund: { refundable: false, amountCents: 0, unavailableReason: null, requiresApple: false },
    })), loaded: true, page: cached.pagination.page, hasMore: cached.pagination.page < cached.pagination.totalPages });
  },
  async loadTabs() {
    const lease = captureSessionLease();
    if (!lease) return;
    try {
      const [dorm, course] = await Promise.all([getAutoDormCheckLocalStatus(), getCourseGrabStatus()]);
      if (!isSessionLeaseCurrent(lease)) return;
      const tabs = [];
      if (dorm.entryEnabled && dorm.functionEnabled) tabs.push({ id: "dorm", label: "查寝" });
      if (course.entryEnabled) tabs.push({ id: "course", label: "抢课" });
      tabs.push({ id: "other", label: "其他" });
      const category = tabs.some((t) => t.id === this.data.category) ? this.data.category : tabs[0].id;
      if (category !== this.data.category) {
        this._revision += 1;
        this.setData({ orders: [], page: 0, loaded: false, loading: false, hasMore: false });
      }
      this.setData({ tabs, category, selectedTabIndex: tabs.findIndex((t) => t.id === category) });
      this.restoreDormCache();
      await this.load(false);
    } catch (error) { this.setData({ error: getErrorMessage(error, "订单分类读取失败，请重试") }); }
  },
  changeCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.id);
    if (!this.data.tabs.some((t) => t.id === category) || category === this.data.category) return;
    this._revision += 1;
    this.setData({ category, selectedTabIndex: this.data.tabs.findIndex((t) => t.id === category), orders: [], page: 0, loaded: false, loading: false, hasMore: false, error: "" });
    this.restoreDormCache();
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
      const page = append ? this.data.page + 1 : 1;
      const category = this.data.category;
      const result = category === "course" ? await getCourseGrabOrders(page) : category === "dorm"
        ? await getAutoDormCheckPaymentOrders(page) : await getServiceOrders(page);
      if (revision !== this._revision || !isSessionLeaseCurrent(lease)) return;
      const unique = new Map(
        (append ? this.data.orders : []).map((item) => [item.id, item]),
      );
      result.items.forEach((raw) => {
        const item = raw as CourseGrabOrder & { title?: string; service?: boolean; statusLabel?: string; planName?: string };
        const view = orderViews([item])[0];
        unique.set(item.id, {
          ...item,
          timeLabel: timeLabel(item.paidAt || item.createdAt),
          priceLabel: `¥${(item.amountCents / 100).toFixed(2)}`,
          title: item.title || item.planName || "抢课一次",
          service: category === "other",
          statusLabel: item.statusLabel || view.statusLabel,
          refund: item.refund || { refundable: false, amountCents: 0, unavailableReason: null, requiresApple: false },
          refundLabel: item.refund?.requiresApple ? "申请退款" : "退款",
        });
      });
      if (category === "dorm" && !append && "total" in result.pagination) saveOrderHistory(lease.account, result as Parameters<typeof saveOrderHistory>[1]);
      for (const item of result.items) {
        if (
          this.data.refunding !== item.id &&
          "refund" in item && item.refund?.refundable &&
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
    void this.loadTabs();
  },
  openOrder(event: WechatMiniprogram.TouchEvent) {
    if (this.data.category === "other") void navigateTo(`/features/pages/service-order/index?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}`);
  },
  copyOrder(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.orders.find((o) => o.id === String(event.currentTarget.dataset.id));
    if (item) wx.setClipboardData({ data: item.outTradeNo });
  },
  more() {
    if (!this.data.error) void this.load(true);
  },
  async refund(event: WechatMiniprogram.TouchEvent) {
    if (this.data.category !== "course") return;
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
