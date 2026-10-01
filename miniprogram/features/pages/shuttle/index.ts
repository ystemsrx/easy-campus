import {
  preferredPlan,
  togglePreferredPlan,
} from "../../utils/shuttle-preferences";
import { setPresence, cancelPresence } from "../../../utils/motion";
import {
  getShuttleMap,
  getShuttleVehiclePreview,
} from "../../../services/shuttle";
import {
  cachedShuttlePlan,
  cachedBoardingWalk,
  forgetShuttlePlan,
  refreshShuttleEstimates,
} from "../../services/shuttle-planning";
import {
  ShuttleStream,
  type ShuttleConnectionState,
} from "../../services/shuttle-stream";
import {
  ShuttleLocationRecorder,
  type LocationResult,
} from "../../../utils/shuttle-location";
import {
  authorizeShuttleLocation,
  locationFailure,
  ShuttlePermissionError,
  type LocationAction,
} from "../../utils/shuttle-authorization";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  getSession,
  type SessionLease,
} from "../../../store/session";
import { ensureAuthenticated } from "../../../utils/navigation";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";
import { getErrorMessage } from "../../../services/request";
import { isDemoSession } from "../../../demo/identity";
import { demoShuttlePosition } from "../../../demo/shuttle";
import {
  distanceLabel,
  distanceMeters,
  roadPolylines,
} from "../../../utils/shuttle-geo";
import { projectToScreen } from "../../utils/shuttle-screen";
import { ShuttlePlanner } from "../../utils/shuttle-routing";
import { departureLabel } from "../../utils/shuttle-departure";
import { routeNames } from "../../utils/shuttle-route-names";
import type {
  ShuttleSelection,
  ShuttleVehicle,
} from "../../utils/shuttle-live-types";
import {
  ShuttleItineraryPlanner,
  type ShuttleJourney,
} from "../../utils/shuttle-itinerary";
import { ShuttleMapMotion } from "../../utils/shuttle-map-motion";
import { ShuttleOnboardDetector } from "../../utils/shuttle-onboard";
import {
  ShuttleJourneyProgress,
  type JourneyProgressView,
} from "../../utils/shuttle-journey-progress";
import {
  orderedTraces,
  tracePolylines,
  type TraceContext,
  routePalette,
  ShuttleRouteReveal,
} from "../../utils/shuttle-route-reveal";
import {
  commonPlace,
  canonicalCommonPlace,
  loadCommonPlaces,
  saveCommonPlaces,
  type CommonPlace,
} from "../../utils/shuttle-common-places";
import { placeShortName } from "../../utils/shuttle-place-names";
import {
  findPlaceGroups,
  groupPoint,
  placeGroups,
  stopName,
} from "../../utils/shuttle-place-groups";
import type {
  CampusShuttleMap,
  GeoPoint,
  NamedPoint,
  ShuttleMarker,
  ShuttlePlace,
  ShuttlePolyline,
  ShuttleRoute,
  ShuttleSnapshot,
} from "../../../types/shuttle";

type Tap = WechatMiniprogram.TouchEvent;
type Journey = "idle" | "waiting" | "riding" | "walking" | "arrived";
interface EdgeHint {
  id: string;
  label: string;
  x: number;
  y: number;
  angle: number;
}
interface Cluster {
  id: string;
  ids: string[];
  count: number;
  x: number;
  y: number;
}
interface VehicleRow {
  id: string;
  number: string;
  color: string;
  routeName: string;
  detail: string;
  eta: string;
  imminent: boolean;
  distanceLabel: string;
}
interface PlanRow {
  favorite: boolean;
  mode: "walk" | "ride";
  id: string;
  color: string;
  routeName: string;
  stopCount: number;
  boardName: string;
  alightName: string;
  walkLabel: string;
  timeLabel: string;
}
interface SearchRow {
  id: string;
  name: string;
  shortName: string;
  categoryLabel: string;
  favorite: boolean;
  distanceLabel: string;
  stop: boolean;
}
interface Runtime {
  onboardDetector?: ShuttleOnboardDetector;
  journeyProgress?: ShuttleJourneyProgress;
  journeyView?: JourneyProgressView;
  planningKey?: string;
  planningContext?: string;
  planningVersion?: number;
  planningOrigin?: GeoPoint;
  planningId?: string;
  boardWalkKey?: string;
  boardWalkRetryAt?: number;
  boardWalk?: { stop: string; origin: GeoPoint; meters: number };
  staticKey?: string;
  markerMasks?: { point: GeoPoint; radius: number }[];
  routeCameraFlight?: boolean;
  planningAt?: number;
  planningFlight?: string;
  planningWait?: string;
  planningTimer?: ReturnType<typeof setTimeout>;
  planningRetryTimer?: ReturnType<typeof setTimeout>;
  remotePlans?: ShuttleJourney[];
  chosenPlanKey?: string;
  saveTimer?: ReturnType<typeof setTimeout>;
  persistedCommon?: CommonPlace[];
  visible: boolean;
  ready: boolean;
  active: boolean;
  attempted: boolean;
  manual: boolean;
  boardCandidates: string[];
  destinationStops: string[];
  manualPoint?: NamedPoint;
  drawnPlan?: ShuttleJourney;
  vehiclePreview?: { id: string; lineId: string; points: GeoPoint[] };
  vehiclePreviewAt?: number;
  vehiclePreviewFlight?: string;
  drawnDestination?: NamedPoint;
  pendingChoice: boolean;
  itinerary?: ShuttleItineraryPlanner;
  routeEpoch: number;
  routeTimer?: ReturnType<typeof setTimeout>;
  routeHandoff?: ReturnType<typeof setTimeout>;
  routeCanvas?: WechatMiniprogram.Canvas;
  routeContext?: TraceContext & { scale(x: number, y: number): void };
  routeFinal?: ShuttlePolyline[];
  generation: number;
  choosing: boolean;
  locationChoice?: {
    mode: "board" | "destination";
    completed: boolean;
    point?: NamedPoint;
    error?: unknown;
  };
  lease: SessionLease | null;
  map?: CampusShuttleMap;
  planner?: ShuttlePlanner;
  context?: WechatMiniprogram.MapContext;
  motion?: ShuttleMapMotion;
  recorder?: ShuttleLocationRecorder;
  stream?: ShuttleStream;
  location?: LocationResult;
  listener?: (value: WechatMiniprogram.OnLocationChangeListenerResult) => void;
  locationError?: (
    value: WechatMiniprogram.OnLocationChangeErrorListenerResult,
  ) => void;
  ticker?: ReturnType<typeof setInterval>;
  overlays?: ReturnType<typeof setInterval>;
  searchTimer?: ReturnType<typeof setTimeout>;
  commonTimer?: ReturnType<typeof setTimeout>;
  routeReveal?: ShuttleRouteReveal;
  routePaintKey?: string;
  routeJourneyKey?: string;
  layoutTimer?: ReturnType<typeof setTimeout>;
  packet?: ShuttleSnapshot;
  packetReceivedAt: number;
  bounds?: CampusShuttleMap["bounds"];
  boundsFlight: boolean;
  moving: boolean;
  selection: ShuttleSelection;
  destination?: NamedPoint;
  board?: ShuttlePlace;
  explicitBoard: string;
  plans: ShuttleJourney[];
  plan?: ShuttleJourney;
  favorites: string[];
  crossing: string[];
  staticIds: number[];
  markerPlaces: Map<number, ShuttlePlace>;
  pick?: NamedPoint;
  pickId?: string;
  pickMode?: "board" | "destination";
  pickTimer?: ReturnType<typeof setTimeout>;
  sheetSpring?: ReturnType<typeof setTimeout>;
  chipTimer?: ReturnType<typeof setTimeout>;
  drawnOrigin?: GeoPoint;
  touchHeight: number;
  touchY: number;
  touchAt: number;
  ignoreTapUntil: number;
  lastUi: number;
  lastOverlay: string;
  alerted: Set<string>;
}
const runtimes = new WeakMap<object, Runtime>();
function rt(host: object): Runtime {
  let state = runtimes.get(host);
  if (!state) {
    state = {
      visible: false,
      ready: false,
      active: false,
      attempted: false,
      manual: false,
      boardCandidates: [],
      destinationStops: [],
      pendingChoice: false,
      routeEpoch: 0,
      generation: 0,
      choosing: false,
      lease: null,
      packetReceivedAt: 0,
      boundsFlight: false,
      moving: false,
      selection: {},
      explicitBoard: "",
      plans: [],
      favorites: [],
      crossing: [],
      staticIds: [],
      markerPlaces: new Map(),
      touchHeight: 0,
      touchY: 0,
      touchAt: 0,
      ignoreTapUntil: 0,
      lastUi: 0,
      lastOverlay: "",
      alerted: new Set(),
    };
    runtimes.set(host, state);
  }
  return state;
}
const FAVORITE_PREFIX = "easy-swu:shuttle:favorites:";
function originPoint(state: Runtime): GeoPoint | undefined {
  return state.manual
    ? state.manualPoint ||
        state.map?.places.find((p) => p.id === state.explicitBoard)
    : state.location;
}
function planDestination(
  state: Runtime,
  plan?: ShuttleJourney,
): NamedPoint | undefined {
  if (!state.destination) return undefined;
  const point =
    plan?.destinationPoint ||
    (plan && state.destinationStops.includes(plan.alight.id)
      ? plan.alight
      : undefined);
  return point
    ? {
        ...state.destination,
        longitude: point.longitude,
        latitude: point.latitude,
      }
    : state.destination;
}
const categoryNames: Record<string, string> = {
  stop: "校车候车点",
  building: "教学 / 办公",
  dorm: "学生宿舍",
  entrance: "校门 / 入口",
  food: "食堂",
  poi: "校园地点",
};
function nearestStop(
  map: CampusShuttleMap,
  point: GeoPoint,
  routeId = "",
): ShuttlePlace | undefined {
  return map.places
    .filter(
      (p) =>
        p.category === "stop" && (!routeId || p.routeIds.includes(routeId)),
    )
    .sort((a, b) => distanceMeters(a, point) - distanceMeters(b, point))[0];
}
const MARKER_ICONS: Record<string, string> = {
  user: "/assets/shuttle/user.png",
  boarding: "/features/assets/shuttle/boarding.png",
  destination: "/features/assets/shuttle/stop.png",
  stop: "/features/assets/shuttle/stop.png",
  transfer: "/features/assets/shuttle/transfer.png",
};
function pointMarker(
  point: GeoPoint,
  id: number,
  icon: string,
  size: number,
  title = "",
): ShuttleMarker {
  return {
    ...point,
    id,
    iconPath: MARKER_ICONS[icon] || MARKER_ICONS.stop,
    width: size,
    height: size,
    anchor: { x: 0.5, y: 0.5 },
    zIndex: id === 1 ? 3000 : 400,
    ...(title
      ? {
          callout: {
            content: title,
            fontSize: 11,
            color: "#33445F",
            bgColor: "#FFFFFF",
            borderRadius: 8,
            padding: 6,
            display: "BYCLICK",
          },
        }
      : {}),
  };
}

Page({
  data: {
    theme: "light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    liquidGlassClass: "",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    windowHeight: 800,
    windowWidth: 375,
    statusBarHeight: 44,
    safeBottom: 20,
    headerHeight: 201,
    mapTop: 88,
    mapHeight: 432,
    sheetHeight: 280,
    sheetExpanded: false,
    sheetOpen: false,
    sheetMounted: false,
    sheetDragging: false,
    walking: false,
    planning: false,
    pickMounted: false,
    pickOpen: false,
    pickX: 0,
    pickY: 0,
    pickOrigin: false,
    originName: "我的位置",
    searchListHeight: 340,
    searchPanelHeight: 560,
    searchStopRows: [] as { id: string; places: SearchRow[] }[],
    searchPlaceRows: [] as { id: string; places: SearchRow[] }[],
    latitude: 29.8201,
    longitude: 106.4234,
    scale: 16,
    polylines: [] as ShuttlePolyline[],
    routeAnimating: false,
    circles: [] as {
      longitude: number;
      latitude: number;
      radius: number;
      color: string;
      fillColor: string;
      strokeWidth: number;
    }[],
    authorized: false,
    manualOrigin: false,
    hasOrigin: false,
    gateMessage: "正在准备校车地图",
    gateAction: "retry" as LocationAction,
    locating: false,
    connection: "connecting" as ShuttleConnectionState,
    stale: true,
    statusLabel: "正在连接实时校车",
    following: false,
    farFromCampus: false,
    routes: [] as ShuttleRoute[],
    routeId: "",
    vehicles: [] as ShuttleVehicle[],
    vehicleRows: [] as VehicleRow[],
    plans: [] as PlanRow[],
    selectedPlanId: "",
    selectedVehicleId: "",
    destinationName: "",
    boardName: "",
    boardDetail: "在地图上选择，或使用附近站点",
    boardFavorite: false,
    crossingLabel: "",
    recordingLabel: "位置仅在使用期间采集",
    journey: "idle" as Journey,
    journeyProgress: null as JourneyProgressView | null,
    journeyScroll: 0,
    reminderEnabled: false,
    edgeHints: [] as EdgeHint[],
    clusters: [] as Cluster[],
    searchMounted: false,
    searchOpen: false,
    searchMode: "destination" as "destination" | "board" | "common",
    searchQuery: "",
    keyboardHeight: 0,
    commonPlaces: [] as CommonPlace[],
    commonPlaceKey: "",
    commonEnteringKey: "",
    commonMounted: false,
    commonOpen: false,
    commonFocus: false,
    commonListHeight: 280,
    searchResults: [] as SearchRow[],
  },
  onLoad() {
    const state = rt(this);
    state.lease = captureSessionLease();
    if (!ensureAuthenticated()) return;
    const info = wx.getWindowInfo(),
      appearance = resolveAppearance();
    const safeBottom = Math.max(
      0,
      info.screenHeight - (info.safeArea?.bottom ?? info.screenHeight),
    );
    this.setData({
      ...appearance,
      windowHeight: info.windowHeight,
      windowWidth: info.windowWidth,
      statusBarHeight: info.statusBarHeight || 20,
      safeBottom,
      mapTop: (info.statusBarHeight || 20) + 44,
      searchListHeight: Math.max(140, Math.min(430, info.windowHeight * 0.5)),
    });
    try {
      const saved = wx.getStorageSync(
        `${FAVORITE_PREFIX}${state.lease?.userId}`,
      ) as unknown;
      state.favorites = Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      state.favorites = [];
    }
    this.layout(false);
    this.setData({ commonPlaces: loadCommonPlaces(state.lease!.userId) });
  },
  onReady() {
    const state = rt(this);
    state.ready = true;
    state.context = wx.createMapContext("campus-shuttle-map", this);
    this.measureHeader();
    this.initRouteCanvas();
    if (
      state.visible &&
      (!state.attempted || this.data.authorized || state.manual)
    )
      void this.activate();
  },
  onShow() {
    if (rt(this).lease && !isSessionLeaseCurrent(rt(this).lease)) {
      this.goBack();
      return;
    }
    rt(this).visible = true;
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
    this.finishLocationChoice();
    // A hidden canvas is cleared, but the active journey and its geometry survive.
    // Restore them immediately without replaying the reveal or choosing a new plan.
    if (rt(this).drawnPlan || rt(this).vehiclePreview) this.paintRoutes(true);
    if (!rt(this).attempted || this.data.authorized || rt(this).manual)
      void this.activate();
  },
  onHide() {
    const state = rt(this);
    if (state.sheetSpring) clearTimeout(state.sheetSpring);
    if (state.chipTimer) clearTimeout(state.chipTimer);
    this.dismissMapPick();
    cancelPresence(this);
    this.setData({
      pickMounted: false,
      pickOpen: false,
      sheetDragging: false,
      commonEnteringKey: "",
    });
    this.closeCommonSearch(true);
    if (this.data.searchMounted) this.closeSearch();
    this.deactivate(true);
  },
  onUnload() {
    cancelPresence(this);
    const pickTimer = rt(this).pickTimer;
    if (pickTimer) clearTimeout(pickTimer);
    this.closeCommonSearch(true);
    this.deactivate();
    const state = rt(this);
    if (state.sheetSpring) clearTimeout(state.sheetSpring);
    if (state.chipTimer) clearTimeout(state.chipTimer);
    if (state.searchTimer) clearTimeout(state.searchTimer);
    if (state.layoutTimer) clearTimeout(state.layoutTimer);
    state.motion?.clear();
    runtimes.delete(this);
  },
  onResize(event: { size: { windowWidth: number; windowHeight: number } }) {
    // Keyboard resize events must not replace the full viewport saved before editing.
    if (event.size.windowWidth === this.data.windowWidth) return;
    this.setData({
      windowWidth: event.size.windowWidth,
      windowHeight: this.data.keyboardHeight
        ? this.data.windowHeight
        : event.size.windowHeight,
    });
    this.layout(this.data.sheetExpanded);
    this.setData({
      searchPanelHeight: this.searchHeight(this.data.searchMode),
    });
    this.measureHeader();
  },
  feedback(message: string) {
    (
      this.selectComponent("#rate-limit-toast") as {
        show?: (value: string) => void;
      } | null
    )?.show?.(message);
  },
  async activate() {
    const state = rt(this);
    if (state.manual) {
      this.startManualOrigin();
      return;
    }
    if (
      !state.ready ||
      !state.visible ||
      state.active ||
      state.choosing ||
      !ensureAuthenticated()
    )
      return;
    state.active = true;
    state.attempted = true;
    state.lease = captureSessionLease();
    const generation = ++state.generation,
      lease = state.lease;
    const current = (): boolean =>
      state.visible &&
      state.active &&
      state.generation === generation &&
      isSessionLeaseCurrent(lease);
    this.setData({ locating: true, gateMessage: "正在准备定位" });
    try {
      // Show the complete road network before asking for any location permission.
      const map = await getShuttleMap();
      if (!current()) return;
      state.map = map;
      state.planner = new ShuttlePlanner(map);
      state.planner.installPlans(
        state.remotePlans || (state.drawnPlan ? [state.drawnPlan] : []),
      );
      state.itinerary = new ShuttleItineraryPlanner(map, state.planner);
      this.refreshCommonPlaces();
      this.setData({ routes: map.routes });
      if (state.drawnPlan || state.vehiclePreview) {
        // Journey planning is deliberately frozen until arrival/cancellation.
        // Do not replace the restored trip with the overview during activation.
        this.paintRoutes(true);
      } else {
        this.setData({
          polylines: roadPolylines(
            map,
            this.data.routeId ? [this.data.routeId] : undefined,
          ),
        });
      }
      if (!state.location) {
        this.setData({
          latitude: map.center.latitude,
          longitude: map.center.longitude,
          scale: map.scale - 1,
          statusLabel: "校园线路总览",
          farFromCampus: false,
          following: false,
        });
        this.staticMarkers();
      }
      if (this.data.searchMounted || this.data.commonMounted)
        this.filterPlaces();
      const raw = await authorizeShuttleLocation(current);
      const recorder = new ShuttleLocationRecorder({
        status: (pending, failed) => {
          if (current())
            this.setData({
              recordingLabel: pending && failed ? "位置记录待同步" : "",
            });
        },
        fatal: (message) => {
          if (current()) {
            this.feedback(message);
            this.deactivate();
            this.cancelJourney();
            this.setData({
              authorized: false,
              hasOrigin: false,
              gateMessage: message,
            });
          }
        },
      });
      state.recorder = recorder;
      // Native permission and the page/account lease are confirmed before recording.
      recorder.record(raw, state.location ? "resume" : "initial");
      const sample = recorder.current();
      if (!sample || !current()) {
        recorder.stop();
        return;
      }
      recorder.start();
      state.location = isDemoSession(getSession())
        ? { ...demoShuttlePosition(sample.raw) }
        : sample.raw;
      state.lastUi = Date.now();
      state.motion?.clear();
      state.motion = new ShuttleMapMotion(
        state.context!,
        state.planner,
        this.data.motionClass === "motion-reduced",
      );
      const far = distanceMeters(state.location, map.center) > 4000;
      const center = far ? map.center : state.location;
      this.setData({
        authorized: true,
        hasOrigin: true,
        manualOrigin: false,
        locating: false,
        farFromCampus: far,
        routes: map.routes,
        latitude: center.latitude,
        longitude: center.longitude,
        scale: far ? map.scale - 0.5 : 16.8,
        following: false,
        gateMessage: "",
        connection: "connecting",
        stale: true,
      });
      this.rebuildPlans(false);
      this.staticMarkers();
      this.paintUser();
      this.updateJourneyProgress();
      // One owned foreground listener; no background-location API or hidden tracking.
      state.listener = (value) => {
        // A callback already delivered by the native bridge still belongs to this account
        // after onHide. Persist it, but never revive a hidden page or another account.
        if (!isSessionLeaseCurrent(lease)) return;
        recorder.record({ ...value }, "change");
        if (!current()) return;
        state.location = isDemoSession(getSession())
          ? { ...demoShuttlePosition(value) }
          : { ...value };
        this.updateJourneyProgress();
        this.paintUser();
        this.refreshRows();
        if (this.data.following)
          this.setData({
            latitude: state.location.latitude,
            longitude: state.location.longitude,
          });
      };
      wx.onLocationChange(state.listener);
      state.locationError = () => {
        if (current()) {
          this.feedback("定位已中断，请检查定位服务后重试");
          this.deactivate();
          this.cancelJourney();
          this.setData({
            authorized: false,
            hasOrigin: false,
            locating: false,
            gateAction: "retry",
            gateMessage: "定位服务暂不可用",
          });
        }
      };
      if (wx.onLocationChangeError)
        wx.onLocationChangeError(state.locationError);
      await new Promise<void>((resolve, reject) =>
        wx.startLocationUpdate({
          type: "gcj02",
          success: () => resolve(),
          fail: (error) =>
            reject(locationFailure(error, "startLocationUpdate")),
        }),
      );
      if (!current()) {
        // A late start acknowledgement must not stop a newer activation.
        if (!state.active || !state.listener) wx.stopLocationUpdate({});
        return;
      }
      this.startLiveStream();
    } catch (error) {
      if (current()) {
        const message = getErrorMessage(error, "暂时无法加载，请稍后重试");
        const gateAction =
          error instanceof ShuttlePermissionError ? error.action : "retry";
        this.deactivate();
        state.visible = true;
        state.location = undefined;
        this.cancelJourney();
        state.motion?.clear();
        state.context?.removeMarkers({ markerIds: [1] });
        this.setData({
          authorized: false,
          hasOrigin: false,
          locating: false,
          gateMessage: message,
          gateAction,
          statusLabel: "校园线路总览",
          vehicles: [],
          vehicleRows: [],
          circles: [],
          edgeHints: [],
          clusters: [],
        });
        this.rebuildPlans(false);
        if (isDemoSession(getSession()) && state.map) {
          // Denied GPS stays denied; the review can still use a manual campus origin.
          state.manualPoint = { ...demoShuttlePosition(), name: "橘园" };
          state.manual = true;
          this.setData({ originName: "橘园" });
          this.startManualOrigin();
        }
        // Denial leaves a useful map and an explicit retry/settings action.
      }
    } finally {
      // Cached maps render immediately; refresh metadata even if positioning was denied.
      if (state.map && state.visible && isSessionLeaseCurrent(lease))
        void this.reloadMap(false);
    }
  },
  startLiveStream() {
    this.openTripSheet();
    const state = rt(this),
      generation = state.generation,
      lease = state.lease;
    const current = (): boolean =>
      state.visible &&
      state.active &&
      state.generation === generation &&
      isSessionLeaseCurrent(lease);
    state.stream = new ShuttleStream(
      () => state.recorder?.current() || null,
      {
        receipt: (accepted) => state.recorder?.acknowledge(accepted),
        snapshot: (packet) => {
          if (current()) this.receiveSnapshot(packet);
        },
        state: (connection) => {
          if (current()) {
            this.setData({ connection });
            this.refreshRows();
          }
        },
        fatal: (message) => {
          if (current()) {
            this.feedback(message);
            this.deactivate();
            this.setData({
              authorized: false,
              hasOrigin: false,
              gateMessage: message,
            });
          }
        },
        selectionInvalid: () => {
          if (current()) void this.reloadMap(true);
        },
      },
      () => (state.manual ? originPoint(state) : undefined),
    );
    state.stream.start(this.liveSelection());
    state.ticker = setInterval(() => {
      if (!current()) {
        this.deactivate();
        return;
      }
      this.refreshRows();
      // Also refresh when the upstream feed is completely silent.
      if (Date.now() - state.lastUi > 60000) {
        state.lastUi = Date.now();
        void this.reloadMap(false);
      }
    }, 1000);
    state.overlays = setInterval(() => {
      if (current()) this.updateOverlays();
    }, 120);
    this.refreshBounds();
  },
  startManualOrigin() {
    const state = rt(this);
    if (
      !state.ready ||
      !state.visible ||
      state.choosing ||
      !state.map ||
      !state.planner ||
      !isSessionLeaseCurrent(state.lease)
    )
      return;
    const stop = originPoint(state);
    if (!stop) return;
    if (
      state.manual &&
      state.active &&
      state.stream &&
      this.data.manualOrigin
    ) {
      this.paintUser();
      state.stream?.select(this.liveSelection());
      return;
    }
    this.deactivate();
    state.manual = true;
    state.visible = true;
    state.active = true;
    state.attempted = true;
    state.recorder = undefined;
    state.location = undefined;
    state.packet = undefined;
    state.motion?.clear();
    state.motion = new ShuttleMapMotion(
      state.context!,
      state.planner,
      this.data.motionClass === "motion-reduced",
    );
    this.setData({
      authorized: false,
      manualOrigin: true,
      hasOrigin: true,
      locating: false,
      gateMessage: "",
      connection: "connecting",
      stale: true,
      latitude: stop.latitude,
      longitude: stop.longitude,
      following: false,
      farFromCampus: false,
      circles: [],
    });
    this.rebuildPlans(false);
    this.paintUser();
    this.staticMarkers();
    this.startLiveStream();
  },
  deactivate(suspend = false) {
    const state = rt(this);
    if (state.planningRetryTimer) clearTimeout(state.planningRetryTimer);
    state.planningRetryTimer = undefined;
    if (state.planningTimer) clearTimeout(state.planningTimer);
    state.planningTimer = undefined;
    if (state.planningWait) {
      state.planningWait = undefined;
      state.planningKey = undefined;
      state.planningFlight = undefined;
    }
    state.planningFlight = undefined;
    state.vehiclePreview = undefined;
    state.journeyProgress?.pause();
    state.onboardDetector?.pause();
    state.visible = false;
    state.active = false;
    // Commit the accepted geometry before clearing a canvas that disappears on hide.
    // A foreground restore is not a new route selection or reveal clock.
    if (suspend && state.routeFinal)
      this.setData({ polylines: state.routeFinal });
    this.cancelRouteAnimation();
    state.routeEpoch++;
    state.generation += 1;
    this.setData({ locating: false, selectedVehicleId: "" });
    state.stream?.stop();
    state.stream = undefined;
    state.motion?.freeze();
    if (state.listener) {
      wx.offLocationChange(state.listener);
      state.listener = undefined;
      wx.stopLocationUpdate({});
    }
    if (state.locationError && wx.offLocationChangeError)
      wx.offLocationChangeError(state.locationError);
    state.locationError = undefined;
    state.recorder?.stop();
    if (state.ticker) clearInterval(state.ticker);
    if (state.overlays) clearInterval(state.overlays);
    state.ticker = undefined;
    state.overlays = undefined;
    state.boundsFlight = false;
  },
  retryActivation() {
    if (this.data.locating) return;
    const state = rt(this);
    this.deactivate();
    state.visible = true;
    void this.activate();
  },
  onLocationSettings(
    event: WechatMiniprogram.CustomEvent<{
      authSetting: Record<string, boolean>;
    }>,
  ) {
    if (event.detail.authSetting?.["scope.userLocation"])
      this.retryActivation();
    else this.setData({ gateMessage: "允许位置后可查看附近校车" });
  },
  openSystemLocationSettings() {
    if (!wx.openAppAuthorizeSetting) {
      this.feedback("请前往手机设置，允许微信使用位置");
      return;
    }
    wx.openAppAuthorizeSetting({
      success: () => this.retryActivation(),
      fail: () => this.feedback("请前往手机设置，允许微信使用位置"),
    });
  },
  receiveSnapshot(packet: ShuttleSnapshot) {
    const state = rt(this);
    state.packet = packet;
    state.packetReceivedAt = Date.now();
    state.motion?.update(
      this.displayVehicles(packet.vehicles),
      packet.fetchedAt,
      packet.stale,
      packet.serverTime,
    );
    this.setData({ vehicles: this.displayVehicles(packet.vehicles) });
    if (
      this.data.selectedVehicleId &&
      (packet.stale ||
        !this.displayVehicles(packet.vehicles).some(
          (v) =>
            v.id === this.data.selectedVehicleId &&
            (!state.vehiclePreview || v.lineId === state.vehiclePreview.lineId),
        ))
    )
      this.clearVehiclePreview();
    else if (this.data.selectedVehicleId && !state.vehiclePreview)
      this.refreshVehiclePreview();
    if (
      !this.data.sheetDragging &&
      this.data.sheetHeight !== this.targetSheetHeight(this.data.sheetExpanded)
    )
      this.layout(this.data.sheetExpanded);
    this.refreshRows();
    if (
      state.destination &&
      !state.planningFlight &&
      Date.now() - (state.planningAt || 0) > 20000
    )
      this.rebuildPlans(false);
    if (packet.mapRevision !== state.map?.revision) void this.reloadMap(false);
  },
  async reloadMap(invalidSelection: boolean) {
    const state = rt(this),
      generation = state.generation;
    try {
      const map = await getShuttleMap(true);
      if (!state.visible || generation !== state.generation) return;
      if (map.revision === state.map?.revision && !invalidSelection) return;
      state.map = map;
      state.planner = new ShuttlePlanner(map);
      state.itinerary = new ShuttleItineraryPlanner(map, state.planner);
      state.boardCandidates = state.boardCandidates.filter((id) =>
        map.places.some((p) => p.id === id && p.category === "stop"),
      );
      state.destinationStops = state.destinationStops.filter((id) =>
        map.places.some((p) => p.id === id && p.category === "stop"),
      );
      state.motion?.setPlanner(state.planner);
      this.refreshCommonPlaces();
      if (this.data.searchMounted || this.data.commonMounted)
        this.filterPlaces();
      let changed = false;
      if (
        state.selection.routeId &&
        !map.routes.some((r) => r.id === state.selection.routeId)
      ) {
        state.selection.routeId = "";
        changed = true;
      }
      if (
        state.explicitBoard &&
        !map.places.some(
          (p) => p.id === state.explicitBoard && p.category === "stop",
        )
      ) {
        state.explicitBoard = "";
        changed = true;
      }
      if (state.selection.destinationId) {
        const destination = map.places.find(
          (p) => p.id === state.selection.destinationId,
        );
        if (destination) state.destination = destination;
        else {
          state.destination = undefined;
          state.selection.destinationId = "";
          changed = true;
        }
      }
      this.setData({
        routes: map.routes,
        routeId: map.routes.some((route) => route.id === this.data.routeId)
          ? this.data.routeId
          : "",
        destinationName: state.destination?.name || "",
      });
      if (changed && state.journeyProgress) this.cancelJourney();
      this.rebuildPlans(true);
      this.staticMarkers();
      if (changed) this.feedback("线路已更新，请重新确认出行方案");
    } catch {
      /* Last-good map remains usable; never replace it with malformed data. */
    }
  },
  rebuildPlans(notify = true, preservePreview = false) {
    const state = rt(this);
    if (!state.map || !state.itinerary) return;
    // Live estimates must never replace the geometry of an active journey.
    if (this.data.journey !== "idle" && state.journeyProgress) return;
    if (
      state.destination &&
      (state.vehiclePreview || this.data.selectedVehicleId)
    )
      this.clearVehiclePreview();
    const currentOrigin = originPoint(state);
    if (!currentOrigin) {
      state.plan = undefined;
      state.plans = [];
      state.board = undefined;
      this.setData({
        plans: [],
        planning: false,
        selectedPlanId: "",
        boardName: "",
        boardDetail: "选择候车点后查看路线",
      });
      this.paintRoutes();
      this.staticMarkers();
      return;
    }
    let oldId = state.plan?.id;
    const colors = routePalette(state.map.routes);
    const oldBoardId = state.board?.id;
    // A GPS update changes the user marker, never the accepted planning anchor.
    // Destination/stop/manual-origin/map changes still create a new request.
    const context = JSON.stringify([
      state.map.revision,
      state.destination,
      state.boardCandidates,
      state.destinationStops,
      state.explicitBoard,
      state.planningVersion,
      state.manual,
      state.manual ? currentOrigin : undefined,
    ]);
    if (!state.planningOrigin || state.planningContext !== context) {
      state.planningOrigin = { ...currentOrigin };
      state.planningContext = context;
    }
    const origin = state.planningOrigin;
    const planKey = state.destination
      ? JSON.stringify([
          state.map.revision,
          state.planningOrigin.longitude,
          state.planningOrigin.latitude,
          state.destination,
          state.boardCandidates,
          state.destinationStops,
          state.manual,
          state.planningVersion,
        ])
      : "";
    if (planKey !== state.planningKey) {
      oldId = undefined;
      if (state.planningRetryTimer) clearTimeout(state.planningRetryTimer);
      state.planningRetryTimer = undefined;
      if (state.planningTimer) clearTimeout(state.planningTimer);
      state.planningTimer = undefined;
      state.planningWait = planKey || undefined;
      state.planningKey = planKey;
      state.remotePlans = undefined;
      state.planningId = undefined;
      state.planningAt = 0;
    }
    if (
      planKey &&
      state.planningFlight !== planKey &&
      Date.now() - (state.planningAt || 0) > 20000
    ) {
      state.planningFlight = planKey;
      state.planningAt = Date.now();
      const generation = state.generation;
      const coord = (p: GeoPoint): GeoPoint => ({
        longitude: p.longitude,
        latitude: p.latitude,
      });
      const estimateId = state.planningId;
      const estimatePlans = state.remotePlans;
      const timingOnly = Boolean(estimateId && estimatePlans);
      if (
        !timingOnly &&
        state.planningWait === planKey &&
        !state.planningTimer
      ) {
        state.planningTimer = setTimeout(() => {
          if (
            runtimes.get(this) !== state ||
            state.generation !== generation ||
            !state.visible ||
            !isSessionLeaseCurrent(state.lease) ||
            state.planningKey !== planKey
          )
            return;
          state.planningTimer = undefined;
          state.planningWait = undefined;
          this.rebuildPlans(true, true);
          this.fitPlans();
        }, 8000);
      }
      const request = {
        origin: coord(origin),
        destination: coord(state.destination!),
        originMode: state.manual ? ("manual" as const) : ("gps" as const),
        boardingIds: state.boardCandidates,
        destinationStopIds: state.destinationStops,
      };
      void (
        timingOnly
          ? refreshShuttleEstimates(estimateId!).then((result) => ({
              ...result,
              planningId: estimateId!,
              plans: estimatePlans!.map((p) => ({
                ...p,
                ...result.plans.find((t) => t.id === p.id),
              })),
            }))
          : cachedShuttlePlan(request, state.map.revision)
      )
        .then((result) => {
          if (
            runtimes.get(this) !== state ||
            state.generation !== generation ||
            !state.visible ||
            (this.data.journey !== "idle" && !!state.journeyProgress) ||
            !isSessionLeaseCurrent(state.lease) ||
            state.planningKey !== planKey ||
            result.revision !== state.map?.revision
          )
            return;
          // Only an explicit user choice is pinned. An automatic timeout walk
          // must not permanently hide a later, valid server ride recommendation.
          const pinned =
            state.chosenPlanKey === planKey ? state.plan : undefined;
          // Even a regenerated result with the same ID cannot rewrite an explicit
          // choice's geometry. Estimates may update its timing, never its itinerary.
          state.remotePlans = pinned
            ? [pinned, ...result.plans.filter((p) => p.id !== pinned.id)]
            : result.plans;
          if (pinned && timingOnly) {
            const timing = result.plans.find((p) => p.id === pinned.id);
            if (timing)
              Object.assign(pinned, {
                availability: timing.availability,
                nextArrivalSeconds: timing.nextArrivalSeconds,
                nextDepartureSeconds: timing.nextDepartureSeconds,
                nextDepartureState: timing.nextDepartureState,
                nextStops: timing.nextStops,
                estimatedAt: timing.estimatedAt,
                totalSeconds: timing.totalSeconds,
                rideSeconds: timing.rideSeconds,
              });
          }
          if (!timingOnly) state.planner?.installPlans(state.remotePlans);
          if (state.planningTimer) clearTimeout(state.planningTimer);
          state.planningTimer = undefined;
          state.planningWait = undefined;
          state.planningId = result.planningId;
          if ("cached" in result && result.cached)
            state.planningAt = Date.now() - 20001;
          if (!timingOnly && !pinned) state.plan = undefined;
          this.rebuildPlans(!timingOnly, true);
          if (!timingOnly && !pinned) this.fitPlans();
        })
        .catch((error) => {
          if (state.planningKey !== planKey || state.generation !== generation)
            return;
          const retryAfter = Number(error?.retryAfterMs);
          if (retryAfter > 0)
            state.planningAt = Date.now() + retryAfter - 20001;
          // A superseded request may still own the endpoint's pacing gate.
          // Retry the new intent when allowed; do not revive its old geometry
          // or turn this local deferral into an immediate straight-line fallback.
          if (error?.code === "SHUTTLE_REFRESH_DEFERRED" && state.visible) {
            if (state.planningRetryTimer)
              clearTimeout(state.planningRetryTimer);
            state.planningRetryTimer = setTimeout(
              () => {
                state.planningRetryTimer = undefined;
                if (
                  runtimes.get(this) === state &&
                  state.visible &&
                  isSessionLeaseCurrent(state.lease) &&
                  state.planningKey === planKey
                )
                  this.rebuildPlans(false, true);
              },
              Math.max(1000, retryAfter || 0),
            );
            return;
          }
          if ((error as { statusCode?: number }).statusCode === 404) {
            if (state.planningId) forgetShuttlePlan(state.planningId);
            state.planningId = undefined;
          }
          if (
            state.planningWait === planKey &&
            state.visible &&
            isSessionLeaseCurrent(state.lease)
          ) {
            if (state.planningTimer) clearTimeout(state.planningTimer);
            state.planningTimer = undefined;
            state.planningWait = undefined;
            this.rebuildPlans(true, true);
          }
          /* Keep the last usable plan while the server is unavailable. */
        })
        .finally(() => {
          if (
            state.planningFlight === planKey &&
            state.generation === generation
          )
            state.planningFlight = undefined;
        });
    }
    if (state.planningWait === planKey && !state.remotePlans) {
      // Keep the last rendered choice and geometry until its replacement is ready.
      this.setData({ planning: !state.drawnPlan });
      return;
    }
    state.plans =
      state.remotePlans ||
      (state.destination
        ? state.itinerary.plans(
            origin,
            state.destination,
            state.boardCandidates,
            state.destinationStops,
          )
        : []);
    if (state.destination && state.lease) {
      const favored = (p: ShuttleJourney): boolean =>
        preferredPlan(state.lease!.userId, p, origin, state.destination!);
      state.plans = [...state.plans].sort(
        (a, b) => Number(favored(b)) - Number(favored(a)),
      );
    }
    state.plan =
      state.plans.find((plan) => plan.id === oldId) || state.plans[0];
    state.board =
      state.plan?.mode === "walk"
        ? undefined
        : state.plan?.board ||
          (state.explicitBoard
            ? state.map.places.find((p) => p.id === state.explicitBoard)
            : nearestStop(state.map, origin, this.data.routeId));

    state.selection.routeId = state.plan?.route.id || this.data.routeId;
    state.selection.boardingId = state.destination
      ? state.plan?.board.id || state.explicitBoard
      : state.explicitBoard;
    // Destination with no suitable plan still stays destination-filtered server-side.
    this.setData({
      planning: false,
      walking: state.plan?.mode === "walk",
      plans: state.plans.map((plan) => ({
        favorite: Boolean(
          state.lease &&
          state.destination &&
          preferredPlan(state.lease.userId, plan, origin, state.destination),
        ),
        mode: plan.mode,
        id: plan.id,
        color: colors.get(plan.route.id) || plan.route.color,
        routeName:
          plan.mode === "walk"
            ? "步行"
            : plan.legs.map((leg) => routeNames(leg.routes)).join(" → "),
        stopCount: plan.stopCount,
        boardName:
          plan.mode === "walk" ? this.data.originName : stopName(plan.board),
        alightName:
          plan.mode === "walk"
            ? this.data.destinationName
            : stopName(plan.alight),
        walkLabel: this.walkLabel(plan),
        timeLabel: this.planTimeLabel(plan),
      })),
      selectedPlanId: state.pendingChoice ? "" : state.plan?.id || "",
      boardName: state.board ? stopName(state.board) : "",
      boardFavorite: Boolean(state.board && this.isSavedPlace(state.board)),
      boardDetail: state.board
        ? origin
          ? `${state.explicitBoard ? "已锁定" : "建议候车点"} · 距你 ${distanceLabel(state.plan?.walkLegs?.[0]?.meters ?? (state.boardWalk?.stop === state.board.id && distanceMeters(state.boardWalk.origin, origin) <= 10 ? state.boardWalk.meters : distanceMeters(origin, state.board)))}${state.plan?.walkLegs?.[0]?.source === "tencent" || (!state.destination && state.boardWalk?.stop === state.board.id && distanceMeters(state.boardWalk.origin, origin) <= 10) ? "" : "（直线）"}`
          : "已选候车点"
        : "暂无匹配站点",
    });
    if (!state.destination && state.board) {
      const board = state.board,
        anchor = { longitude: origin.longitude, latitude: origin.latitude };
      const walkKey = JSON.stringify([
        state.map.revision,
        board.id,
        state.planningOrigin,
      ]);
      if (
        walkKey !== state.boardWalkKey &&
        Date.now() >= (state.boardWalkRetryAt || 0)
      ) {
        state.boardWalkKey = walkKey;
        void cachedBoardingWalk(anchor, board, state.map.revision, state.manual)
          .then((leg) => {
            const currentOrigin = originPoint(state);
            if (
              !leg ||
              !state.visible ||
              !isSessionLeaseCurrent(state.lease) ||
              state.boardWalkKey !== walkKey ||
              state.destination ||
              state.board?.id !== board.id ||
              !currentOrigin ||
              distanceMeters(anchor, currentOrigin) > 10
            )
              return;
            state.boardWalk = {
              stop: board.id,
              origin: anchor,
              meters: leg.meters,
            };
            this.setData({
              boardDetail: `${state.explicitBoard ? "已锁定" : "建议候车点"} · 距你 ${distanceLabel(leg.meters)}`,
            });
          })
          .catch((error) => {
            if (state.boardWalkKey === walkKey) {
              state.boardWalkKey = undefined;
              state.boardWalkRetryAt =
                Date.now() + Math.max(5000, Number(error?.retryAfterMs) || 0);
            }
          });
      }
    }
    if (!state.pendingChoice) {
      state.drawnPlan = state.plan;
      state.drawnDestination = planDestination(state, state.plan);
      state.drawnOrigin = origin;
    }
    if (notify || state.destination || !this.data.polylines.length)
      this.paintRoutes();
    if (!notify && oldBoardId !== state.board?.id) this.staticMarkers();
    this.refreshRows();
    if (notify) this.applySelection(preservePreview);
  },
  liveSelection(): ShuttleSelection {
    const state = rt(this),
      plan = state.drawnPlan;
    const boardingVisits =
      plan?.legs.flatMap((leg) =>
        (leg.variants || [leg]).map((v) => ({
          routeId: v.route.id,
          stopId: v.board.id,
          serviceDirection: v.board.serviceDirection,
          serviceOrder: v.board.serviceOrder,
          platformHeading: v.board.platformHeading,
        })),
      ) || [];
    // Keep one existing stream, but observe other lines while navigating.
    if (state.journeyProgress && this.data.journey !== "idle" && !state.manual)
      return {};
    return plan?.mode === "walk"
      ? {}
      : plan
        ? {
            routeIds: [
              ...new Set(
                plan.legs.flatMap((leg) => leg.routes.map((r) => r.id)),
              ),
            ],
            boardingVisits,
          }
        : { ...state.selection };
  },
  displayVehicles(vehicles: ShuttleVehicle[]): ShuttleVehicle[] {
    const state = rt(this);
    if (!state.journeyProgress || this.data.journey === "idle") {
      const origin = originPoint(state) || state.map?.center;
      return [...vehicles]
        .sort((a, b) =>
          origin
            ? distanceMeters(origin, a) - distanceMeters(origin, b)
            : a.distance - b.distance,
        )
        .slice(0, 10);
    }
    const ids = state.drawnPlan?.legs.flatMap((leg) =>
      leg.routes.map((r) => r.id),
    );
    return ids?.length
      ? vehicles.filter((v) => ids.includes(v.lineId))
      : vehicles;
  },
  applySelection(preservePreview = false) {
    const state = rt(this);
    if (state.pendingChoice) return;
    if (!preservePreview) this.clearVehiclePreview();
    // Retain stable markers until the first snapshot for the new selection arrives.
    state.crossing = [];
    this.setData({
      edgeHints: [],
      clusters: [],
      crossingLabel: "",
      selectedVehicleId: preservePreview ? this.data.selectedVehicleId : "",
    });
    state.stream?.select(this.liveSelection());
    this.staticMarkers();
  },
  walkLabel(plan: ShuttleJourney): string {
    const state = rt(this),
      packet = state.packet;
    const fresh =
      packet &&
      !packet.stale &&
      this.data.connection === "live" &&
      packet.serverTime -
        packet.fetchedAt +
        Date.now() -
        state.packetReceivedAt <=
        12000;
    const variants =
      plan.legs?.[0]?.variants || (plan.legs?.[0] ? [plan.legs[0]] : []);
    const remoteArrival = (bus: ShuttleVehicle, board: ShuttlePlace) =>
      packet?.mapRevision === state.map?.revision
        ? bus.arrivals?.find(
            (a) =>
              a.board.stopId === board.id &&
              a.board.serviceDirection === board.serviceDirection &&
              a.board.serviceOrder === board.serviceOrder,
          )
        : undefined;
    const waiting =
      fresh &&
      variants.some((v) =>
        packet.vehicles.some((bus) => {
          if (bus.lineId !== v.route.id) return false;
          const remote = remoteArrival(bus, v.board);
          return remote
            ? remote.status === "waiting"
            : state.map?.planningMode !== "adaptive" &&
                state.planner?.arrival(
                  bus,
                  v.board,
                  false,
                  false,
                  packet.fetchedAt,
                ).preparing;
        }),
      );
    if (
      plan.mode !== "walk" &&
      (waiting || plan.nextDepartureState === "preparing")
    ) {
      const remoteWaiting = fresh
        ? (packet.vehicles as ShuttleVehicle[]).flatMap((bus) =>
            (packet.mapRevision === state.map?.revision
              ? bus.arrivals || []
              : []
            ).filter(
              (a) =>
                a.status === "waiting" &&
                variants.some(
                  (v) =>
                    v.route.id === bus.lineId &&
                    a.board.stopId === v.board.id &&
                    a.board.serviceDirection === v.board.serviceDirection &&
                    a.board.serviceOrder === v.board.serviceOrder,
                ),
            ),
          )
        : [];
      const seconds = remoteWaiting.length
        ? remoteWaiting[0].departureSeconds
        : plan.nextDepartureSeconds;
      const age = remoteWaiting.length
        ? Math.max(0, (Date.now() - state.packetReceivedAt) / 1000)
        : plan.estimatedAt
          ? Math.max(
              0,
              ((packet?.serverTime || Date.now()) +
                (packet ? Date.now() - state.packetReceivedAt : 0) -
                plan.estimatedAt) /
                1000,
            )
          : 0;
      return `下一辆：${departureLabel(seconds, age)}`;
    }
    if (plan.mode !== "walk" && plan.nextArrivalSeconds != null)
      return `下一辆：${plan.nextStops != null ? plan.nextStops + " 站" : ""}（约 ${Math.max(1, Math.ceil(plan.nextArrivalSeconds / 60))} 分钟）`;
    if (
      plan.mode !== "walk" &&
      plan.availability &&
      plan.availability !== "live"
    )
      return plan.availability === "waiting" ? "等待发车" : "到站时间待确认";
    if (plan.mode === "walk")
      return `步行约 ${distanceLabel(plan.walkTo)} · ${Math.max(1, Math.round((plan.totalSeconds || plan.walkTo / 1.2) / 60))} 分钟`;
    const transfer = plan.legs
      .slice(1)
      .reduce(
        (n, leg, i) => n + distanceMeters(plan.legs[i].alight, leg.board),
        0,
      );
    const walk = plan.walkLegs
      ? plan.walkLegs.reduce((n, leg) => n + leg.meters, 0)
      : plan.walkTo + plan.walkFrom + transfer;
    const names = plan.legs.slice(0, -1).map((leg) => stopName(leg.alight));
    return (
      (names.length ? names.join("、") + "换乘 · " : "直达 · ") +
      "步行约 " +
      distanceLabel(walk)
    );
  },
  planTimeLabel(plan: ShuttleJourney): string {
    const minutes = Math.max(
      1,
      Math.ceil(
        (plan.totalSeconds ??
          (plan.walkTo + plan.walkFrom) / 1.2 + plan.rideMeters / 4) / 60,
      ),
    );
    if (plan.mode === "walk") return `约 ${minutes} 分钟`;
    const known = plan.availability === "live";
    const travel = Math.max(
      1,
      Math.ceil(
        ((plan.rideSeconds ?? plan.rideMeters / 4) +
          (plan.walkingSeconds ?? (plan.walkTo + plan.walkFrom) / 1.2)) /
          60,
      ),
    );
    return `${plan.stopCount} 站（${known ? "全程约" : "行程约"} ${known ? minutes : travel} 分钟）`;
  },
  initRouteCanvas() {
    const state = rt(this);
    const selection = this.createSelectorQuery().select("#route-trace-canvas");
    if (!selection.fields) return;
    selection
      .fields({ node: true, size: true }, (result) => {
        const node = (result as { node?: WechatMiniprogram.Canvas })?.node;
        if (!node || runtimes.get(this) !== state) return;
        state.routeCanvas = node;
        state.routeContext = node.getContext("2d") as typeof state.routeContext;
      })
      .exec();
  },
  cancelRouteAnimation() {
    const state = rt(this);
    for (const timer of [state.routeTimer, state.routeHandoff])
      if (timer) clearTimeout(timer);
    state.routeTimer = state.routeHandoff = undefined;
    state.routeReveal?.stop();
    state.routeReveal = undefined;
    state.routeFinal = undefined;
    state.routeContext?.clearRect(
      0,
      0,
      this.data.windowWidth,
      this.data.windowHeight,
    );
    this.setData({ routeAnimating: false });
    if (state.visible) this.paintUser();
  },
  finishRouteAnimation() {
    const state = rt(this);
    if (!state.routeFinal || state.routeHandoff) return;
    // A single geographic overlay commit, after all independent traces complete.
    this.setData({ polylines: state.routeFinal });
    const epoch = state.routeEpoch;
    state.routeHandoff = setTimeout(() => {
      if (runtimes.get(this) !== state || epoch !== state.routeEpoch) return;
      this.cancelRouteAnimation();
    }, 160);
  },
  paintRoutes(immediate = false) {
    const state = rt(this);
    if (!state.map || (state.pendingChoice && !immediate)) return;
    if (state.planningWait && !state.drawnPlan) return;
    const preview = state.vehiclePreview;
    const plan = state.drawnPlan,
      destination = state.drawnDestination;
    const activeJourney =
      this.data.journey !== "idle" && !!state.journeyProgress;
    const journeyKey = JSON.stringify([
      state.map.revision,
      destination,
      // Server IDs and estimates may change without changing the accepted itinerary.
      // Only a different directed geometry or endpoint starts a fresh reveal.
      preview ? undefined : plan?.legs.map((l) => [l.route.id, l.points]),
      preview ? undefined : state.drawnOrigin,
      state.manual ? state.manualPoint : undefined,
      preview,
    ]);
    const animate = state.routeJourneyKey !== journeyKey;
    const colors = routePalette(state.map.routes);
    const rides: {
      points: GeoPoint[];
      color: string;
      width: number;
      dotted: boolean;
    }[] = [];
    const walks: typeof rides = [];
    const journey: typeof rides = [];
    if (preview) {
      rides.push({
        points: preview.points,
        color: colors.get(preview.lineId) || "#3478F6",
        width: 4,
        dotted: false,
      });
      journey.push(rides[0]);
    }
    let walkIndex = 0;
    const ready = true;
    const walk = (from: GeoPoint, to: GeoPoint, color: string): void => {
      const geometry = plan?.walkLegs?.[walkIndex++];
      if (distanceMeters(from, to) <= 2) return;
      // A straight fallback is still a walking leg. Draw it now; a later
      // refinement can reveal independently without removing the bus overlay.
      walks.push({
        points: geometry?.points.length
          ? [from, ...geometry.points.slice(1, -1), to]
          : [from, to],
        color,
        width: 3,
        dotted: true,
      });
      journey.push(walks[walks.length - 1]);
    };
    if (plan) {
      let from =
        state.drawnOrigin && (!animate || activeJourney)
          ? state.drawnOrigin
          : state.planningOrigin || originPoint(state) || plan.board;
      for (const leg of plan.legs) {
        const color = colors.get(leg.route.id) || leg.route.color;
        if (leg === plan.legs[0] && leg.onboard) walkIndex++;
        else walk(from, leg.board, color);
        if (!preview) {
          rides.push({ points: leg.points, color, width: 4, dotted: false });
          journey.push(rides[rides.length - 1]);
        }
        from = leg.alight;
      }
      if (destination)
        walk(
          from,
          destination,
          colors.get(plan.legs[plan.legs.length - 1]?.route.id) || "#526C64",
        );
    }
    const key = JSON.stringify([
      journeyKey,
      walks,
      ready,
      this.data.motionClass,
    ]);
    if (
      key === state.routePaintKey &&
      (!immediate ||
        (!state.routeTimer &&
          !this.data.routeAnimating &&
          this.data.polylines.length))
    )
      return;
    state.routePaintKey = key;
    const base = destination || preview ? [] : roadPolylines(state.map);
    const rideParts = orderedTraces(rides),
      walkParts = orderedTraces(walks);
    const final = [...base, ...tracePolylines([...rideParts, ...walkParts])];
    if (
      !immediate &&
      !animate &&
      this.data.routeAnimating &&
      state.routeReveal &&
      !state.routeHandoff
    ) {
      state.routeFinal = final;
      state.routeReveal.updateWalking(walkParts, ready);
      return;
    }
    const firstPaint = animate || Boolean(state.routeTimer);
    const epoch = ++state.routeEpoch;
    this.cancelRouteAnimation();
    state.routeJourneyKey = journeyKey;
    if (!state.drawnOrigin)
      state.drawnOrigin = state.planningOrigin || originPoint(state);
    state.routeFinal = final;
    const current = (): boolean =>
      runtimes.get(this) === state &&
      state.visible &&
      state.routeEpoch === epoch &&
      isSessionLeaseCurrent(state.lease);
    this.staticMarkers();
    if (
      immediate ||
      (!destination && !preview) ||
      this.data.motionClass === "motion-reduced" ||
      !state.routeCanvas ||
      !state.routeContext
    ) {
      this.setData({ polylines: final });
      return;
    }
    const start = (): void => {
      if (!current()) return;
      state.routeTimer = undefined;
      state.context?.getRegion({
        success: (bounds) => {
          if (!current()) return;
          state.bounds = bounds;
          const width = this.data.windowWidth,
            height = this.data.mapHeight;
          const ratio = Math.min(3, wx.getWindowInfo().pixelRatio || 2);
          state.routeCanvas!.width = Math.round(width * ratio);
          state.routeCanvas!.height = Math.round(height * ratio);
          state.routeContext!.scale(ratio, ratio);
          state.routeReveal = new ShuttleRouteReveal(
            state.routeCanvas!,
            state.routeContext!,
          );
          // A late walking refinement keeps the installed bus overlay underneath
          // the canvas until the refined geometry is complete.
          this.setData(
            firstPaint
              ? { routeAnimating: true, polylines: base }
              : { routeAnimating: true },
          );
          this.paintUser();
          state.routeReveal.start(
            rideParts,
            (p) => projectToScreen(p, state.bounds || bounds, width, height),
            width,
            height,
            () => {
              if (current()) this.finishRouteAnimation();
            },
            () => {
              // Read the live camera at most once in flight. No native polyline writes per frame.
              if (state.moving && !state.routeCameraFlight) {
                state.routeCameraFlight = true;
                state.context?.getRegion({
                  success: (region) => {
                    if (current()) state.bounds = region;
                  },
                  complete: () => {
                    state.routeCameraFlight = false;
                  },
                });
              }
              return !state.moving;
            },
            !ready,
            !firstPaint,
            () => [
              ...(state.markerMasks || []),
              ...(state.motion
                ?.positions()
                .map((m) => ({ point: m.point, radius: 13 })) || []),
              ...(state.drawnOrigin
                ? [{ point: state.drawnOrigin, radius: 11 }]
                : []),
            ],
          );
          if (firstPaint && ready && !preview)
            state.routeReveal.updateJourney(orderedTraces(journey));
          else state.routeReveal.updateWalking(walkParts, ready);
        },
        fail: () => {
          if (current()) this.setData({ polylines: state.routeFinal || final });
        },
      });
    };
    state.routeTimer = setTimeout(start, animate && !preview ? 420 : 0);
  },
  staticMarkers() {
    const state = rt(this);
    if (!state.context || !state.map) return;
    state.markerPlaces.clear();
    const markers: ShuttleMarker[] = state.map.places
      .filter((place) => place.category === "stop")
      .map((place, index) => {
        const id = 100 + index;
        state.markerPlaces.set(id, place);
        return {
          ...pointMarker(place, id, "stop", 44),
          iconPath: "/features/assets/shuttle/stop-hit.png",
        };
      });
    const destination =
      state.drawnDestination ||
      (!state.pendingChoice ? state.destination : undefined);
    const board =
      state.drawnPlan?.mode === "walk"
        ? undefined
        : state.drawnPlan?.board || state.board;
    if (destination)
      markers.push(
        pointMarker(destination, 2, "destination", 25, destination.name),
      );
    if (board)
      markers.push(pointMarker(board, 3, "boarding", 25, stopName(board)));
    state.drawnPlan?.legs
      .slice(0, -1)
      .forEach((leg, i) =>
        markers.push(
          pointMarker(
            leg.alight,
            10 + i,
            "transfer",
            25,
            stopName(leg.alight) + "换乘",
          ),
        ),
      );
    const key = JSON.stringify(markers);
    state.markerMasks = markers.map((m) => ({
      point: m,
      radius: m.id >= 100 ? 6.1 : m.width / 2,
    }));
    if (key === state.staticKey) return;
    const removed = state.staticIds.filter(
      (id) => !markers.some((m) => m.id === id),
    );
    if (removed.length) state.context.removeMarkers({ markerIds: removed });
    state.staticKey = key;
    state.staticIds = markers.map((m) => m.id);
    state.context.addMarkers({ markers });
  },
  paintUser() {
    const state = rt(this);
    const origin = originPoint(state);
    if (!origin || !state.context || !state.visible) return;
    state.context.addMarkers({
      markers: [
        pointMarker(
          origin,
          1,
          "user",
          22,
          state.manual ? "出发点" : "我的位置",
        ),
      ],
    });
    const accuracy = state.manual ? 0 : Number(state.location?.accuracy);
    this.setData({
      circles:
        Number.isFinite(accuracy) && accuracy > 0
          ? [
              {
                longitude: origin.longitude,
                latitude: origin.latitude,
                radius: Math.min(accuracy, 250),
                color: "#3478F622",
                fillColor: "#3478F610",
                strokeWidth: 1,
              },
            ]
          : [],
    });
  },
  refreshRows() {
    const state = rt(this);
    if (!state.map || !state.planner) return;
    const packet = state.packet;
    const colors = routePalette(state.map.routes);
    // Server time, not the phone's possibly incorrect wall clock, determines data age.
    const age = packet
      ? Math.max(0, packet.serverTime - packet.fetchedAt) +
        (Date.now() - state.packetReceivedAt)
      : Infinity;
    const stale =
      !packet || packet.stale || age > 12000 || this.data.connection !== "live";
    if (stale) state.motion?.freeze();
    const expired = age > 60000;
    const vehicles = expired
      ? []
      : this.displayVehicles(packet?.vehicles || []);
    if (expired && state.motion?.positions().length) state.motion.clear();
    const rows: VehicleRow[] = vehicles
      .filter((v) => !state.crossing.length || state.crossing.includes(v.id))
      .map((bus) => {
        const route = state.map!.routes.find((r) => r.id === bus.lineId);
        const leg = state.drawnPlan?.legs.find((leg) =>
          leg.routes.some((route) => route.id === bus.lineId),
        );
        const board =
          (this.data.journey !== "idle" && state.journeyView?.boardingId
            ? state.map!.places.find(
                (p) => p.id === state.journeyView!.boardingId,
              )
            : undefined) ||
          leg?.variants?.find((v) => v.route.id === bus.lineId)?.board ||
          leg?.board ||
          (state.drawnPlan?.mode === "ride"
            ? state.drawnPlan.board
            : state.board) ||
          nearestStop(
            state.map!,
            originPoint(state) || state.map!.center,
            bus.lineId,
          );
        const remote =
          !stale && packet?.mapRevision === state.map!.revision
            ? bus.arrivals?.find(
                (a) =>
                  a.board.stopId === board?.id &&
                  a.board.routeId === bus.lineId &&
                  a.board.serviceDirection === board?.serviceDirection &&
                  a.board.serviceOrder === board?.serviceOrder,
              )
            : undefined;
        const local = remote
          ? {
              ...remote,
              passed: remote.status === "passed",
              preparing: remote.status === "waiting",
            }
          : board
            ? state.planner!.arrival(
                bus,
                board,
                stale,
                this.data.journey !== "idle",
                packet?.fetchedAt,
              )
            : {
                text: "待确认",
                detail: "",
                seconds: null,
                distance: null,
                passed: false,
                preparing: false,
              };
        const arrivalStatus =
          remote?.status ||
          (local.passed
            ? "passed"
            : local.preparing
              ? "waiting"
              : local.seconds !== null
                ? "approaching"
                : "unconfirmed");
        // Local geometry may classify a vehicle, but must not invent historical minutes.
        const seconds = remote
          ? remote.seconds
          : local.seconds === 0
            ? 0
            : null;
        const estimate = remote || {
          seconds,
          distance: local.distance,
          detail: "",
          text:
            arrivalStatus === "waiting"
              ? "等候中"
              : arrivalStatus === "approaching"
                ? seconds === 0
                  ? "即将到站"
                  : "正在驶来"
                : "待确认",
        };
        if (
          this.data.reminderEnabled &&
          this.data.journey === "waiting" &&
          state.journeyView?.routes.includes(bus.lineId) &&
          !stale &&
          local.seconds !== null &&
          local.seconds <= 75 &&
          !state.alerted.has(bus.id)
        ) {
          state.alerted.add(bus.id);
          haptic("medium");
          this.feedback(
            `${bus.vehicleNo || bus.id} 号车接近候车点，请留意来车`,
          );
        }
        return {
          arrivalStatus,
          sortSeconds: seconds ?? Infinity,
          routeDistance: estimate.distance ?? Infinity,
          id: bus.id,
          number: (bus.vehicleNo || bus.id).slice(-5),
          color: route ? colors.get(route.id) || route.color : "#7892B5",
          routeName: route?.name || `线路 ${bus.lineId || "待确认"}`,
          detail: stale ? "信号未更新 · 不继续推算" : estimate.detail,
          eta: estimate.text,
          imminent:
            !stale && estimate.seconds !== null && estimate.seconds <= 75,
          distanceLabel: `${state.manual ? "距起点" : "距你"} ${distanceLabel(originPoint(state) ? distanceMeters(originPoint(state)!, bus) : bus.distance)}`,
        };
      })
      .filter(
        (row) =>
          row.arrivalStatus !== "passed" &&
          (!(state.drawnPlan?.mode === "ride" || state.explicitBoard) ||
            row.arrivalStatus !== "unconfirmed"),
      )
      .sort((a, b) => {
        const rank = { waiting: 0, approaching: 1, unconfirmed: 2, passed: 3 };
        return (
          rank[a.arrivalStatus] - rank[b.arrivalStatus] ||
          a.sortSeconds - b.sortSeconds ||
          a.routeDistance - b.routeDistance ||
          a.id.localeCompare(b.id)
        );
      })
      .map(
        ({
          arrivalStatus: _status,
          sortSeconds: _seconds,
          routeDistance: _distance,
          ...row
        }) => row,
      );
    const statusLabel =
      this.data.connection !== "live"
        ? this.data.connection === "connecting"
          ? "正在连接实时校车"
          : "连接中断，正在重连"
        : stale
          ? "车辆信号暂未更新"
          : "实时位置 · 3 秒更新";
    this.setData({ vehicleRows: rows, vehicles, stale, statusLabel });
    if (state.plans.length)
      this.setData({
        plans: this.data.plans.map((row) => {
          const plan = state.plans.find((p) => p.id === row.id);
          return plan ? { ...row, walkLabel: this.walkLabel(plan) } : row;
        }),
      });
    if (
      this.data.journey === "riding" &&
      state.journeyView?.approaching &&
      !state.alerted.has(`arrival:${state.journeyView.boardingId}`)
    ) {
      state.alerted.add(`arrival:${state.journeyView!.boardingId}`);
      haptic("medium");
      this.feedback("已接近下车点，请留意停车后安全下车");
    }
  },
  selectRoute(event: Tap) {
    const state = rt(this);
    state.selection.routeId = String(event.currentTarget.dataset.id || "");
    state.plan = undefined;
    this.setData({
      routeId: state.selection.routeId,
      journey: "idle",
      reminderEnabled: false,
    });
    haptic();
    this.rebuildPlans(true);
  },
  choosePlan(event: Tap) {
    this.dismissMapPick();
    const state = rt(this),
      plan = state.plans.find((p) => p.id === event.currentTarget.dataset.id);
    if (!plan || state.planningWait) return;
    if (
      state.plan?.id !== plan.id ||
      state.chosenPlanKey !== state.planningKey
    ) {
      state.routePaintKey = undefined;
      state.routeJourneyKey = undefined;
    }
    state.plan = plan;
    state.chosenPlanKey = state.planningKey;
    state.board = plan.mode === "walk" ? undefined : plan.board;
    state.pendingChoice = false;
    state.drawnPlan = plan;
    state.drawnDestination = planDestination(state, plan);
    state.drawnOrigin = state.planningOrigin || originPoint(state);
    state.selection.routeId = plan.route.id;
    state.selection.boardingId = plan.board.id;

    this.setData({
      walking: plan.mode === "walk",
      selectedPlanId: plan.id,
      boardName: stopName(plan.board),
      boardFavorite: this.isSavedPlace(plan.board),
      boardDetail: originPoint(state)
        ? `建议候车点 · 距你 ${distanceLabel(plan.walkTo)}${plan.walkLegs?.[0]?.source === "tencent" ? "" : "（直线）"}`
        : "已选候车点",
      journey: "idle",
    });
    haptic();
    this.paintRoutes();
    this.applySelection();
    this.fitPlans();
  },
  openDestinationSearch() {
    this.openSearch("destination");
  },
  openBoardingSearch() {
    this.openSearch("board");
  },
  openCommonSearch() {
    this.dismissMapPick();
    if (this.data.commonMounted) {
      this.closeCommonSearch();
      return;
    }
    const state = rt(this);
    if (!isSessionLeaseCurrent(state.lease)) return;
    if (state.commonTimer) clearTimeout(state.commonTimer);
    if (this.data.searchMounted) this.closeSearch();
    this.setData({
      commonMounted: true,
      commonOpen: false,
      commonFocus: false,
      searchMode: "common",
      searchQuery: "",
    });
    this.filterPlaces();
    this.updateCommonHeight();
    state.commonTimer = setTimeout(() => {
      if (!state.visible || !isSessionLeaseCurrent(state.lease)) return;
      this.setData({ commonOpen: true });
      state.commonTimer = setTimeout(
        () => {
          if (
            state.visible &&
            this.data.commonOpen &&
            isSessionLeaseCurrent(state.lease)
          )
            this.setData({ commonFocus: true });
        },
        this.data.motionClass === "motion-reduced" ? 0 : 260,
      );
    }, 20);
    haptic();
  },
  closeCommonSearch(immediate: unknown = false) {
    const state = rt(this);
    if (state.commonTimer) clearTimeout(state.commonTimer);
    if (!this.data.commonMounted) return;
    wx.hideKeyboard({});
    this.setData({ commonOpen: false, commonFocus: false, keyboardHeight: 0 });
    if (immediate === true || this.data.motionClass === "motion-reduced") {
      this.setData({ commonMounted: false });
    } else {
      state.commonTimer = setTimeout(
        () => this.setData({ commonMounted: false }),
        280,
      );
    }
  },
  updateCommonHeight() {
    this.setData({
      commonListHeight: Math.max(
        48,
        Math.min(
          300,
          this.data.windowHeight -
            this.data.headerHeight -
            this.data.keyboardHeight -
            12,
        ),
      ),
    });
  },
  refreshCommonPlaces() {
    const state = rt(this);
    if (!state.map || !isSessionLeaseCurrent(state.lease)) return;
    const commonPlaces = [
      ...new Map(
        this.data.commonPlaces.map((p) => {
          const value = canonicalCommonPlace(state.map!, p);
          return [value.key, value] as const;
        }),
      ).values(),
    ];
    this.setData({ commonPlaces });
    saveCommonPlaces(state.lease!.userId, commonPlaces);
  },
  openSearch(mode: "destination" | "board" | "common") {
    this.dismissMapPick();
    this.closeCommonSearch(true);
    this.setData({
      searchMode: mode,
      searchQuery: "",
      searchPanelHeight: this.searchHeight(mode),
    });
    this.filterPlaces();
    setPresence(this, true, {
      mounted: "searchMounted",
      active: "searchOpen",
      reducedMotion: this.data.motionClass === "motion-reduced",
    });
    haptic();
  },
  closeSearch() {
    wx.hideKeyboard({});
    setPresence(this, false, {
      mounted: "searchMounted",
      active: "searchOpen",
      reducedMotion: this.data.motionClass === "motion-reduced",
    });
  },
  searchHeight(
    _mode: "destination" | "board" | "common",
    _keyboard?: number,
  ): number {
    return Math.max(
      180,
      Math.min(
        this.data.windowHeight * 0.82,
        this.data.windowHeight - this.data.mapTop - 12,
      ),
    );
  },
  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ searchQuery: event.detail.value });
    this.filterPlaces();
  },
  onSearchKeyboard(event: WechatMiniprogram.CustomEvent<{ height: number }>) {
    // The full drawer stays fixed: the system keyboard overlays its content.
    if (!this.data.commonOpen) return;
    this.setData({ keyboardHeight: Math.max(0, event.detail.height || 0) });
    this.updateCommonHeight();
  },
  filterPlaces() {
    const state = rt(this);
    if (!state.map) return;
    const origin = originPoint(state);
    const results: SearchRow[] = findPlaceGroups(
      state.map,
      this.data.searchQuery,
      false,
      origin,
    )
      .sort(
        (a, b) =>
          Number(b.stop) - Number(a.stop) ||
          Number(b.members.some((p) => this.isSavedPlace(p))) -
            Number(a.members.some((p) => this.isSavedPlace(p))),
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        shortName: g.shortName,
        stop: g.stop,
        categoryLabel: categoryNames[g.members[0].category] || "校园地点",
        favorite: g.members.some((p) => this.isSavedPlace(p)),
        distanceLabel: origin
          ? distanceLabel(
              Math.min(...g.members.map((p) => distanceMeters(origin, p))),
            )
          : "",
      }));
    const pairs = (
      items: SearchRow[],
    ): { id: string; places: SearchRow[] }[] => {
      const rows: { id: string; places: SearchRow[] }[] = [];
      for (let i = 0; i < items.length; i += 2)
        rows.push({ id: items[i].id, places: items.slice(i, i + 2) });
      return rows;
    };
    this.setData({
      searchResults: results,
      searchStopRows: pairs(results.filter((p) => p.stop)),
      searchPlaceRows: pairs(results.filter((p) => !p.stop)),
    });
  },
  selectPlaceGroup(id: string, boarding: boolean) {
    const state = rt(this);
    if (!state.map) return;
    const group = placeGroups(state.map).find((g) =>
      g.members.some((p) => p.id === id),
    );
    if (!group) return;
    const origin = originPoint(state) || state.map.center;
    const members = [...group.members].sort(
      (a, b) => distanceMeters(origin, a) - distanceMeters(origin, b),
    );
    const place = members[0];
    if (boarding) {
      state.boardCandidates = group.stop ? members.map((p) => p.id) : [];
      state.explicitBoard = group.stop ? place.id : "";
      state.manualPoint = groupPoint(group);
      state.manual = true;
      this.resetPlanning();
      this.setData({ originName: group.shortName });
      this.openTripSheet();
    } else {
      this.openTripSheet();
      state.destinationStops = group.stop ? members.map((p) => p.id) : [];
      state.destination = groupPoint(group);
      state.selection.destinationId = place.id;
      delete state.selection.destinationPoint;
      this.resetPlanning();
      this.setData({
        destinationName: group.shortName,
        commonPlaceKey: commonPlace(group.members[0], group.id).key,
      });
    }
  },
  choosePlace(event: Tap) {
    const state = rt(this),
      place = state.map?.places.find(
        (p) => p.id === event.currentTarget.dataset.id,
      );
    if (!place || !isSessionLeaseCurrent(state.lease)) return;
    if (this.data.searchMode === "common") {
      if (!this.addCommonPlace(commonPlace(place, place.id))) return;
    }
    this.selectPlaceGroup(place.id, this.data.searchMode === "board");
    state.plan = undefined;
    state.alerted.clear();
    this.setData({ journey: "idle", reminderEnabled: false });
    if (this.data.searchMode === "common") this.closeCommonSearch();
    else this.closeSearch();
    this.rebuildPlans(true);
    if (state.manual) this.startManualOrigin();
    this.layout(false);
    this.fitPlans();
    haptic();
  },
  chooseOnMap() {
    const state = rt(this);
    if (state.choosing || !state.visible || !isSessionLeaseCurrent(state.lease))
      return;
    const choice: NonNullable<Runtime["locationChoice"]> = {
      mode: this.data.searchMode === "board" ? "board" : "destination",
      completed: false,
    };
    state.locationChoice = choice;
    state.choosing = true;
    this.dismissMapPick();
    this.closeSearch();
    const center =
      (choice.mode === "board" ? originPoint(state) : state.destination) ||
      originPoint(state) ||
      state.map?.center;
    const complete = (point?: NamedPoint, error?: unknown): void => {
      // Native callbacks can arrive before or after onShow; never revive another
      // page/account, and retain the result until this page becomes visible.
      if (
        runtimes.get(this) !== state ||
        state.locationChoice !== choice ||
        choice.completed ||
        !isSessionLeaseCurrent(state.lease)
      )
        return;
      choice.completed = true;
      choice.point = point;
      choice.error = error;
      this.finishLocationChoice();
    };
    try {
      wx.chooseLocation({
        ...(center
          ? { latitude: center.latitude, longitude: center.longitude }
          : {}),
        success: (result) => {
          if (
            !Number.isFinite(result.latitude) ||
            Math.abs(result.latitude) > 90 ||
            !Number.isFinite(result.longitude) ||
            Math.abs(result.longitude) > 180
          ) {
            complete(undefined, {
              errMsg: "chooseLocation:fail invalid coordinates",
            });
            return;
          }
          complete({
            latitude: result.latitude,
            longitude: result.longitude,
            name: result.name?.trim() || result.address?.trim() || "地图选点",
          });
        },
        fail: (error) =>
          complete(undefined, /cancel/i.test(error.errMsg) ? undefined : error),
      });
    } catch (error) {
      complete(undefined, error);
    }
  },
  finishLocationChoice() {
    const state = rt(this),
      choice = state.locationChoice;
    if (
      !state.visible ||
      !choice?.completed ||
      !isSessionLeaseCurrent(state.lease)
    )
      return;
    state.locationChoice = undefined;
    state.choosing = false;
    if (choice.point) {
      state.pickMode = choice.mode;
      state.pick = choice.point;
      state.pickId = undefined;
      this.confirmMapPick();
    } else {
      this.openSearch(choice.mode);
      if (choice.error)
        this.feedback(locationFailure(choice.error, "chooseLocation").message);
    }
    if (
      !state.active &&
      (!state.attempted || this.data.authorized || state.manual)
    )
      void this.activate();
  },
  async useMyLocation() {
    if (this.data.searchMode === "board") {
      this.useNearestBoard();
      return;
    }
    const state = rt(this);
    try {
      const point =
        state.location ||
        (await authorizeShuttleLocation(
          () =>
            state.visible &&
            runtimes.get(this) === state &&
            isSessionLeaseCurrent(state.lease),
        ));
      if (
        !state.visible ||
        runtimes.get(this) !== state ||
        !isSessionLeaseCurrent(state.lease)
      )
        return;
      state.pickMode = "destination";
      state.pick = { ...point, name: "我的位置" };
      state.pickId = undefined;
      this.closeSearch();
      this.confirmMapPick();
    } catch (error) {
      this.feedback(locationFailure(error, "getLocation").message);
    }
  },
  chooseSavedPlace(event: Tap) {
    const state = rt(this),
      saved = this.data.commonPlaces.find(
        (p) => p.key === event.currentTarget.dataset.key,
      );
    if (!saved) return;
    state.pickMode = this.data.searchMode === "board" ? "board" : "destination";
    state.pick = saved;
    state.pickId = saved.placeId;
    this.closeSearch();
    this.confirmMapPick();
  },
  useNearestBoard() {
    const state = rt(this);
    state.explicitBoard = "";
    state.boardCandidates = [];
    state.manual = false;
    state.manualPoint = undefined;
    this.resetPlanning();
    this.setData({ originName: "我的位置" });
    state.plan = undefined;
    this.closeSearch();
    this.retryActivation();
  },
  persistCommonPlaces(places: CommonPlace[]) {
    const state = rt(this),
      lease = state.lease;
    if (!state.persistedCommon)
      state.persistedCommon = loadCommonPlaces(lease!.userId);
    // Coalesce rapid toggles, paint first, then persist the latest user intent.
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      if (!isSessionLeaseCurrent(lease)) return;
      try {
        saveCommonPlaces(lease!.userId, places);
        state.persistedCommon = places;
      } catch {
        if (runtimes.get(this) === state) {
          this.setData({ commonPlaces: state.persistedCommon || [] });
          this.setData({
            boardFavorite: Boolean(
              state.board && this.isSavedPlace(state.board),
            ),
          });
          if (this.data.searchMounted) this.filterPlaces();
        }
        this.feedback("地点未能保存，请重试");
      }
    }, 0);
  },
  addCommonPlace(place: CommonPlace): boolean {
    const state = rt(this);
    if (!isSessionLeaseCurrent(state.lease)) return false;
    if (state.map) place = canonicalCommonPlace(state.map, place);
    if (this.data.commonPlaces.some((p) => p.key === place.key)) return true;
    if (this.data.commonPlaces.length >= 8) {
      this.feedback("常用地点已满，长按地点可移除");
      return false;
    }
    const next = [place, ...this.data.commonPlaces];
    try {
      this.setData({ commonPlaces: next, commonEnteringKey: place.key });
      this.persistCommonPlaces(next);
      if (state.chipTimer) clearTimeout(state.chipTimer);
      state.chipTimer = setTimeout(() => {
        if (runtimes.get(this) === state)
          this.setData({ commonEnteringKey: "" });
      }, 400);
      return true;
    } catch {
      this.feedback("地点未能保存，请重试");
      return false;
    }
  },
  selectCommonPlace(event: Tap) {
    const state = rt(this),
      place = this.data.commonPlaces.find(
        (p) => p.key === event.currentTarget.dataset.key,
      );
    if (!place || !state.map || !isSessionLeaseCurrent(state.lease)) return;
    const current = state.map.places.find((p) => p.id === place.placeId);
    this.openTripSheet();
    state.destinationStops = [];
    state.destination = current || place;
    state.selection.destinationId = current?.id;
    state.selection.destinationPoint = current ? undefined : place;
    if (current) this.selectPlaceGroup(current.id, false);
    else this.resetPlanning();
    state.plan = undefined;
    state.alerted.clear();
    this.setData({
      destinationName: current ? placeShortName(current) : place.shortName,
      commonPlaceKey: place.key,
      journey: "idle",
      reminderEnabled: false,
    });
    this.rebuildPlans(true);
    this.layout(false);
    this.fitPlans();
    haptic();
  },
  removeCommonPlace(event: Tap) {
    const state = rt(this),
      key = event.currentTarget.dataset.key;
    wx.showActionSheet({
      itemList: ["移除常用地点"],
      success: () => {
        if (!isSessionLeaseCurrent(state.lease) || runtimes.get(this) !== state)
          return;
        const next = this.data.commonPlaces.filter((p) => p.key !== key);
        try {
          this.setData({ commonPlaces: next });
          this.persistCommonPlaces(next);
        } catch {
          this.feedback("地点未能移除，请重试");
        }
      },
    });
  },
  fitPlans() {
    const state = rt(this);
    if (!state.destination || state.pendingChoice || state.planningWait) return;
    this.setData({ following: false });
    state.context?.includePoints({
      points: [
        state.destination,
        ...(state.plan?.points || []),
        ...(originPoint(state) ? [originPoint(state)!] : []),
      ],
      padding: [
        Math.max(20, this.data.headerHeight - this.data.mapTop + 30),
        35,
        this.data.sheetOpen ? this.data.sheetHeight + 24 : 30,
        35,
      ],
    });
  },
  isSavedPlace(place: ShuttlePlace): boolean {
    const state = rt(this);
    if (!state.map) return false;
    const saved = canonicalCommonPlace(state.map, commonPlace(place, place.id));
    return (
      this.data.commonPlaces.some((p) => p.key === saved.key) ||
      state.favorites.includes(place.id)
    );
  },
  toggleFavorite() {
    const state = rt(this);
    if (!state.board || !state.map || !isSessionLeaseCurrent(state.lease))
      return;
    const place = canonicalCommonPlace(
        state.map,
        commonPlace(state.board, state.board.id),
      ),
      saved = !this.isSavedPlace(state.board);
    try {
      if (saved) {
        if (!this.addCommonPlace(place)) return;
      } else {
        const next = this.data.commonPlaces.filter((p) => p.key !== place.key);
        this.setData({ commonPlaces: next });
        this.persistCommonPlaces(next);
      }
      const group = placeGroups(state.map).find((g) =>
        g.members.some((p) => p.id === state.board!.id),
      );
      state.favorites = state.favorites.filter(
        (id) => !group?.members.some((p) => p.id === id),
      );
      setTimeout(() => {
        if (isSessionLeaseCurrent(state.lease))
          wx.setStorage({
            key: FAVORITE_PREFIX + state.lease!.userId,
            data: state.favorites,
          });
      }, 0);
      this.setData({ boardFavorite: saved });
      this.filterPlaces();
      haptic();
    } catch {
      this.feedback("收藏未能保存，请重试");
    }
  },
  togglePlanFavorite(event: Tap) {
    const state = rt(this),
      plan = state.plans.find((p) => p.id === event.currentTarget.dataset.id),
      origin = originPoint(state);
    if (
      !plan ||
      !origin ||
      !state.destination ||
      !isSessionLeaseCurrent(state.lease)
    )
      return;
    try {
      togglePreferredPlan(state.lease!.userId, plan, origin, state.destination);
      this.rebuildPlans(false);
      haptic();
    } catch {
      this.feedback("收藏未能保存，请重试");
    }
  },
  clearDestination() {
    const state = rt(this);
    state.destination = undefined;
    state.drawnPlan = undefined;
    state.drawnDestination = undefined;
    state.pendingChoice = false;
    state.destinationStops = [];
    state.plan = undefined;
    state.alerted.clear();
    delete state.selection.destinationId;
    delete state.selection.destinationPoint;
    state.selection.routeId = this.data.routeId;
    this.setData({
      destinationName: "",
      commonPlaceKey: "",
      journey: "idle",
      reminderEnabled: false,
    });
    this.rebuildPlans(true);
    this.layout(false);
  },
  startJourney() {
    const state = rt(this);
    if (
      !this.data.authorized ||
      !this.data.hasOrigin ||
      state.manual ||
      !state.active ||
      !state.location ||
      state.pendingChoice ||
      state.planningWait ||
      !state.plan ||
      !state.drawnDestination ||
      !state.planner
    )
      return;
    this.clearVehiclePreview();
    state.alerted.clear();
    state.onboardDetector = new ShuttleOnboardDetector();
    state.journeyProgress = new ShuttleJourneyProgress(
      state.plan,
      state.location,
      state.drawnDestination,
      state.planner,
    );
    this.setData({ journey: "waiting", reminderEnabled: true });
    state.stream?.select(this.liveSelection());
    this.updateJourneyProgress();
    this.layout(false);
    haptic();
  },
  updateJourneyProgress() {
    const state = rt(this);
    if (
      !state.visible ||
      !state.active ||
      !this.data.authorized ||
      state.manual ||
      !state.location ||
      !state.journeyProgress ||
      this.data.journey === "idle"
    )
      return;
    const packet = state.packet;
    const fresh =
      packet &&
      !packet.stale &&
      this.data.connection === "live" &&
      Date.now() -
        state.packetReceivedAt +
        Math.max(0, packet.serverTime - packet.fetchedAt) <
        12000;
    if (
      fresh &&
      packet.available &&
      packet.selectionValid &&
      packet.mapRevision === state.map?.revision &&
      this.data.journey !== "arrived"
    ) {
      const bus = state.onboardDetector?.update(
        state.location,
        Date.now(),
        packet.fetchedAt,
        packet.vehicles,
        state.packetReceivedAt -
          Math.max(0, packet.serverTime - packet.fetchedAt),
      );
      if (
        bus &&
        (bus.lineId !== state.journeyView?.routes[0] ||
          !state.journeyProgress.confirmOnboard(bus))
      )
        this.rerouteOnboard(bus);
    } else state.onboardDetector?.pause();
    state.journeyProgress.update(
      state.location,
      Date.now(),
      fresh ? packet.vehicles : [],
    );
    this.renderJourneyProgress();
  },
  rerouteOnboard(bus: ShuttleVehicle) {
    const state = rt(this);
    if (
      !state.journeyProgress ||
      !state.itinerary ||
      !state.planner ||
      !state.location ||
      !state.drawnDestination ||
      !state.visible ||
      !state.active ||
      !this.data.authorized ||
      state.manual ||
      !isSessionLeaseCurrent(state.lease) ||
      this.data.journey === "idle"
    )
      return;
    const destination = state.drawnDestination;
    this.clearVehiclePreview();
    const plan = state.itinerary.onboard(
      bus,
      destination,
      state.destinationStops,
    );
    if (!plan) return; // Keep the last usable trip if direction/topology is uncertain.
    state.onboardDetector?.switched(Date.now());
    state.plan = plan;
    state.plans = [plan];
    state.drawnPlan = plan;
    state.board = plan.board;
    state.selection.routeId = plan.route.id;
    state.selection.boardingId = plan.board.id;
    state.alerted.clear();
    state.journeyProgress = new ShuttleJourneyProgress(
      plan,
      state.location,
      destination,
      state.planner,
    );
    this.setData({
      journey: "riding",
      walking: false,
      reminderEnabled: true,
      routeId: plan.route.id,
      selectedPlanId: plan.id,
      boardName: stopName(plan.board),
      boardFavorite: this.isSavedPlace(plan.board),
      boardDetail: "",
      selectedVehicleId: "",
      crossingLabel: "",
      edgeHints: [],
      clusters: [],
      plans: [
        {
          id: plan.id,
          mode: plan.mode,
          favorite: false,
          color:
            routePalette(state.map!.routes).get(plan.route.id) ||
            plan.route.color,
          routeName: plan.legs.map((l) => l.route.name).join(" → "),
          stopCount: plan.stopCount,
          boardName: stopName(plan.board),
          alightName: stopName(plan.alight),
          walkLabel: this.walkLabel(plan),
          timeLabel: this.planTimeLabel(plan),
        },
      ],
    });
    state.crossing = [];
    this.renderJourneyProgress();
    // Silent replacement: no toast, vibration, camera jump, or reveal/loading UI.
    this.paintRoutes(true);
    const packet = state.packet;
    if (packet)
      state.motion?.update(
        this.displayVehicles(packet.vehicles),
        packet.fetchedAt,
        packet.stale,
        packet.serverTime,
      );
  },
  renderJourneyProgress() {
    const state = rt(this);
    if (!state.journeyProgress || this.data.journey === "idle") return;
    const viewport = Math.max(
      200,
      this.data.windowWidth - (this.data.windowWidth <= 340 ? 68 : 80),
    );
    const view = state.journeyProgress.view(viewport);
    if (view.phase === "arrived" && this.data.journey !== "arrived")
      haptic("medium");
    state.journeyView = view;
    this.setData({
      journeyProgress: view,
      journey: view.phase,
      reminderEnabled: view.phase !== "arrived",
      journeyScroll: Math.max(
        0,
        Math.min(view.width - viewport, view.position - viewport / 2),
      ),
    });
  },
  cancelJourney() {
    const state = rt(this);
    state.alerted.clear();
    state.journeyProgress = undefined;
    state.journeyView = undefined;
    state.onboardDetector = undefined;
    this.setData({
      journey: "idle",
      reminderEnabled: false,
      journeyProgress: null,
    });
    if (state.plan?.onboard) this.rebuildPlans(true);
    else state.stream?.select(this.liveSelection());
    haptic();
  },
  resetPlanning() {
    const state = rt(this);
    // Invalidate both queued network results and animation frames before using
    // a confirmed origin/destination. Keep the requested endpoints, not the old itinerary.
    state.planningVersion = (state.planningVersion || 0) + 1;
    if (state.planningTimer) clearTimeout(state.planningTimer);
    if (state.planningRetryTimer) clearTimeout(state.planningRetryTimer);
    state.planningRetryTimer = undefined;
    state.planningTimer = undefined;
    state.planningKey =
      state.planningContext =
      state.planningFlight =
        undefined;
    state.planningWait = state.planningId = undefined;
    state.planningOrigin = undefined;
    state.planningAt = 0;
    state.remotePlans = undefined;
    state.chosenPlanKey = undefined;
    state.routeEpoch++;
    this.cancelRouteAnimation();
    state.plan = undefined;
    state.plans = [];
    state.board = undefined;
    state.boardWalk = undefined;
    state.boardWalkKey = undefined;
    state.boardWalkRetryAt = undefined;
    state.drawnPlan = undefined;
    state.drawnDestination = undefined;
    state.drawnOrigin = undefined;
    state.routeFinal = undefined;
    state.routeJourneyKey = undefined;
    state.routePaintKey = undefined;
    state.vehiclePreview = undefined;
    state.vehiclePreviewAt = 0;
    state.pendingChoice = false;
    state.journeyProgress = undefined;
    state.journeyView = undefined;
    state.onboardDetector = undefined;
    state.alerted.clear();
    delete state.selection.boardingId;
    this.setData({
      polylines: [],
      plans: [],
      selectedPlanId: "",
      selectedVehicleId: "",
      boardName: "",
      boardDetail: "",
      boardFavorite: false,
      walking: false,
      planning: false,
      journey: "idle",
      journeyProgress: null,
      reminderEnabled: false,
    });
    this.staticMarkers();
  },
  refreshShuttles() {
    const state = rt(this);
    if (!state.active) {
      this.retryActivation();
      return;
    }
    if (this.data.journey === "idle") {
      if (state.planningId) forgetShuttlePlan(state.planningId);
      this.resetPlanning();
      this.rebuildPlans(true);
    }
    void this.reloadMap(false);
    state.stream?.stop();
    state.stream?.start(this.liveSelection());
  },
  selectVehicle(event: Tap) {
    const id = String(event.currentTarget.dataset.id || "");
    this.toggleVehiclePreview(id);
    haptic();
  },
  clearVehiclePreview() {
    const state = rt(this);
    if (!state.vehiclePreview && !this.data.selectedVehicleId) return;
    state.vehiclePreview = undefined;
    this.setData({ selectedVehicleId: "" });
    this.paintRoutes(true);
  },
  toggleVehiclePreview(id: string) {
    const state = rt(this);
    // Vehicle inspection must not replace an itinerary the user is comparing.
    if (
      state.destination ||
      state.drawnDestination ||
      this.data.journey !== "idle"
    ) {
      this.focusBus(id);
      return;
    }
    if (this.data.selectedVehicleId === id) {
      this.clearVehiclePreview();
      return;
    }
    if (state.pendingChoice || !state.visible) return;
    const value = state.motion?.previewVehicle(id);
    if (!value || state.packet?.stale) return;
    state.vehiclePreview = undefined;
    state.vehiclePreviewAt = 0;
    state.vehiclePreviewFlight = undefined;
    this.setData({ selectedVehicleId: id });
    this.focusBus(id);
    this.refreshVehiclePreview();
  },
  refreshVehiclePreview() {
    const state = rt(this),
      id = this.data.selectedVehicleId;
    if (!id || !state.visible || state.pendingChoice || state.packet?.stale)
      return;
    if (state.map?.planningMode === "adaptive") {
      if (
        state.vehiclePreviewFlight ||
        Date.now() - (state.vehiclePreviewAt || 0) < 6000
      )
        return;
      state.vehiclePreviewFlight = id;
      state.vehiclePreviewAt = Date.now();
      void getShuttleVehiclePreview(id)
        .then((result) => {
          if (
            runtimes.get(this) !== state ||
            !state.visible ||
            this.data.selectedVehicleId !== id ||
            state.destination ||
            this.data.journey !== "idle" ||
            result.revision !== state.map?.revision
          )
            return;
          state.vehiclePreview =
            result.points.length > 1 && result.lineId
              ? { id, lineId: result.lineId, points: result.points }
              : undefined;
          this.paintRoutes();
        })
        .catch(() => undefined)
        .finally(() => {
          if (state.vehiclePreviewFlight === id)
            state.vehiclePreviewFlight = undefined;
        });
      return;
    }
    const vehicle = state.motion?.previewVehicle(id);
    const points = vehicle ? state.planner?.vehiclePath(vehicle) || [] : [];
    if (vehicle && points.length > 1)
      state.vehiclePreview = { id, lineId: vehicle.lineId, points };
    else if (state.vehiclePreview?.id !== id) state.vehiclePreview = undefined;
    this.paintRoutes();
  },
  focusVehicle(event: Tap) {
    this.toggleVehiclePreview(String(event.currentTarget.dataset.id || ""));
  },
  focusBus(id: string) {
    const state = rt(this),
      value = state.motion?.positions().find((v) => v.bus.id === id);
    if (!value) return;
    this.setData({
      following: false,
      latitude: value.point.latitude,
      longitude: value.point.longitude,
      scale: 17,
    });
  },
  onMarkerTap(event: WechatMiniprogram.CustomEvent<{ markerId: number }>) {
    const state = rt(this),
      id = Number(event.detail.markerId),
      busId = state.motion?.busForMarker(id);
    if (busId) {
      this.toggleVehiclePreview(busId);
      return;
    }
    const place =
      state.markerPlaces.get(id) || (id === 3 ? state.board : undefined);
    const point =
      place ||
      (id === 2
        ? state.drawnDestination
        : id === 1
          ? originPoint(state)
          : undefined);
    if (point)
      this.showMapPick(
        { ...point, name: place ? stopName(place) : "地图选点" },
        place?.id,
      );
  },
  onMapTap(
    event: WechatMiniprogram.CustomEvent<{
      longitude: number;
      latitude: number;
      name?: string;
    }>,
  ) {
    const state = rt(this),
      point = event.detail;
    if (
      !Number.isFinite(point.longitude) ||
      !Number.isFinite(point.latitude) ||
      this.data.searchMounted
    )
      return;
    let nearby: ShuttlePlace | undefined;
    if (state.bounds && state.map) {
      const screen = projectToScreen(
        point,
        state.bounds,
        this.data.windowWidth,
        this.data.mapHeight,
      );
      let gap = 24;
      for (const place of state.map.places.filter(
        (p) => p.category === "stop",
      )) {
        const p = projectToScreen(
          place,
          state.bounds,
          this.data.windowWidth,
          this.data.mapHeight,
        );
        const d = Math.hypot(p.x - screen.x, p.y - screen.y);
        if (d < gap) {
          gap = d;
          nearby = place;
        }
      }
    }
    this.showMapPick(
      { ...point, name: nearby ? stopName(nearby) : point.name || "地图选点" },
      nearby?.id,
    );
  },
  showMapPick(point: NamedPoint, id?: string) {
    const state = rt(this);
    if (state.pickTimer) clearTimeout(state.pickTimer);
    const show = (): void => {
      if (!state.visible || runtimes.get(this) !== state) return;
      state.pick = point;
      state.pickId = id;
      this.setData({ pickOrigin: state.pickMode === "board" });
      this.positionMapPick();
      setPresence(this, true, {
        mounted: "pickMounted",
        active: "pickOpen",
        reducedMotion: this.data.motionClass === "motion-reduced",
      });
      this.refreshBounds();
    };
    if (this.data.pickMounted) {
      this.setData({ pickOpen: false });
      state.pickTimer = setTimeout(() => {
        this.setData({ pickMounted: false });
        show();
      }, 140);
    } else show();
    haptic();
  },
  positionMapPick() {
    const state = rt(this);
    if (!state.pick || !state.bounds) return;
    const p = projectToScreen(
      state.pick,
      state.bounds,
      this.data.windowWidth,
      this.data.mapHeight,
    );
    this.setData({ pickX: p.x, pickY: p.y + this.data.mapTop });
  },
  dismissMapPick() {
    const state = rt(this);
    if (state.pickTimer) clearTimeout(state.pickTimer);
    state.pick = undefined;
    state.pickId = undefined;
    setPresence(this, false, {
      mounted: "pickMounted",
      active: "pickOpen",
      exitMs: 140,
      reducedMotion: this.data.motionClass === "motion-reduced",
    });
  },
  confirmMapPick() {
    const state = rt(this),
      point = state.pick,
      id = state.pickId,
      boarding = state.pickMode === "board";
    if (!point || !isSessionLeaseCurrent(state.lease)) return;
    this.dismissMapPick();
    state.pickMode = undefined;
    if (id) this.selectPlaceGroup(id, boarding);
    else if (boarding) {
      state.manual = true;
      state.manualPoint = point;
      state.explicitBoard = "";
      state.boardCandidates = [];
      this.resetPlanning();
      this.setData({ originName: point.shortName || point.name });
    } else {
      state.destination = point;
      state.destinationStops = [];
      state.selection.destinationPoint = point;
      delete state.selection.destinationId;
      this.resetPlanning();
      this.setData({
        destinationName: point.shortName || point.name,
        commonPlaceKey: "",
      });
    }
    state.pendingChoice = false;
    state.plan = undefined;
    this.setData({ journey: "idle", reminderEnabled: false });
    this.openTripSheet();
    this.rebuildPlans(true);
    if (state.manual) this.startManualOrigin();
    this.layout(false);
    this.fitPlans();
  },
  openCrossing(event: Tap) {
    const state = rt(this);
    state.crossing = Array.isArray(event.currentTarget.dataset.ids)
      ? (event.currentTarget.dataset.ids as string[])
      : [];
    this.setData({ crossingLabel: `此处 ${state.crossing.length} 辆车` });
    this.refreshRows();
    this.layout(true);
  },
  clearCrossing() {
    rt(this).crossing = [];
    this.setData({ crossingLabel: "" });
    this.refreshRows();
  },
  locateUser() {
    this.dismissMapPick();
    const state = rt(this);
    if (state.manual) {
      state.manual = false;
      state.manualPoint = undefined;
      this.setData({ originName: "我的位置" });
      state.explicitBoard = "";
      state.boardCandidates = [];
    }
    if (!this.data.authorized || !state.location) {
      this.retryActivation();
      return;
    }
    this.setData({
      following: false,
      farFromCampus: false,
    });
    state.context?.moveToLocation({
      latitude: state.location.latitude,
      longitude: state.location.longitude,
    });
    haptic();
  },
  showOverview() {
    this.dismissMapPick();
    const state = rt(this);
    if (!state.map) return;
    this.setData({ following: false });
    state.context?.includePoints({
      points: [state.map.bounds.southwest, state.map.bounds.northeast],
      padding: [
        Math.max(30, this.data.headerHeight - this.data.mapTop + 45),
        30,
        this.data.hasOrigin ? 30 : this.data.safeBottom + 190,
        30,
      ],
    });
    haptic();
  },
  onRegionChange(
    event: WechatMiniprogram.CustomEvent<{ causedBy?: string; type?: string }>,
  ) {
    const state = rt(this),
      kind =
        event.type === "begin" || event.type === "end"
          ? event.type
          : event.detail.type;
    if (kind === "begin") {
      if (event.detail.causedBy === "gesture") {
        this.dismissMapPick();
      }
      state.moving = true;
      this.setData({ edgeHints: [], clusters: [] });
    }
    if (event.detail.causedBy === "gesture") this.setData({ following: false });
    if (kind === "end") {
      state.moving = false;
      this.paintUser();
      this.refreshBounds();
    }
  },
  onMapUpdated() {
    this.refreshBounds();
  },
  refreshBounds() {
    const state = rt(this);
    if (!state.context || state.boundsFlight || !state.visible) return;
    state.boundsFlight = true;
    const generation = state.generation;
    state.context.getRegion({
      success: (bounds) => {
        if (generation === state.generation) {
          state.bounds = bounds;
          this.positionMapPick();
          this.updateOverlays();
        }
      },
      complete: () => {
        state.boundsFlight = false;
      },
    });
  },
  updateOverlays() {
    // Native markers stay attached to the map during gestures. No floating counts.
    if (this.data.edgeHints.length || this.data.clusters.length)
      this.setData({ edgeHints: [], clusters: [] });
  },
  measureHeader() {
    this.createSelectorQuery()
      .select("#shuttle-navigation")
      .boundingClientRect((result) => {
        const rect =
          result as WechatMiniprogram.BoundingClientRectCallbackResult;
        if (rect?.height && rect.height !== this.data.mapTop) {
          this.setData({ mapTop: rect.height });
          this.layout(this.data.sheetExpanded);
        }
      })
      .exec();
    this.createSelectorQuery()
      .select("#map-header")
      .boundingClientRect((result) => {
        const rect =
          result as WechatMiniprogram.BoundingClientRectCallbackResult;
        if (rect?.height) {
          this.setData({ headerHeight: rect.height });
          this.updateCommonHeight();
          this.refreshBounds();
        }
      })
      .exec();
  },
  targetSheetHeight(expanded: boolean) {
    const height = this.data.windowHeight;
    const base = Math.min(310, Math.max(240, height * 0.36));
    const emptyNearby =
      !this.data.vehicles.length &&
      !this.data.destinationName &&
      this.data.journey === "idle";
    const collapsed = emptyNearby
      ? Math.max(160 + this.data.safeBottom, base - 48)
      : this.data.journey !== "idle"
        ? 256 + this.data.safeBottom
        : base;
    const maxSheet = Math.max(160, height - this.data.headerHeight - 105);
    return Math.round(Math.min(maxSheet, expanded ? height * 0.62 : collapsed));
  },
  layout(expanded: boolean) {
    const state = rt(this),
      height = this.data.windowHeight;
    const sheetHeight = this.targetSheetHeight(expanded);
    this.renderJourneyProgress();
    this.setData({
      sheetExpanded: expanded,
      sheetHeight,
      searchListHeight: this.searchHeight(this.data.searchMode),
      mapHeight: Math.max(150, height - this.data.mapTop),
    });
    state.bounds = undefined;
    this.setData({ edgeHints: [], clusters: [] });
    if (state.layoutTimer) clearTimeout(state.layoutTimer);
    state.layoutTimer = setTimeout(() => {
      this.refreshBounds();
    }, 380);
  },
  closeTripSheet() {
    setPresence(this, false, {
      mounted: "sheetMounted",
      active: "sheetOpen",
      reducedMotion: this.data.motionClass === "motion-reduced",
    });
    this.updateOverlays();
  },
  openTripSheet() {
    this.layout(this.data.sheetExpanded);
    setPresence(this, true, {
      mounted: "sheetMounted",
      active: "sheetOpen",
      reducedMotion: this.data.motionClass === "motion-reduced",
    });
    this.updateOverlays();
  },
  toggleSheet() {
    if (Date.now() < rt(this).ignoreTapUntil) return;
    haptic();
    this.springSheet(!this.data.sheetExpanded);
  },
  onSheetTouchStart(event: Tap) {
    const state = rt(this);
    if (state.sheetSpring) clearTimeout(state.sheetSpring);
    state.touchY = event.touches[0]?.clientY || 0;
    state.touchAt = Date.now();
    state.touchHeight = this.data.sheetHeight;
  },
  onSheetTouchMove(event: Tap) {
    const state = rt(this),
      dy = (event.touches[0]?.clientY ?? state.touchY) - state.touchY;
    if (Math.abs(dy) < 3) return;
    const raw = state.touchHeight - dy,
      max = Math.max(180, this.data.windowHeight - this.data.headerHeight - 30);
    this.setData({
      sheetDragging: true,
      sheetHeight:
        raw < 170
          ? 170 + (raw - 170) * 0.22
          : raw > max
            ? max + (raw - max) * 0.22
            : raw,
    });
  },
  onSheetTouchEnd(event: Tap) {
    const state = rt(this),
      y = event.changedTouches[0]?.clientY ?? state.touchY,
      dy = y - state.touchY;
    if (Math.abs(dy) > 24) {
      state.ignoreTapUntil = Date.now() + 250;
      this.springSheet(dy < 0);
      haptic();
    } else this.springSheet(this.data.sheetExpanded);
  },
  springSheet(expanded: boolean) {
    const state = rt(this);
    if (state.sheetSpring) clearTimeout(state.sheetSpring);
    const target = this.targetSheetHeight(expanded);
    if (this.data.motionClass === "motion-reduced") {
      this.setData({ sheetDragging: false });
      this.layout(expanded);
      return;
    }
    let value = this.data.sheetHeight,
      velocity = 0,
      frames = 0;
    this.setData({ sheetExpanded: expanded, sheetDragging: true });
    const tick = (): void => {
      if (!state.visible || runtimes.get(this) !== state) return;
      velocity += (target - value) * 0.13;
      velocity *= 0.72;
      value += velocity;
      frames++;
      if (
        (Math.abs(value - target) < 0.4 && Math.abs(velocity) < 0.4) ||
        frames > 65
      ) {
        this.setData({ sheetHeight: target, sheetDragging: false });
        this.refreshBounds();
        return;
      }
      this.setData({ sheetHeight: value });
      state.sheetSpring = setTimeout(tick, 16);
    };
    tick();
  },
  goBack() {
    this.deactivate();
    if (getCurrentPages().length > 1)
      wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({ url: "/pages/home/index" }),
      });
    else wx.switchTab({ url: "/pages/home/index" });
  },
  noop() {},
});
