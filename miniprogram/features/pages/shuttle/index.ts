import { getShuttleMap } from "../../../services/shuttle";
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
import {
  distanceLabel,
  distanceMeters,
  roadPolylines,
} from "../../../utils/shuttle-geo";
import {
  edgeIntersection,
  projectToScreen,
  type ScreenPoint,
} from "../../utils/shuttle-screen";
import { ShuttlePlanner } from "../../utils/shuttle-routing";
import {
  ShuttleItineraryPlanner,
  type ShuttleJourney,
} from "../../utils/shuttle-itinerary";
import { ShuttleMapMotion } from "../../utils/shuttle-map-motion";
import {
  orderedTraces,
  tracePolylines,
  type TraceContext,
  routePalette,
  ShuttleRouteReveal,
} from "../../utils/shuttle-route-reveal";
import {
  commonPlace,
  loadCommonPlaces,
  saveCommonPlaces,
  type CommonPlace,
} from "../../utils/shuttle-common-places";
import { placeShortName } from "../../utils/shuttle-place-names";
import {
  findPlaceGroups,
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
  ShuttleSelection,
  ShuttleSnapshot,
  ShuttleVehicle,
} from "../../../types/shuttle";

type Tap = WechatMiniprogram.TouchEvent;
type Journey = "idle" | "waiting" | "riding" | "arrived";
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
  id: string;
  color: string;
  routeName: string;
  stopCount: number;
  boardName: string;
  alightName: string;
  walkLabel: string;
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
  visible: boolean;
  ready: boolean;
  active: boolean;
  attempted: boolean;
  manual: boolean;
  boardCandidates: string[];
  destinationStops: string[];
  manualPoint?: NamedPoint;
  drawnPlan?: ShuttleJourney;
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
    sheetOpen: true,
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
    if (!rt(this).attempted || this.data.authorized || rt(this).manual)
      void this.activate();
  },
  onHide() {
    this.closeCommonSearch(true);
    if (this.data.searchMounted) this.closeSearch();
    this.deactivate();
  },
  onUnload() {
    this.closeCommonSearch(true);
    this.deactivate();
    const state = rt(this);
    if (state.searchTimer) clearTimeout(state.searchTimer);
    if (state.layoutTimer) clearTimeout(state.layoutTimer);
    state.motion?.clear();
    runtimes.delete(this);
  },
  onResize(event: { size: { windowWidth: number; windowHeight: number } }) {
    // Keyboard resize events must not replace the full viewport saved before editing.
    if (
      (this.data.searchMounted || this.data.commonMounted) &&
      event.size.windowWidth === this.data.windowWidth
    )
      return;
    this.setData({
      windowWidth: event.size.windowWidth,
      windowHeight: this.data.keyboardHeight
        ? this.data.windowHeight
        : event.size.windowHeight,
    });
    this.layout(this.data.sheetExpanded);
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
    if (isDemoSession(getSession())) {
      this.setData({ gateMessage: "请使用校园账号查看实时校车" });
      return;
    }
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
      state.itinerary = new ShuttleItineraryPlanner(map, state.planner);
      this.refreshCommonPlaces();
      this.setData({
        routes: map.routes,
        polylines: roadPolylines(
          map,
          this.data.routeId ? [this.data.routeId] : undefined,
        ),
      });
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
      state.location = sample.raw;
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
        following: !far,
        gateMessage: "",
        connection: "connecting",
        stale: true,
      });
      this.rebuildPlans(false);
      this.staticMarkers();
      this.paintUser();
      // One owned foreground listener; no background-location API or hidden tracking.
      state.listener = (value) => {
        // A callback already delivered by the native bridge still belongs to this account
        // after onHide. Persist it, but never revive a hidden page or another account.
        if (!isSessionLeaseCurrent(lease)) return;
        recorder.record({ ...value }, "change");
        if (!current()) return;
        state.location = { ...value };
        this.paintUser();
        this.refreshRows();
        if (!state.destination && !state.explicitBoard)
          this.rebuildPlans(false);
        if (this.data.following)
          this.setData({
            latitude: value.latitude,
            longitude: value.longitude,
          });
      };
      wx.onLocationChange(state.listener);
      state.locationError = () => {
        if (current()) {
          this.feedback("定位已中断，请检查定位服务后重试");
          this.deactivate();
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
        // Denial leaves a useful map and an explicit retry/settings action.
      }
    } finally {
      // Cached maps render immediately; refresh metadata even if positioning was denied.
      if (state.map && state.visible && isSessionLeaseCurrent(lease))
        void this.reloadMap(false);
    }
  },
  startLiveStream() {
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
    if (!stop || isDemoSession(getSession())) return;
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
  deactivate() {
    const state = rt(this);
    state.visible = false;
    state.active = false;
    this.cancelRouteAnimation();
    state.routePaintKey = undefined;
    state.routeEpoch++;
    state.generation += 1;
    this.setData({ locating: false });
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
    state.motion?.update(packet.vehicles, packet.fetchedAt, packet.stale);
    this.setData({ vehicles: packet.vehicles });
    this.refreshRows();
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
      this.rebuildPlans(true);
      this.staticMarkers();
      if (changed) this.feedback("线路已更新，请重新确认出行方案");
    } catch {
      /* Last-good map remains usable; never replace it with malformed data. */
    }
  },
  rebuildPlans(notify = true) {
    const state = rt(this);
    if (!state.map || !state.itinerary) return;
    const origin = originPoint(state);
    if (!origin) {
      state.plan = undefined;
      state.plans = [];
      state.board = undefined;
      this.setData({
        plans: [],
        selectedPlanId: "",
        boardName: "",
        boardDetail: "选择候车点后查看路线",
      });
      this.paintRoutes();
      this.staticMarkers();
      return;
    }
    const oldId = state.plan?.id;
    const colors = routePalette(state.map.routes);
    const oldBoardId = state.board?.id;
    state.plans = state.destination
      ? state.itinerary.plans(
          origin,
          state.destination,
          state.boardCandidates,
          state.destinationStops,
        )
      : [];
    state.plan =
      state.plans.find((plan) => plan.id === oldId) || state.plans[0];
    state.board =
      state.plan?.board ||
      (state.explicitBoard
        ? state.map.places.find((p) => p.id === state.explicitBoard)
        : nearestStop(state.map, origin, this.data.routeId));

    state.selection.routeId = state.plan?.route.id || this.data.routeId;
    state.selection.boardingId = state.destination
      ? state.plan?.board.id || state.explicitBoard
      : state.explicitBoard;
    // Destination with no suitable plan still stays destination-filtered server-side.
    this.setData({
      plans: state.plans.map((plan) => ({
        id: plan.id,
        color: colors.get(plan.route.id) || plan.route.color,
        routeName: plan.legs
          .map((leg) => leg.routes.map((r) => r.name).join(" / "))
          .join(" → "),
        stopCount: plan.stopCount,
        boardName: stopName(plan.board),
        alightName: stopName(plan.alight),
        walkLabel: this.walkLabel(plan),
      })),
      selectedPlanId: state.pendingChoice ? "" : state.plan?.id || "",
      boardName: state.board ? stopName(state.board) : "",
      boardFavorite: Boolean(
        state.board && state.favorites.includes(state.board.id),
      ),
      boardDetail: state.board
        ? state.location
          ? `${state.explicitBoard ? "已锁定" : "建议候车点"} · 距你 ${distanceLabel(distanceMeters(state.location, state.board))}（直线）`
          : "已选候车点"
        : "暂无匹配站点",
    });
    if (!state.pendingChoice) {
      state.drawnPlan = state.plan;
      state.drawnDestination =
        state.destinationStops.length && state.plan
          ? state.plan.alight
          : state.destination;
    }
    if (notify || state.destination || !this.data.polylines.length)
      this.paintRoutes();
    if (!notify && oldBoardId !== state.board?.id) this.staticMarkers();
    this.refreshRows();
    if (notify) this.applySelection();
  },
  liveSelection(): ShuttleSelection {
    const state = rt(this),
      plan = state.drawnPlan;
    return plan
      ? {
          routeIds: [
            ...new Set(plan.legs.flatMap((leg) => leg.routes.map((r) => r.id))),
          ],
        }
      : { ...state.selection };
  },
  applySelection() {
    const state = rt(this);
    if (state.pendingChoice) return;
    state.motion?.clear();
    state.packet = undefined;
    state.crossing = [];
    this.setData({
      vehicles: [],
      vehicleRows: [],
      edgeHints: [],
      clusters: [],
      crossingLabel: "",
      selectedVehicleId: "",
      stale: true,
    });
    state.stream?.select(this.liveSelection());
    this.staticMarkers();
  },
  walkLabel(plan: ShuttleJourney): string {
    const transfer = plan.legs
      .slice(1)
      .reduce(
        (n, leg, i) => n + distanceMeters(plan.legs[i].alight, leg.board),
        0,
      );
    const walk =
      plan.walkTo +
      (rt(this).destinationStops.length ? 0 : plan.walkFrom) +
      transfer;
    const names = plan.legs.slice(0, -1).map((leg) => stopName(leg.alight));
    return (
      (names.length ? names.join("、") + "换乘 · " : "直达 · ") +
      "步行约 " +
      distanceLabel(walk)
    );
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
    if (state.routeTimer) clearTimeout(state.routeTimer);
    if (state.routeHandoff) clearTimeout(state.routeHandoff);
    state.routeTimer = undefined;
    state.routeHandoff = undefined;
    state.routeReveal?.stop();
    state.routeFinal = undefined;
    state.routeContext?.clearRect(
      0,
      0,
      this.data.windowWidth,
      this.data.windowHeight,
    );
    this.setData({ routeAnimating: false });
  },
  finishRouteAnimation() {
    const state = rt(this);
    if (!state.routeFinal) return;
    state.routeReveal?.stop();
    this.setData({ polylines: state.routeFinal });
    if (state.routeHandoff) clearTimeout(state.routeHandoff);
    // Keep the complete canvas trace visible until the native overlay has landed.
    state.routeHandoff = setTimeout(() => this.cancelRouteAnimation(), 160);
  },
  paintRoutes() {
    const state = rt(this);
    if (!state.map) return;
    if (state.pendingChoice) return;
    const plan = state.drawnPlan,
      destination = state.drawnDestination;
    const key = JSON.stringify([
      state.map.revision,
      destination,
      plan?.id,
      this.data.motionClass,
    ]);
    if (key === state.routePaintKey) return;
    const epoch = ++state.routeEpoch;
    state.routePaintKey = key;
    this.cancelRouteAnimation();
    const base = destination ? [] : roadPolylines(state.map);
    this.setData({ polylines: base });
    const current = (): boolean =>
      runtimes.get(this) === state &&
      state.visible &&
      state.routePaintKey === key &&
      state.routeEpoch === epoch &&
      isSessionLeaseCurrent(state.lease);
    const reveal = (): void => {
      if (!current()) return;
      this.staticMarkers();
      const colors = routePalette(state.map!.routes);
      const links: {
        points: GeoPoint[];
        color: string;
        width: number;
        dotted: boolean;
      }[] = [];
      const walk = (from: GeoPoint, to: GeoPoint, color: string): void => {
        if (distanceMeters(from, to) > 2)
          links.push({ points: [from, to], color, width: 3, dotted: true });
      };
      if (plan) {
        let from = originPoint(state) || plan.board;
        for (const leg of plan.legs) {
          const color = colors.get(leg.route.id) || leg.route.color;
          walk(from, leg.board, color);
          links.push({ points: leg.points, color, width: 4, dotted: false });
          from = leg.alight;
        }
        if (destination)
          walk(
            from,
            destination,
            colors.get(plan.legs[plan.legs.length - 1].route.id)!,
          );
      }
      const parts = orderedTraces(links);
      const final = [...base, ...tracePolylines(parts)];
      if (
        !parts.length ||
        this.data.motionClass === "motion-reduced" ||
        !state.routeCanvas ||
        !state.routeContext
      ) {
        this.setData({ polylines: final });
        return;
      }
      state.routeTimer = setTimeout(() => {
        if (!current()) return;
        state.context?.getRegion({
          success: (bounds) => {
            if (!current()) return;
            if (state.moving) {
              this.setData({ polylines: final });
              return;
            }
            const width = this.data.windowWidth,
              height = this.data.mapHeight;
            const pixelRatio = Math.min(3, wx.getWindowInfo().pixelRatio || 2);
            state.routeCanvas!.width = Math.round(width * pixelRatio);
            state.routeCanvas!.height = Math.round(height * pixelRatio);
            state.routeContext!.scale(pixelRatio, pixelRatio);
            state.routeFinal = final;
            state.routeReveal = new ShuttleRouteReveal(
              state.routeCanvas!,
              state.routeContext!,
            );
            this.setData({ routeAnimating: true });
            state.routeReveal.start(
              parts,
              (p) => projectToScreen(p, bounds, width, height),
              width,
              height,
              () => {
                if (current()) this.finishRouteAnimation();
              },
            );
          },
          fail: () => {
            if (current()) this.setData({ polylines: final });
          },
        });
      }, 420);
    };
    reveal();
  },
  staticMarkers() {
    const state = rt(this);
    if (!state.context || !state.map) return;
    if (state.staticIds.length)
      state.context.removeMarkers({ markerIds: state.staticIds });
    state.markerPlaces.clear();
    const markers: ShuttleMarker[] = placeGroups(state.map)
      .filter((group) => group.stop)
      .map((group, index) => {
        const place =
          group.members.find((p) => p.id === state.board?.id) ||
          group.members[0];
        const id = 100 + index;
        state.markerPlaces.set(id, place);
        return pointMarker(place, id, "stop", 10, group.name);
      });
    const destination =
      state.drawnDestination ||
      (!state.pendingChoice ? state.destination : undefined);
    const board = state.drawnPlan?.board || state.board;
    if (destination)
      markers.push(
        pointMarker(destination, 2, "destination", 29, destination.name),
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
            29,
            stopName(leg.alight) + "换乘",
          ),
        ),
      );
    state.staticIds = markers.map((m) => m.id);
    state.context.addMarkers({ markers });
  },
  paintUser() {
    const state = rt(this);
    const origin = originPoint(state);
    if (!origin || !state.context) return;
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
    const vehicles = expired ? [] : packet?.vehicles || [];
    if (expired && state.motion?.positions().length) state.motion.clear();
    const rows: VehicleRow[] = vehicles
      .filter((v) => !state.crossing.length || state.crossing.includes(v.id))
      .map((bus) => {
        const route = state.map!.routes.find((r) => r.id === bus.lineId);
        const leg = state.drawnPlan?.legs.find((leg) =>
          leg.routes.some((route) => route.id === bus.lineId),
        );
        const board = leg?.board || state.drawnPlan?.board || state.board;
        const estimate = board
          ? state.planner!.arrival(bus, board, stale)
          : { text: "待确认", detail: "请先选择候车点", seconds: null };
        if (
          this.data.reminderEnabled &&
          this.data.journey === "waiting" &&
          !stale &&
          estimate.seconds !== null &&
          estimate.seconds <= 75 &&
          !state.alerted.has(bus.id)
        ) {
          state.alerted.add(bus.id);
          haptic("medium");
          this.feedback(
            `${bus.vehicleNo || bus.id} 号车接近候车点，请留意来车`,
          );
        }
        return {
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
      });
    const statusLabel =
      this.data.connection !== "live"
        ? this.data.connection === "connecting"
          ? "正在连接实时校车"
          : "连接中断，正在重连"
        : stale
          ? "车辆信号暂未更新"
          : "实时位置 · 3 秒更新";
    this.setData({ vehicleRows: rows, vehicles, stale, statusLabel });
    if (
      this.data.journey === "riding" &&
      state.plan &&
      state.location &&
      distanceMeters(state.location, state.plan.alight) < 65 &&
      !state.alerted.has("arrival")
    ) {
      state.alerted.add("arrival");
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
    const state = rt(this),
      plan = state.plans.find((p) => p.id === event.currentTarget.dataset.id);
    if (!plan) return;
    state.plan = plan;
    state.board = plan.board;
    state.pendingChoice = false;
    state.drawnPlan = plan;
    state.drawnDestination = state.destinationStops.length
      ? plan.alight
      : state.destination;
    state.selection.routeId = plan.route.id;
    state.selection.boardingId = plan.board.id;

    this.setData({
      selectedPlanId: plan.id,
      boardName: stopName(plan.board),
      boardFavorite: state.favorites.includes(plan.board.id),
      boardDetail: state.location
        ? `建议候车点 · 距你 ${distanceLabel(plan.walkTo)}（直线）`
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
    // Resolve old saved labels against each new map revision without discarding favorites.
    this.setData({
      commonPlaces: this.data.commonPlaces.map((saved) => {
        const current = state.map!.places.find(
          (place) => place.id === saved.placeId,
        );
        return commonPlace(current || saved, saved.placeId);
      }),
    });
  },
  openSearch(mode: "destination" | "board" | "common") {
    this.closeCommonSearch(true);
    const state = rt(this);
    if (state.searchTimer) clearTimeout(state.searchTimer);
    this.setData({
      searchMode: mode,
      searchMounted: true,
      searchOpen: false,
      searchQuery: "",
      keyboardHeight: 0,
      searchPanelHeight: this.searchHeight(mode),
      searchListHeight: this.searchHeight(mode) - 174,
    });
    this.filterPlaces();
    state.searchTimer = setTimeout(() => {
      if (state.visible) this.setData({ searchOpen: true });
    }, 20);
    haptic();
  },
  closeSearch() {
    const state = rt(this);
    if (state.searchTimer) clearTimeout(state.searchTimer);
    wx.hideKeyboard({});
    this.setData({
      searchOpen: false,
      keyboardHeight: 0,
      searchPanelHeight: this.searchHeight(this.data.searchMode, 0),
    });
    state.searchTimer = setTimeout(
      () => this.setData({ searchMounted: false }),
      this.data.motionClass === "motion-reduced" ? 0 : 240,
    );
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
    if (!this.data.searchOpen && !this.data.commonOpen) return;
    this.setData({ keyboardHeight: Math.max(0, event.detail.height || 0) });
    this.setData({
      searchPanelHeight: this.searchHeight(this.data.searchMode),
      searchListHeight: this.searchHeight(this.data.searchMode) - 174,
    });
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
    ).map((g) => ({
      id: g.id,
      name: g.name,
      shortName: g.shortName,
      stop: g.stop,
      categoryLabel: categoryNames[g.members[0].category] || "校园地点",
      favorite: g.members.some((p) => state.favorites.includes(p.id)),
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
      state.manualPoint = place;
      state.manual = true;
      state.pendingChoice = false;
      this.setData({ originName: group.shortName, sheetOpen: true });
    } else {
      state.pendingChoice = Boolean(state.drawnPlan);
      this.setData({ sheetOpen: true });
      state.destinationStops = group.stop ? members.map((p) => p.id) : [];
      state.destination = place;
      state.selection.destinationId = place.id;
      delete state.selection.destinationPoint;
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
  async chooseOnMap() {
    const state = rt(this);
    if (!state.map) {
      this.feedback("地点加载中，请稍后重试");
      return;
    }
    const mode = this.data.searchMode,
      lease = state.lease;
    state.choosing = true;
    try {
      const value =
        await new Promise<WechatMiniprogram.ChooseLocationSuccessCallbackResult>(
          (resolve, reject) =>
            wx.chooseLocation({
              latitude: (state.location || state.map!.center).latitude,
              longitude: (state.location || state.map!.center).longitude,
              success: resolve,
              fail: reject,
            }),
        );
      if (
        !isSessionLeaseCurrent(lease) ||
        !state.map ||
        runtimes.get(this) !== state
      )
        return;
      if (mode === "board") {
        state.manualPoint = {
          longitude: value.longitude,
          latitude: value.latitude,
          name: value.name || "地图选点",
        };
        state.manual = true;
        state.explicitBoard = "";
        state.boardCandidates = [];
        state.pendingChoice = false;
        this.setData({ originName: state.manualPoint.name, sheetOpen: true });
      } else {
        const destination = {
          longitude: value.longitude,
          latitude: value.latitude,
          name: value.name || "地图选点",
        };
        const common = commonPlace(destination);
        if (mode === "common" && !this.addCommonPlace(common)) return;
        state.pendingChoice = Boolean(state.drawnPlan);
        this.setData({ sheetOpen: true });
        state.destinationStops = [];
        state.destination = destination;
        state.selection.destinationPoint = state.destination;
        delete state.selection.destinationId;
        this.setData({
          destinationName: state.destination.name,
          commonPlaceKey: common.key,
        });
      }
      state.plan = undefined;
      this.setData({ journey: "idle", reminderEnabled: false });
      this.closeSearch();
      this.rebuildPlans(true);
      this.layout(false);
      this.fitPlans();
    } catch (error) {
      if (!/cancel/i.test(String((error as { errMsg?: string }).errMsg)))
        this.feedback("选点未完成，请检查位置权限");
    } finally {
      state.choosing = false;
      if (
        runtimes.get(this) === state &&
        state.visible &&
        (this.data.authorized || state.manual) &&
        isSessionLeaseCurrent(lease)
      )
        void this.activate();
    }
  },
  useNearestBoard() {
    const state = rt(this);
    state.explicitBoard = "";
    state.boardCandidates = [];
    state.manual = false;
    state.manualPoint = undefined;
    this.setData({ originName: "我的位置" });
    state.plan = undefined;
    this.closeSearch();
    this.retryActivation();
  },
  addCommonPlace(place: CommonPlace): boolean {
    const state = rt(this);
    if (!isSessionLeaseCurrent(state.lease)) return false;
    if (this.data.commonPlaces.some((p) => p.key === place.key)) return true;
    if (this.data.commonPlaces.length >= 8) {
      this.feedback("常用地点已满，长按地点可移除");
      return false;
    }
    const next = [place, ...this.data.commonPlaces];
    try {
      saveCommonPlaces(state.lease!.userId, next);
      this.setData({ commonPlaces: next });
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
    state.pendingChoice = Boolean(state.drawnPlan);
    this.setData({ sheetOpen: true });
    state.destinationStops = [];
    state.destination = current || place;
    state.selection.destinationId = current?.id;
    state.selection.destinationPoint = current ? undefined : place;
    if (current) this.selectPlaceGroup(current.id, false);
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
          saveCommonPlaces(state.lease!.userId, next);
          this.setData({ commonPlaces: next });
        } catch {
          this.feedback("地点未能移除，请重试");
        }
      },
    });
  },
  fitPlans() {
    const state = rt(this);
    if (!state.destination || state.pendingChoice) return;
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
  toggleFavorite() {
    const state = rt(this);
    if (!state.board || !isSessionLeaseCurrent(state.lease)) return;
    const id = state.board.id,
      saved = !state.favorites.includes(id);
    state.favorites = saved
      ? [...state.favorites, id]
      : state.favorites.filter((value) => value !== id);
    try {
      wx.setStorageSync(
        `${FAVORITE_PREFIX}${state.lease?.userId}`,
        state.favorites,
      );
      this.setData({ boardFavorite: saved });
      haptic();
    } catch {
      this.feedback("收藏未能保存，请检查存储空间");
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
    if (!this.data.hasOrigin || !rt(this).plan) return;
    rt(this).alerted.clear();
    this.setData({ journey: "waiting", reminderEnabled: true });
    haptic();
    this.feedback("请前往候车点，保持本页打开可收到提醒");
  },
  toggleReminder() {
    this.setData({ reminderEnabled: !this.data.reminderEnabled });
    haptic();
  },
  boardVehicle() {
    this.setData({ journey: "riding", reminderEnabled: false });
    haptic();
    this.feedback("请留意下车点；安全停车后再下车");
  },
  finishJourney() {
    this.setData({ journey: "arrived", reminderEnabled: false });
    haptic("medium");
  },
  cancelJourney() {
    rt(this).alerted.clear();
    this.setData({ journey: "idle", reminderEnabled: false });
    haptic();
  },
  refreshShuttles() {
    const state = rt(this);
    if (!state.active) {
      this.retryActivation();
      return;
    }
    void this.reloadMap(false);
    state.stream?.stop();
    state.stream?.start(this.liveSelection());
  },
  selectVehicle(event: Tap) {
    const id = String(event.currentTarget.dataset.id || "");
    this.setData({ selectedVehicleId: id });
    this.focusBus(id);
    haptic();
  },
  focusVehicle(event: Tap) {
    this.focusBus(String(event.currentTarget.dataset.id || ""));
  },
  focusBus(id: string) {
    const state = rt(this),
      value = state.motion?.positions().find((v) => v.bus.id === id);
    if (!value) return;
    this.setData({
      selectedVehicleId: id,
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
      this.setData({ selectedVehicleId: busId });
      this.focusBus(busId);
      return;
    }
    const place =
      state.markerPlaces.get(id) || (id === 3 ? state.board : undefined);
    if (place) {
      this.selectPlaceGroup(place.id, false);
      state.plan = undefined;
      this.rebuildPlans(true);
      this.layout(false);
      this.fitPlans();
      haptic();
    }
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
    state.pendingChoice = Boolean(state.drawnPlan);
    state.destination = {
      longitude: point.longitude,
      latitude: point.latitude,
      name: point.name || "地图选点",
    };
    state.destinationStops = [];
    state.selection.destinationPoint = state.destination;
    delete state.selection.destinationId;
    state.plan = undefined;
    this.setData({
      destinationName: state.destination.name,
      commonPlaceKey: "",
      sheetOpen: true,
      journey: "idle",
    });
    this.rebuildPlans(true);
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
      latitude: state.location.latitude,
      longitude: state.location.longitude,
      scale: 17,
      following: true,
      farFromCampus: false,
    });
    haptic();
  },
  showOverview() {
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
      this.finishRouteAnimation();
      if (state.routeFinal) this.cancelRouteAnimation();
      state.moving = true;
      this.setData({ edgeHints: [], clusters: [] });
    }
    if (event.detail.causedBy === "gesture") this.setData({ following: false });
    if (kind === "end") {
      state.moving = false;
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
          this.updateOverlays();
        }
      },
      complete: () => {
        state.boundsFlight = false;
      },
    });
  },
  updateOverlays() {
    const state = rt(this);
    if (!state.bounds || !state.motion || state.moving || !this.data.hasOrigin)
      return;
    const width = this.data.windowWidth,
      height = this.data.mapHeight;
    const rect = {
      left: 22,
      right: width - 22,
      top: Math.min(
        height - 45,
        Math.max(25, this.data.headerHeight - this.data.mapTop + 56),
      ),
      bottom: height - (this.data.sheetOpen ? this.data.sheetHeight : 0) - 23,
    };
    if (rect.bottom - rect.top < 45) {
      this.setData({ edgeHints: [], clusters: [] });
      return;
    }
    const projected = state.motion.positions().map((value) => ({
      ...value,
      screen: projectToScreen(value.point, state.bounds!, width, height),
    }));
    const edgeHints: EdgeHint[] = [],
      inside: { id: string; point: ScreenPoint }[] = [];
    projected.forEach((value) => {
      const hit = edgeIntersection(value.screen, rect);
      if (hit)
        edgeHints.push({
          id: value.bus.id,
          label: (value.bus.vehicleNo || value.bus.id).slice(-4),
          x: Math.round(hit.x),
          y: Math.round(hit.y),
          angle:
            (Math.atan2(value.screen.y - hit.y, value.screen.x - hit.x) * 180) /
              Math.PI +
            90,
        });
      else inside.push({ id: value.bus.id, point: value.screen });
    });
    // Resolve pill overlap only along the edge. Never move, resize or repel real bus markers.
    const sides = [
      edgeHints.filter((p) => p.x <= rect.left + 1),
      edgeHints.filter((p) => p.x >= rect.right - 1),
      edgeHints.filter(
        (p) =>
          p.x > rect.left + 1 && p.x < rect.right - 1 && p.y <= rect.top + 1,
      ),
      edgeHints.filter(
        (p) =>
          p.x > rect.left + 1 && p.x < rect.right - 1 && p.y > rect.top + 1,
      ),
    ];
    sides.forEach((items, side) => {
      const vertical = side < 2,
        min = vertical ? rect.top : rect.left,
        max = vertical ? rect.bottom : rect.right;
      const coordinate = (v: EdgeHint): number => (vertical ? v.y : v.x);
      items.sort(
        (a, b) => coordinate(a) - coordinate(b) || a.id.localeCompare(b.id),
      );
      const gap = Math.min(
        vertical ? 25 : 48,
        (max - min) / Math.max(1, items.length - 1),
      );
      items.forEach((item, index) => {
        const at = Math.max(
          coordinate(item),
          index ? coordinate(items[index - 1]) + gap : min,
        );
        if (vertical) item.y = at;
        else item.x = at;
      });
      if (items.length && coordinate(items[items.length - 1]) > max) {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const at = Math.min(
            coordinate(items[i]),
            i === items.length - 1 ? max : coordinate(items[i + 1]) - gap,
          );
          if (vertical) items[i].y = at;
          else items[i].x = at;
        }
      }
    });
    const clusters: Cluster[] = [],
      used = new Set<string>();
    inside
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((value) => {
        if (used.has(value.id)) return;
        const group = inside.filter(
          (other) =>
            !used.has(other.id) &&
            Math.hypot(
              other.point.x - value.point.x,
              other.point.y - value.point.y,
            ) < 23,
        );
        if (group.length < 2) return;
        group.forEach((item) => used.add(item.id));
        const ids = group.map((item) => item.id).sort();
        clusters.push({
          id: ids.join("_"),
          ids,
          count: ids.length,
          x: Math.min(rect.right, value.point.x + 16),
          y: Math.max(rect.top, value.point.y - 18),
        });
      });
    const signature = JSON.stringify({ edgeHints, clusters });
    if (signature !== state.lastOverlay) {
      state.lastOverlay = signature;
      this.setData({ edgeHints, clusters });
    }
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
  layout(expanded: boolean) {
    this.finishRouteAnimation();
    if (rt(this).routeFinal) this.cancelRouteAnimation();
    const state = rt(this),
      height = this.data.windowHeight;
    const base = Math.min(310, Math.max(240, height * 0.36));
    const maxSheet = Math.max(160, height - this.data.headerHeight - 105);
    const sheetHeight = Math.round(
      Math.min(maxSheet, expanded ? height * 0.62 : base),
    );
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
    this.setData({ sheetOpen: false });
    this.updateOverlays();
  },
  openTripSheet() {
    this.setData({ sheetOpen: true });
    this.updateOverlays();
  },
  toggleSheet() {
    if (Date.now() < rt(this).ignoreTapUntil) return;
    haptic();
    this.layout(!this.data.sheetExpanded);
  },
  onSheetTouchStart(event: Tap) {
    const state = rt(this);
    state.touchY = event.touches[0]?.clientY || 0;
    state.touchAt = Date.now();
  },
  onSheetTouchEnd(event: Tap) {
    const state = rt(this),
      y = event.changedTouches[0]?.clientY ?? state.touchY,
      dy = y - state.touchY;
    if (Math.abs(dy) > 24) {
      state.ignoreTapUntil = Date.now() + 250;
      this.layout(dy < 0);
      haptic();
    }
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
