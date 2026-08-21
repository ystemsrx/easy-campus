import { getRoomOptions, getRooms } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import type {
  EmptyRoom,
  PeriodGroup,
  PeriodOption,
  RoomOptionsData,
  SelectOption,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { formatFriendlyDate, toDateString } from "../../../utils/date";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import {
  formatRoomResultDate,
  resolveInitialRoomDate,
} from "../../../utils/room-date";
import {
  groupRoomsByFloor,
  type FloorRoomGroup,
} from "../../../utils/room-floor";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";

interface PeriodView extends PeriodOption {
  selected: boolean;
}

interface BuildingView extends SelectOption {
  selected: boolean;
}

interface PeriodGroupView extends PeriodGroup {
  selected: boolean;
}

interface QuickDateView {
  date: string;
  weekdayLabel: string;
  dayLabel: string;
  selected: boolean;
}

interface RoomView extends EmptyRoom {
  capacityLabel: string;
  metaLabel: string;
}

const PAGE_SIZE = 30;
const MAX_BUILDINGS = 30;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PICKER_TRANSITION_MS = 380;
let optionsSequence = 0;
let roomsSequence = 0;
let pickerTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let resultTransitionTimer: ReturnType<typeof setTimeout> | undefined;

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function quickDates(startDate: string, selectedDate: string): QuickDateView[] {
  const start = parseLocalDate(startDate);
  if (!start) return [];
  return Array.from({ length: 7 }, (_item, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = toDateString(date);
    return {
      date: value,
      weekdayLabel: WEEKDAYS[date.getDay()],
      dayLabel: String(date.getDate()),
      selected: value === selectedDate,
    };
  });
}

function quickDateIndicatorStyle(options: QuickDateView[]): string {
  if (!options.length) return "";
  const selectedIndex = options.findIndex((item) => item.selected);
  const index = Math.max(0, selectedIndex);
  return `width: ${100 / options.length}%; transform: translateX(${index * 100}%); opacity: ${selectedIndex < 0 ? 0 : 1};`;
}

function selectQuickDate(
  options: QuickDateView[],
  date: string,
): { quickDates: QuickDateView[]; quickDateIndicatorStyle: string } {
  const next = options.map((item) => ({
    ...item,
    selected: item.date === date,
  }));
  return {
    quickDates: next,
    quickDateIndicatorStyle: quickDateIndicatorStyle(next),
  };
}

function campusIndicatorStyle(
  campuses: SelectOption[],
  campusId: string,
): string {
  if (!campuses.length) return "";
  const index = Math.max(
    0,
    campuses.findIndex((item) => item.value === campusId),
  );
  return `width: ${100 / campuses.length}%; transform: translateX(${index * 100}%);`;
}

function periodGroupsWithSelection(
  groups: PeriodGroup[],
  selectedPeriods: number[],
): PeriodGroupView[] {
  return groups.map((group) => ({
    ...group,
    selected: group.periods.every((period) => selectedPeriods.includes(period)),
  }));
}

function selectedPeriodLabel(periods: number[]): string {
  if (!periods.length) return "选择节次";
  if (periods.length === 1) return `第 ${periods[0]} 节`;
  return `第 ${periods.join("、")} 节`;
}

function clearPickerTransitionTimer() {
  if (pickerTransitionTimer) {
    clearTimeout(pickerTransitionTimer);
    pickerTransitionTimer = undefined;
  }
}

function clearResultTransitionTimer() {
  if (resultTransitionTimer) {
    clearTimeout(resultTransitionTimer);
    resultTransitionTimer = undefined;
  }
}

function toRoomView(room: EmptyRoom): RoomView {
  return {
    ...room,
    capacityLabel:
      typeof room.capacity === "number" ? `${room.capacity} 人` : "—",
    metaLabel: room.type || "普通教室",
  };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    optionsLoading: true,
    querying: false,
    loadingMore: false,
    errorMessage: "",
    hasQueried: false,
    date: "",
    dateTouched: false,
    dateLabel: "选择日期",
    minDate: "",
    maxDate: "",
    quickDates: [] as QuickDateView[],
    quickDateIndicatorStyle: "",
    campuses: [] as SelectOption[],
    campusId: "",
    campusIndicatorStyle: "",
    buildingsByCampus: {} as Record<string, SelectOption[]>,
    buildings: [] as BuildingView[],
    selectedBuildingIds: [] as string[],
    periods: [] as PeriodView[],
    periodGroups: [] as PeriodGroupView[],
    selectedPeriods: [] as number[],
    periodLabel: "选择节次",
    pickerVisible: false,
    pickerMounted: false,
    pickerActive: false,
    draftPeriods: [] as number[],
    resultVisible: false,
    resultMounted: false,
    resultActive: false,
    resultDateLabel: "",
    resultPeriodLabel: "",
    roomItems: [] as RoomView[],
    roomGroups: [] as FloorRoomGroup<RoomView>[],
    totalRooms: 0,
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
    } else {
      this.syncLateDateDefault();
    }
  },
  onUnload() {
    clearPickerTransitionTimer();
    clearResultTransitionTimer();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  applyOptionData(data: RoomOptionsData) {
    const selectedPeriods = this.data.selectedPeriods;
    const campusId = data.campuses.some(
      (item) => item.value === this.data.campusId,
    )
      ? this.data.campusId
      : data.campuses[0]?.value || "";
    const buildingsByCampus = data.buildingsByCampus || {};
    const campusBuildings = buildingsByCampus[campusId] || data.buildings;
    const selectedBuildingIds = this.data.selectedBuildingIds.filter((value) =>
      campusBuildings.some((building) => building.value === value),
    );
    const date = resolveInitialRoomDate(
      data.minDate,
      this.data.dateTouched ? this.data.date : "",
    );
    const dateOptions = quickDates(data.minDate, date);
    this.setData({
      minDate: data.minDate,
      maxDate: data.maxDate,
      date,
      dateLabel: formatFriendlyDate(date),
      quickDates: dateOptions,
      quickDateIndicatorStyle: quickDateIndicatorStyle(dateOptions),
      campuses: data.campuses,
      campusId,
      campusIndicatorStyle: campusIndicatorStyle(data.campuses, campusId),
      buildingsByCampus,
      buildings: campusBuildings.map((building) => ({
        ...building,
        selected: selectedBuildingIds.includes(building.value),
      })),
      selectedBuildingIds,
      periods: data.periods.map((period) => ({
        ...period,
        selected: selectedPeriods.includes(period.period),
      })),
      periodGroups: periodGroupsWithSelection(
        data.periodGroups,
        selectedPeriods,
      ),
    });
  },
  async loadInitialOptions() {
    const lease = captureSessionLease();
    if (!lease) return;
    const sequence = ++optionsSequence;
    this.setData({ optionsLoading: true, errorMessage: "" });
    try {
      const result = await getRoomOptions();
      if (sequence !== optionsSequence || !isSessionLeaseCurrent(lease)) return;
      this.applyOptionData(result.data);
    } catch (error) {
      if (sequence === optionsSequence && isSessionLeaseCurrent(lease)) {
        this.setData({
          errorMessage: getErrorMessage(error, "查询选项加载失败。"),
        });
      }
    } finally {
      if (sequence === optionsSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ optionsLoading: false });
      }
    }
  },
  onDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const date = event.detail.value;
    haptic("light");
    this.setData({
      date,
      dateTouched: true,
      dateLabel: formatFriendlyDate(date),
      ...selectQuickDate(this.data.quickDates, date),
      hasQueried: false,
    });
  },
  selectQuickDate(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date || "");
    if (!date || date === this.data.date) return;
    haptic("light");
    this.setData({
      date,
      dateTouched: true,
      dateLabel: formatFriendlyDate(date),
      ...selectQuickDate(this.data.quickDates, date),
      hasQueried: false,
    });
  },
  syncLateDateDefault() {
    if (this.data.dateTouched || !this.data.minDate) return;
    const date = resolveInitialRoomDate(this.data.minDate, "");
    if (!date || date === this.data.date) return;
    this.setData({
      date,
      dateLabel: formatFriendlyDate(date),
      ...selectQuickDate(this.data.quickDates, date),
      hasQueried: false,
      roomItems: [],
    });
  },
  selectCampusInline(event: WechatMiniprogram.TouchEvent) {
    const campusId = String(event.currentTarget.dataset.value || "");
    if (!campusId || campusId === this.data.campusId) return;
    haptic("light");
    this.setData({
      campusId,
      campusIndicatorStyle: campusIndicatorStyle(this.data.campuses, campusId),
      buildings: (this.data.buildingsByCampus[campusId] || []).map(
        (building) => ({ ...building, selected: false }),
      ),
      selectedBuildingIds: [],
      hasQueried: false,
      roomItems: [],
    });
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
      buildings: this.data.buildings.map((item) => ({
        ...item,
        selected: selectedBuildingIds.includes(item.value),
      })),
      hasQueried: false,
    });
  },
  openPeriodPicker() {
    haptic("light");
    clearPickerTransitionTimer();
    const draftPeriods = [...this.data.selectedPeriods];
    this.setData(
      {
        pickerVisible: true,
        pickerMounted: true,
        pickerActive: false,
        draftPeriods,
        periods: this.data.periods.map((item) => ({
          ...item,
          selected: draftPeriods.includes(item.period),
        })),
        periodGroups: periodGroupsWithSelection(
          this.data.periodGroups,
          draftPeriods,
        ),
      },
      () => {
        wx.nextTick(() => {
          if (this.data.pickerVisible) this.setData({ pickerActive: true });
        });
      },
    );
  },
  closePeriodPicker() {
    clearPickerTransitionTimer();
    const periods = [...this.data.draftPeriods].sort((a, b) => a - b);
    const selectionChanged =
      periods.length !== this.data.selectedPeriods.length ||
      periods.some(
        (period, index) => period !== this.data.selectedPeriods[index],
      );
    this.setData({
      pickerVisible: false,
      pickerActive: false,
      selectedPeriods: periods,
      periodLabel: selectedPeriodLabel(periods),
      periods: this.data.periods.map((item) => ({
        ...item,
        selected: periods.includes(item.period),
      })),
      periodGroups: periodGroupsWithSelection(this.data.periodGroups, periods),
      ...(selectionChanged ? { hasQueried: false } : {}),
    });
    pickerTransitionTimer = setTimeout(() => {
      if (!this.data.pickerVisible) this.setData({ pickerMounted: false });
      pickerTransitionTimer = undefined;
    }, PICKER_TRANSITION_MS);
  },
  toggleDraftPeriod(event: WechatMiniprogram.TouchEvent) {
    const period = Number(event.currentTarget.dataset.period);
    if (!period) return;
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
      periodGroups: periodGroupsWithSelection(this.data.periodGroups, next),
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
      periodGroups: periodGroupsWithSelection(this.data.periodGroups, next),
    });
  },
  applyPeriodPicker() {
    if (!this.data.draftPeriods.length) {
      wx.showToast({ title: "请至少选择一个节次", icon: "none" });
      return;
    }
    this.closePeriodPicker();
  },
  openResultDrawer() {
    clearResultTransitionTimer();
    this.setData(
      {
        resultVisible: true,
        resultMounted: true,
        resultActive: false,
      },
      () => {
        wx.nextTick(() => {
          if (this.data.resultVisible) this.setData({ resultActive: true });
        });
      },
    );
  },
  closeResultDrawer() {
    clearResultTransitionTimer();
    this.setData({ resultVisible: false, resultActive: false });
    resultTransitionTimer = setTimeout(() => {
      if (!this.data.resultVisible) this.setData({ resultMounted: false });
      resultTransitionTimer = undefined;
    }, PICKER_TRANSITION_MS);
  },
  noop() {
    // 用于阻止遮罩层手势穿透。
  },
  retry() {
    if (!this.data.campuses.length || !this.data.buildings.length) {
      void this.loadInitialOptions();
      return;
    }
    void this.queryRooms(true);
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
    const lease = captureSessionLease();
    if (!lease) return;
    const page = reset ? 1 : this.data.page + 1;
    const queryDate = this.data.date;
    const queryPeriods = [...this.data.selectedPeriods];
    const queryPeriodLabel = selectedPeriodLabel(queryPeriods);
    const sequence = ++roomsSequence;
    this.setData({
      querying: reset,
      loadingMore: !reset,
      errorMessage: "",
    });
    try {
      const result = await getRooms({
        date: queryDate,
        periods: queryPeriods,
        campusId: this.data.campusId,
        buildingIds: this.data.selectedBuildingIds,
        page,
        pageSize: PAGE_SIZE,
      });
      if (sequence !== roomsSequence || !isSessionLeaseCurrent(lease)) return;
      const incoming = result.data.items.map(toRoomView);
      const roomItems = reset
        ? incoming
        : [...this.data.roomItems, ...incoming];
      this.setData(
        {
          roomItems,
          roomGroups: groupRoomsByFloor(roomItems),
          totalRooms: result.data.summary.totalRooms,
          resultDateLabel: formatRoomResultDate(queryDate),
          resultPeriodLabel: queryPeriodLabel,
          page: result.data.pagination.page,
          totalPages: result.data.pagination.totalPages,
          hasQueried: true,
        },
        () => {
          if (reset) this.openResultDrawer();
        },
      );
      if (reset) haptic("medium");
    } catch (error) {
      if (sequence === roomsSequence && isSessionLeaseCurrent(lease)) {
        const errorMessage = getErrorMessage(error, "空教室查询失败。");
        if (reset && errorMessage) {
          this.setData(
            {
              errorMessage,
              hasQueried: true,
              roomItems: [],
              roomGroups: [],
              totalRooms: 0,
              resultDateLabel: formatRoomResultDate(queryDate),
              resultPeriodLabel: queryPeriodLabel,
              page: 1,
              totalPages: 1,
            },
            () => this.openResultDrawer(),
          );
        } else if (errorMessage) {
          wx.showToast({ title: errorMessage, icon: "none" });
        }
      }
    } finally {
      if (sequence === roomsSequence && isSessionLeaseCurrent(lease)) {
        this.setData({
          querying: false,
          loadingMore: false,
        });
      }
    }
  },
  onQuery() {
    void this.queryRooms(true);
  },
  loadMore() {
    if (
      this.data.resultVisible &&
      !this.data.querying &&
      !this.data.loadingMore &&
      this.data.hasQueried &&
      this.data.page < this.data.totalPages
    ) {
      void this.queryRooms(false);
    }
  },
});
