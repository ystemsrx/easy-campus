import { apiRequest, getErrorMessage } from "../../../services/request";
import { launchWechatPayment } from "../../../services/auto-dorm-check";
import { captureSessionLease, isSessionLeaseCurrent, sessionLeaseKey, type SessionLease } from "../../../store/session";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import { resolveAppearance, syncWindowBackground } from "../../../utils/appearance";
import { buildAppShare } from "../../../utils/app-share";
import type { WechatPaymentParameters } from "../../../types/api";
import { serviceStatus, type ServiceOrder } from "../../services/service-orders";
import { uuid } from "../../utils/course-grab";
import { rememberServiceOrder } from "../../../utils/service-order-return";

const ORDER_POLL_INTERVAL_MILLISECONDS = 900;
const ORDER_POLL_ATTEMPTS = 45;
const PAYMENT_PROGRESS_TRANSITION_MS = 260;
const activePages = new WeakSet<object>();
const flowRevisions = new WeakMap<object, number>();
const progressTransitions = new WeakMap<object, { close?: ReturnType<typeof setTimeout> }>();
type ServiceOrderResult = { order: ServiceOrder };
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const isFlowCurrent = (instance: object, revision: number, lease: SessionLease) =>
  activePages.has(instance) && flowRevisions.get(instance) === revision && isSessionLeaseCurrent(lease);
const shouldPollOrder = (order: ServiceOrder) => ["PROCESSING", "RECONCILING"].includes(order.payment_status);
const pendingKey = (account: string, id: string) => `easy-swu:service-payment:v1:${encodeURIComponent(account)}:${id}`;
function pending(account: string, id: string): boolean {
  try { return wx.getStorageSync(pendingKey(account, id)) === true; } catch { return false; }
}
async function queryServicePayment(id: string): Promise<ServiceOrderResult> {
  return apiRequest<ServiceOrderResult>(`/service-orders/${id}/payment-checks`, {
    method: "POST", data: { check_id: uuid() },
  });
}

Page({
  onShareAppMessage: buildAppShare,
  data: {
    ...resolveAppearance(), code: "", id: "", tradeNo: "", order: null as ServiceOrder | null,
    items: [] as { id: string; name: string; price: string }[],
    price: "", status: "", refundSummary: "", busy: false, error: "", canPay: false,
    processing: false, checkingPayment: false, canResumePayment: false,
    paymentActionPending: false, pendingResult: false, pendingPlanName: "", pendingPriceLabel: "",
    progressMounted: false, progressExpanded: false, progressHeight: 0, progressBusy: false,
    progressPlanName: "", progressPriceLabel: "", paymentScrollTop: 0,
  },
  _visible: false,
  _launchAllowed: false,
  _accountKey: "",
  _scrollTop: 0,
  _unconfirmedChecks: 0,
  _timer: undefined as ReturnType<typeof setTimeout> | undefined,
  onLoad(options: Record<string, string>) {
    activePages.add(this);
    flowRevisions.set(this, 0);
    this.setData({ code: options.code || "", id: options.id || "", tradeNo: options.out_trade_no || "" });
  },
  onShow() {
    this._visible = true;
    const lease = captureSessionLease();
    if (!lease) {
      rememberServiceOrder(this.data.code, this.data.id, this.data.tradeNo);
      this.stopFlow();
      this.setData({ order: null, items: [], busy: false, canPay: false });
      ensureAuthenticated();
      return;
    }
    const key = sessionLeaseKey(lease);
    if (key !== this._accountKey) {
      this.stopFlow();
      this._accountKey = key;
      this.setData({ order: null, items: [], busy: false, canPay: false, error: "" });
    }
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
    if (!this.data.busy && (this.data.id || this.data.code || this.data.tradeNo)) void this.load();
  },
  onHide() {
    this._visible = false;
    this._launchAllowed = false;
    if (this._timer !== undefined) clearTimeout(this._timer);
  },
  onUnload() {
    this.onHide();
    this.stopFlow();
    activePages.delete(this);
  },
  onResize() {
    if (this.data.processing || this.data.checkingPayment)
      this.setPaymentView({ processing: this.data.processing });
  },
  stopFlow() {
    flowRevisions.set(this, (flowRevisions.get(this) || 0) + 1);
    this._launchAllowed = false;
    this._unconfirmedChecks = 0;
    if (this._timer !== undefined) clearTimeout(this._timer);
    const transition = progressTransitions.get(this);
    if (transition?.close !== undefined) clearTimeout(transition.close);
    progressTransitions.delete(this);
    this.setData({ processing: false, checkingPayment: false, pendingResult: false,
      paymentActionPending: false, progressHeight: 0, progressMounted: false, progressExpanded: false });
  },
  setPaymentView(patch: Record<string, unknown>, callback?: () => void) {
    const changesProgress = [
      "processing",
      "checkingPayment",
      "canResumePayment",
      "paymentActionPending",
      "pendingResult",
      "pendingPlanName",
      "pendingPriceLabel",
    ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    if (!changesProgress) {
      this.setData(patch, callback);
      return;
    }
    const instance = this as unknown as object;
    const previous = progressTransitions.get(instance);
    if (previous?.close !== undefined) clearTimeout(previous.close);
    const transition: { close?: ReturnType<typeof setTimeout> } = {};
    progressTransitions.set(instance, transition);
    const current = () =>
      activePages.has(instance) &&
      progressTransitions.get(instance) === transition;
    const busy = Boolean(
      (patch.processing ?? this.data.processing) ||
      (patch.checkingPayment ?? this.data.checkingPayment),
    );
    const visible =
      busy || Boolean(patch.canResumePayment ?? this.data.canResumePayment);
    if (visible) {
      // Mount into a zero-height region first. Measuring after this render
      // accounts for actual wrapping, font size and the pending-result actions.
      this.setData(
        {
          ...patch,
          progressMounted: true,
          progressBusy: busy,
          progressPlanName: String(
            patch.pendingPlanName ?? this.data.pendingPlanName,
          ),
          progressPriceLabel: String(
            patch.pendingPriceLabel ?? this.data.pendingPriceLabel,
          ),
        },
        () => {
          if (current()) {
            this.createSelectorQuery()
              .select(".payment-progress-inner")
              .boundingClientRect()
              .exec(
                (
                  rects: WechatMiniprogram.BoundingClientRectCallbackResult[],
                ) => {
                  if (!current() || !rects[0]?.height) {
                    callback?.();
                    return;
                  }
                  this.setData(
                    {
                      progressHeight: rects[0].height,
                      progressExpanded: true,
                    },
                    callback,
                  );
                },
              );
          } else callback?.();
        },
      );
      return;
    }
    // Keep the last visible content throughout collapse. A fast success must
    // not replace the spinner with pending-result copy just before removing it.
    this.setData(
      { ...patch, progressHeight: 0, progressExpanded: false },
      () => {
        if (current() && this.data.progressMounted) {
          const unmount = () => {
            if (current())
              this.setData({ progressMounted: false, progressBusy: false });
          };
          if (this.data.motionClass === "motion-reduced") unmount();
          else
            transition.close = setTimeout(
              unmount,
              PAYMENT_PROGRESS_TRANSITION_MS,
            );
        }
        callback?.();
      },
    );
  },

  inputCode(event: WechatMiniprogram.Input) { this.setData({ code: event.detail.value.trim() }); },
  onPaymentScroll(event: WechatMiniprogram.CustomEvent<{ scrollTop: number }>) {
    this._scrollTop = Math.max(0, event.detail.scrollTop);
  },
  scrollToPayment() {
    this.setData({ paymentScrollTop: this._scrollTop }, () => {
      if (activePages.has(this)) this.setData({ paymentScrollTop: 0 });
    });
  },
  apply(order: ServiceOrder) {
    if (!Array.isArray(order.service_items) || !order.service_items.length)
      throw new Error("订单明细缺失，请重新读取订单");
    const validItems = order.service_items.every((item) =>
      typeof item.name === "string" && item.name.trim() &&
      Number.isSafeInteger(item.billable_units) && item.billable_units > 0);
    const itemTotal = order.service_items.reduce((sum, item) => sum + item.billable_units * order.unit_price_fen, 0);
    if (!validItems || !Number.isSafeInteger(order.unit_price_fen) || order.unit_price_fen <= 0 ||
        !Number.isSafeInteger(itemTotal) || itemTotal !== order.amount_fen)
      throw new Error("订单明细金额不一致，请重新读取订单");
    this.setData({
      order, id: order.order_id, price: (order.amount_fen / 100).toFixed(2), status: serviceStatus(order),
      items: order.service_items.map((item) => ({
        id: item.id, name: item.name, price: (item.billable_units * order.unit_price_fen / 100).toFixed(2),
      })),
      pendingPlanName: order.platform_name, pendingPriceLabel: `¥${(order.amount_fen / 100).toFixed(2)}`,
      refundSummary: order.refunds.map((r) => `${({ SUCCEEDED: "已退款", PENDING: "退款处理中", PROCESSING: "退款处理中", CLOSED: "退款未完成", MANUAL_REQUIRED: "退款待处理" } as Record<string, string>)[r.status] || r.status} ¥${(r.amount_fen / 100).toFixed(2)}`).join("；"),
      canPay: order.payment_status === "UNPAID" && order.code_status === "ACTIVE" &&
        order.code_expires_at > Date.now() && !!this.data.code,
    });
  },
  async load() {
    const lease = captureSessionLease();
    if (!lease || this.data.busy) return;
    const revision = (flowRevisions.get(this) || 0) + 1;
    flowRevisions.set(this, revision);
    this.setData({ busy: true, error: "" });
    try {
      let order: ServiceOrder;
      if (this.data.code) {
        try { order = await apiRequest<ServiceOrder>("/service-orders/resolve", { method: "POST", data: { code: this.data.code } }); }
        catch (error) {
          if (!this.data.id || !isFlowCurrent(this, revision, lease)) throw error;
          order = await apiRequest<ServiceOrder>(`/service-orders/${this.data.id}`);
        }
      } else if (this.data.tradeNo) {
        order = await apiRequest<ServiceOrder>(`/service-orders/by-trade-no/${encodeURIComponent(this.data.tradeNo)}`);
      } else order = await apiRequest<ServiceOrder>(`/service-orders/${this.data.id}`);
      if (!isFlowCurrent(this, revision, lease)) return;
      this.apply(order);
    } catch (error) {
      if (isFlowCurrent(this, revision, lease)) this.setData({ error: getErrorMessage(error, "订单读取失败") });
    } finally {
      if (isFlowCurrent(this, revision, lease)) this.setData({ busy: false });
    }
    if (isFlowCurrent(this, revision, lease) && this._visible && this.data.order &&
        (shouldPollOrder(this.data.order) || pending(lease.account, this.data.id))) {
      this._unconfirmedChecks = 0;
      void this.check();
    }
  },
  async checkPaymentOrder(orderId: string) {
    // Match dorm checkout's measured reveal barrier, including fast errors.
    await new Promise<void>((resolve) => {
      this.setPaymentView({ checkingPayment: true, canResumePayment: false }, resolve);
    });
    const reveal = wait(PAYMENT_PROGRESS_TRANSITION_MS);
    try { return await queryServicePayment(orderId); }
    finally { await reveal; }
  },
  async pollPaymentOrder(
    initial: ServiceOrderResult,
    lease: SessionLease,
    revision: number,
    instance: object,
  ): Promise<ServiceOrderResult | null> {
    let current = initial;
    for (let attempt = 0; attempt < ORDER_POLL_ATTEMPTS; attempt += 1) {
      if (!shouldPollOrder(current.order)) return current;
      await wait(ORDER_POLL_INTERVAL_MILLISECONDS);
      if (!isFlowCurrent(instance, revision, lease)) return null;
      current = await queryServicePayment(current.order.order_id);
      if (!isFlowCurrent(instance, revision, lease)) return null;
    }
    return shouldPollOrder(current.order) ? null : current;
  },

  showAwaitingPayment() {
    this.setPaymentView({ processing: false, checkingPayment: true, pendingResult: true });
    if (this._timer !== undefined) clearTimeout(this._timer);
    const lease = captureSessionLease();
    if (!lease || !this._visible) return;
    const revision = flowRevisions.get(this) || 0;
    const delay = Math.min(30000, 3000 * 2 ** Math.min(this._unconfirmedChecks, 4));
    this._unconfirmedChecks += 1;
    this._timer = setTimeout(() => {
      if (isFlowCurrent(this, revision, lease) && this._visible) void this.check();
    }, delay);
  },
  finish(order: ServiceOrder, lease: SessionLease) {
    this.apply(order);
    if (shouldPollOrder(order)) { this.showAwaitingPayment(); return; }
    this._unconfirmedChecks = 0;
    try { wx.removeStorageSync(pendingKey(lease.account, order.order_id)); } catch { /* Server state remains authoritative. */ }
    this.setPaymentView({ processing: false, checkingPayment: false, pendingResult: false, error: "" });
    if (order.payment_status === "PAID") wx.showToast({ title: "购买成功", icon: "success" });
  },
  async check() { await this.runPaymentFlow(false); },
  async pay() { await this.runPaymentFlow(true); },
  async runPaymentFlow(purchase: boolean) {
    const lease = captureSessionLease();
    if (!lease || !this._visible || this.data.busy || !this.data.id || (purchase && !this.data.canPay)) return;
    if (this._timer !== undefined) clearTimeout(this._timer);
    const revision = (flowRevisions.get(this) || 0) + 1;
    flowRevisions.set(this, revision);
    this._launchAllowed = purchase;
    const current = () => isFlowCurrent(this, revision, lease);
    let attempted = pending(lease.account, this.data.id) || !!this.data.order && shouldPollOrder(this.data.order);
    this.scrollToPayment();
    this.setPaymentView({ busy: true, processing: purchase, checkingPayment: !purchase,
      paymentActionPending: true, error: "" });
    try {
      let result: ServiceOrderResult;
      if (purchase) {
        await apiRequest(`/service-orders/${this.data.id}/purchase`, { method: "POST", data: { code: this.data.code } });
        if (!current() || !this._launchAllowed) return;
        const login = await wx.login();
        if (!current() || !this._launchAllowed) return;
        wx.setStorageSync(pendingKey(lease.account, this.data.id), true);
        if (!pending(lease.account, this.data.id)) throw new Error("订单保存失败，请稍后重试");
        attempted = true;
        const created = await apiRequest<ServiceOrderResult & { payment: WechatPaymentParameters | null }>(
          `/service-orders/${this.data.id}/payment-attempts`,
          { method: "POST", retry: false, data: { code: this.data.code, login_code: login.code } });
        if (!current()) return;
        this.apply(created.order);
        result = created;
        if (created.payment && this._visible && this._launchAllowed) {
          const outcome = await launchWechatPayment(created.payment);
          if (!current()) return;
          if (outcome === "cancelled") {
            this.setPaymentView({ processing: false, checkingPayment: true, pendingResult: true });
            await wait(ORDER_POLL_INTERVAL_MILLISECONDS);
            if (!current()) return;
            result = await this.checkPaymentOrder(this.data.id);
          } else {
            const polled = await this.pollPaymentOrder(created, lease, revision, this);
            if (!current()) return;
            if (!polled) { this.showAwaitingPayment(); return; }
            result = polled;
          }
        } else result = await this.checkPaymentOrder(this.data.id);
      } else result = await this.checkPaymentOrder(this.data.id);
      if (current()) this.finish(result.order, lease);
    } catch (error) {
      if (!current()) return;
      if (attempted && purchase) {
        try {
          const result = await this.checkPaymentOrder(this.data.id);
          if (!current()) return;
          this.finish(result.order, lease);
          return;
        } catch { /* Keep the exact attempt when the provider cannot be queried. */ }
      }
      if (!current()) return;
      if (attempted) this.showAwaitingPayment();
      else this.setPaymentView({ processing: false, checkingPayment: false });
      this.setData({ error: getErrorMessage(error, attempted ? "支付结果确认中" : "购买失败，请重试") });
    } finally {
      if (current()) {
        this._launchAllowed = false;
        this.setPaymentView({ busy: false, paymentActionPending: false });
        if (!attempted) this.setPaymentView({ processing: false, checkingPayment: false });
      }
    }
  },
  orders() { void navigateTo("/features/pages/orders/index?category=other&modal=1", "wx://cupertino-modal"); },
});
