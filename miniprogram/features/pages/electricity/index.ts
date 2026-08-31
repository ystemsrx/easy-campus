import {
  ApiClientError,
  getErrorMessage,
  shouldShowRefreshFailureFeedback,
} from "../../../services/request";
import { queryElectricity } from "../../../services/electricity";
import { getElectricityBuildings } from "../../services/utilities";
import { refreshElectricityOnForeground } from "../../../services/cache-refresh";
import {
  loadElectricitySnapshot,
  saveElectricitySnapshot,
  type ElectricitySnapshot,
} from "../../../store/electricity";
import { isUpstreamRefreshResult } from "../../../store/cache-policy";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import type {
  ElectricityAccount,
  ElectricityBuilding,
  ElectricityCachedData,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { formatDateTime } from "../../../utils/date";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../utils/refresh-flight";
import {
  showRefreshConfirmation,
  showRefreshFailure,
} from "../../utils/refresh-feedback";

interface ElectricityView {
  billedElectricityLabel: string;
  electricityFeeLabel: string;
  remainingAmountLabel: string;
  balanceNegative: boolean;
  lastPaymentDateLabel: string;
  lastSettlementDateLabel: string;
}

interface ElectricityBuildingRow {
  id: string;
  items: ElectricityBuilding[];
}

interface ElectricityRefreshInput {
  buildingId: string;
  buildingName: string;
  roomNumber: string;
}

interface ElectricityRefreshOutcome {
  succeeded: boolean;
  showFailureFeedback?: boolean;
  input: ElectricityRefreshInput;
  result: Awaited<ReturnType<typeof queryElectricity>> | null;
  errorMessage: string;
  unavailable: boolean;
}

const BINDING_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

let buildingRequestSequence = 0;
let accountRequestSequence = 0;
let activeAccount = "";
let activeSnapshot: ElectricitySnapshot | null = null;
let bindingToastShowTimer: ReturnType<typeof setTimeout> | undefined;
let bindingToastHideTimer: ReturnType<typeof setTimeout> | undefined;
let bindingToastUnmountTimer: ReturnType<typeof setTimeout> | undefined;

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function toView(account: ElectricityAccount): ElectricityView {
  return {
    billedElectricityLabel: formatDecimal(account.billedElectricityKwh),
    electricityFeeLabel: formatDecimal(account.electricityFeeYuan),
    remainingAmountLabel: formatDecimal(account.remainingAmountYuan),
    balanceNegative: account.remainingAmountYuan < 0,
    lastPaymentDateLabel: account.lastPaymentDate || "暂无记录",
    lastSettlementDateLabel: account.lastSettlementDate || "暂无记录",
  };
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.code === "ELECTRICITY_SERVICE_UNAVAILABLE"
  );
}

function isBindingLimited(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.code === "ELECTRICITY_BINDING_LIMIT"
  );
}

function electricityRefreshFlightKey(lease: SessionLease): string {
  return `electricity:${sessionLeaseKey(lease)}`;
}

async function refreshElectricity(
  lease: SessionLease,
  input: ElectricityRefreshInput,
): Promise<ElectricityRefreshOutcome> {
  const normalizedRoomNumber = /^\d{3}$/.test(input.roomNumber)
    ? `0${input.roomNumber}`
    : input.roomNumber;
  try {
    const result = await queryElectricity({
      buildingId: input.buildingId,
      buildingName: input.buildingName,
      roomNumber: normalizedRoomNumber,
    });
    if (!isSessionLeaseCurrent(lease)) {
      return {
        succeeded: false,
        input,
        result: null,
        errorMessage: "",
        unavailable: false,
      };
    }
    const refreshed = isUpstreamRefreshResult(result.meta);
    if (refreshed) {
      saveElectricitySnapshot(
        lease.account,
        result.data,
        result.meta.fetchedAt,
      );
    }
    return {
      succeeded: refreshed,
      showFailureFeedback: !refreshed && result.meta.stale === true,
      input,
      result,
      errorMessage: "",
      unavailable: false,
    };
  } catch (error) {
    const unavailable = isUnavailable(error);
    return {
      succeeded: false,
      showFailureFeedback:
        unavailable || shouldShowRefreshFailureFeedback(error),
      input,
      result: null,
      errorMessage: unavailable ? "" : getErrorMessage(error, "电费查询失败。"),
      unavailable,
    };
  }
}

function clearBindingToastTimers(): void {
  if (bindingToastShowTimer !== undefined) {
    clearTimeout(bindingToastShowTimer);
    bindingToastShowTimer = undefined;
  }
  if (bindingToastHideTimer !== undefined) {
    clearTimeout(bindingToastHideTimer);
    bindingToastHideTimer = undefined;
  }
  if (bindingToastUnmountTimer !== undefined) {
    clearTimeout(bindingToastUnmountTimer);
    bindingToastUnmountTimer = undefined;
  }
}

function filterBuildings(
  buildings: ElectricityBuilding[],
  query: string,
): ElectricityBuilding[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return buildings;
  return buildings.filter(
    (building) =>
      building.name.toLowerCase().includes(normalized) ||
      building.id.toLowerCase().includes(normalized),
  );
}

function toBuildingRows(
  buildings: ElectricityBuilding[],
): ElectricityBuildingRow[] {
  const rows: ElectricityBuildingRow[] = [];
  for (let index = 0; index < buildings.length; index += 2) {
    const items = buildings.slice(index, index + 2);
    rows.push({
      id: items.map((building) => building.id).join(":"),
      items,
    });
  }
  return rows;
}

function isBindingCooldownActive(
  binding: ElectricityCachedData["binding"],
  fallbackTimestamp = "",
): boolean {
  if (!binding) return false;
  const reference =
    binding.changedAt || binding.boundAt || fallbackTimestamp || "";
  const referenceTime = new Date(reference).getTime();
  if (!Number.isFinite(referenceTime)) return false;
  return Date.now() - referenceTime < BINDING_COOLDOWN_MS;
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    optionsLoading: false,
    querying: false,
    serviceUnavailable: false,
    errorMessage: "",
    allBuildings: [] as ElectricityBuilding[],
    buildings: [] as ElectricityBuilding[],
    buildingRows: [] as ElectricityBuildingRow[],
    buildingId: "",
    buildingName: "",
    draftBuildingId: "",
    buildingQuery: "",
    buildingSearchFocused: false,
    buildingPickerVisible: false,
    bindingEditing: false,
    roomNumber: "",
    boundBuildingId: "",
    boundBuildingName: "",
    boundRoomNumber: "",
    account: null as ElectricityView | null,
    cacheLabel: "尚未绑定寝室",
    bindingToastMounted: false,
    bindingToastVisible: false,
    refreshPageToken: 0,
    observedRefreshFlightId: 0,
  },
  onLoad() {
    buildingRequestSequence += 1;
    accountRequestSequence += 1;
    activeAccount = "";
    activeSnapshot = null;
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    this.setData({ refreshPageToken });
    this.applyAppearance();
    this.syncActiveElectricityRefresh();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    markRefreshPageVisible(this.data.refreshPageToken);
    this.applyAppearance();
    this.hydrateAccount();
    if (!this.syncActiveElectricityRefresh()) {
      void this.loadSavedAccount();
    }
    if (!this.data.buildingId && !this.data.optionsLoading) {
      void this.loadBuildings();
    }
  },
  onHide() {
    markRefreshPageHidden(this.data.refreshPageToken);
  },
  onUnload() {
    markRefreshPageHidden(this.data.refreshPageToken);
    clearBindingToastTimers();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  hydrateAccount() {
    const account = getSession()?.user.account || "";
    if (!account || account === activeAccount) return;
    if (activeAccount) {
      accountRequestSequence += 1;
      buildingRequestSequence += 1;
      clearBindingToastTimers();
      this.setData({
        optionsLoading: false,
        querying: false,
        serviceUnavailable: false,
        errorMessage: "",
        buildingId: "",
        buildingName: "",
        draftBuildingId: "",
        buildingQuery: "",
        buildingSearchFocused: false,
        buildingPickerVisible: false,
        bindingEditing: false,
        roomNumber: "",
        boundBuildingId: "",
        boundBuildingName: "",
        boundRoomNumber: "",
        account: null,
        cacheLabel: "尚未绑定寝室",
        bindingToastMounted: false,
        bindingToastVisible: false,
      });
    }
    activeAccount = account;
    activeSnapshot = loadElectricitySnapshot(account);
    this.applyElectricityData(
      activeSnapshot?.data || { binding: null, account: null },
    );
  },
  syncActiveElectricityRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<ElectricityRefreshOutcome>(
          electricityRefreshFlightKey(lease),
        )
      : null;
    if (!lease || !flight) {
      if (this.data.querying || this.data.observedRefreshFlightId) {
        this.setData({ querying: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    this.observeElectricityRefresh(flight, lease);
    return true;
  },
  observeElectricityRefresh(
    flight: RefreshFlight<ElectricityRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedRefreshFlightId === flight.id) {
      if (!this.data.querying) this.setData({ querying: true });
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({ querying: true, observedRefreshFlightId: flight.id });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({ querying: false, observedRefreshFlightId: 0 });
      if (!outcome.succeeded || !outcome.result) {
        if (outcome.showFailureFeedback) showRefreshFailure(this);
        this.setData({
          serviceUnavailable: outcome.unavailable,
          errorMessage: outcome.errorMessage,
        });
        return;
      }
      activeSnapshot = loadElectricitySnapshot(lease.account);
      this.applyElectricityData(outcome.result.data);
      this.setData({
        bindingEditing: false,
        serviceUnavailable: false,
        errorMessage: "",
      });
      showRefreshConfirmation(this);
    });
  },
  applyElectricityData(data: ElectricityCachedData) {
    const binding = data.binding;
    const bindingFields = {
      boundBuildingId: binding?.buildingId || "",
      boundBuildingName: binding?.buildingName || "",
      boundRoomNumber: binding?.roomNumber || "",
      account: data.account ? toView(data.account) : null,
      cacheLabel: activeSnapshot?.serverFetchedAt
        ? `更新于 ${formatDateTime(activeSnapshot.serverFetchedAt)}`
        : data.account
          ? "使用已保存电费"
          : "尚未绑定寝室",
    };
    if (this.data.bindingEditing && this.data.account) {
      this.setData(bindingFields);
      return;
    }
    this.setData({
      ...bindingFields,
      buildingId: binding?.buildingId || "",
      buildingName: binding?.buildingName || "",
      roomNumber: binding?.roomNumber || "",
    });
  },
  async loadSavedAccount() {
    const lease = captureSessionLease();
    if (!lease) return;
    const sequence = ++accountRequestSequence;
    try {
      const snapshot = await refreshElectricityOnForeground();
      if (
        sequence !== accountRequestSequence ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return;
      }
      if (snapshot) {
        activeSnapshot = snapshot;
        this.applyElectricityData(snapshot.data);
      }
    } catch {
      // 服务端快照不可用时继续展示本地保存的数据。
    }
  },
  async loadBuildings() {
    const lease = captureSessionLease();
    if (!lease) return;
    const sequence = ++buildingRequestSequence;
    this.setData({
      optionsLoading: !this.data.allBuildings.length,
      serviceUnavailable: false,
      errorMessage: "",
    });
    try {
      const result = await getElectricityBuildings();
      if (
        sequence !== buildingRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      const selected = result.buildings.find(
        (building) => building.id === this.data.buildingId,
      );
      const buildings = filterBuildings(
        result.buildings,
        this.data.buildingQuery,
      );
      this.setData({
        allBuildings: result.buildings,
        buildings,
        buildingRows: toBuildingRows(buildings),
        buildingId: selected?.id || "",
        buildingName: selected?.name || "",
      });
    } catch (error) {
      if (
        sequence !== buildingRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      if (isUnavailable(error)) {
        this.setData({
          serviceUnavailable: true,
          errorMessage: "",
        });
      } else {
        this.setData({
          errorMessage: getErrorMessage(error, "宿舍楼加载失败。"),
        });
      }
    } finally {
      if (
        sequence === buildingRequestSequence &&
        isSessionLeaseCurrent(lease)
      ) {
        this.setData({ optionsLoading: false });
      }
    }
  },
  retryService() {
    if (this.data.boundBuildingId && this.data.boundRoomNumber) {
      void this.onRefreshBoundAccount();
    } else {
      haptic("light");
      void this.loadBuildings();
    }
  },
  openRebind() {
    haptic("light");
    const binding = activeSnapshot?.data.binding || null;
    if (
      isBindingCooldownActive(binding, activeSnapshot?.serverFetchedAt || "")
    ) {
      this.showBindingLimitToast();
      return;
    }
    this.setData({
      bindingEditing: true,
      buildingId: this.data.boundBuildingId,
      buildingName: this.data.boundBuildingName,
      roomNumber: this.data.boundRoomNumber,
      errorMessage: "",
    });
    if (!this.data.allBuildings.length && !this.data.optionsLoading) {
      void this.loadBuildings();
    }
  },
  cancelRebind() {
    this.setData({
      bindingEditing: false,
      buildingId: this.data.boundBuildingId,
      buildingName: this.data.boundBuildingName,
      roomNumber: this.data.boundRoomNumber,
      errorMessage: "",
    });
  },
  openBuildingPicker() {
    if (this.data.optionsLoading) return;
    if (!this.data.allBuildings.length) {
      void this.loadBuildings();
      return;
    }
    haptic("light");
    this.setData({
      buildingPickerVisible: true,
      draftBuildingId: this.data.buildingId,
      buildingQuery: "",
      buildings: this.data.allBuildings,
      buildingRows: toBuildingRows(this.data.allBuildings),
    });
  },
  closeBuildingPicker() {
    this.setData({ buildingPickerVisible: false });
  },
  onBuildingSearch(event: WechatMiniprogram.Input) {
    const buildingQuery = String(event.detail.value || "");
    const buildings = filterBuildings(this.data.allBuildings, buildingQuery);
    this.setData({
      buildingQuery,
      buildings,
      buildingRows: toBuildingRows(buildings),
    });
  },
  onBuildingSearchFocus() {
    this.setData({ buildingSearchFocused: true });
  },
  onBuildingSearchBlur() {
    this.setData({ buildingSearchFocused: false });
  },
  selectBuilding(event: WechatMiniprogram.TouchEvent) {
    const selected = this.data.allBuildings.find(
      (building) =>
        building.id === String(event.currentTarget.dataset.id || ""),
    );
    if (!selected) return;
    haptic("light");
    this.setData({
      draftBuildingId: selected.id,
      buildingId: selected.id,
      buildingName: selected.name,
      buildingPickerVisible: false,
      errorMessage: "",
    });
  },
  onRoomInput(event: WechatMiniprogram.Input): string {
    const roomNumber = String(event.detail.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    this.setData({ roomNumber, errorMessage: "" });
    return roomNumber;
  },
  async onQuery() {
    if (!this.data.buildingId) {
      wx.showToast({ title: "请选择宿舍楼", icon: "none" });
      return;
    }
    if (!/^[A-Z0-9]{1,4}$/.test(this.data.roomNumber)) {
      wx.showToast({ title: "请输入 1 至 4 位寝室号", icon: "none" });
      return;
    }
    await this.queryBoundAccount(true);
  },
  async refreshBoundAccount(): Promise<boolean> {
    if (!this.data.boundBuildingId || !this.data.boundRoomNumber) return false;
    const lease = captureSessionLease();
    const activeRefresh = lease
      ? findRefreshFlight<ElectricityRefreshOutcome>(
          electricityRefreshFlightKey(lease),
        )
      : null;
    if (lease && activeRefresh) {
      this.observeElectricityRefresh(activeRefresh, lease);
      return (await activeRefresh.completion).succeeded;
    }
    return this.queryBoundAccount(false);
  },
  onRefreshBoundAccount() {
    if (this.data.querying) return;
    const lease = captureSessionLease();
    if (
      !lease ||
      activeAccount !== lease.account ||
      !this.data.boundBuildingId ||
      !this.data.boundRoomNumber
    ) {
      return;
    }
    const input: ElectricityRefreshInput = {
      buildingId: this.data.boundBuildingId,
      buildingName: this.data.boundBuildingName,
      roomNumber: this.data.boundRoomNumber,
    };
    const { flight, started } = startRefreshFlight(
      electricityRefreshFlightKey(lease),
      () => refreshElectricity(lease, input),
    );
    this.observeElectricityRefresh(flight, lease);
    if (started) {
      accountRequestSequence += 1;
      haptic("light");
    }
  },
  async queryBoundAccount(rebinding: boolean): Promise<boolean> {
    const lease = captureSessionLease();
    if (!lease || activeAccount !== lease.account) return false;
    const sequence = ++accountRequestSequence;
    const buildingId = rebinding
      ? this.data.buildingId
      : this.data.boundBuildingId;
    const buildingName = rebinding
      ? this.data.buildingName
      : this.data.boundBuildingName;
    const roomNumber = rebinding
      ? this.data.roomNumber
      : this.data.boundRoomNumber;
    const normalizedRoomNumber = /^\d{3}$/.test(roomNumber)
      ? `0${roomNumber}`
      : roomNumber;
    this.setData({
      querying: true,
      serviceUnavailable: false,
      errorMessage: "",
    });
    try {
      const result = await queryElectricity({
        buildingId,
        buildingName,
        roomNumber: normalizedRoomNumber,
      });
      if (
        sequence !== accountRequestSequence ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return false;
      }
      if (!isUpstreamRefreshResult(result.meta)) {
        activeSnapshot = loadElectricitySnapshot(activeAccount);
        if (activeSnapshot) this.applyElectricityData(activeSnapshot.data);
        return false;
      }
      activeSnapshot = saveElectricitySnapshot(
        activeAccount,
        result.data,
        result.meta.fetchedAt,
      );
      this.applyElectricityData(result.data);
      this.setData({ bindingEditing: false, serviceUnavailable: false });
      if (rebinding) haptic("medium");
      return true;
    } catch (error) {
      if (
        sequence !== accountRequestSequence ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return false;
      }
      if (isUnavailable(error)) {
        this.setData({
          serviceUnavailable: true,
          errorMessage: "",
        });
      } else if (isBindingLimited(error)) {
        this.setData({
          bindingEditing: false,
          buildingId: this.data.boundBuildingId,
          buildingName: this.data.boundBuildingName,
          roomNumber: this.data.boundRoomNumber,
          errorMessage: "",
        });
        this.showBindingLimitToast();
      } else {
        this.setData({
          errorMessage: getErrorMessage(error, "电费查询失败。"),
        });
      }
      return false;
    } finally {
      if (
        sequence === accountRequestSequence &&
        isSessionLeaseCurrent(lease) &&
        activeAccount === lease.account
      ) {
        this.setData({ querying: false });
      }
    }
  },
  showBindingLimitToast() {
    clearBindingToastTimers();
    this.setData(
      { bindingToastMounted: true, bindingToastVisible: false },
      () => {
        bindingToastShowTimer = setTimeout(() => {
          bindingToastShowTimer = undefined;
          this.setData({ bindingToastVisible: true });
          bindingToastHideTimer = setTimeout(() => {
            bindingToastHideTimer = undefined;
            this.setData({ bindingToastVisible: false });
            bindingToastUnmountTimer = setTimeout(() => {
              bindingToastUnmountTimer = undefined;
              if (!this.data.bindingToastVisible) {
                this.setData({ bindingToastMounted: false });
              }
            }, 320);
          }, 3000);
        }, 16);
      },
    );
  },
});
