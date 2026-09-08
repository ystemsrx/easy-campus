import { buildAppShare } from "../../../utils/app-share";
import { getAutoDormCheckPaymentOrders } from "../../../services/auto-dorm-check";
import { getErrorMessage } from "../../../services/request";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../../../store/session";
import type { AutoDormCheckOrderHistoryItem } from "../../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { ensureAuthenticated } from "../../../utils/navigation";
import { haptic } from "../../../utils/haptics";
import {
  loadOrderHistory,
  saveOrderHistory,
  type OrderHistory,
} from "../../store/auto-dorm-check-orders";
import { orderViews, type OrderView } from "../../utils/auto-dorm-check-orders";

let activeSessionKey = "";
let sequence = 0;
let pending = false;
let items: AutoDormCheckOrderHistoryItem[] = [];

Page({
  onShareAppMessage: buildAppShare,
  data: {
    ...resolveAppearance(),
    orders: [] as OrderView[],
    total: 0,
    page: 0,
    hasMore: false,
    loaded: false,
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: "",
    moreError: "",
  },
  onLoad() {
    activeSessionKey = "";
    sequence += 1;
    pending = false;
    items = [];
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
    const lease = captureSessionLease();
    if (!lease) return;
    const key = sessionLeaseKey(lease);
    if (key !== activeSessionKey) {
      activeSessionKey = key;
      sequence += 1;
      pending = false;
      items = [];
      this.setData({
        orders: [],
        total: 0,
        page: 0,
        hasMore: false,
        loaded: false,
        error: "",
        moreError: "",
        loadingMore: false,
        refreshing: false,
      });
      const cached = loadOrderHistory(lease.account);
      if (cached) this.applyOrders(cached, false);
    }
    void this.loadOrders(false);
  },
  onUnload() {
    sequence += 1;
    pending = false;
  },
  applyOrders(result: OrderHistory, append: boolean) {
    const unique = new Map(
      (append ? items : []).map((item) => [item.id, item]),
    );
    result.items.forEach((item) => unique.set(item.id, item));
    items = [...unique.values()];
    this.setData({
      orders: orderViews(items),
      total: result.pagination.total,
      page: result.pagination.page,
      hasMore: result.pagination.page < result.pagination.totalPages,
      loaded: true,
      loading: false,
    });
  },
  async loadOrders(append = false) {
    if (pending || (append && !this.data.hasMore)) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const request = ++sequence;
    const page = append ? this.data.page + 1 : 1;
    pending = true;
    this.setData({
      loading: !this.data.loaded,
      refreshing: !append && this.data.loaded,
      loadingMore: append,
      error: "",
      moreError: "",
    });
    try {
      const result = await getAutoDormCheckPaymentOrders(page);
      if (request !== sequence || !isSessionLeaseCurrent(lease)) return;
      this.applyOrders(result, append);
      if (!append) saveOrderHistory(lease.account, result);
    } catch (error) {
      if (request !== sequence || !isSessionLeaseCurrent(lease)) return;
      this.setData(
        append
          ? { moreError: "读取失败，点击重试" }
          : { error: getErrorMessage(error, "订单读取失败，请重试。") },
      );
    } finally {
      if (request === sequence && isSessionLeaseCurrent(lease)) {
        pending = false;
        this.setData({ loading: false, refreshing: false, loadingMore: false });
      }
    }
  },
  refresh() {
    haptic("light");
    void this.loadOrders(false);
  },
  loadMore() {
    // Do not repeatedly retry a failed page on scroll; leave an explicit action.
    if (!this.data.moreError) void this.loadOrders(true);
  },
  retryMore() {
    void this.loadOrders(true);
  },
  copyOrder(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const order = items.find((item) => item.id === id);
    const lease = captureSessionLease();
    if (
      !order?.outTradeNo ||
      !lease ||
      sessionLeaseKey(lease) !== activeSessionKey
    )
      return;
    haptic("light");
    wx.setClipboardData({ data: order.outTradeNo });
  },
});
