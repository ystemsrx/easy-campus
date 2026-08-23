import {
  coursesForWeek,
  teachingWeekForDate,
  timetableWeekCount,
  timetableWeekForDisplay,
  type TimetableCourse,
} from "../../../data/timetable";
import {
  buildTimetablePeriodRows,
  buildTimetableWeekPage,
  buildTimetableWeekPlaceholder,
  getPrewarmedTimetableFirstScreen,
  prewarmTimetableFirstScreen,
  timetableGridLayoutMetrics,
  timetableMaxPeriod,
  type TimetableGridLayoutMetrics,
  type TimetablePeriodRow,
  type TimetableWeekPage,
} from "../../../data/timetable-render";
import {
  DEFAULT_TIMETABLE_COMPANION_COLOR,
  loadTimetableThemeId,
  TIMETABLE_THEME_OPTIONS,
  TIMETABLE_THEME_STORAGE_KEY,
  timetableThemePatch,
  type TimetableThemeId,
} from "../../../data/timetable-theme";
import { getErrorMessage } from "../../../services/request";
import { getPassRates, getTimetable } from "../../../services/teaching";
import {
  claimAutomaticRefresh,
  FIFTEEN_DAYS_MS,
  isCacheStale,
  shouldUseServerSnapshot,
} from "../../../store/cache-policy";
import {
  DEFAULT_PET_PREFERENCES,
  loadPetPreferences,
  shouldShowPet,
  type PetPreferences,
} from "../../../store/pet";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
  type TimetableSnapshot,
} from "../../../store/timetable";
import type {
  AcademicSemesterOption,
  PassRateCourse,
  PassRateStatistics,
  TimetableData,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { formatScore } from "../../../utils/format";
import { haptic } from "../../../utils/haptics";
import { preloadTimetableThemeAssets } from "../../../utils/icon-preload";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../../utils/refresh-flight";
import { showRefreshConfirmation } from "../../../utils/refresh-feedback";
import {
  shortAcademicSemesterLabel,
  timetableSemesterMenuLabel,
} from "../../../utils/semester";

interface TimetableSemesterOption extends AcademicSemesterOption {
  displayLabel: string;
}

interface TimetableWeekMenuOption {
  weekNumber: number;
  startDateLabel: string;
}

interface TimetableWeekMenuRow {
  id: string;
  weeks: TimetableWeekMenuOption[];
}

interface PassRateSheetHeightInput {
  loading: boolean;
  errorMessage: string;
  courseName: string;
  status: "ready" | "collecting";
  hasStatistics: boolean;
  showOwnScore: boolean;
  message: string;
}

interface TimetableCompanionInstance {
  setExternalGazeTarget(x: number, y: number): void;
  clearExternalGaze(): void;
  playInteraction(): void;
}

interface TimetableGazeTarget {
  x: number;
  y: number;
}

type TimetableClawdSceneName =
  | "walking"
  | "lurking"
  | "waving"
  | "jumping"
  | "dancing"
  | "laptop"
  | "magnifier"
  | "racing"
  | "rowing-intro"
  | "rowing-outro"
  | "rowing";

type TimetableClawdActionName =
  "waving" | "jumping" | "dancing" | "laptop" | "magnifier";
type TimetableClawdEdge = "left" | "right";
type TimetableClawdTravelMode = "walking" | "racing";
type TimetableClawdArrivalMode =
  "lurking" | TimetableClawdTravelMode | "rowing";
type TimetableClawdDepartureMode = TimetableClawdTravelMode | "rowing";
type TimetableClawdJourneyStepKind =
  | "lurking"
  | "arrival"
  | "action"
  | "bridge-exit"
  | "bridge-enter"
  | "farewell"
  | "rowing-intro"
  | "rowing-outro"
  | "exit";

interface TimetableClawdJourneyStep {
  kind: TimetableClawdJourneyStepKind;
  scene: TimetableClawdSceneName;
  positionStyle: string;
  motionClass: string;
  mediaClass: string;
  durationMs: number;
  exitOffscreen: boolean;
  restartOffscreen: boolean;
}

interface TimetableClawdJourney {
  arrivalMode: TimetableClawdArrivalMode;
  entryEdge: TimetableClawdEdge;
  stopPoint: TimetableClawdStopPoint;
  bridgeCount: number;
  bridgeModes: readonly TimetableClawdTravelMode[];
  actionBlocks: readonly (readonly TimetableClawdActionName[])[];
  exitEdge: TimetableClawdEdge;
  departureMode: TimetableClawdDepartureMode;
  actionNames: readonly TimetableClawdActionName[];
  steps: readonly TimetableClawdJourneyStep[];
}

interface TimetableClawdRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TimetableClawdStopLayoutInput {
  courses: readonly TimetableCourse[];
  maxPeriod: number;
  headerHeightPx: number;
  metrics: TimetableGridLayoutMetrics;
}

interface TimetableClawdStopLayoutGeometry {
  gridTopRpx: number;
  gridBottomRpx: number;
  rowHeightRpx: number;
  minimumBaselineRpx: number;
  maximumBaselineRpx: number;
  verticalPhaseLimitRpx: number;
}

interface TimetableClawdStopPoint {
  cellKey: string;
  columnIndex: number;
  rowIndex: number;
  centerXRpx: number;
  baselineYRpx: number;
  stageLeftRpx: number;
  stageTopRpx: number;
  obstructionScore: number;
  positionStyle: string;
}

interface TimetableClawdJourneyPlanner {
  actionBag: TimetableClawdActionName[];
  actionCountBag: number[];
  arrivalBag: TimetableClawdArrivalMode[];
  bridgeCountBag: number[];
  bridgeModeBag: TimetableClawdTravelMode[];
  departureBag: TimetableClawdDepartureMode[];
  lastAction: TimetableClawdActionName | "";
  lastArrivalMode: TimetableClawdArrivalMode | "";
  arrivalModeRunLength: number;
  lastBridgeMode: TimetableClawdTravelMode | "";
  bridgeModeRunLength: number;
  lastEntryEdge: TimetableClawdEdge | "";
  entryEdgeRunLength: number;
  lastStopCellKey: string;
  lastExitEdge: TimetableClawdEdge | "";
  exitEdgeRunLength: number;
  lastDepartureMode: TimetableClawdDepartureMode | "";
  departureModeRunLength: number;
}

const BACKGROUND_WIDTH = 854;
const BACKGROUND_HEIGHT = 1920;
const MODAL_HEADER_EDGE_INSET_RPX = 24;
const HEADER_BUTTON_GAP_RPX = 12;
const TIMETABLE_MENU_LEFT_RPX = 88;
const MAIN_MENU_HEIGHT = 516;
const MENU_TRANSITION_MS = 260;
const WEEK_MENU_TRANSITION_MS = 260;
const CLAWD_BASELINE_HANDOFF_MS = 80;
const CLAWD_WALKING_SOURCE_DURATION_MS = 1860;
const CLAWD_LURKING_SOURCE_DURATION_MS = 5580;
const CLAWD_WAVING_SOURCE_DURATION_MS = 1410;
const CLAWD_JUMPING_SOURCE_DURATION_MS = 1760;
const CLAWD_DANCING_SOURCE_DURATION_MS = 3330;
const CLAWD_LAPTOP_SOURCE_DURATION_MS = 3580;
const CLAWD_MAGNIFIER_SOURCE_DURATION_MS = 9410;
const CLAWD_RACING_SOURCE_DURATION_MS = 4010;
const CLAWD_ROWING_INTRO_SOURCE_DURATION_MS = 2170;
const CLAWD_ROWING_OUTRO_SOURCE_DURATION_MS = 2170;
const CLAWD_ROWING_SOURCE_DURATION_MS = 1760;
const CLAWD_WALKING_DURATION_MS =
  CLAWD_WALKING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_LURKING_DURATION_MS = CLAWD_LURKING_SOURCE_DURATION_MS;
const CLAWD_WAVING_DURATION_MS =
  CLAWD_WAVING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_JUMPING_DURATION_MS =
  CLAWD_JUMPING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_DANCING_DURATION_MS =
  CLAWD_DANCING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_LAPTOP_DURATION_MS =
  CLAWD_LAPTOP_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_MAGNIFIER_DURATION_MS =
  CLAWD_MAGNIFIER_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_RACING_DURATION_MS =
  CLAWD_RACING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_ROWING_INTRO_DURATION_MS = CLAWD_ROWING_INTRO_SOURCE_DURATION_MS;
const CLAWD_ROWING_OUTRO_DURATION_MS = CLAWD_ROWING_OUTRO_SOURCE_DURATION_MS;
const CLAWD_ROWING_DURATION_MS =
  CLAWD_ROWING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
const CLAWD_QUIET_RANGE_MS = [900, 2800] as const;
const CLAWD_FAREWELL_CHANCE = 0.32;
const CLAWD_MIRRORED_MEDIA_CLASS = "clawd-scene-media--mirrored";
const CLAWD_STAGE_WIDTH_RPX = 360;
const CLAWD_STAGE_HEIGHT_RPX = 242;
const CLAWD_GRID_LEFT_RPX = 74;
const CLAWD_GRID_WIDTH_RPX = 666;
const CLAWD_GRID_HEAD_RPX = 84;
const CLAWD_STOP_COLUMN_COUNT = 7;
const CLAWD_STOP_ROW_COUNT = 7;
const CLAWD_STOP_POOL_SIZE = 6;
const CLAWD_STOP_X_RANGE_RPX = [170, 580] as const;
const CLAWD_STOP_X_PHASE_RPX = 22;
const CLAWD_STOP_CORE_BOUNDS = [71, 46, 319, 242] as const;
const CLAWD_STOP_HALO_BOUNDS = [12, 26, 338, 242] as const;
const CLAWD_STOP_HALO_WEIGHT = 0.22;
const CLAWD_VEHICLE_ROUTE_RATIOS = {
  tiny: 3 / 560,
  small: 13 / 560,
  medium: 29 / 560,
  easing: 51 / 560,
  decelStart: 80 / 560,
  raceExitNear: 430 / 560,
  rowNear: 460 / 560,
  raceEntryReveal: 506 / 560,
  raceBridgeNearEdge: 534 / 560,
} as const;
const CLAWD_ACTIONS: readonly TimetableClawdActionName[] = [
  "waving",
  "jumping",
  "dancing",
  "laptop",
  "magnifier",
];
const CLAWD_WEIGHTED_ARRIVALS: readonly TimetableClawdArrivalMode[] = [
  "lurking",
  "walking",
  "walking",
  "racing",
  "rowing",
];
const CLAWD_ACTION_BLOCK_SIZES: readonly number[] = [1, 1, 2, 2, 3];
const CLAWD_BRIDGE_COUNTS: readonly number[] = [0, 0, 1, 1, 2];
const CLAWD_WEIGHTED_BRIDGE_MODES: readonly TimetableClawdTravelMode[] = [
  "walking",
  "walking",
  "racing",
  "racing",
];
const CLAWD_WEIGHTED_DEPARTURES: readonly TimetableClawdDepartureMode[] = [
  "walking",
  "walking",
  "racing",
  "rowing",
];
const CLAWD_SCENE_SOURCES: Record<TimetableClawdSceneName, string> = {
  walking: "/features/assets/timetable/timetable-theme-clawd-walking.gif",
  lurking: "/assets/login/lurking.gif",
  waving: "/assets/login/waving.gif",
  jumping: "/features/assets/timetable/timetable-theme-clawd-jumping.gif",
  dancing: "/assets/login/dancing.gif",
  laptop: "/assets/login/laptop.gif",
  magnifier: "/assets/login/magnifier.gif",
  racing: "/features/assets/timetable/timetable-theme-clawd-racing-car.gif",
  "rowing-intro":
    "/features/assets/timetable/timetable-theme-clawd-rowing-intro.gif",
  "rowing-outro":
    "/features/assets/timetable/timetable-theme-clawd-rowing-outro.gif",
  rowing: "/features/assets/timetable/timetable-theme-clawd-rowing.gif",
};
const CLAWD_ACTION_DURATIONS: Record<TimetableClawdActionName, number> = {
  waving: CLAWD_WAVING_DURATION_MS,
  jumping: CLAWD_JUMPING_DURATION_MS,
  dancing: CLAWD_DANCING_DURATION_MS,
  laptop: CLAWD_LAPTOP_DURATION_MS,
  magnifier: CLAWD_MAGNIFIER_DURATION_MS,
};

function randomIntegerInclusive(
  range: readonly [number, number],
  random: () => number = Math.random,
): number {
  const [minimum, maximum] = range;
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function fisherYatesShuffle<T>(
  values: readonly T[],
  random: () => number,
): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function refillNoAdjacentBag<T>(
  values: readonly T[],
  previousValue: T | "",
  random: () => number,
): T[] {
  const shuffled = fisherYatesShuffle(values, random);
  if (previousValue !== "" && shuffled[0] === previousValue) {
    const replacementIndex = shuffled.findIndex(
      (value) => value !== previousValue,
    );
    if (replacementIndex > 0) {
      [shuffled[0], shuffled[replacementIndex]] = [
        shuffled[replacementIndex],
        shuffled[0],
      ];
    }
  }
  return shuffled;
}

function drawNoAdjacentBagValue<T>(
  bag: T[],
  values: readonly T[],
  previousValue: T | "",
  random: () => number,
): T {
  if (bag.length === 0) {
    bag.push(...refillNoAdjacentBag(values, previousValue, random));
  }
  const value = bag.shift();
  if (value === undefined) throw new Error("Unable to draw a Clawd bag value");
  return value;
}

function drawBagValue<T>(
  bag: T[],
  values: readonly T[],
  random: () => number,
): T {
  if (bag.length === 0) bag.push(...fisherYatesShuffle(values, random));
  const value = bag.shift();
  if (value === undefined) throw new Error("Unable to draw a Clawd bag value");
  return value;
}

function orderClawdRunBoundedBag<T extends string>(
  candidates: readonly T[],
  previousValue: T | "",
  previousRunLength: number,
): T[] | null {
  if (candidates.length === 0) return [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === previousValue && previousRunLength >= 2) continue;
    const remaining = [
      ...candidates.slice(0, index),
      ...candidates.slice(index + 1),
    ];
    const nextRunLength =
      candidate === previousValue ? previousRunLength + 1 : 1;
    const orderedTail = orderClawdRunBoundedBag(
      remaining,
      candidate,
      nextRunLength,
    );
    if (orderedTail) return [candidate, ...orderedTail];
  }
  return null;
}

function refillClawdRunBoundedBag<T extends string>(
  values: readonly T[],
  previousValue: T | "",
  previousRunLength: number,
  random: () => number,
): T[] {
  const ordered = orderClawdRunBoundedBag(
    fisherYatesShuffle(values, random),
    previousValue,
    previousRunLength,
  );
  if (!ordered) throw new Error("Unable to build a Clawd run-bounded bag");
  return ordered;
}

function drawClawdArrivalMode(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdArrivalMode {
  if (planner.arrivalBag.length === 0) {
    planner.arrivalBag.push(
      ...refillClawdRunBoundedBag(
        CLAWD_WEIGHTED_ARRIVALS,
        planner.lastArrivalMode,
        planner.arrivalModeRunLength,
        random,
      ),
    );
  }
  const mode = planner.arrivalBag.shift();
  if (!mode) throw new Error("Unable to draw a Clawd arrival mode");
  planner.arrivalModeRunLength =
    mode === planner.lastArrivalMode ? planner.arrivalModeRunLength + 1 : 1;
  planner.lastArrivalMode = mode;
  return mode;
}

function drawClawdBridgeMode(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdTravelMode {
  if (planner.bridgeModeBag.length === 0) {
    planner.bridgeModeBag.push(
      ...refillClawdRunBoundedBag(
        CLAWD_WEIGHTED_BRIDGE_MODES,
        planner.lastBridgeMode,
        planner.bridgeModeRunLength,
        random,
      ),
    );
  }
  const mode = planner.bridgeModeBag.shift();
  if (!mode) throw new Error("Unable to draw a Clawd bridge mode");
  planner.bridgeModeRunLength =
    mode === planner.lastBridgeMode ? planner.bridgeModeRunLength + 1 : 1;
  planner.lastBridgeMode = mode;
  return mode;
}

function isClawdDepartureSafe(
  previousMode: TimetableClawdDepartureMode | "",
  previousRunLength: number,
  candidate: TimetableClawdDepartureMode,
): boolean {
  if (candidate === "walking") {
    return previousMode !== "walking" || previousRunLength < 2;
  }
  return candidate !== previousMode;
}

function orderClawdDepartureBag(
  candidates: readonly TimetableClawdDepartureMode[],
  previousMode: TimetableClawdDepartureMode | "",
  previousRunLength: number,
): TimetableClawdDepartureMode[] | null {
  if (candidates.length === 0) return [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!isClawdDepartureSafe(previousMode, previousRunLength, candidate)) {
      continue;
    }
    const remaining = [
      ...candidates.slice(0, index),
      ...candidates.slice(index + 1),
    ];
    const nextRunLength =
      candidate === previousMode ? previousRunLength + 1 : 1;
    const orderedTail = orderClawdDepartureBag(
      remaining,
      candidate,
      nextRunLength,
    );
    if (orderedTail) return [candidate, ...orderedTail];
  }
  return null;
}

function refillClawdDepartureBag(
  previousMode: TimetableClawdDepartureMode | "",
  previousRunLength: number,
  random: () => number,
): TimetableClawdDepartureMode[] {
  const shuffled = fisherYatesShuffle(CLAWD_WEIGHTED_DEPARTURES, random);
  const ordered = orderClawdDepartureBag(
    shuffled,
    previousMode,
    previousRunLength,
  );
  if (!ordered) throw new Error("Unable to build a Clawd departure bag");
  return ordered;
}

function drawClawdDepartureMode(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdDepartureMode {
  if (planner.departureBag.length === 0) {
    planner.departureBag.push(
      ...refillClawdDepartureBag(
        planner.lastDepartureMode,
        planner.departureModeRunLength,
        random,
      ),
    );
  }
  const mode = planner.departureBag.shift();
  if (!mode) throw new Error("Unable to draw a Clawd departure mode");
  planner.departureModeRunLength =
    mode === planner.lastDepartureMode ? planner.departureModeRunLength + 1 : 1;
  planner.lastDepartureMode = mode;
  return mode;
}

function clampClawdNumber(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clawdRandomUnit(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? clampClawdNumber(value, 0, 1) : 0.5;
}

function clawdStopLayoutGeometry(
  input: TimetableClawdStopLayoutInput,
): TimetableClawdStopLayoutGeometry {
  const scale =
    Number.isFinite(input.metrics.scale) && input.metrics.scale > 0
      ? input.metrics.scale
      : 1;
  const maxPeriod = Math.max(1, Math.floor(input.maxPeriod) || 1);
  const headerHeightPx = Number.isFinite(input.headerHeightPx)
    ? Math.max(0, input.headerHeightPx)
    : 0;
  const headerHeightRpx = headerHeightPx / scale;
  const gridTopRpx = headerHeightRpx + CLAWD_GRID_HEAD_RPX;
  const rowHeightRpx =
    Number.isFinite(input.metrics.rowHeightPx) && input.metrics.rowHeightPx > 0
      ? input.metrics.rowHeightPx / scale
      : 1;
  const gridBottomRpx = gridTopRpx + rowHeightRpx * maxPeriod;
  const minimumBaselineRpx = Math.min(
    gridBottomRpx - 12,
    gridTopRpx + (CLAWD_STAGE_HEIGHT_RPX - CLAWD_STOP_CORE_BOUNDS[1]),
  );
  const maximumBaselineRpx = Math.max(minimumBaselineRpx, gridBottomRpx - 12);
  return {
    gridTopRpx,
    gridBottomRpx,
    rowHeightRpx,
    minimumBaselineRpx,
    maximumBaselineRpx,
    verticalPhaseLimitRpx: Math.min(26, rowHeightRpx * 0.35),
  };
}

function clawdRectangleIntersectionArea(
  left: TimetableClawdRectangle,
  right: TimetableClawdRectangle,
): number {
  const width = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  return width * height;
}

function clawdVisibleCourseRectangles(
  input: TimetableClawdStopLayoutInput,
  geometry: TimetableClawdStopLayoutGeometry = clawdStopLayoutGeometry(input),
): TimetableClawdRectangle[] {
  const scale =
    Number.isFinite(input.metrics.scale) && input.metrics.scale > 0
      ? input.metrics.scale
      : 1;
  const maxPeriod = Math.max(1, Math.floor(input.maxPeriod) || 1);
  const dayWidthRpx = CLAWD_GRID_WIDTH_RPX / 7;
  const courseTopInsetRpx = input.metrics.courseTopInsetPx / scale;
  const courseHeightExtensionRpx =
    input.metrics.courseHeightExtensionPx / scale;
  return input.courses.flatMap((course) => {
    const weekday = Number(course.weekday);
    const rawPeriodStart = Number(course.periodStart);
    const rawPeriodEnd = Number(course.periodEnd);
    if (
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7 ||
      !Number.isFinite(rawPeriodStart) ||
      !Number.isFinite(rawPeriodEnd)
    ) {
      return [];
    }
    const periodStart = clampClawdNumber(
      Math.floor(rawPeriodStart),
      1,
      maxPeriod,
    );
    const periodEnd = clampClawdNumber(Math.floor(rawPeriodEnd), 1, maxPeriod);
    if (periodEnd < periodStart) return [];
    const left = CLAWD_GRID_LEFT_RPX + (weekday - 1) * dayWidthRpx;
    const top =
      geometry.gridTopRpx +
      (periodStart - 1) * geometry.rowHeightRpx +
      courseTopInsetRpx;
    return [
      {
        left,
        right: left + dayWidthRpx,
        top,
        bottom:
          top +
          (periodEnd - periodStart + 1) * geometry.rowHeightRpx +
          (periodEnd < maxPeriod ? courseHeightExtensionRpx : 0),
      },
    ];
  });
}

function clawdTranslatedStageBounds(
  stageLeftRpx: number,
  stageTopRpx: number,
  bounds: readonly [number, number, number, number],
): TimetableClawdRectangle {
  return {
    left: stageLeftRpx + bounds[0],
    top: stageTopRpx + bounds[1],
    right: stageLeftRpx + bounds[2],
    bottom: stageTopRpx + bounds[3],
  };
}

function clawdStopObstructionScore(
  stageLeftRpx: number,
  stageTopRpx: number,
  courseRectangles: readonly TimetableClawdRectangle[],
): number {
  const coreRectangle = clawdTranslatedStageBounds(
    stageLeftRpx,
    stageTopRpx,
    CLAWD_STOP_CORE_BOUNDS,
  );
  const haloRectangle = clawdTranslatedStageBounds(
    stageLeftRpx,
    stageTopRpx,
    CLAWD_STOP_HALO_BOUNDS,
  );
  return courseRectangles.reduce((score, courseRectangle) => {
    const coreOverlap = clawdRectangleIntersectionArea(
      coreRectangle,
      courseRectangle,
    );
    const haloOverlap = clawdRectangleIntersectionArea(
      haloRectangle,
      courseRectangle,
    );
    return (
      score +
      coreOverlap +
      Math.max(0, haloOverlap - coreOverlap) * CLAWD_STOP_HALO_WEIGHT
    );
  }, 0);
}

function clawdRouteOffsets(centerXRpx: number) {
  const walkLeftFar = -(centerXRpx + 95);
  const walkRightFar = 845 - centerXRpx;
  const vehicleLeftFar = -(centerXRpx + 185);
  const vehicleRightFar = 935 - centerXRpx;
  return {
    walkLeftFar,
    walkRightFar,
    walkLeftReveal: walkLeftFar * (414 / 470),
    walkRightReveal: walkRightFar * (414 / 470),
    walkLeftNear: walkLeftFar * (390 / 470),
    walkRightNear: walkRightFar * (390 / 470),
    lurkLeftHold: 180 - centerXRpx,
    lurkRightHold: 570 - centerXRpx,
    vehicleLeftFar,
    vehicleRightFar,
    vehicleLeftTiny: vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.tiny,
    vehicleRightTiny: vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.tiny,
    vehicleLeftSmall: vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.small,
    vehicleRightSmall: vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.small,
    vehicleLeftMedium: vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.medium,
    vehicleRightMedium: vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.medium,
    vehicleLeftEasing: vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.easing,
    vehicleRightEasing: vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.easing,
    vehicleLeftDecelStart:
      vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.decelStart,
    vehicleRightDecelStart:
      vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.decelStart,
    vehicleLeftRaceExitNear:
      vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceExitNear,
    vehicleRightRaceExitNear:
      vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceExitNear,
    vehicleLeftRowNear: vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.rowNear,
    vehicleRightRowNear: vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.rowNear,
    vehicleLeftRaceEntryReveal:
      vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceEntryReveal,
    vehicleRightRaceEntryReveal:
      vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceEntryReveal,
    vehicleLeftRaceBridgeNearEdge:
      vehicleLeftFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceBridgeNearEdge,
    vehicleRightRaceBridgeNearEdge:
      vehicleRightFar * CLAWD_VEHICLE_ROUTE_RATIOS.raceBridgeNearEdge,
  };
}

function formatClawdRpx(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("Invalid Clawd route coordinate");
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded.toFixed(2)}rpx`;
}

function clawdStopPositionStyle(
  centerXRpx: number,
  baselineYRpx: number,
): string {
  const route = clawdRouteOffsets(centerXRpx);
  const declarations: readonly [string, number][] = [
    ["left", centerXRpx - CLAWD_STAGE_WIDTH_RPX / 2],
    ["top", baselineYRpx - CLAWD_STAGE_HEIGHT_RPX],
    ["--clawd-walk-left-far", route.walkLeftFar],
    ["--clawd-walk-right-far", route.walkRightFar],
    ["--clawd-walk-left-reveal", route.walkLeftReveal],
    ["--clawd-walk-right-reveal", route.walkRightReveal],
    ["--clawd-walk-left-near", route.walkLeftNear],
    ["--clawd-walk-right-near", route.walkRightNear],
    ["--clawd-lurk-left-hold", route.lurkLeftHold],
    ["--clawd-lurk-right-hold", route.lurkRightHold],
    ["--clawd-vehicle-left-far", route.vehicleLeftFar],
    ["--clawd-vehicle-right-far", route.vehicleRightFar],
    ["--clawd-vehicle-left-tiny", route.vehicleLeftTiny],
    ["--clawd-vehicle-right-tiny", route.vehicleRightTiny],
    ["--clawd-vehicle-left-small", route.vehicleLeftSmall],
    ["--clawd-vehicle-right-small", route.vehicleRightSmall],
    ["--clawd-vehicle-left-medium", route.vehicleLeftMedium],
    ["--clawd-vehicle-right-medium", route.vehicleRightMedium],
    ["--clawd-vehicle-left-easing", route.vehicleLeftEasing],
    ["--clawd-vehicle-right-easing", route.vehicleRightEasing],
    ["--clawd-vehicle-left-decel-start", route.vehicleLeftDecelStart],
    ["--clawd-vehicle-right-decel-start", route.vehicleRightDecelStart],
    ["--clawd-vehicle-left-race-exit-near", route.vehicleLeftRaceExitNear],
    ["--clawd-vehicle-right-race-exit-near", route.vehicleRightRaceExitNear],
    ["--clawd-vehicle-left-row-near", route.vehicleLeftRowNear],
    ["--clawd-vehicle-right-row-near", route.vehicleRightRowNear],
    [
      "--clawd-vehicle-left-race-entry-reveal",
      route.vehicleLeftRaceEntryReveal,
    ],
    [
      "--clawd-vehicle-right-race-entry-reveal",
      route.vehicleRightRaceEntryReveal,
    ],
    [
      "--clawd-vehicle-left-race-bridge-near-edge",
      route.vehicleLeftRaceBridgeNearEdge,
    ],
    [
      "--clawd-vehicle-right-race-bridge-near-edge",
      route.vehicleRightRaceBridgeNearEdge,
    ],
  ];
  return declarations
    .map(([property, value]) => `${property}: ${formatClawdRpx(value)};`)
    .join(" ");
}

const CLAWD_DEFAULT_POSITION_STYLE = clawdStopPositionStyle(375, 560);

function clawdStopCandidates(
  input: TimetableClawdStopLayoutInput,
  horizontalPhaseRpx: number,
  verticalPhaseRpx: number,
): TimetableClawdStopPoint[] {
  const geometry = clawdStopLayoutGeometry(input);
  const courseRectangles = clawdVisibleCourseRectangles(input, geometry);
  const xPhase = clampClawdNumber(
    horizontalPhaseRpx,
    -CLAWD_STOP_X_PHASE_RPX,
    CLAWD_STOP_X_PHASE_RPX,
  );
  const yPhase = clampClawdNumber(
    verticalPhaseRpx,
    -geometry.verticalPhaseLimitRpx,
    geometry.verticalPhaseLimitRpx,
  );
  const xMinimum = CLAWD_STOP_X_RANGE_RPX[0] - CLAWD_STOP_X_PHASE_RPX;
  const xMaximum = CLAWD_STOP_X_RANGE_RPX[1] + CLAWD_STOP_X_PHASE_RPX;
  const candidates: TimetableClawdStopPoint[] = [];
  for (let rowIndex = 0; rowIndex < CLAWD_STOP_ROW_COUNT; rowIndex += 1) {
    const rowProgress = rowIndex / Math.max(1, CLAWD_STOP_ROW_COUNT - 1);
    const baseBaselineYRpx =
      geometry.minimumBaselineRpx +
      (geometry.maximumBaselineRpx - geometry.minimumBaselineRpx) * rowProgress;
    const baselineYRpx = clampClawdNumber(
      baseBaselineYRpx + yPhase,
      geometry.minimumBaselineRpx,
      geometry.maximumBaselineRpx,
    );
    for (
      let columnIndex = 0;
      columnIndex < CLAWD_STOP_COLUMN_COUNT;
      columnIndex += 1
    ) {
      const columnProgress =
        columnIndex / Math.max(1, CLAWD_STOP_COLUMN_COUNT - 1);
      const baseCenterXRpx =
        CLAWD_STOP_X_RANGE_RPX[0] +
        (CLAWD_STOP_X_RANGE_RPX[1] - CLAWD_STOP_X_RANGE_RPX[0]) *
          columnProgress;
      const centerXRpx = clampClawdNumber(
        baseCenterXRpx + xPhase,
        xMinimum,
        xMaximum,
      );
      const stageLeftRpx = centerXRpx - CLAWD_STAGE_WIDTH_RPX / 2;
      const stageTopRpx = baselineYRpx - CLAWD_STAGE_HEIGHT_RPX;
      candidates.push({
        cellKey: `${columnIndex}:${rowIndex}`,
        columnIndex,
        rowIndex,
        centerXRpx,
        baselineYRpx,
        stageLeftRpx,
        stageTopRpx,
        obstructionScore: clawdStopObstructionScore(
          stageLeftRpx,
          stageTopRpx,
          courseRectangles,
        ),
        positionStyle: clawdStopPositionStyle(centerXRpx, baselineYRpx),
      });
    }
  }
  return candidates;
}

function drawClawdStopPoint(
  planner: TimetableClawdJourneyPlanner,
  input: TimetableClawdStopLayoutInput,
  random: () => number,
): TimetableClawdStopPoint {
  const horizontalPhaseRpx =
    (clawdRandomUnit(random) * 2 - 1) * CLAWD_STOP_X_PHASE_RPX;
  const verticalPhaseLimitRpx =
    clawdStopLayoutGeometry(input).verticalPhaseLimitRpx;
  const verticalPhaseRpx =
    (clawdRandomUnit(random) * 2 - 1) * verticalPhaseLimitRpx;
  const rankedCandidates = fisherYatesShuffle(
    clawdStopCandidates(input, horizontalPhaseRpx, verticalPhaseRpx),
    random,
  ).sort((left, right) => left.obstructionScore - right.obstructionScore);
  const pool = rankedCandidates.slice(0, CLAWD_STOP_POOL_SIZE);
  const nonRepeatingPool = pool.filter(
    (candidate) => candidate.cellKey !== planner.lastStopCellKey,
  );
  const eligible = nonRepeatingPool.length > 0 ? nonRepeatingPool : pool;
  const selected =
    eligible[
      Math.min(
        eligible.length - 1,
        Math.floor(clawdRandomUnit(random) * eligible.length),
      )
    ];
  if (!selected) throw new Error("Unable to draw a Clawd stop point");
  planner.lastStopCellKey = selected.cellKey;
  return selected;
}

function drawClawdEntryEdge(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdEdge {
  const edge =
    planner.entryEdgeRunLength >= 2 && planner.lastEntryEdge
      ? oppositeClawdEdge(planner.lastEntryEdge)
      : clawdRandomUnit(random) < 0.5
        ? "left"
        : "right";
  planner.entryEdgeRunLength =
    edge === planner.lastEntryEdge ? planner.entryEdgeRunLength + 1 : 1;
  planner.lastEntryEdge = edge;
  return edge;
}

function drawClawdExitEdge(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdEdge {
  const edge =
    planner.exitEdgeRunLength >= 2 && planner.lastExitEdge
      ? planner.lastExitEdge === "left"
        ? "right"
        : "left"
      : clawdRandomUnit(random) < 0.5
        ? "left"
        : "right";
  planner.exitEdgeRunLength =
    edge === planner.lastExitEdge ? planner.exitEdgeRunLength + 1 : 1;
  planner.lastExitEdge = edge;
  return edge;
}

function clawdTravelMediaClass(direction: TimetableClawdEdge): string {
  return direction === "left" ? CLAWD_MIRRORED_MEDIA_CLASS : "";
}

function oppositeClawdEdge(edge: TimetableClawdEdge): TimetableClawdEdge {
  return edge === "left" ? "right" : "left";
}

function clawdJourneyStep(
  kind: TimetableClawdJourneyStepKind,
  scene: TimetableClawdSceneName,
  positionStyle: string,
  motionClass: string,
  durationMs: number,
  mediaClass = "",
  exitOffscreen = false,
  restartOffscreen = false,
): TimetableClawdJourneyStep {
  return {
    kind,
    scene,
    positionStyle,
    motionClass,
    mediaClass,
    durationMs,
    exitOffscreen,
    restartOffscreen,
  };
}

function clawdTravelJourneyStep(
  kind: "arrival" | "bridge-enter" | "bridge-exit" | "exit",
  mode: TimetableClawdTravelMode,
  route: "enter" | "exit",
  edge: TimetableClawdEdge,
  positionStyle: string,
  restartOffscreen = false,
): TimetableClawdJourneyStep {
  const entering = route === "enter";
  const mediaDirection = entering ? oppositeClawdEdge(edge) : edge;
  const motionPrefix =
    mode === "walking"
      ? entering
        ? "clawd-scene-motion--emerge-from-"
        : "clawd-scene-motion--walk-exit-"
      : entering
        ? "clawd-scene-motion--race-enter-"
        : kind === "bridge-exit"
          ? "clawd-scene-motion--race-bridge-exit-"
          : "clawd-scene-motion--race-exit-";
  return clawdJourneyStep(
    kind,
    mode,
    positionStyle,
    motionPrefix + edge,
    mode === "walking" ? CLAWD_WALKING_DURATION_MS : CLAWD_RACING_DURATION_MS,
    clawdTravelMediaClass(mediaDirection),
    !entering,
    restartOffscreen,
  );
}

function createClawdJourneyPlanner(): TimetableClawdJourneyPlanner {
  return {
    actionBag: [],
    actionCountBag: [],
    arrivalBag: [],
    bridgeCountBag: [],
    bridgeModeBag: [],
    departureBag: [],
    lastAction: "",
    lastArrivalMode: "",
    arrivalModeRunLength: 0,
    lastBridgeMode: "",
    bridgeModeRunLength: 0,
    lastEntryEdge: "",
    entryEdgeRunLength: 0,
    lastStopCellKey: "",
    lastExitEdge: "",
    exitEdgeRunLength: 0,
    lastDepartureMode: "",
    departureModeRunLength: 0,
  };
}

function drawClawdAction(
  planner: TimetableClawdJourneyPlanner,
  random: () => number,
): TimetableClawdActionName {
  const action = drawNoAdjacentBagValue(
    planner.actionBag,
    CLAWD_ACTIONS,
    planner.lastAction,
    random,
  );
  planner.lastAction = action;
  return action;
}

function appendClawdActionBlock(
  steps: TimetableClawdJourneyStep[],
  actionBlocks: TimetableClawdActionName[][],
  planner: TimetableClawdJourneyPlanner,
  positionStyle: string,
  mediaClass: string,
  random: () => number,
): void {
  const actionCount = drawBagValue(
    planner.actionCountBag,
    CLAWD_ACTION_BLOCK_SIZES,
    random,
  );
  const actionBlock: TimetableClawdActionName[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    const action = drawClawdAction(planner, random);
    actionBlock.push(action);
    steps.push(
      clawdJourneyStep(
        "action",
        action,
        positionStyle,
        "clawd-scene-motion--anchored",
        CLAWD_ACTION_DURATIONS[action],
        mediaClass,
      ),
    );
  }
  actionBlocks.push(actionBlock);
}

function buildClawdJourney(
  planner: TimetableClawdJourneyPlanner,
  stopLayoutInput: TimetableClawdStopLayoutInput,
  random: () => number = Math.random,
): TimetableClawdJourney {
  const arrivalMode = drawClawdArrivalMode(planner, random);
  const stopPoint = drawClawdStopPoint(planner, stopLayoutInput, random);
  const entryEdge = drawClawdEntryEdge(planner, random);
  const bridgeCount = drawBagValue(
    planner.bridgeCountBag,
    CLAWD_BRIDGE_COUNTS,
    random,
  );
  const positionStyle = stopPoint.positionStyle;
  const entryMediaClass = clawdTravelMediaClass(oppositeClawdEdge(entryEdge));
  const steps: TimetableClawdJourneyStep[] = [];
  if (arrivalMode === "lurking") {
    steps.push(
      clawdJourneyStep(
        "lurking",
        "lurking",
        positionStyle,
        "clawd-scene-motion--lurk-from-" + entryEdge,
        CLAWD_LURKING_DURATION_MS,
        entryMediaClass,
      ),
      clawdTravelJourneyStep(
        "arrival",
        "walking",
        "enter",
        entryEdge,
        positionStyle,
      ),
    );
  } else if (arrivalMode === "rowing") {
    steps.push(
      clawdJourneyStep(
        "arrival",
        "rowing",
        positionStyle,
        "clawd-scene-motion--row-enter-" + entryEdge,
        CLAWD_ROWING_DURATION_MS,
        entryMediaClass,
      ),
      clawdJourneyStep(
        "rowing-outro",
        "rowing-outro",
        positionStyle,
        "clawd-scene-motion--anchored",
        CLAWD_ROWING_OUTRO_DURATION_MS,
        entryMediaClass,
      ),
    );
  } else {
    steps.push(
      clawdTravelJourneyStep(
        "arrival",
        arrivalMode,
        "enter",
        entryEdge,
        positionStyle,
      ),
    );
  }

  const actionBlocks: TimetableClawdActionName[][] = [];
  appendClawdActionBlock(
    steps,
    actionBlocks,
    planner,
    positionStyle,
    entryMediaClass,
    random,
  );

  const bridgeModes: TimetableClawdTravelMode[] = [];
  let activeMediaClass = entryMediaClass;
  for (let index = 0; index < bridgeCount; index += 1) {
    const bridgeMode = drawClawdBridgeMode(planner, random);
    const bridgeExitEdge = drawClawdExitEdge(planner, random);
    const bridgeEntryEdge = oppositeClawdEdge(bridgeExitEdge);
    const bridgeExit = clawdTravelJourneyStep(
      "bridge-exit",
      bridgeMode,
      "exit",
      bridgeExitEdge,
      positionStyle,
    );
    const bridgeEnter = clawdTravelJourneyStep(
      "bridge-enter",
      bridgeMode,
      "enter",
      bridgeEntryEdge,
      positionStyle,
      true,
    );
    bridgeModes.push(bridgeMode);
    steps.push(bridgeExit, bridgeEnter);
    activeMediaClass = bridgeEnter.mediaClass;
    appendClawdActionBlock(
      steps,
      actionBlocks,
      planner,
      positionStyle,
      activeMediaClass,
      random,
    );
  }

  const exitEdge = drawClawdExitEdge(planner, random);
  const departureMode = drawClawdDepartureMode(planner, random);
  const exitMediaClass = clawdTravelMediaClass(exitEdge);
  const actionNames = actionBlocks.flat();
  const lastAction = actionNames[actionNames.length - 1];
  if (lastAction !== "waving" && random() < CLAWD_FAREWELL_CHANCE) {
    steps.push(
      clawdJourneyStep(
        "farewell",
        "waving",
        positionStyle,
        "clawd-scene-motion--anchored",
        CLAWD_WAVING_DURATION_MS,
        exitMediaClass,
      ),
    );
  }

  if (departureMode === "rowing") {
    steps.push(
      clawdJourneyStep(
        "rowing-intro",
        "rowing-intro",
        positionStyle,
        "clawd-scene-motion--anchored",
        CLAWD_ROWING_INTRO_DURATION_MS,
        exitMediaClass,
      ),
      clawdJourneyStep(
        "exit",
        "rowing",
        positionStyle,
        "clawd-scene-motion--row-exit-" + exitEdge,
        CLAWD_ROWING_DURATION_MS,
        exitMediaClass,
        true,
      ),
    );
  } else {
    steps.push(
      clawdTravelJourneyStep(
        "exit",
        departureMode,
        "exit",
        exitEdge,
        positionStyle,
      ),
    );
  }

  return {
    arrivalMode,
    entryEdge,
    stopPoint,
    bridgeCount,
    bridgeModes,
    actionBlocks,
    exitEdge,
    departureMode,
    actionNames,
    steps,
  };
}

interface InFlightTimetableRequest {
  refresh: boolean;
  completion: Promise<boolean>;
}

interface TimetableRefreshOutcome {
  succeeded: boolean;
  semester?: string;
}

let activeTimetable: TimetableData | null = null;
let visibleCourses: TimetableCourse[] = [];
const timetableRequestsInFlight = new Map<string, InFlightTimetableRequest>();
let activeAccount = "";
let defaultSemesterId = "";
let activeSnapshot: TimetableSnapshot | null = null;
let weekMenuOpenTimer: ReturnType<typeof setTimeout> | undefined;
let weekMenuUnmountTimer: ReturnType<typeof setTimeout> | undefined;
let menuOpenTimer: ReturnType<typeof setTimeout> | undefined;
let menuUnmountTimer: ReturnType<typeof setTimeout> | undefined;
let weekBuildTimer: ReturnType<typeof setTimeout> | undefined;
let companionGazeTimer: ReturnType<typeof setTimeout> | undefined;
let clawdSceneTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCompanionGaze: TimetableGazeTarget | null = null;
let clawdSequenceRevision = 0;
let clawdSceneStepIndex = 0;
let clawdJourneyPlanner = createClawdJourneyPlanner();
let clawdActiveJourney: TimetableClawdJourney | null = null;
let weekBuildSequence = 0;
let visibleRequestSequence = 0;
let pendingVisibleRequestId: number | null = null;
let passRateRequestSequence = 0;
let pageAlive = false;

function timetableRequestKey(lease: SessionLease, semester?: string): string {
  return `${sessionLeaseKey(lease)}:${semester || "default"}`;
}

function timetableRefreshFlightKey(lease: SessionLease): string {
  return `timetable:${sessionLeaseKey(lease)}`;
}

async function refreshTimetableSnapshot(
  lease: SessionLease,
  semester?: string,
): Promise<boolean> {
  if (!isSessionLeaseCurrent(lease)) return false;
  const requestKey = timetableRequestKey(lease, semester);
  const existingRequest = timetableRequestsInFlight.get(requestKey);
  if (existingRequest) {
    const succeeded = await existingRequest.completion;
    if (!isSessionLeaseCurrent(lease)) return false;
    return existingRequest.refresh
      ? succeeded
      : refreshTimetableSnapshot(lease, semester);
  }

  let resolveCompletion: (succeeded: boolean) => void = () => undefined;
  const completion = new Promise<boolean>((resolve) => {
    resolveCompletion = resolve;
  });
  timetableRequestsInFlight.set(requestKey, { refresh: true, completion });
  void (async () => {
    let succeeded = false;
    try {
      const result = await getTimetable({ semester, refresh: true });
      if (isSessionLeaseCurrent(lease)) {
        saveTimetableSnapshot(lease.account, result.data, {
          semesterId: semester,
          serverFetchedAt: result.meta.fetchedAt,
        });
        succeeded = true;
      }
    } catch {
      // 手动刷新失败时保留已有课表，下次进入或再次操作时可重试。
    } finally {
      if (
        timetableRequestsInFlight.get(requestKey)?.completion === completion
      ) {
        timetableRequestsInFlight.delete(requestKey);
      }
      resolveCompletion(succeeded);
    }
  })();
  return completion;
}

function resetClawdSceneScheduler(): void {
  clawdSceneStepIndex = 0;
  clawdJourneyPlanner = createClawdJourneyPlanner();
  clawdActiveJourney = null;
}

function timetableSemesterOptions(
  semesters: AcademicSemesterOption[],
): TimetableSemesterOption[] {
  return semesters.map((semester) => ({
    ...semester,
    displayLabel: timetableSemesterMenuLabel(semester),
  }));
}

function submenuHeight(semesterCount: number): number {
  return Math.min(590, Math.max(250, 104 + Math.min(6, semesterCount) * 78));
}

function weekMenuListHeight(weekCount: number): number {
  return Math.min(448, 32 + Math.ceil(Math.max(1, weekCount) / 4) * 86);
}

function weekMenuRowId(weekNumber: number): string {
  return `week-option-row-${Math.floor((Math.max(1, weekNumber) - 1) / 4)}`;
}

function timetableWeekMenuRows(
  weekPages: TimetableWeekPage[],
): TimetableWeekMenuRow[] {
  const options = weekPages.map(({ weekNumber, startDateLabel }) => ({
    weekNumber,
    startDateLabel,
  }));
  return Array.from({ length: Math.ceil(options.length / 4) }, (_, index) => ({
    id: `week-option-row-${index}`,
    weeks: options.slice(index * 4, index * 4 + 4),
  }));
}

function estimatedTextLines(value: string, charactersPerLine: number): number {
  return Math.max(
    1,
    Math.ceil(Array.from(value.trim()).length / charactersPerLine),
  );
}

function viewportSheetHeight(
  contentHeightRpx: number,
  minimumPercent: number,
  maximumPercent: number,
  fallbackPercent: number,
): number {
  try {
    const windowInfo = wx.getWindowInfo();
    const width = Math.max(1, windowInfo.windowWidth || 375);
    const height = Math.max(1, windowInfo.windowHeight || 667);
    const safeBottom = Math.max(
      0,
      height - Number(windowInfo.safeArea?.bottom || height),
    );
    const desiredPercent =
      (((contentHeightRpx * width) / 750 + safeBottom) / height) * 100;
    return Number(
      Math.min(
        maximumPercent,
        Math.max(minimumPercent, desiredPercent),
      ).toFixed(1),
    );
  } catch {
    return Math.min(maximumPercent, Math.max(minimumPercent, fallbackPercent));
  }
}

function courseSheetHeight(course: TimetableCourse): number {
  const detailValues = [
    course.location,
    course.displayTimeLabel,
    course.weekText,
    ...(course.credits !== null ? [String(course.credits)] : []),
    ...(course.teachingClass ? [course.teachingClass] : []),
    ...(course.nature ? [course.nature] : []),
    ...(course.assessmentMethod ? [course.assessmentMethod] : []),
  ];
  const detailHeight = detailValues.reduce(
    (height, value) =>
      height + 46 + Math.min(3, estimatedTextLines(value, 18)) * 35,
    0,
  );
  const titleLines = Math.min(3, estimatedTextLines(course.name, 10));
  const teacherLines = Math.min(
    2,
    estimatedTextLines(`${course.teacher} · ${course.activityTypeLabel}`, 18),
  );
  const contentHeightRpx =
    100 +
    30 +
    68 +
    32 +
    6 +
    titleLines * 56 +
    7 +
    teacherLines * 33 +
    22 +
    detailHeight +
    24;
  return viewportSheetHeight(
    contentHeightRpx,
    44,
    82,
    42 + detailValues.length * 5,
  );
}

function passRateSheetHeight(input: PassRateSheetHeightInput): number {
  let headingHeight = 0;
  let bodyHeight = 230;
  let minimumPercent = 42;
  let fallbackPercent = 46;

  if (input.loading) {
    bodyHeight = 330;
  } else if (input.errorMessage) {
    const descriptionLines = Math.min(
      4,
      estimatedTextLines(input.errorMessage, 16),
    );
    bodyHeight = Math.max(230, 278 + descriptionLines * 38);
  } else if (input.courseName) {
    const nameLines = Math.min(2, estimatedTextLines(input.courseName, 16));
    headingHeight = 63 + nameLines * 40;
    if (input.status === "ready" && input.hasStatistics) {
      bodyHeight = 872 + (input.showOwnScore ? 58 : 0);
      minimumPercent = 56;
      fallbackPercent = input.showOwnScore ? 82 : 78;
    } else {
      const messageLines = Math.min(
        4,
        estimatedTextLines(input.message || "统计中，请稍后查看", 16),
      );
      bodyHeight = Math.max(330, 245 + messageLines * 35);
      minimumPercent = 44;
      fallbackPercent = 52;
    }
  }

  const contentHeightRpx = 84 + 30 + 10 + headingHeight + bodyHeight + 32;
  return viewportSheetHeight(
    contentHeightRpx,
    minimumPercent,
    82,
    fallbackPercent,
  );
}

function hasSelectedSemesterCalendar(timetable: TimetableData): boolean {
  return Boolean(
    (timetable.semesterCalendar?.semesterId === timetable.semester.id &&
      timetable.semesterCalendar.weeks.length) ||
    timetable.currentSemester?.id === timetable.semester.id,
  );
}

function timetableMenuOriginX(
  windowWidth: number,
  headerControlSize: number,
): number {
  const pixelsPerRpx = windowWidth / 750;
  return (
    headerControlSize * 1.5 +
    (MODAL_HEADER_EDGE_INSET_RPX +
      HEADER_BUTTON_GAP_RPX -
      TIMETABLE_MENU_LEFT_RPX) *
      pixelsPerRpx
  );
}

function backgroundMetrics(compactHeader = false): {
  headerTop: number;
  headerHeight: number;
  headerControlSize: number;
  headerControlCenter: number;
  menuTop: number;
  menuOriginX: number;
  menuOriginY: number;
  weekMenuTop: number;
  weekMenuOriginY: number;
  imageStyle: string;
} {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || menu.top || 24;
    const headerControlSize = menu.height || 32;
    const headerControlTop = menu.top || statusBarHeight + 4;
    const headerControlBottom =
      menu.bottom || headerControlTop + headerControlSize;
    const contentHeight =
      Math.max(0, headerControlTop - statusBarHeight) * 2 + headerControlSize;
    const headerHeight = statusBarHeight + contentHeight;
    const scale = Math.max(
      windowInfo.windowWidth / BACKGROUND_WIDTH,
      windowInfo.windowHeight / BACKGROUND_HEIGHT,
    );
    const width = BACKGROUND_WIDTH * scale;
    const height = BACKGROUND_HEIGHT * scale;
    const left = (windowInfo.windowWidth - width) / 2;
    const imageStyle = `width:${width}px;height:${height}px;left:${left}px;top:0px;`;
    if (compactHeader) {
      const edgeInset =
        (MODAL_HEADER_EDGE_INSET_RPX * windowInfo.windowWidth) / 750;
      const compactHeaderHeight = headerControlSize + edgeInset * 2;
      const compactControlBottom = edgeInset + headerControlSize;
      const headerControlCenter = edgeInset + headerControlSize / 2;
      const menuTop = compactHeaderHeight + 4;
      const weekMenuTop = compactControlBottom + 8;
      return {
        headerTop: 0,
        headerHeight: compactHeaderHeight,
        headerControlSize,
        headerControlCenter,
        menuTop,
        menuOriginX: timetableMenuOriginX(
          windowInfo.windowWidth,
          headerControlSize,
        ),
        menuOriginY: headerControlCenter - menuTop,
        weekMenuTop,
        weekMenuOriginY: headerControlCenter - weekMenuTop,
        imageStyle,
      };
    }
    const headerControlCenter = headerControlTop + headerControlSize / 2;
    const menuTop = Math.max(headerHeight, headerControlBottom) + 4;
    const weekMenuTop = headerControlBottom + 8;
    return {
      headerTop: statusBarHeight,
      headerHeight,
      headerControlSize,
      headerControlCenter,
      menuTop,
      menuOriginX: timetableMenuOriginX(
        windowInfo.windowWidth,
        headerControlSize,
      ),
      menuOriginY: headerControlCenter - menuTop,
      weekMenuTop,
      weekMenuOriginY: headerControlCenter - weekMenuTop,
      imageStyle,
    };
  } catch {
    if (compactHeader) {
      return {
        headerTop: 0,
        headerHeight: 56,
        headerControlSize: 32,
        headerControlCenter: 28,
        menuTop: 60,
        menuOriginX: 22,
        menuOriginY: -32,
        weekMenuTop: 52,
        weekMenuOriginY: -24,
        imageStyle: "width:100%;height:100%;left:0;top:0;",
      };
    }
    return {
      headerTop: 24,
      headerHeight: 64,
      headerControlSize: 32,
      headerControlCenter: 44,
      menuTop: 68,
      menuOriginX: 22,
      menuOriginY: -24,
      weekMenuTop: 68,
      weekMenuOriginY: -24,
      imageStyle: "width:100%;height:100%;left:0;top:0;",
    };
  }
}

function timetableVisualPreferencesPatch(
  themeId: TimetableThemeId = loadTimetableThemeId(),
) {
  const appearance = resolveAppearance();
  const account = getSession()?.user.account || "";
  const pet: PetPreferences = account
    ? loadPetPreferences(account)
    : { ...DEFAULT_PET_PREFERENCES };
  const petEnabled = Boolean(account) && shouldShowPet(pet);
  const timetablePet = petEnabled ? pet : DEFAULT_PET_PREFERENCES;
  const companionColor = petEnabled
    ? timetablePet.color
    : DEFAULT_TIMETABLE_COMPANION_COLOR;
  return {
    ...appearance,
    ...timetableThemePatch(themeId, companionColor),
    companionColor,
    petShape: timetablePet.shape,
    petColor: companionColor,
    petEnhanced: petEnabled && timetablePet.enhanced,
    petSelected: petEnabled,
    // The fallback belongs to the timetable theme only; no pet preference is saved.
    petVisible: true,
    petReducedMotion: appearance.motionClass === "motion-reduced",
  };
}

const INITIAL_TIMETABLE_VISUAL_PREFERENCES = timetableVisualPreferencesPatch();

function clearTimetableMenuTimers(): void {
  if (menuOpenTimer !== undefined) {
    clearTimeout(menuOpenTimer);
    menuOpenTimer = undefined;
  }
  if (menuUnmountTimer !== undefined) {
    clearTimeout(menuUnmountTimer);
    menuUnmountTimer = undefined;
  }
}

function clearClawdSceneTimer(): void {
  if (clawdSceneTimer !== undefined) {
    clearTimeout(clawdSceneTimer);
    clawdSceneTimer = undefined;
  }
}

function cancelPendingWeekBuilds(): void {
  weekBuildSequence += 1;
  if (weekBuildTimer !== undefined) {
    clearTimeout(weekBuildTimer);
    weekBuildTimer = undefined;
  }
}

function cancelCompanionGazeUpdate(): void {
  pendingCompanionGaze = null;
  if (companionGazeTimer !== undefined) {
    clearTimeout(companionGazeTimer);
    companionGazeTimer = undefined;
  }
}

Page({
  data: {
    ...INITIAL_TIMETABLE_VISUAL_PREFERENCES,
    compactHeader: false,
    ...backgroundMetrics(),
    timetableThemes: TIMETABLE_THEME_OPTIONS,
    clawdSceneSrc: "",
    clawdScenePositionStyle: CLAWD_DEFAULT_POSITION_STYLE,
    clawdSceneMotionClass: "",
    clawdSceneMediaClass: "",
    menuMounted: false,
    menuOpen: false,
    semesterOpen: false,
    weekMenuMounted: false,
    weekMenuOpen: false,
    weekScrollIntoView: "",
    weekMenuListHeight: 114,
    menuHeight: MAIN_MENU_HEIGHT,
    semesterMenuHeight: 250,
    semesterShortLabel: "选择学期",
    semesterId: "",
    semesters: [] as TimetableSemesterOption[],
    weekNumber: 1,
    currentWeekNumber: 0,
    weekIndex: 0,
    weekLabel: "第 1 周",
    maxWeek: 1,
    weekPages: [] as TimetableWeekPage[],
    weekMenuRows: [] as TimetableWeekMenuRow[],
    periodRows: [] as TimetablePeriodRow[],
    selectedCourse: null as TimetableCourse | null,
    courseSheetVisible: false,
    courseSheetHeight: 60,
    passRateSheetVisible: false,
    passRateSheetHeight: 46,
    passRateLoading: false,
    passRateErrorMessage: "",
    passRateCourseName: "",
    passRateCourse: null as PassRateCourse | null,
    passRateStatistics: null as PassRateStatistics | null,
    passRateStatus: "collecting" as "ready" | "collecting",
    passRateMessage: "统计中，请稍后查看",
    passRateCohortLabel: "",
    passRatePercentageOnly: false,
    passRateOwnScore: -1,
    passRateDisplayScore: "—",
    hasHydrated: false,
    refreshing: false,
    refreshPageToken: 0,
    observedRefreshFlightId: 0,
  },
  onLoad(options: Record<string, string | undefined>) {
    pageAlive = true;
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    clearTimetableMenuTimers();
    clearClawdSceneTimer();
    clawdSequenceRevision += 1;
    resetClawdSceneScheduler();
    cancelPendingWeekBuilds();
    cancelCompanionGazeUpdate();
    activeAccount = "";
    activeTimetable = null;
    activeSnapshot = null;
    defaultSemesterId = "";
    visibleRequestSequence += 1;
    passRateRequestSequence += 1;
    pendingVisibleRequestId = null;
    const compactHeader = options.source === "schedule";
    const visualPreferences = timetableVisualPreferencesPatch();
    preloadTimetableThemeAssets(visualPreferences.timetableThemeId);
    this.setData(
      {
        ...visualPreferences,
        compactHeader,
        refreshPageToken,
        ...backgroundMetrics(compactHeader),
      },
      () => this.syncClawdSceneSequence(),
    );
    this.hydrate();
    this.syncActiveTimetableRefresh();
    this.syncTimetableIfNeeded();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    markRefreshPageVisible(this.data.refreshPageToken);
    this.setData(
      {
        ...timetableVisualPreferencesPatch(),
        ...backgroundMetrics(this.data.compactHeader),
      },
      () => this.syncClawdSceneSequence(),
    );
    this.hydrate();
    this.syncActiveTimetableRefresh();
    this.syncTimetableIfNeeded();
  },
  onHide() {
    markRefreshPageHidden(this.data.refreshPageToken);
    this.stopClawdSceneSequence();
  },
  onUnload() {
    pageAlive = false;
    markRefreshPageHidden(this.data.refreshPageToken);
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    clearTimetableMenuTimers();
    clearClawdSceneTimer();
    clawdSequenceRevision += 1;
    resetClawdSceneScheduler();
    cancelPendingWeekBuilds();
    cancelCompanionGazeUpdate();
    passRateRequestSequence += 1;
  },
  syncClawdSceneSequence() {
    if (this.data.timetableThemeId === "clawd" && !this.data.petReducedMotion) {
      this.startClawdSceneSequence();
      return;
    }
    this.stopClawdSceneSequence();
  },
  startClawdSceneSequence() {
    clearClawdSceneTimer();
    clawdSequenceRevision += 1;
    resetClawdSceneScheduler();
    this.playClawdSceneStep(clawdSequenceRevision);
  },
  stopClawdSceneSequence() {
    clearClawdSceneTimer();
    clawdSequenceRevision += 1;
    resetClawdSceneScheduler();
    if (
      pageAlive &&
      (this.data.clawdSceneSrc ||
        this.data.clawdSceneMotionClass ||
        this.data.clawdSceneMediaClass)
    ) {
      this.setData({
        clawdSceneSrc: "",
        clawdSceneMotionClass: "",
        clawdSceneMediaClass: "",
      });
    }
  },
  playClawdSceneStep(revision: number) {
    if (
      !pageAlive ||
      revision !== clawdSequenceRevision ||
      this.data.timetableThemeId !== "clawd" ||
      this.data.petReducedMotion
    ) {
      return;
    }
    if (!clawdActiveJourney) {
      const maxPeriod = Math.max(1, this.data.periodRows.length);
      const headerHeightPx = Number(this.data.headerHeight) || 64;
      clawdActiveJourney = buildClawdJourney(clawdJourneyPlanner, {
        courses: visibleCourses,
        maxPeriod,
        headerHeightPx,
        metrics: timetableGridLayoutMetrics(maxPeriod, headerHeightPx),
      });
      clawdSceneStepIndex = 0;
    }
    const journey = clawdActiveJourney;
    const step = journey.steps[clawdSceneStepIndex];
    const mountStep = () => {
      this.setData(
        {
          clawdSceneSrc: CLAWD_SCENE_SOURCES[step.scene],
          clawdScenePositionStyle: step.positionStyle,
          clawdSceneMotionClass: step.motionClass,
          clawdSceneMediaClass: step.mediaClass,
        },
        () => {
          if (!pageAlive || revision !== clawdSequenceRevision) return;
          clawdSceneTimer = setTimeout(() => {
            clawdSceneTimer = undefined;
            if (!pageAlive || revision !== clawdSequenceRevision) return;
            clawdSceneStepIndex += 1;
            if (clawdSceneStepIndex >= journey.steps.length) {
              if (!step.exitOffscreen || step.kind !== "exit") return;
              const quietDurationMs =
                randomIntegerInclusive(CLAWD_QUIET_RANGE_MS);
              clawdActiveJourney = null;
              clawdSceneStepIndex = 0;
              this.setData(
                {
                  clawdSceneSrc: "",
                  clawdSceneMotionClass: "",
                  clawdSceneMediaClass: "",
                },
                () => {
                  if (!pageAlive || revision !== clawdSequenceRevision) return;
                  clawdSceneTimer = setTimeout(() => {
                    clawdSceneTimer = undefined;
                    this.playClawdSceneStep(revision);
                  }, quietDurationMs);
                },
              );
              return;
            }
            this.playClawdSceneStep(revision);
          }, step.durationMs);
        },
      );
    };
    if (step.restartOffscreen) {
      const previousStep = journey.steps[clawdSceneStepIndex - 1];
      if (
        !previousStep ||
        !previousStep.exitOffscreen ||
        previousStep.kind !== "bridge-exit" ||
        previousStep.scene !== step.scene ||
        previousStep.positionStyle !== step.positionStyle
      ) {
        return;
      }
      this.setData(
        {
          clawdSceneSrc: "",
          clawdSceneMotionClass: "",
          clawdSceneMediaClass: "",
        },
        () => {
          if (!pageAlive || revision !== clawdSequenceRevision) return;
          mountStep();
        },
      );
      return;
    }
    mountStep();
  },
  queueRemainingWeekPages(
    timetable: TimetableData,
    maxPeriod: number,
    layoutMetrics: TimetableGridLayoutMetrics,
    selectedWeek: number,
    cachedWeekDates: Map<number, string[]>,
  ) {
    cancelPendingWeekBuilds();
    const sequence = weekBuildSequence;
    const remainingWeeks = Array.from(
      { length: this.data.maxWeek },
      (_, index) => index + 1,
    )
      .filter((week) => week !== selectedWeek)
      .sort(
        (left, right) =>
          Math.abs(left - selectedWeek) - Math.abs(right - selectedWeek),
      );

    const buildNext = () => {
      weekBuildTimer = undefined;
      if (
        !pageAlive ||
        activeTimetable !== timetable ||
        sequence !== weekBuildSequence
      ) {
        return;
      }
      const weekNumber = remainingWeeks.shift();
      if (weekNumber === undefined) return;
      const index = weekNumber - 1;
      if (this.data.weekPages[index]?.ready) {
        weekBuildTimer = setTimeout(buildNext, 0);
        return;
      }
      const page = buildTimetableWeekPage(
        timetable,
        weekNumber,
        maxPeriod,
        layoutMetrics,
        cachedWeekDates.get(weekNumber),
      );
      this.setData({ [`weekPages[${index}]`]: page }, () => {
        if (sequence === weekBuildSequence) {
          weekBuildTimer = setTimeout(buildNext, 16);
        }
      });
    };

    weekBuildTimer = setTimeout(buildNext, 0);
  },
  hydrate() {
    const account = getSession()?.user.account || "";
    if (!account) return;
    if (account === activeAccount) {
      if (!this.data.hasHydrated) this.setData({ hasHydrated: true });
      return;
    }
    if (activeAccount) {
      visibleRequestSequence += 1;
      passRateRequestSequence += 1;
      pendingVisibleRequestId = null;
      visibleCourses = [];
      cancelPendingWeekBuilds();
      cancelCompanionGazeUpdate();
      clearTimetableMenuTimers();
      clearClawdSceneTimer();
      clawdSequenceRevision += 1;
      resetClawdSceneScheduler();
      this.setData({
        clawdSceneSrc: "",
        clawdSceneMotionClass: "",
        clawdSceneMediaClass: "",
        menuMounted: false,
        menuOpen: false,
        semesterOpen: false,
        weekMenuMounted: false,
        weekMenuOpen: false,
        weekScrollIntoView: "",
        semesterMenuHeight: 250,
        semesterShortLabel: "选择学期",
        semesterId: "",
        semesters: [],
        weekNumber: 1,
        currentWeekNumber: 0,
        weekIndex: 0,
        weekLabel: "第 1 周",
        maxWeek: 1,
        weekMenuListHeight: 114,
        weekPages: [],
        weekMenuRows: [],
        periodRows: [],
        selectedCourse: null,
        courseSheetVisible: false,
        courseSheetHeight: 60,
        passRateSheetVisible: false,
        passRateSheetHeight: 46,
        passRateLoading: false,
        passRateErrorMessage: "",
        passRateCourseName: "",
        passRateCourse: null,
        passRateStatistics: null,
        passRateStatus: "collecting",
        passRateMessage: "统计中，请稍后查看",
        passRateCohortLabel: "",
        passRatePercentageOnly: false,
        passRateOwnScore: -1,
        passRateDisplayScore: "—",
        hasHydrated: false,
        refreshing: false,
        observedRefreshFlightId: 0,
      });
    }
    activeAccount = account;
    activeSnapshot = loadTimetableSnapshot(account);
    activeTimetable = activeSnapshot?.data || null;
    defaultSemesterId = activeTimetable?.semester.id || "";
    if (activeTimetable) this.applyTimetable(activeTimetable, false);
    this.setData({ hasHydrated: true }, () => this.syncClawdSceneSequence());
  },
  currentTimetableSemesterQuery(): string | undefined {
    return this.data.semesterId === defaultSemesterId
      ? undefined
      : this.data.semesterId || undefined;
  },
  syncActiveTimetableRefresh(): boolean {
    const lease = captureSessionLease();
    if (!lease || activeAccount !== lease.account) {
      if (this.data.refreshing || this.data.observedRefreshFlightId) {
        this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    const flight = findRefreshFlight<TimetableRefreshOutcome>(
      timetableRefreshFlightKey(lease),
    );
    if (!flight) {
      if (this.data.refreshing || this.data.observedRefreshFlightId) {
        this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    this.observeTimetableRefresh(flight, lease);
    return true;
  },
  observeTimetableRefresh(
    flight: RefreshFlight<TimetableRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedRefreshFlightId === flight.id) {
      if (!this.data.refreshing) this.setData({ refreshing: true });
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({
      refreshing: true,
      observedRefreshFlightId: flight.id,
    });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease) ||
        activeAccount !== lease.account
      ) {
        return;
      }
      this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      if (!outcome.succeeded) return;
      const snapshot = loadTimetableSnapshot(lease.account, outcome.semester);
      if (snapshot) {
        activeSnapshot = snapshot;
        activeTimetable = snapshot.data;
        if (!outcome.semester) defaultSemesterId = snapshot.data.semester.id;
        this.applyTimetable(snapshot.data, true);
      }
      showRefreshConfirmation(this);
    });
  },
  syncTimetableIfNeeded(semester?: string) {
    if (!activeAccount) return;
    const snapshot =
      loadTimetableSnapshot(activeAccount, semester) ||
      (!semester ? activeSnapshot : null);
    if (!snapshot) {
      void this.loadTimetable(false, semester, !activeTimetable);
      return;
    }
    const needsRefresh =
      isCacheStale(snapshot, FIFTEEN_DAYS_MS) ||
      !hasSelectedSemesterCalendar(snapshot.data);
    if (
      needsRefresh &&
      claimAutomaticRefresh(`timetable:${semester || "default"}`, activeAccount)
    ) {
      void this.loadTimetable(true, semester);
    }
  },
  async loadTimetable(
    refresh: boolean,
    semester?: string,
    activate = false,
  ): Promise<boolean> {
    const lease = captureSessionLease();
    const requestAccount = lease?.account || "";
    if (!lease || !requestAccount || activeAccount !== requestAccount) {
      return false;
    }
    const requestKey = timetableRequestKey(lease, semester);
    const existingRequest = timetableRequestsInFlight.get(requestKey);
    if (existingRequest) {
      const succeeded = await existingRequest.completion;
      if (!isSessionLeaseCurrent(lease)) return false;
      return refresh && !existingRequest.refresh
        ? this.loadTimetable(true, semester, activate)
        : succeeded;
    }
    let resolveCompletion: (succeeded: boolean) => void = () => undefined;
    const completion = new Promise<boolean>((resolve) => {
      resolveCompletion = resolve;
    });
    timetableRequestsInFlight.set(requestKey, { refresh, completion });
    const visibleRequestId = activate ? ++visibleRequestSequence : 0;
    if (activate) pendingVisibleRequestId = visibleRequestId;
    let shouldRefreshAfterward = false;
    let succeeded = false;
    try {
      const result = await getTimetable({ semester, refresh });
      if (!isSessionLeaseCurrent(lease)) return false;
      const local = loadTimetableSnapshot(requestAccount, semester);
      const shouldStore =
        refresh || shouldUseServerSnapshot(local, result.meta.fetchedAt);
      let stored = local;
      if (shouldStore) {
        stored = saveTimetableSnapshot(requestAccount, result.data, {
          semesterId: semester,
          serverFetchedAt: result.meta.fetchedAt,
        });
      }
      const stillViewingResult = activate
        ? isSessionLeaseCurrent(lease) &&
          activeAccount === requestAccount &&
          pendingVisibleRequestId === visibleRequestId
        : isSessionLeaseCurrent(lease) &&
          activeAccount === requestAccount &&
          pendingVisibleRequestId === null &&
          (!activeTimetable ||
            !this.data.semesterId ||
            this.data.semesterId === result.data.semester.id);
      if (shouldStore && stillViewingResult) {
        if (activate) pendingVisibleRequestId = null;
        activeSnapshot = stored;
        const cachedResult = stored?.data || result.data;
        activeTimetable = cachedResult;
        if (!semester) defaultSemesterId = cachedResult.semester.id;
        this.applyTimetable(cachedResult, refresh || !semester);
      } else if (stillViewingResult && !activeTimetable && local) {
        if (activate) pendingVisibleRequestId = null;
        activeSnapshot = local;
        activeTimetable = local.data;
        this.applyTimetable(local.data, !semester);
      }
      const current =
        loadTimetableSnapshot(requestAccount, semester) ||
        (activeAccount === requestAccount ? activeSnapshot : null);
      shouldRefreshAfterward =
        !refresh &&
        current !== null &&
        (result.meta.stale === true ||
          result.meta.refreshing === true ||
          isCacheStale(current, FIFTEEN_DAYS_MS) ||
          !hasSelectedSemesterCalendar(current.data)) &&
        claimAutomaticRefresh(
          `timetable:${semester || "default"}`,
          requestAccount,
        );
      succeeded = true;
      return true;
    } catch {
      if (
        isSessionLeaseCurrent(lease) &&
        activate &&
        pendingVisibleRequestId === visibleRequestId
      ) {
        pendingVisibleRequestId = null;
      }
      if (isSessionLeaseCurrent(lease) && !activeTimetable) {
        wx.showToast({ title: "课表暂时不可用", icon: "none" });
      }
      return false;
    } finally {
      if (activate && pendingVisibleRequestId === visibleRequestId) {
        pendingVisibleRequestId = null;
      }
      if (
        timetableRequestsInFlight.get(requestKey)?.completion === completion
      ) {
        timetableRequestsInFlight.delete(requestKey);
      }
      resolveCompletion(succeeded);
      if (
        shouldRefreshAfterward &&
        isSessionLeaseCurrent(lease) &&
        activeAccount === requestAccount
      ) {
        setTimeout(() => {
          if (
            isSessionLeaseCurrent(lease) &&
            activeAccount === requestAccount
          ) {
            void this.loadTimetable(true, semester);
          }
        }, 0);
      }
    }
  },
  applyTimetable(timetable: TimetableData, preserveWeek: boolean) {
    const maxWeek = timetableWeekCount(timetable);
    const cachedWeekDates = new Map(
      activeSnapshot?.data.semester.id === timetable.semester.id
        ? activeSnapshot.weekDates.map((week) => [week.weekNumber, week.dates])
        : [],
    );
    const maxPeriod = timetableMaxPeriod(timetable);
    const layoutMetrics = timetableGridLayoutMetrics(
      maxPeriod,
      Number(this.data.headerHeight) || 64,
    );
    const prewarmed = activeSnapshot
      ? getPrewarmedTimetableFirstScreen(
          activeAccount,
          activeSnapshot,
          layoutMetrics,
          this.data.timetableThemeId,
        )
      : null;
    const detectedWeek =
      prewarmed?.currentWeekNumber || teachingWeekForDate(timetable) || 0;
    const weekNumber = Math.min(
      maxWeek,
      Math.max(
        1,
        preserveWeek && this.data.semesterId === timetable.semester.id
          ? this.data.weekNumber
          : prewarmed?.weekNumber || timetableWeekForDisplay(timetable),
      ),
    );
    const firstScreen = prewarmed?.weekNumber === weekNumber ? prewarmed : null;
    const periodCourses = firstScreen
      ? firstScreen.courses
      : coursesForWeek(timetable, weekNumber);
    const weekPages = Array.from({ length: maxWeek }, (_, index) =>
      buildTimetableWeekPlaceholder(
        timetable,
        index + 1,
        cachedWeekDates.get(index + 1),
      ),
    );
    const weekMenuRows = timetableWeekMenuRows(weekPages);
    weekPages[weekNumber - 1] = firstScreen
      ? firstScreen.weekPage
      : buildTimetableWeekPage(
          timetable,
          weekNumber,
          maxPeriod,
          layoutMetrics,
          cachedWeekDates.get(weekNumber),
        );
    visibleCourses = periodCourses;
    this.setData(
      {
        semesterShortLabel: shortAcademicSemesterLabel(timetable.semester),
        semesterId: timetable.semester.id,
        semesters: timetableSemesterOptions(timetable.semesters),
        semesterMenuHeight: submenuHeight(timetable.semesters.length),
        weekNumber,
        currentWeekNumber: detectedWeek,
        weekIndex: weekNumber - 1,
        weekLabel: `第 ${weekNumber} 周`,
        maxWeek,
        weekMenuListHeight: weekMenuListHeight(maxWeek),
        weekMenuRows,
        periodRows: firstScreen
          ? firstScreen.periodRows
          : buildTimetablePeriodRows(timetable, maxPeriod, periodCourses),
        weekPages,
      },
      () =>
        this.queueRemainingWeekPages(
          timetable,
          maxPeriod,
          layoutMetrics,
          weekNumber,
          cachedWeekDates,
        ),
    );
  },
  setWeek(weekNumber: number, feedback = false) {
    if (!activeTimetable) return;
    const normalizedWeek = Math.min(
      this.data.maxWeek,
      Math.max(1, Math.floor(weekNumber)),
    );
    visibleCourses = coursesForWeek(activeTimetable, normalizedWeek);
    const maxPeriod =
      this.data.periodRows.length || timetableMaxPeriod(activeTimetable);
    const weekIndex = normalizedWeek - 1;
    const weekPage = this.data.weekPages[weekIndex];
    const pagePatch = weekPage?.ready
      ? {}
      : {
          [`weekPages[${weekIndex}]`]: buildTimetableWeekPage(
            activeTimetable,
            normalizedWeek,
            maxPeriod,
            timetableGridLayoutMetrics(
              maxPeriod,
              Number(this.data.headerHeight) || 64,
            ),
            activeSnapshot?.weekDates.find(
              (week) => week.weekNumber === normalizedWeek,
            )?.dates,
          ),
        };
    this.setData({
      weekNumber: normalizedWeek,
      weekIndex,
      weekLabel: `第 ${normalizedWeek} 周`,
      periodRows: buildTimetablePeriodRows(
        activeTimetable,
        maxPeriod,
        visibleCourses,
      ),
      ...pagePatch,
    });
    if (feedback) haptic("light");
  },
  onWeekChange(event: WechatMiniprogram.SwiperChange) {
    if (!activeTimetable) return;
    const weekNumber = Math.min(
      this.data.maxWeek,
      Math.max(1, Number(event.detail.current) + 1),
    );
    if (weekNumber === this.data.weekNumber) return;
    this.setWeek(weekNumber, true);
  },
  selectWeek(event: WechatMiniprogram.TouchEvent) {
    const weekNumber = Number(event.currentTarget.dataset.week);
    this.closeWeekMenu();
    if (
      !Number.isInteger(weekNumber) ||
      weekNumber < 1 ||
      weekNumber > this.data.maxWeek ||
      weekNumber === this.data.weekNumber
    ) {
      return;
    }
    this.setWeek(weekNumber, true);
  },
  selectSemester(event: WechatMiniprogram.TouchEvent) {
    if (this.data.refreshing) return;
    const semester = String(event.currentTarget.dataset.semester || "");
    this.closeTimetableMenu();
    if (!semester || semester === this.data.semesterId) return;
    haptic("light");
    const querySemester = semester === defaultSemesterId ? undefined : semester;
    const cached = loadTimetableSnapshot(activeAccount, querySemester);
    if (cached) {
      visibleRequestSequence += 1;
      pendingVisibleRequestId = null;
      activeSnapshot = cached;
      activeTimetable = cached.data;
      this.applyTimetable(cached.data, false);
      this.syncTimetableIfNeeded(querySemester);
      return;
    }
    void this.loadTimetable(false, querySemester, true);
  },
  toggleWeekMenu() {
    haptic("light");
    if (this.data.weekMenuOpen) {
      this.closeWeekMenu();
      return;
    }
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
      weekMenuUnmountTimer = undefined;
    }
    this.closeTimetableMenu();
    this.setData(
      {
        weekMenuMounted: true,
        weekScrollIntoView: "",
      },
      () => {
        wx.nextTick(() => {
          if (!this.data.weekMenuMounted) return;
          this.setData({
            weekScrollIntoView: weekMenuRowId(this.data.weekNumber),
          });
          weekMenuOpenTimer = setTimeout(() => {
            weekMenuOpenTimer = undefined;
            if (this.data.weekMenuMounted) this.setData({ weekMenuOpen: true });
          }, 16);
        });
      },
    );
  },
  closeWeekMenu() {
    if (!this.data.weekMenuMounted) return;
    if (weekMenuOpenTimer !== undefined) {
      clearTimeout(weekMenuOpenTimer);
      weekMenuOpenTimer = undefined;
    }
    this.setData({ weekMenuOpen: false });
    if (weekMenuUnmountTimer !== undefined) {
      clearTimeout(weekMenuUnmountTimer);
    }
    weekMenuUnmountTimer = setTimeout(() => {
      weekMenuUnmountTimer = undefined;
      if (!this.data.weekMenuOpen) {
        this.setData({ weekMenuMounted: false });
      }
    }, WEEK_MENU_TRANSITION_MS);
  },
  toggleMenu() {
    haptic("light");
    this.closeWeekMenu();
    if (this.data.menuOpen || menuOpenTimer !== undefined) {
      this.closeTimetableMenu();
      return;
    }
    this.openTimetableMenu();
  },
  openTimetableMenu() {
    clearTimetableMenuTimers();
    this.setData(
      {
        menuMounted: true,
        menuOpen: false,
        semesterOpen: false,
        menuHeight: MAIN_MENU_HEIGHT,
      },
      () => {
        wx.nextTick(() => {
          if (!this.data.menuMounted) return;
          menuOpenTimer = setTimeout(() => {
            menuOpenTimer = undefined;
            if (this.data.menuMounted) this.setData({ menuOpen: true });
          }, 16);
        });
      },
    );
  },
  closeTimetableMenu() {
    if (!this.data.menuMounted) return;
    if (menuOpenTimer !== undefined) {
      clearTimeout(menuOpenTimer);
      menuOpenTimer = undefined;
    }
    this.setData({ menuOpen: false });
    if (menuUnmountTimer !== undefined) clearTimeout(menuUnmountTimer);
    menuUnmountTimer = setTimeout(() => {
      menuUnmountTimer = undefined;
      if (!this.data.menuOpen) {
        this.setData({
          menuMounted: false,
          semesterOpen: false,
          menuHeight: MAIN_MENU_HEIGHT,
        });
      }
    }, MENU_TRANSITION_MS);
  },
  openSemesterMenu() {
    haptic("light");
    this.setData({
      semesterOpen: true,
      menuHeight: this.data.semesterMenuHeight,
    });
  },
  backToMainMenu() {
    haptic("light");
    this.setData({ semesterOpen: false, menuHeight: MAIN_MENU_HEIGHT });
  },
  closeMenus() {
    this.closeTimetableMenu();
  },
  stopPropagation() {},
  companionComponent(): TimetableCompanionInstance | null {
    return this.selectComponent(
      "#timetable-companion",
    ) as unknown as TimetableCompanionInstance | null;
  },
  updateCompanionGaze(event: WechatMiniprogram.TouchEvent) {
    if (
      this.data.timetableThemeId !== "companion" ||
      !this.data.petVisible ||
      this.data.petReducedMotion
    ) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    pendingCompanionGaze = { x: touch.clientX, y: touch.clientY };
    if (companionGazeTimer !== undefined) return;
    companionGazeTimer = setTimeout(() => {
      companionGazeTimer = undefined;
      const target = pendingCompanionGaze;
      pendingCompanionGaze = null;
      if (!pageAlive || !target) return;
      this.companionComponent()?.setExternalGazeTarget(target.x, target.y);
    }, 16);
  },
  clearCompanionGaze() {
    cancelCompanionGazeUpdate();
    this.companionComponent()?.clearExternalGaze();
  },
  onTimetableInteraction() {
    if (
      this.data.timetableThemeId !== "companion" ||
      !this.data.petVisible ||
      this.data.petReducedMotion
    ) {
      return;
    }
    this.companionComponent()?.playInteraction();
  },
  selectTheme(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.theme || "default");
    const patch = timetableThemePatch(id, this.data.companionColor);
    if (patch.timetableThemeId !== "companion") this.clearCompanionGaze();
    this.setData(patch, () => this.syncClawdSceneSequence());
    preloadTimetableThemeAssets(patch.timetableThemeId);
    if (activeAccount && activeSnapshot) {
      try {
        prewarmTimetableFirstScreen(
          activeAccount,
          activeSnapshot,
          patch.timetableThemeId,
        );
      } catch {
        // 当前页面已经完成切换，首屏预热失败不影响本次显示。
      }
    }
    try {
      wx.setStorageSync(TIMETABLE_THEME_STORAGE_KEY, patch.timetableThemeId);
    } catch {
      // 外观偏好保存失败不影响当前显示。
    }
    haptic("light");
  },
  openCalendar() {
    this.closeTimetableMenu();
    haptic("light");
    void navigateTo("/features/pages/calendar/index");
  },
  goToday() {
    if (!activeTimetable) return;
    this.closeTimetableMenu();
    const week = teachingWeekForDate(activeTimetable);
    if (week !== null && week >= 1 && week <= this.data.maxWeek) {
      this.setWeek(week, true);
    }
  },
  onRefresh() {
    if (this.data.refreshing) return;
    const lease = captureSessionLease();
    if (!lease || activeAccount !== lease.account) return;
    const semester = this.currentTimetableSemesterQuery();
    const { flight, started } = startRefreshFlight(
      timetableRefreshFlightKey(lease),
      async () => ({
        succeeded: await refreshTimetableSnapshot(lease, semester),
        semester,
      }),
    );
    this.observeTimetableRefresh(flight, lease);
    if (started) haptic("light");
  },
  goBack() {
    haptic("light");
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) });
  },
  openCourse(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const course = visibleCourses.find((item) => item.id === id);
    if (!course) return;
    haptic("light");
    this.setData({
      selectedCourse: course,
      courseSheetHeight: courseSheetHeight(course),
      courseSheetVisible: true,
    });
  },
  async openCoursePassRate() {
    const selectedCourse = this.data.selectedCourse;
    if (!selectedCourse || this.data.passRateLoading) return;
    const semester = activeTimetable?.semester.id || this.data.semesterId;
    if (!semester || !selectedCourse.courseId) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const sequence = ++passRateRequestSequence;
    haptic("light");
    this.setData({
      passRateSheetVisible: true,
      passRateSheetHeight: passRateSheetHeight({
        loading: true,
        errorMessage: "",
        courseName: selectedCourse.name,
        status: "collecting",
        hasStatistics: false,
        showOwnScore: false,
        message: "统计中，请稍后查看",
      }),
      passRateLoading: true,
      passRateErrorMessage: "",
      passRateCourseName: selectedCourse.name,
      passRateCourse: null,
      passRateStatistics: null,
      passRateStatus: "collecting",
      passRateMessage: "统计中，请稍后查看",
      passRateCohortLabel: "",
      passRatePercentageOnly: false,
      passRateOwnScore: -1,
      passRateDisplayScore: "—",
    });
    try {
      const result = await getPassRates({
        semester,
        timetableCourseId: selectedCourse.courseId,
      });
      if (
        sequence !== passRateRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      const course = result.data.selectedCourse;
      const statistics = result.data.statistics;
      const ownScore =
        typeof course?.calculationScore === "number"
          ? course.calculationScore
          : -1;
      const message = result.data.message || "统计中，请稍后查看";
      const showOwnScore = Boolean(course?.hasOwnGrade && ownScore >= 0);
      this.setData({
        passRateLoading: false,
        passRateSheetHeight: passRateSheetHeight({
          loading: false,
          errorMessage: "",
          courseName: course?.courseName || selectedCourse.name,
          status: result.data.status,
          hasStatistics: Boolean(statistics),
          showOwnScore,
          message,
        }),
        passRateCourse: course,
        passRateStatistics: statistics,
        passRateStatus: result.data.status,
        passRateMessage: message,
        passRatePercentageOnly: result.data.percentageOnly,
        passRateCohortLabel: statistics
          ? `${statistics.cohorts
              .map((year) => String(year).slice(-2))
              .join("、")}${statistics.cohorts.length ? "级" : ""}`
          : "",
        passRateOwnScore: ownScore,
        passRateDisplayScore: formatScore(course?.finalScore ?? null),
      });
    } catch (error) {
      if (
        sequence !== passRateRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      const errorMessage = getErrorMessage(
        error,
        "通过率加载失败，请稍后重试。",
      );
      this.setData({
        passRateLoading: false,
        passRateErrorMessage: errorMessage,
        passRateSheetHeight: passRateSheetHeight({
          loading: false,
          errorMessage,
          courseName: selectedCourse.name,
          status: "collecting",
          hasStatistics: false,
          showOwnScore: false,
          message: "",
        }),
      });
    }
  },
  closeCoursePassRate() {
    passRateRequestSequence += 1;
    this.setData({
      passRateSheetVisible: false,
      passRateLoading: false,
    });
  },
  closeCourse() {
    passRateRequestSequence += 1;
    this.setData({
      courseSheetVisible: false,
      passRateSheetVisible: false,
      passRateLoading: false,
      selectedCourse: null,
    });
  },
  onResize() {
    const selectedCourse = this.data.selectedCourse;
    const passRateCourse = this.data.passRateCourse;
    const passRateOwnScore = Number(this.data.passRateOwnScore);
    this.setData({
      ...backgroundMetrics(this.data.compactHeader),
      ...(selectedCourse
        ? { courseSheetHeight: courseSheetHeight(selectedCourse) }
        : {}),
      ...(this.data.passRateSheetVisible
        ? {
            passRateSheetHeight: passRateSheetHeight({
              loading: this.data.passRateLoading,
              errorMessage: this.data.passRateErrorMessage,
              courseName:
                passRateCourse?.courseName || this.data.passRateCourseName,
              status: this.data.passRateStatus,
              hasStatistics: Boolean(this.data.passRateStatistics),
              showOwnScore: Boolean(
                passRateCourse?.hasOwnGrade && passRateOwnScore >= 0,
              ),
              message: this.data.passRateMessage,
            }),
          }
        : {}),
    });
    if (activeTimetable) this.applyTimetable(activeTimetable, true);
  },
});
