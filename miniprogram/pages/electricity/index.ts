import { ApiClientError, getErrorMessage } from "../../services/request";
import {
  getElectricityAccount,
  getElectricityBuildings,
  queryElectricity,
} from "../../services/utilities";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  THREE_DAYS_MS,
} from "../../store/cache-policy";
import {
  loadElectricitySnapshot,
  saveElectricitySnapshot,
  type ElectricitySnapshot,
} from "../../store/electricity";
import { getSession } from "../../store/session";
import type {
  ElectricityAccount,
  ElectricityBuilding,
  ElectricityCachedData,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatDateTime } from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

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

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    optionsLoading: false,
    refreshing: false,
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
    account: null as ElectricityView | null,
    cacheLabel: "尚未绑定寝室",
    bindingToastMounted: false,
    bindingToastVisible: false,
  },
  onLoad() {
    activeAccount = "";
    activeSnapshot = null;
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    this.hydrateAccount();
    void this.loadSavedAccount();
    if (!this.data.buildingId && !this.data.optionsLoading) {
      void this.loadBuildings();
    }
  },
  onUnload() {
    clearBindingToastTimers();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  hydrateAccount() {
    const account = getSession()?.user.account || "";
    if (!account || account === activeAccount) return;
    activeAccount = account;
    activeSnapshot = loadElectricitySnapshot(account);
    if (activeSnapshot) this.applyElectricityData(activeSnapshot.data);
  },
  applyElectricityData(data: ElectricityCachedData) {
    const binding = data.binding;
    this.setData({
      buildingId: binding?.buildingId || "",
      buildingName: binding?.buildingName || "",
      roomNumber: binding?.roomNumber || "",
      account: data.account ? toView(data.account) : null,
      cacheLabel: activeSnapshot?.serverFetchedAt
        ? `更新于 ${formatDateTime(activeSnapshot.serverFetchedAt)}`
        : data.account
          ? "使用已保存电费"
          : "尚未绑定寝室",
    });
  },
  async loadSavedAccount() {
    const sequence = ++accountRequestSequence;
    let shouldRefreshAfterward = false;
    try {
      const result = await getElectricityAccount();
      if (sequence !== accountRequestSequence) return;
      if (shouldUseServerSnapshot(activeSnapshot, result.meta.fetchedAt)) {
        activeSnapshot = saveElectricitySnapshot(
          activeAccount,
          result.data,
          result.meta.fetchedAt,
        );
        this.applyElectricityData(result.data);
      }
      const current = loadElectricitySnapshot(activeAccount);
      shouldRefreshAfterward =
        Boolean(current?.data.binding) &&
        isCacheStale(current, THREE_DAYS_MS) &&
        claimAutomaticRefresh("electricity", activeAccount);
    } catch {
      // 服务端快照不可用时继续展示本地保存的数据。
    } finally {
      if (sequence === accountRequestSequence && shouldRefreshAfterward) {
        setTimeout(() => void this.refreshBoundAccount(), 0);
      }
    }
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  async loadBuildings(refreshing = false) {
    const sequence = ++buildingRequestSequence;
    this.setData({
      optionsLoading: !this.data.allBuildings.length,
      refreshing,
      serviceUnavailable: false,
      errorMessage: "",
    });
    try {
      const result = await getElectricityBuildings();
      if (sequence !== buildingRequestSequence) return;
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
      if (sequence !== buildingRequestSequence) return;
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
      if (sequence === buildingRequestSequence) {
        this.setData({ optionsLoading: false, refreshing: false });
      }
    }
  },
  onRefresh() {
    haptic("light");
    if (this.data.buildingId && this.data.roomNumber) {
      void this.refreshBoundAccount();
    } else {
      void this.loadBuildings(true);
    }
  },
  retryService() {
    haptic("light");
    if (this.data.buildingId && this.data.roomNumber) {
      void this.refreshBoundAccount();
    } else {
      void this.loadBuildings();
    }
  },
  openRebind() {
    haptic("light");
    this.setData({ bindingEditing: true, errorMessage: "" });
    if (!this.data.allBuildings.length && !this.data.optionsLoading) {
      void this.loadBuildings();
    }
  },
  cancelRebind() {
    const binding = activeSnapshot?.data.binding;
    this.setData({
      bindingEditing: false,
      buildingId: binding?.buildingId || "",
      buildingName: binding?.buildingName || "",
      roomNumber: binding?.roomNumber || "",
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
  async refreshBoundAccount() {
    if (!this.data.buildingId || !this.data.roomNumber) return;
    await this.queryBoundAccount(false);
  },
  async queryBoundAccount(rebinding: boolean) {
    const sequence = ++accountRequestSequence;
    const normalizedRoomNumber = /^\d{3}$/.test(this.data.roomNumber)
      ? `0${this.data.roomNumber}`
      : this.data.roomNumber;
    this.setData({
      querying: true,
      serviceUnavailable: false,
      errorMessage: "",
    });
    try {
      const result = await queryElectricity({
        buildingId: this.data.buildingId,
        buildingName: this.data.buildingName,
        roomNumber: normalizedRoomNumber,
      });
      if (sequence !== accountRequestSequence) return;
      activeSnapshot = saveElectricitySnapshot(
        activeAccount,
        result.data,
        result.meta.fetchedAt,
      );
      this.applyElectricityData(result.data);
      this.setData({ bindingEditing: false, serviceUnavailable: false });
      if (rebinding) haptic("medium");
    } catch (error) {
      if (sequence !== accountRequestSequence) return;
      if (isUnavailable(error)) {
        this.setData({
          serviceUnavailable: true,
          errorMessage: "",
        });
      } else if (isBindingLimited(error)) {
        this.setData({ errorMessage: "" });
        this.showBindingLimitToast();
      } else {
        this.setData({
          errorMessage: getErrorMessage(error, "电费查询失败。"),
        });
      }
    } finally {
      if (sequence === accountRequestSequence) {
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
