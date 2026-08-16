import { ApiClientError, getErrorMessage } from "../../services/request";
import {
  getElectricityBuildings,
  queryElectricity,
} from "../../services/utilities";
import type { ElectricityAccount, ElectricityBuilding } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
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

let buildingRequestSequence = 0;
let accountRequestSequence = 0;

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
    buildingId: "",
    buildingName: "",
    draftBuildingId: "",
    buildingQuery: "",
    buildingSearchFocused: false,
    buildingPickerVisible: false,
    roomNumber: "",
    account: null as ElectricityView | null,
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    if (!this.data.allBuildings.length && !this.data.optionsLoading) {
      void this.loadBuildings();
    }
  },
  applyAppearance() {
    this.setData(resolveAppearance());
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
      this.setData({
        allBuildings: result.buildings,
        buildings: filterBuildings(result.buildings, this.data.buildingQuery),
        buildingId: selected?.id || "",
        buildingName: selected?.name || "",
      });
    } catch (error) {
      if (sequence !== buildingRequestSequence) return;
      if (isUnavailable(error)) {
        this.setData({
          serviceUnavailable: true,
          account: null,
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
    void this.loadBuildings(true);
  },
  retryService() {
    haptic("light");
    void this.loadBuildings();
  },
  openBuildingPicker() {
    if (this.data.optionsLoading || !this.data.allBuildings.length) return;
    haptic("light");
    this.setData({
      buildingPickerVisible: true,
      draftBuildingId: this.data.buildingId,
      buildingQuery: "",
      buildings: this.data.allBuildings,
    });
  },
  closeBuildingPicker() {
    this.setData({ buildingPickerVisible: false });
  },
  onBuildingSearch(event: WechatMiniprogram.Input) {
    const buildingQuery = String(event.detail.value || "");
    this.setData({
      buildingQuery,
      buildings: filterBuildings(this.data.allBuildings, buildingQuery),
    });
  },
  onBuildingSearchFocus() {
    this.setData({ buildingSearchFocused: true });
  },
  onBuildingSearchBlur() {
    this.setData({ buildingSearchFocused: false });
  },
  selectBuilding(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftBuildingId: String(event.currentTarget.dataset.id || ""),
    });
  },
  applyBuilding() {
    const selected = this.data.allBuildings.find(
      (building) => building.id === this.data.draftBuildingId,
    );
    if (!selected) {
      wx.showToast({ title: "请选择宿舍楼", icon: "none" });
      return;
    }
    haptic("light");
    this.setData({
      buildingId: selected.id,
      buildingName: selected.name,
      buildingPickerVisible: false,
      account: null,
      errorMessage: "",
    });
  },
  onRoomInput(event: WechatMiniprogram.Input): string {
    const roomNumber = String(event.detail.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    this.setData({ roomNumber, account: null, errorMessage: "" });
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
      const account = await queryElectricity({
        buildingId: this.data.buildingId,
        roomNumber: normalizedRoomNumber,
      });
      if (sequence !== accountRequestSequence) return;
      this.setData({
        account: toView(account),
        roomNumber: normalizedRoomNumber,
      });
      haptic("medium");
    } catch (error) {
      if (sequence !== accountRequestSequence) return;
      if (isUnavailable(error)) {
        this.setData({
          serviceUnavailable: true,
          account: null,
          errorMessage: "",
        });
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
});
