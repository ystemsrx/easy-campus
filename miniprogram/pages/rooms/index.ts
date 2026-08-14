import { getRoomOptions, getRooms } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import type {
  EmptyRoom,
  PeriodGroup,
  PeriodOption,
  RoomOptionsData,
  SelectOption,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatDateTime, formatFriendlyDate } from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface PeriodView extends PeriodOption {
  selected: boolean;
}

interface BuildingView extends SelectOption {
  selected: boolean;
}

interface RoomView extends EmptyRoom {
  capacityLabel: string;
  locationLabel: string;
  metaLabel: string;
}

const PAGE_SIZE = 30;
const MAX_BUILDINGS = 30;
let optionsSequence = 0;
let roomsSequence = 0;

function selectedLabels(options: SelectOption[], values: string[]): string {
  return options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label)
    .join("、");
}

function toRoomView(room: EmptyRoom): RoomView {
  const location = [
    room.campus.name,
    room.building.name,
    room.floor ? `${room.floor} 层` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const meta = [room.type, room.capacity ? `${room.capacity} 人` : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    ...room,
    capacityLabel: room.capacity ? `${room.capacity}` : "—",
    locationLabel: location || "位置信息待定",
    metaLabel: meta || "普通教室",
  };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    optionsLoading: true,
    querying: false,
    refreshing: false,
    loadingMore: false,
    errorMessage: "",
    hasQueried: false,
    date: "",
    dateDay: "日",
    dateLabel: "选择日期",
    minDate: "",
    maxDate: "",
    campuses: [] as SelectOption[],
    campusId: "",
    campusLabel: "选择校区",
    buildings: [] as BuildingView[],
    selectedBuildingIds: [] as string[],
    buildingLabel: "选择楼栋",
    periods: [] as PeriodView[],
    periodGroups: [] as PeriodGroup[],
    selectedPeriods: [] as number[],
    periodLabel: "选择节次",
    sourceName: "学校教务管理系统",
    sourceUpdatedAt: "",
    pickerVisible: false,
    pickerMode: "campus" as "campus" | "buildings" | "periods",
    pickerTitle: "",
    draftCampusId: "",
    draftBuildingIds: [] as string[],
    draftPeriods: [] as number[],
    roomItems: [] as RoomView[],
    totalRooms: 0,
    buildingSummary: [] as Array<{
      id: string;
      name: string;
      roomCount: number;
    }>,
    page: 1,
    totalPages: 1,
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    if (!this.data.campuses.length) {
      void this.loadInitialOptions();
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
  applyOptionData(data: RoomOptionsData) {
    const selectedPeriods = this.data.selectedPeriods;
    const selectedBuildingIds = this.data.selectedBuildingIds;
    this.setData({
      minDate: data.minDate,
      maxDate: data.maxDate,
      date: this.data.date || data.minDate,
      dateDay: (this.data.date || data.minDate).slice(8, 10),
      dateLabel: formatFriendlyDate(this.data.date || data.minDate),
      campuses: data.campuses,
      buildings: data.buildings.map((building) => ({
        ...building,
        selected: selectedBuildingIds.includes(building.value),
      })),
      periods: data.periods.map((period) => ({
        ...period,
        selected: selectedPeriods.includes(period.period),
      })),
      periodGroups: data.periodGroups,
      sourceName: data.source.name || "学校教务管理系统",
      sourceUpdatedAt: data.source.updatedAt
        ? formatDateTime(data.source.updatedAt)
        : "",
    });
  },
  async loadInitialOptions() {
    const sequence = ++optionsSequence;
    this.setData({ optionsLoading: true, errorMessage: "" });
    try {
      const result = await getRoomOptions();
      if (sequence !== optionsSequence) return;
      this.applyOptionData(result.data);
    } catch (error) {
      if (sequence === optionsSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "查询选项加载失败。"),
        });
      }
    } finally {
      if (sequence === optionsSequence) this.setData({ optionsLoading: false });
    }
  },
  async loadBuildings(campusId: string) {
    const sequence = ++optionsSequence;
    this.setData({ optionsLoading: true, errorMessage: "" });
    try {
      const result = await getRoomOptions(campusId);
      if (sequence !== optionsSequence) return;
      this.applyOptionData(result.data);
      const campus = result.data.campuses.find(
        (item) => item.value === campusId,
      );
      this.setData({
        campusId,
        campusLabel: campus?.label || "已选校区",
        selectedBuildingIds: [],
        buildingLabel: "选择楼栋",
        buildings: result.data.buildings.map((building) => ({
          ...building,
          selected: false,
        })),
      });
    } catch (error) {
      if (sequence === optionsSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "楼栋选项加载失败。"),
        });
      }
    } finally {
      if (sequence === optionsSequence) this.setData({ optionsLoading: false });
    }
  },
  onDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const date = event.detail.value;
    haptic("light");
    this.setData({
      date,
      dateDay: date.slice(8, 10),
      dateLabel: formatFriendlyDate(date),
      hasQueried: false,
    });
  },
  selectCampusInline(event: WechatMiniprogram.TouchEvent) {
    const campusId = String(event.currentTarget.dataset.value || "");
    if (!campusId || campusId === this.data.campusId) return;
    haptic("light");
    void this.loadBuildings(campusId);
    this.setData({ hasQueried: false, roomItems: [] });
  },
  toggleBuildingInline(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || "");
    if (!value) return;
    if (
      !this.data.selectedBuildingIds.includes(value) &&
      this.data.selectedBuildingIds.length >= MAX_BUILDINGS
    ) {
      wx.showToast({ title: `最多选择 ${MAX_BUILDINGS} 栋楼`, icon: "none" });
      return;
    }
    const selectedBuildingIds = this.data.selectedBuildingIds.includes(value)
      ? this.data.selectedBuildingIds.filter((item) => item !== value)
      : [...this.data.selectedBuildingIds, value];
    haptic("light");
    this.setData({
      selectedBuildingIds,
      draftBuildingIds: selectedBuildingIds,
      buildingLabel: selectedBuildingIds.length
        ? selectedLabels(this.data.buildings, selectedBuildingIds)
        : "选择楼栋",
      buildings: this.data.buildings.map((item) => ({
        ...item,
        selected: selectedBuildingIds.includes(item.value),
      })),
      hasQueried: false,
    });
  },
  togglePeriodInline(event: WechatMiniprogram.TouchEvent) {
    const period = Number(event.currentTarget.dataset.period);
    if (!period) return;
    const selectedPeriods = this.data.selectedPeriods.includes(period)
      ? this.data.selectedPeriods.filter((item) => item !== period)
      : [...this.data.selectedPeriods, period].sort((a, b) => a - b);
    haptic("light");
    this.setData({
      selectedPeriods,
      draftPeriods: selectedPeriods,
      periodLabel: selectedPeriods.length
        ? selectedPeriods.length === 1
          ? `第 ${selectedPeriods[0]} 节`
          : `第 ${selectedPeriods.join("、")} 节`
        : "选择节次",
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: selectedPeriods.includes(item.period),
      })),
      hasQueried: false,
    });
  },
  openCampusPicker() {
    haptic("light");
    this.setData({
      pickerVisible: true,
      pickerMode: "campus",
      pickerTitle: "选择校区",
      draftCampusId: this.data.campusId,
    });
  },
  openBuildingPicker() {
    if (!this.data.campusId) {
      wx.showToast({ title: "请先选择校区", icon: "none" });
      return;
    }
    haptic("light");
    this.setData({
      pickerVisible: true,
      pickerMode: "buildings",
      pickerTitle: "选择楼栋",
      draftBuildingIds: [...this.data.selectedBuildingIds],
      buildings: this.data.buildings.map((item) => ({
        ...item,
        selected: this.data.selectedBuildingIds.includes(item.value),
      })),
    });
  },
  openPeriodPicker() {
    haptic("light");
    this.setData({
      pickerVisible: true,
      pickerMode: "periods",
      pickerTitle: "选择节次",
      draftPeriods: [...this.data.selectedPeriods],
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: this.data.selectedPeriods.includes(item.period),
      })),
    });
  },
  closePicker() {
    this.setData({ pickerVisible: false });
  },
  selectCampus(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({ draftCampusId: String(event.currentTarget.dataset.value) });
  },
  toggleBuilding(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value);
    if (
      !this.data.draftBuildingIds.includes(value) &&
      this.data.draftBuildingIds.length >= MAX_BUILDINGS
    ) {
      wx.showToast({ title: `最多选择 ${MAX_BUILDINGS} 栋楼`, icon: "none" });
      return;
    }
    const next = this.data.draftBuildingIds.includes(value)
      ? this.data.draftBuildingIds.filter((item) => item !== value)
      : [...this.data.draftBuildingIds, value];
    haptic("light");
    this.setData({
      draftBuildingIds: next,
      buildings: this.data.buildings.map((item) => ({
        ...item,
        selected: next.includes(item.value),
      })),
    });
  },
  selectAllBuildings() {
    const all = this.data.buildings.map((item) => item.value);
    const selectable = all.slice(0, MAX_BUILDINGS);
    const next = this.data.draftBuildingIds.length ? [] : selectable;
    if (all.length > MAX_BUILDINGS && next.length) {
      wx.showToast({ title: `已选择前 ${MAX_BUILDINGS} 栋楼`, icon: "none" });
    }
    haptic("light");
    this.setData({
      draftBuildingIds: next,
      buildings: this.data.buildings.map((item) => ({
        ...item,
        selected: next.includes(item.value),
      })),
    });
  },
  togglePeriod(event: WechatMiniprogram.TouchEvent) {
    const period = Number(event.currentTarget.dataset.period);
    const next = this.data.draftPeriods.includes(period)
      ? this.data.draftPeriods.filter((item) => item !== period)
      : [...this.data.draftPeriods, period].sort((a, b) => a - b);
    haptic("light");
    this.setData({
      draftPeriods: next,
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: next.includes(item.period),
      })),
    });
  },
  togglePeriodGroup(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const group = this.data.periodGroups.find((item) => item.id === id);
    if (!group) return;
    const containsAll = group.periods.every((period) =>
      this.data.draftPeriods.includes(period),
    );
    const set = new Set(this.data.draftPeriods);
    for (const period of group.periods) {
      if (containsAll) set.delete(period);
      else set.add(period);
    }
    haptic("light");
    const next = [...set].sort((a, b) => a - b);
    this.setData({
      draftPeriods: next,
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: next.includes(item.period),
      })),
    });
  },
  applyPicker() {
    const mode = this.data.pickerMode;
    if (mode === "campus") {
      if (!this.data.draftCampusId) {
        wx.showToast({ title: "请选择校区", icon: "none" });
        return;
      }
      const changed = this.data.draftCampusId !== this.data.campusId;
      this.setData({ pickerVisible: false });
      if (changed) void this.loadBuildings(this.data.draftCampusId);
      return;
    }
    if (mode === "buildings") {
      if (!this.data.draftBuildingIds.length) {
        wx.showToast({ title: "请至少选择一栋楼", icon: "none" });
        return;
      }
      const label = selectedLabels(
        this.data.buildings,
        this.data.draftBuildingIds,
      );
      this.setData({
        selectedBuildingIds: [...this.data.draftBuildingIds],
        buildingLabel: label,
        buildings: this.data.buildings.map((item) => ({
          ...item,
          selected: this.data.draftBuildingIds.includes(item.value),
        })),
        pickerVisible: false,
        hasQueried: false,
      });
      return;
    }
    if (!this.data.draftPeriods.length) {
      wx.showToast({ title: "请至少选择一个节次", icon: "none" });
      return;
    }
    const periods = [...this.data.draftPeriods].sort((a, b) => a - b);
    this.setData({
      selectedPeriods: periods,
      periodLabel:
        periods.length === 1
          ? `第 ${periods[0]} 节`
          : `第 ${periods.join("、")} 节`,
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: periods.includes(item.period),
      })),
      pickerVisible: false,
      hasQueried: false,
    });
  },
  validateQuery(): boolean {
    if (!this.data.date) {
      wx.showToast({ title: "请选择日期", icon: "none" });
      return false;
    }
    if (!this.data.selectedPeriods.length) {
      wx.showToast({ title: "请选择节次", icon: "none" });
      return false;
    }
    if (!this.data.campusId) {
      wx.showToast({ title: "请选择校区", icon: "none" });
      return false;
    }
    if (!this.data.selectedBuildingIds.length) {
      wx.showToast({ title: "请选择楼栋", icon: "none" });
      return false;
    }
    return true;
  },
  async queryRooms(reset: boolean) {
    if (!this.validateQuery()) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++roomsSequence;
    this.setData({
      querying: reset && !this.data.roomItems.length,
      refreshing: false,
      loadingMore: !reset,
      errorMessage: "",
    });
    try {
      const result = await getRooms({
        date: this.data.date,
        periods: this.data.selectedPeriods,
        campusId: this.data.campusId,
        buildingIds: this.data.selectedBuildingIds,
        page,
        pageSize: PAGE_SIZE,
      });
      if (sequence !== roomsSequence) return;
      const incoming = result.data.items.map(toRoomView);
      this.setData({
        roomItems: reset ? incoming : [...this.data.roomItems, ...incoming],
        totalRooms: result.data.summary.totalRooms,
        buildingSummary: result.data.summary.buildings,
        sourceUpdatedAt: result.data.dataUpdatedAt
          ? formatDateTime(result.data.dataUpdatedAt)
          : this.data.sourceUpdatedAt,
        page: result.data.pagination.page,
        totalPages: result.data.pagination.totalPages,
        hasQueried: true,
      });
      if (reset) haptic("medium");
    } catch (error) {
      if (sequence === roomsSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "空教室查询失败。"),
        });
      }
    } finally {
      if (sequence === roomsSequence) {
        this.setData({
          querying: false,
          refreshing: false,
          loadingMore: false,
        });
      }
    }
  },
  onQuery() {
    void this.queryRooms(true);
  },
  onRefresh() {
    if (this.data.hasQueried) void this.queryRooms(true);
    else void this.loadInitialOptions();
  },
  loadMore() {
    if (this.data.hasQueried && this.data.page < this.data.totalPages) {
      void this.queryRooms(false);
    }
  },
});
