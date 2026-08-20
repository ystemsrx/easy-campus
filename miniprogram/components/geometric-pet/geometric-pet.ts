import {
  PET_SHAPE_IDS,
  PET_STATE_IDS,
  type PetShapeId,
  type PetStateId,
} from "./engine-data";
import {
  ORIGINAL_PET_OVERSCAN_FACTOR,
  createOriginalPetSvgEngine,
} from "./original-engine";

interface GazeTarget {
  x: number;
  y: number;
}

interface RendererQueryResult {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}

interface OriginalEngineRuntime {
  setMetrics(
    width: number,
    height: number,
    pixelRatio: number,
    overscan?: number,
    left?: number,
    top?: number,
  ): void;
  update(options: Record<string, unknown>): void;
  spin(turns?: number): void;
  bounce(): void;
  burst(): void;
  destroy(): void;
}

interface PetRuntime {
  engine: OriginalEngineRuntime | null;
  currentState: PetStateId;
  tourIndex: number;
  interactionIndex: number;
  visible: boolean;
  initializationAttempts: number;
  lastSource: string;
  lastMetricsKey: string;
  lastRendererStyle: string;
  interactionTimer?: ReturnType<typeof setTimeout>;
  measureTimer?: ReturnType<typeof setTimeout>;
  tourTimer?: ReturnType<typeof setTimeout>;
}

interface InteractionPreset {
  state: PetStateId;
  actions: readonly ("bounce" | "burst" | "spin")[];
}

const OVERSCAN_FACTOR = ORIGINAL_PET_OVERSCAN_FACTOR;
const NATIVE_IMAGE_TOP_GUTTER_RATIO = 0.33;
const AUTO_TOUR_INTERVAL_MS = 3800;
const INTERACTION_HOLD_MS = 1700;
const LIFECYCLE_STATES: readonly PetStateId[] = [
  "sleeping",
  "waking",
  "idle",
  "listening",
  "searching",
  "working",
];
const REACTION_STATES: readonly PetStateId[] = [
  "excited",
  "surprised",
  "suspicious",
  "angry",
  "drowsy",
  "happy",
  "curious",
  "confused",
  "bored",
  "proud",
  "shy",
  "sad",
  "laughing",
  "scared",
  "playful",
  "celebrate",
];
const AMBIENT_STATES: readonly PetStateId[] = [
  ...LIFECYCLE_STATES,
  ...REACTION_STATES,
];
const NOTIFICATION_STATES = new Set<PetStateId>(["notifying", "alerting"]);
const INTERACTION_PRESETS: readonly InteractionPreset[] = [
  { state: "playful", actions: ["spin"] },
  { state: "excited", actions: ["bounce", "burst"] },
  { state: "curious", actions: ["bounce"] },
  { state: "laughing", actions: ["spin", "burst"] },
  { state: "proud", actions: ["bounce"] },
];
const runtimeByComponent = new WeakMap<object, PetRuntime>();

function createRuntime(): PetRuntime {
  return {
    engine: null,
    currentState: "idle",
    tourIndex: 0,
    interactionIndex: 0,
    visible: true,
    initializationAttempts: 0,
    lastSource: "",
    lastMetricsKey: "",
    lastRendererStyle: "",
  };
}

function isShape(value: unknown): value is PetShapeId {
  return (
    typeof value === "string" &&
    (PET_SHAPE_IDS as readonly string[]).includes(value)
  );
}

function isState(value: unknown): value is PetStateId {
  return (
    typeof value === "string" &&
    (PET_STATE_IDS as readonly string[]).includes(value)
  );
}

function safeColor(value: unknown): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : "#111214";
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = safeColor(color).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

Component({
  properties: {
    shape: {
      type: String,
      value: "blob",
      observer: "refreshAppearance",
    },
    color: {
      type: String,
      value: "#111214",
      observer: "refreshAppearance",
    },
    state: {
      type: String,
      value: "idle",
      observer: "refreshState",
    },
    badgeText: { type: String, value: "" },
    reducedMotion: {
      type: Boolean,
      value: false,
      observer: "refreshAppearance",
    },
    enhanced: {
      type: Boolean,
      value: false,
      observer: "refreshAppearance",
    },
    autoCycle: {
      type: Boolean,
      value: false,
      observer: "refreshState",
    },
    cycleOffset: {
      type: Number,
      value: 0,
      observer: "refreshState",
    },
    previewOffsetX: {
      type: Number,
      value: 0.1,
      observer: "measureRenderer",
    },
    previewOffsetY: {
      type: Number,
      value: 0.11,
      observer: "measureRenderer",
    },
    previewScale: {
      type: Number,
      value: 0.92,
      observer: "refreshPreviewScale",
    },
    previewTopGutter: {
      type: Number,
      value: 0.22,
      observer: "refreshPreviewTopGutter",
    },
    label: { type: String, value: "校园伙伴" },
  },
  data: {
    haloColor: "rgba(17, 18, 20, 0.13)",
    shadowColor: "rgba(17, 18, 20, 0.12)",
    petSource: "",
    rendererReady: false,
    rendererStyle: "",
  },
  lifetimes: {
    ready() {
      runtimeByComponent.set(this, createRuntime());
      this.setData({
        haloColor: colorWithAlpha(safeColor(this.data.color), 0.13),
        shadowColor: colorWithAlpha(safeColor(this.data.color), 0.12),
      });
      wx.nextTick(() => this.initializeEngine());
    },
    detached() {
      this.disposeRuntime();
    },
  },
  pageLifetimes: {
    show() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      runtime.visible = true;
      if (runtime.engine) {
        runtime.engine.update({ paused: Boolean(this.data.reducedMotion) });
        this.measureRenderer();
      } else {
        this.initializeEngine();
      }
      this.refreshState();
    },
    hide() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      runtime.visible = false;
      this.clearTourTimer();
      this.clearInteractionTimer();
      runtime.engine?.update({ paused: true, gazeTarget: null });
    },
  },
  methods: {
    initializeEngine() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime || runtime.engine || !runtime.visible) return;
      const shape = isShape(this.data.shape) ? this.data.shape : "blob";
      const state = isState(this.data.state) ? this.data.state : "idle";
      const color = safeColor(this.data.color);
      const engine = createOriginalPetSvgEngine(
        {
          shape,
          state,
          color,
          background: "#fff",
          reduceMotion: Boolean(this.data.reducedMotion),
          paused: Boolean(this.data.reducedMotion),
          emphasis: Boolean(this.data.enhanced),
          previewScale: Number(this.data.previewScale) || 1,
          previewTopGutter: Math.max(
            0,
            Number(this.data.previewTopGutter) || 0,
          ),
          badgeColor: "#d93d35",
          gazeTarget: null,
        },
        (source: string) => {
          const currentRuntime = runtimeByComponent.get(this);
          if (!currentRuntime?.visible || source === currentRuntime.lastSource)
            return;
          currentRuntime.lastSource = source;
          this.setData({ petSource: source });
        },
      ) as OriginalEngineRuntime;
      runtime.engine = engine;
      runtime.currentState = state;
      this.refreshState();
      wx.nextTick(() => this.measureRenderer());
    },

    measureRenderer() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime?.engine) return;
      this.createSelectorQuery()
        .select(".geometric-pet")
        .fields({ size: true, rect: true })
        .exec((results) => {
          const currentRuntime = runtimeByComponent.get(this);
          const result = results[0] as RendererQueryResult | undefined;
          const width = Number(result?.width) || 0;
          const height = Number(result?.height) || 0;
          if (!currentRuntime?.engine) return;
          if (width <= 0 || height <= 0) {
            currentRuntime.initializationAttempts += 1;
            if (currentRuntime.initializationAttempts < 6) {
              currentRuntime.measureTimer = setTimeout(
                () => this.measureRenderer(),
                48,
              );
            }
            return;
          }
          currentRuntime.initializationAttempts = 0;
          const outerWidth = width * OVERSCAN_FACTOR;
          const outerHeight = height * OVERSCAN_FACTOR;
          const previewOffsetX = width * Number(this.data.previewOffsetX || 0);
          const previewOffsetY = height * Number(this.data.previewOffsetY || 0);
          const offsetX = (outerWidth - width) / 2;
          const offsetY = (outerHeight - height) / 2;
          const imageLeft = previewOffsetX;
          const imageTop =
            -height * NATIVE_IMAGE_TOP_GUTTER_RATIO + previewOffsetY;
          const left = Number(result?.left) || 0;
          const top = Number(result?.top) || 0;
          const metricsLeft = left - offsetX + previewOffsetX;
          const metricsTop = top - offsetY + previewOffsetY;
          const metricsKey = [
            outerWidth,
            outerHeight,
            metricsLeft,
            metricsTop,
          ]
            .map((value) => value.toFixed(3))
            .join(":");
          const rendererStyle =
            `left: ${imageLeft.toFixed(3)}px; ` +
            `top: ${imageTop.toFixed(3)}px; ` +
            `width: ${outerWidth.toFixed(3)}px; ` +
            `height: ${outerHeight.toFixed(3)}px;`;

          if (metricsKey !== currentRuntime.lastMetricsKey) {
            currentRuntime.lastMetricsKey = metricsKey;
            currentRuntime.engine.setMetrics(
              outerWidth,
              outerHeight,
              1,
              OVERSCAN_FACTOR,
              metricsLeft,
              metricsTop,
            );
          }
          if (
            rendererStyle !== currentRuntime.lastRendererStyle ||
            !this.data.rendererReady
          ) {
            currentRuntime.lastRendererStyle = rendererStyle;
            this.setData({
              rendererReady: true,
              rendererStyle,
            });
          }
        });
    },

    refreshAppearance() {
      const runtime = runtimeByComponent.get(this);
      const color = safeColor(this.data.color);
      this.setData({
        haloColor: colorWithAlpha(color, 0.13),
        shadowColor: colorWithAlpha(color, 0.12),
      });
      if (!runtime?.engine) return;
      runtime.engine.update({
        shape: isShape(this.data.shape) ? this.data.shape : "blob",
        color,
        reduceMotion: Boolean(this.data.reducedMotion),
        paused: Boolean(this.data.reducedMotion) || !runtime.visible,
        emphasis: Boolean(this.data.enhanced),
      });
    },

    refreshPreviewScale() {
      runtimeByComponent.get(this)?.engine?.update({
        previewScale: Number(this.data.previewScale) || 1,
      });
    },

    refreshPreviewTopGutter() {
      runtimeByComponent.get(this)?.engine?.update({
        previewTopGutter: Math.max(0, Number(this.data.previewTopGutter) || 0),
      });
    },

    refreshState() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      const requestedState = isState(this.data.state)
        ? this.data.state
        : "idle";
      const notificationActive = NOTIFICATION_STATES.has(requestedState);
      if (notificationActive) this.clearInteractionTimer();
      else if (runtime.interactionTimer) return;
      const canTour = Boolean(this.data.autoCycle) && !notificationActive;
      const requestedIndex = AMBIENT_STATES.indexOf(requestedState);
      const offset = Math.floor(Number(this.data.cycleOffset) || 0);
      const normalizedOffset =
        ((offset % AMBIENT_STATES.length) + AMBIENT_STATES.length) %
        AMBIENT_STATES.length;

      this.clearTourTimer();
      runtime.tourIndex = canTour
        ? ((requestedIndex < 0 ? 0 : requestedIndex) + normalizedOffset) %
          AMBIENT_STATES.length
        : 0;
      this.activateState(
        canTour ? AMBIENT_STATES[runtime.tourIndex] : requestedState,
      );
      if (canTour && !this.data.reducedMotion && runtime.visible) {
        this.scheduleNextTourState();
      }
    },

    activateState(state: PetStateId) {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      runtime.currentState = state;
      runtime.engine?.update({
        state,
        paused: Boolean(this.data.reducedMotion) || !runtime.visible,
      });
    },

    scheduleNextTourState() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      this.clearTourTimer();
      runtime.tourTimer = setTimeout(() => {
        const activeRuntime = runtimeByComponent.get(this);
        if (
          !activeRuntime ||
          !activeRuntime.visible ||
          !this.data.autoCycle ||
          this.data.reducedMotion
        )
          return;
        activeRuntime.tourIndex =
          (activeRuntime.tourIndex + 1) % AMBIENT_STATES.length;
        this.activateState(AMBIENT_STATES[activeRuntime.tourIndex]);
        this.scheduleNextTourState();
      }, AUTO_TOUR_INTERVAL_MS);
    },

    updateGaze(event: WechatMiniprogram.TouchEvent) {
      const runtime = runtimeByComponent.get(this);
      const touch = event.touches[0];
      if (!runtime?.engine || !touch) return;
      this.setExternalGazeTarget(touch.clientX, touch.clientY);
    },

    setExternalGazeTarget(x: number, y: number) {
      const runtime = runtimeByComponent.get(this);
      if (!runtime?.engine || this.data.reducedMotion) return;
      const target: GazeTarget = { x, y };
      runtime.engine.update({ gazeTarget: target });
    },

    clearGaze() {
      this.clearExternalGaze();
    },

    clearExternalGaze() {
      runtimeByComponent.get(this)?.engine?.update({ gazeTarget: null });
    },

    playInteraction() {
      this.handleTap();
    },

    handleTap() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime?.engine || this.data.reducedMotion) return;
      const requestedState = isState(this.data.state)
        ? this.data.state
        : "idle";
      this.clearInteractionTimer();
      this.clearTourTimer();
      if (NOTIFICATION_STATES.has(requestedState)) {
        runtime.engine.bounce();
        runtime.engine.burst();
        return;
      }

      const preset =
        INTERACTION_PRESETS[
          runtime.interactionIndex % INTERACTION_PRESETS.length
        ];
      runtime.interactionIndex += 1;
      this.activateState(preset.state);
      for (const action of preset.actions) {
        if (action === "spin") runtime.engine.spin(1);
        else if (action === "bounce") runtime.engine.bounce();
        else runtime.engine.burst();
      }
      runtime.interactionTimer = setTimeout(() => {
        const activeRuntime = runtimeByComponent.get(this);
        if (!activeRuntime) return;
        activeRuntime.interactionTimer = undefined;
        this.refreshState();
      }, INTERACTION_HOLD_MS);
    },

    clearTourTimer() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime?.tourTimer) return;
      clearTimeout(runtime.tourTimer);
      runtime.tourTimer = undefined;
    },

    clearInteractionTimer() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime?.interactionTimer) return;
      clearTimeout(runtime.interactionTimer);
      runtime.interactionTimer = undefined;
    },

    disposeRuntime() {
      const runtime = runtimeByComponent.get(this);
      if (!runtime) return;
      runtime.visible = false;
      this.clearTourTimer();
      this.clearInteractionTimer();
      if (runtime.measureTimer) clearTimeout(runtime.measureTimer);
      runtime.engine?.destroy();
      runtime.engine = null;
      runtimeByComponent.delete(this);
    },
  },
});
