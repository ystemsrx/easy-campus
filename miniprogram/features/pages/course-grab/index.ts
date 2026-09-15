import { courseGrabPaymentPage } from "./payment";
import { cancelPresence, setPresence } from "../../../utils/motion";
import { buildAppShare } from "../../../utils/app-share";
import {
  getCourseGrabStatus,
  loadCourseGrabStatus,
  saveCourseGrab,
  toggleCourseGrab,
  deleteCourseGrab,
  type CourseGrabStatus,
  type CourseGrabTask,
} from "../../../services/course-grab";
import { getErrorMessage } from "../../../services/request";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import {
  localMinute,
  timePickerState,
  scheduledInstant,
  parseKeywords,
  resolveSourceTimezone,
  timeLabel,
  stateLabel,
  uuid,
} from "../../utils/course-grab";

Page({
  ...courseGrabPaymentPage,
  onShareAppMessage: buildAppShare,
  data: {
    ...courseGrabPaymentPage.data,
    ...resolveAppearance(),
    statusLoaded: false,
    refreshing: false,
    saving: false,
    error: "",
    account: "",
    entryEnabled: false,
    remaining: 0,
    reserved: 0,
    tasks: [] as Array<
      CourseGrabTask & {
        label: string;
        timeLabel: string;
        searchLabel: string;
        positiveLabel: string;
        negativeLabel: string;
      }
    >,
    observedAt: "",
    draftOpen: false,
    draftMounted: false,
    draftActive: false,
    draftBodyHeight: 0,
    draftId: "",
    editId: "",
    search: "",
    positive: "",
    negative: "",
    date: "",
    time: "",
    minDate: "",
    timeRange: [[], []] as string[][],
    timeIndices: [0, 0],
    draftError: "",
  },
  _draftRevision: 0,
  _visible: false,
  _revision: 0,
  _timer: null as ReturnType<typeof setTimeout> | null,
  onLoad(query: Record<string, string | undefined>) {
    courseGrabPaymentPage.onLoad.call(this, query);
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this._visible = true;
    courseGrabPaymentPage.onShow.call(this);
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
    const lease = captureSessionLease();
    if (!lease) return;
    if (this.data.account !== lease.account) {
      this._revision += 1;
      cancelPresence(this);
      this.setData({
        account: lease.account,
        statusLoaded: false,
        tasks: [],
        observedAt: "",
        draftOpen: false,
        draftMounted: false,
        draftActive: false,
        entryEnabled: false,
        remaining: 0,
        reserved: 0,
        saving: false,
        refreshing: false,
      });
      const cached = loadCourseGrabStatus(lease.account);
      if (cached) this.applyStatus(cached);
    }
    if (this.data.draftOpen) {
      this.prepareTimePicker();
      this.setDraftPresence(true);
    }
    void this.refresh();
  },
  onHide() {
    courseGrabPaymentPage.onHide.call(this);
    cancelPresence(this);
    this._draftRevision += 1;
    this.setData({ draftMounted: false, draftActive: false });
    this._visible = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  },
  onUnload() {
    this.onHide();
    this._revision += 1;
    courseGrabPaymentPage.onUnload.call(this);
  },
  applyStatus(status: CourseGrabStatus) {
    if (
      this.data.observedAt &&
      Date.parse(status.observedAt) < Date.parse(this.data.observedAt)
    )
      return;
    this.setData({
      statusLoaded: true,
      entryEnabled: status.entryEnabled,
      remaining: status.balance.remaining,
      reserved: status.balance.reserved,
      observedAt: status.observedAt,
      tasks: status.tasks.map((task) => ({
        ...task,
        label: stateLabel[task.state] || "已关闭",
        timeLabel: timeLabel(task.scheduledAt),
        searchLabel: task.searchKeywords.join("、"),
        positiveLabel: (task.positiveKeywords || []).join("、"),
        negativeLabel: task.negativeKeywords.join("、"),
      })),
    });
  },
  async refresh() {
    if (this.data.refreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const revision = this._revision;
    this.setData({ refreshing: true, error: "" });
    try {
      const status = await getCourseGrabStatus();
      if (this._revision === revision && isSessionLeaseCurrent(lease))
        this.applyStatus(status);
    } catch (error) {
      if (this._revision === revision && isSessionLeaseCurrent(lease))
        this.setData({ error: getErrorMessage(error, "读取失败，请重试") });
    } finally {
      if (this._revision === revision && isSessionLeaseCurrent(lease)) {
        this.setData({ refreshing: false });
        if (this._timer) clearTimeout(this._timer);
        if (this._visible)
          this._timer = setTimeout(() => {
            this._timer = null;
            void this.refresh();
          }, 5000);
      }
    }
  },
  async buy(event: WechatMiniprogram.TouchEvent) {
    if (
      !this.data.entryEnabled ||
      this.data.processing ||
      this.data.paymentActionPending
    )
      return;
    const lease = captureSessionLease();
    if (!lease) return;
    if (!this.data.loaded) await this.loadPayment();
    if (
      !this._visible ||
      !isSessionLeaseCurrent(lease) ||
      !this.data.entryEnabled
    )
      return;
    if (!this.data.paymentEnabled) {
      this.showCapsuleToast(this.data.errorMessage || "暂未开放购买");
      return;
    }
    await this.onPlanTap(event);
    if (this._visible && isSessionLeaseCurrent(lease)) void this.refresh();
  },
  retryPurchase() {
    this.retryPayment();
  },
  resumePurchase() {
    this.retryPendingPayment();
  },
  cancelPurchase() {
    this.cancelPendingPayment();
  },
  orders() {
    navigateTo(
      "/features/pages/orders/index?category=course&modal=1",
      "wx://cupertino-modal",
    );
  },
  configure(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving || !this.data.entryEnabled) return;
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    const next = localMinute(
      new Date(Math.ceil((Date.now() + 1) / 60000) * 60000),
    );
    const chosen = task ? localMinute(new Date(task.scheduledAt)) : next;
    this.setData({
      editId: id,
      draftId: id || uuid(),
      search: task?.searchKeywords.join(", ") || "",
      positive: task?.positiveKeywords?.join(", ") || "",
      negative: task?.negativeKeywords.join(", ") || "",
      ...timePickerState(chosen.date, chosen.time),
      draftError: "",
    });
    this.setDraftPresence(true);
  },
  onResize(event: WechatMiniprogram.Page.IResizeOption) {
    courseGrabPaymentPage.onResize.call(this, event);
    if (this.data.draftOpen) this.measureDraft();
  },
  measureDraft() {
    const revision = ++this._draftRevision;
    wx.nextTick(() => {
      if (
        !this._visible ||
        !this.data.draftOpen ||
        revision !== this._draftRevision
      )
        return;
      this.createSelectorQuery()
        .select(".grab-form")
        .boundingClientRect()
        .select(".grab-sheet-head")
        .boundingClientRect()
        .select(".grab-sheet-footer")
        .boundingClientRect()
        .exec((rects: WechatMiniprogram.BoundingClientRectCallbackResult[]) => {
          if (
            !this._visible ||
            !this.data.draftOpen ||
            revision !== this._draftRevision
          )
            return;
          const windowInfo = wx.getWindowInfo();
          const body = Math.ceil(rects[0]?.height || 0);
          const fixed = Math.ceil(
            (rects[1]?.height || 0) + (rects[2]?.height || 0),
          );
          const available = Math.max(
            0,
            Math.floor(windowInfo.windowHeight * 0.86) - fixed,
          );
          this.setData({ draftBodyHeight: Math.min(body, available) }, () => {
            if (
              !this.data.draftActive &&
              this._visible &&
              this.data.draftOpen &&
              revision === this._draftRevision
            )
              setPresence(this, true, {
                mounted: "draftMounted",
                active: "draftActive",
                reducedMotion: this.data.motionClass === "motion-reduced",
              });
          });
        });
    });
  },
  setDraftPresence(visible: boolean) {
    this._draftRevision += 1;
    this.setData({ draftOpen: visible });
    if (visible) {
      cancelPresence(this);
      // Give the native list a viewport for its first layout, while the sheet
      // is still offscreen. Reveal only after measuring its actual content.
      this.setData(
        {
          draftMounted: true,
          draftActive: false,
          draftBodyHeight: Math.floor(wx.getWindowInfo().windowHeight * 0.6),
        },
        () => this.measureDraft(),
      );
    } else {
      setPresence(this, false, {
        mounted: "draftMounted",
        active: "draftActive",
        reducedMotion: this.data.motionClass === "motion-reduced",
      });
    }
  },
  closeDraft() {
    if (!this.data.saving) this.setDraftPresence(false);
  },
  input(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    if (["search", "positive", "negative"].includes(field))
      this.setData({ [field]: event.detail.value });
  },
  dateChange(event: WechatMiniprogram.PickerChange) {
    this.setData(timePickerState(String(event.detail.value), this.data.time));
  },
  prepareTimePicker() {
    this.setData(timePickerState(this.data.date, this.data.time));
  },
  timeColumnChange(
    event: WechatMiniprogram.CustomEvent<{ column: number; value: number }>,
  ) {
    const { column, value } = event.detail;
    if ((column !== 0 && column !== 1) || !Number.isInteger(value)) return;
    const indices = this.data.timeIndices.slice();
    indices[column] = value;
    const hour = this.data.timeRange[0][indices[0]];
    const minute = this.data.timeRange[1][indices[1]];
    if (!hour || !minute) return;
    const state = timePickerState(
      this.data.date,
      `${hour.slice(0, 2)}:${minute.slice(0, 2)}`,
    );
    // Wheel movement is a draft; cancellation must preserve the displayed time.
    this.setData({
      timeRange: state.timeRange,
      timeIndices: state.timeIndices,
    });
  },
  timeChange(event: WechatMiniprogram.PickerChange) {
    const indices = event.detail.value;
    if (!Array.isArray(indices) || indices.length !== 2) return;
    const hour = this.data.timeRange[0][Number(indices[0])];
    const minute = this.data.timeRange[1][Number(indices[1])];
    if (!hour || !minute) return;
    this.setData(
      timePickerState(
        this.data.date,
        `${hour.slice(0, 2)}:${minute.slice(0, 2)}`,
      ),
    );
  },
  cancelTimePicker() {
    this.prepareTimePicker();
  },
  async save() {
    if (this.data.saving) return;
    const lease = captureSessionLease();
    if (!lease) return;
    try {
      const searchKeywords = parseKeywords(this.data.search, 3);
      if (!searchKeywords.length) throw new Error("请填写课程关键词");
      const scheduledAt = scheduledInstant(this.data.date, this.data.time);
      const positiveKeywords = parseKeywords(this.data.positive);
      const negativeKeywords = parseKeywords(this.data.negative);
      this.setData({ saving: true, draftError: "" });
      const sourceTimezone = resolveSourceTimezone();
      const status = await saveCourseGrab(
        {
          ...(this.data.editId ? {} : { id: this.data.draftId }),
          searchKeywords,
          positiveKeywords,
          negativeKeywords,
          scheduledAt,
          sourceTimezone,
        },
        this.data.editId || undefined,
      );
      if (!isSessionLeaseCurrent(lease)) return;
      this.applyStatus(status);
      this.setDraftPresence(false);
    } catch (error) {
      if (isSessionLeaseCurrent(lease))
        this.setData(
          {
            draftError: getErrorMessage(error, "保存失败，请重试"),
          },
          () => this.measureDraft(),
        );
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ saving: false });
    }
  },
  async toggle(event: WechatMiniprogram.CustomEvent) {
    if (this.data.saving) return;
    const task = this.data.tasks.find(
      (item) => item.id === String(event.currentTarget.dataset.id),
    );
    if (!task) return;
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({ saving: true });
    try {
      const status = await toggleCourseGrab(task.id, !task.enabled);
      if (isSessionLeaseCurrent(lease)) this.applyStatus(status);
    } catch (error) {
      if (isSessionLeaseCurrent(lease)) {
        this.showCapsuleToast(getErrorMessage(error, "操作失败，请重试"));
        this.setData({ tasks: this.data.tasks.slice() });
      }
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ saving: false });
    }
  },
  async remove() {
    if (!this.data.editId || this.data.saving) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const id = this.data.editId;
    this.setData({ saving: true });
    try {
      const status = await deleteCourseGrab(id);
      if (isSessionLeaseCurrent(lease)) {
        this.applyStatus(status);
        this.setDraftPresence(false);
      }
    } catch (error) {
      if (isSessionLeaseCurrent(lease))
        this.setData(
          {
            draftError: getErrorMessage(error, "删除失败，请重试"),
          },
          () => this.measureDraft(),
        );
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ saving: false });
    }
  },
  noop() {},
});
