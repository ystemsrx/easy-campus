const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(miniprogramRoot, relativePath), "utf8");
}

function loadGeneratedData() {
  const source = read("components/geometric-pet/engine-data.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function loadPetStore(engineData) {
  const source = read("store/pet.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const storage = new Map();
  global.wx = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
  };
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request.endsWith("components/geometric-pet/engine-data")) {
        return engineData;
      }
      throw new Error(`Unexpected store dependency: ${request}`);
    },
  );
  return { store: moduleRecord.exports, storage };
}

function loadCompanionService(petStore) {
  const source = read("services/companion.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const writes = [];
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request.endsWith("store/pet")) return petStore;
      if (request === "./request") {
        return {
          async apiRequest(path, options) {
            writes.push({ path, data: options.data });
            return {
              ...options.data,
              updatedAt: "2026-08-20T03:00:00.000Z",
            };
          },
        };
      }
      throw new Error(`Unexpected companion service dependency: ${request}`);
    },
  );
  return { service: moduleRecord.exports, writes };
}

const data = loadGeneratedData();
const petStoreRuntime = loadPetStore(data);
assert(data.PET_SHAPE_IDS.length === 18, "校园伙伴必须保留参考中的 18 种形状");
assert(data.PET_STATE_IDS.length === 39, "校园伙伴必须保留参考中的 39 种状态");
assert(
  data.PET_EYE_TOPOLOGIES.length === 25,
  "校园伙伴必须保留参考中的 25 组眼睛拓扑",
);

for (const shape of data.PET_SHAPE_IDS) {
  const definition = data.PET_SHAPE_DEFINITIONS[shape];
  assert(definition?.path?.startsWith("M"), `${shape} 缺少参考轮廓路径`);
  assert(
    definition.ring.length === 96 &&
      definition.spanLeft.length === 160 &&
      definition.spanRight.length === 160 &&
      Number.isFinite(definition.radius) &&
      Number.isFinite(definition.beltRadius) &&
      Number.isFinite(definition.tiltScale),
    `${shape} 缺少原引擎的轮廓、转身或边界数据`,
  );
  for (const key of ["x", "y", "sx", "sy", "eye"]) {
    assert(
      Number.isFinite(definition.face[key]),
      `${shape} 的面部参数 ${key} 无效`,
    );
  }
}

for (const state of data.PET_STATE_IDS) {
  const eyes = data.PET_STATE_EYES[state];
  const delay = data.PET_STATE_EYE_DELAYS[state];
  assert(Array.isArray(eyes) && eyes.length > 0, `${state} 缺少眼睛状态`);
  assert(
    eyes.every(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < data.PET_EYE_TOPOLOGIES.length,
    ),
    `${state} 包含无效眼睛拓扑`,
  );
  assert(
    Array.isArray(delay) && delay.length === 2 && delay[1] >= delay[0],
    `${state} 的切换节奏无效`,
  );
}

const defaultPreferences = petStoreRuntime.store.loadPetPreferences("new");
assert(
  !defaultPreferences.completed &&
    !defaultPreferences.selected &&
    !defaultPreferences.skipped &&
    !defaultPreferences.enabled &&
    !defaultPreferences.enhanced &&
    !petStoreRuntime.store.shouldShowPet(defaultPreferences),
  "没有选择过宠物的账号不得默认显示宠物",
);
const skippedPreferences = petStoreRuntime.store.skipPetSetup("skipped");
assert(
  skippedPreferences.completed &&
    skippedPreferences.skipped &&
    !skippedPreferences.selected &&
    !skippedPreferences.enabled &&
    !petStoreRuntime.store.shouldShowPet(skippedPreferences),
  "跳过必须结束引导并保持宠物隐藏",
);
const selectedPreferences = petStoreRuntime.store.savePetSelection("selected", {
  shape: "blob",
  color: "#111214",
  enhanced: true,
});
assert(
  selectedPreferences.selected &&
    !selectedPreferences.skipped &&
    selectedPreferences.enabled &&
    selectedPreferences.enhanced &&
    petStoreRuntime.store.shouldShowPet(selectedPreferences),
  "显式选择默认形状和颜色也必须被识别为已选择",
);
const disabledPreferences = petStoreRuntime.store.setPetEnabled(
  "selected",
  false,
);
assert(
  disabledPreferences.selected &&
    !disabledPreferences.enabled &&
    disabledPreferences.enhanced &&
    !petStoreRuntime.store.shouldShowPet(disabledPreferences),
  "关闭开关必须保留选择并隐藏宠物",
);
const changedWhileDisabled = petStoreRuntime.store.savePetSelection(
  "selected",
  {
    shape: "leaf",
    color: "#2a92fe",
  },
);
assert(
  changedWhileDisabled.shape === "leaf" &&
    changedWhileDisabled.selected &&
    changedWhileDisabled.enhanced &&
    !changedWhileDisabled.enabled,
  "关闭状态下更换形状或颜色不得擅自重新开启功能或清除增强状态",
);
const selectedButHidden = petStoreRuntime.store.savePetSelection("hidden", {
  shape: "pill",
  color: "#9159fe",
  enabled: false,
});
assert(
  selectedButHidden.selected &&
    !selectedButHidden.enabled &&
    !petStoreRuntime.store.shouldShowPet(selectedButHidden),
  "选择页中的显示开关必须和形状、颜色一起保存",
);
assert(
  !petStoreRuntime.store.hasStoredPetPreferences("server-only"),
  "从未保存过伙伴的账号必须能与本地默认值区分",
);
const serverPreferences = petStoreRuntime.store.storeServerPetPreferences(
  "server-only",
  {
    selected: true,
    skipped: false,
    enabled: false,
    enhanced: true,
    shape: "cloud",
    color: "#f0449d",
    updatedAt: "2026-08-20T02:00:00.000Z",
  },
);
assert(
  petStoreRuntime.store.hasStoredPetPreferences("server-only") &&
    serverPreferences.completed &&
    serverPreferences.selected &&
    !serverPreferences.skipped &&
    !serverPreferences.enabled &&
    serverPreferences.enhanced &&
    serverPreferences.shape === "cloud" &&
    serverPreferences.color === "#f0449d",
  "本地没有记录时必须完整接收服务端伙伴状态和样式",
);

const component = read("components/geometric-pet/geometric-pet.ts");
const componentTemplate = read("components/geometric-pet/geometric-pet.wxml");
const componentStyles = read("components/geometric-pet/geometric-pet.wxss");
const originalEngine = read("components/geometric-pet/original-engine.ts");
const setupScript = read("pages/pet-setup/index.ts");
const setupTemplate = read("pages/pet-setup/index.wxml");
const setupStyles = read("pages/pet-setup/index.wxss");
const pickerScript = read("components/pet-picker-drawer/pet-picker-drawer.ts");
const pickerTemplate = read(
  "components/pet-picker-drawer/pet-picker-drawer.wxml",
);
const pickerStyles = read(
  "components/pet-picker-drawer/pet-picker-drawer.wxss",
);
const homeScript = read("pages/home/index.ts");
const homeTemplate = read("pages/home/index.wxml");
const homeStyles = read("pages/home/index.wxss");
const profileScript = read("pages/profile/index.ts");
const profileTemplate = read("pages/profile/index.wxml");
const profileStyles = read("pages/profile/index.wxss");
const petStore = read("store/pet.ts");
const companionService = read("services/companion.ts");
const authService = read("services/auth.ts");
const apiTypes = read("types/api.ts");
const loginScript = read("pages/login/index.ts");
const navigationScript = read("utils/navigation.ts");
const appConfig = JSON.parse(read("app.json"));

assert(
  component.includes("createOriginalPetSvgEngine") &&
    component.includes("AUTO_TOUR_INTERVAL_MS = 3800") &&
    component.includes("LIFECYCLE_STATES") &&
    component.includes("REACTION_STATES") &&
    component.includes("AMBIENT_STATES") &&
    component.includes('"sleeping"') &&
    component.includes('"waking"') &&
    component.includes('"celebrate"') &&
    !component.includes('"thinking"') &&
    !component.includes('"orbit"') &&
    !component.includes('"loading"') &&
    component.includes("INTERACTION_PRESETS") &&
    component.includes("INTERACTION_HOLD_MS = 1700") &&
    component.includes("NOTIFICATION_STATES.has(requestedState)") &&
    component.includes("this.activateState(preset.state)") &&
    component.includes("runtime.engine.spin(1)") &&
    component.includes("runtime.engine.bounce()") &&
    component.includes("runtime.engine.burst()") &&
    component.includes("enhanced:") &&
    component.includes("emphasis: Boolean(this.data.enhanced)") &&
    component.includes(
      "const OVERSCAN_FACTOR = ORIGINAL_PET_OVERSCAN_FACTOR",
    ) &&
    component.includes("NATIVE_IMAGE_TOP_GUTTER_RATIO = 0.33") &&
    component.includes("previewOffsetX:") &&
    component.includes("previewOffsetY:") &&
    component.includes("previewScale:") &&
    component.includes("value: 0.1") &&
    component.includes("value: 0.11") &&
    component.includes("value: 0.92") &&
    component.includes("value: 0.22") &&
    component.includes("refreshPreviewScale()") &&
    component.includes("previewTopGutter:") &&
    component.includes("refreshPreviewTopGutter()") &&
    componentTemplate.includes('id="pet-engine-image"') &&
    componentTemplate.includes('style="{{rendererStyle}}"') &&
    componentTemplate.includes("<image") &&
    componentTemplate.includes('src="{{petSource}}"') &&
    componentTemplate.includes('mode="aspectFit"') &&
    componentTemplate.includes('fade-in="{{false}}"') &&
    !componentTemplate.includes("<canvas") &&
    componentTemplate.includes('bindtouchmove="updateGaze"') &&
    component.includes("const outerWidth = width * OVERSCAN_FACTOR") &&
    component.includes("const outerHeight = height * OVERSCAN_FACTOR") &&
    component.includes("const imageLeft = previewOffsetX") &&
    component.includes("-height * NATIVE_IMAGE_TOP_GUTTER_RATIO") &&
    component.includes("const metricsLeft = left - offsetX + previewOffsetX") &&
    component.includes("const metricsTop = top - offsetY + previewOffsetY") &&
    component.includes("lastMetricsKey") &&
    component.includes("lastRendererStyle") &&
    component.includes("`left: ${imageLeft.toFixed(3)}px; `") &&
    component.includes("`top: ${imageTop.toFixed(3)}px; `") &&
    componentStyles.includes(".pet-engine-viewport") &&
    componentStyles.includes(".pet-engine-image") &&
    componentStyles.includes(
      ".pet-engine-viewport {\n  position: absolute;\n  top: 0;",
    ) &&
    componentStyles.includes(
      ".pet-engine-image {\n  position: absolute;\n  left: 0;",
    ) &&
    componentStyles.includes("position: absolute") &&
    componentStyles.includes("overflow: visible") &&
    componentStyles.includes("box-sizing: border-box") &&
    componentStyles.includes("top: 11%") &&
    componentStyles.includes("bottom: 11%") &&
    componentStyles.includes("bottom: 4%") &&
    componentStyles.includes("top: -3%") &&
    !componentStyles.includes("pet-canvas--") &&
    !componentStyles.includes("pet-effect-layer") &&
    !component.includes("renderPetSource") &&
    !component.includes("STATE_CROSSFADE"),
  "校园伙伴必须由原始逐帧引擎驱动，并由可定位的 Skyline SVG 图像保留溢出",
);
assert(
  originalEngine.includes("Mechanically extracted from Grok Bot 0.16.0") &&
    originalEngine.includes("rzt = 1 / 120") &&
    originalEngine.includes("Wl(Se, Xt, 1, dn)") &&
    originalEngine.includes("qn = requestAnimationFrame(ir)") &&
    originalEngine.includes('loading: "whirl"') &&
    originalEngine.includes('"powering-down": "standby"') &&
    originalEngine.includes("129.5 /") &&
    originalEngine.includes("createOriginalPetEngine") &&
    originalEngine.includes("createOriginalPetSvgEngine") &&
    originalEngine.includes("toSvgDataUri()") &&
    originalEngine.includes("serializeNode(node)") &&
    originalEngine.includes("function __hslToHex(value)") &&
    originalEngine.includes("return __hslToHex(value)") &&
    originalEngine.includes("const __PET_ANCHOR_OFFSET_X_RATIO = -0.1") &&
    originalEngine.includes("const __PET_ANCHOR_OFFSET_Y_RATIO = -0.22") &&
    originalEngine.includes("const __PET_VIEWPORT_SCALE = 0.85") &&
    originalEngine.includes("const __TOP_MOTION_GUTTER_RATIO = 0.22") &&
    originalEngine.includes(
      "export const ORIGINAL_PET_OVERSCAN_FACTOR = 2.4",
    ) &&
    originalEngine.includes("let __nextEngineId = 0") &&
    originalEngine.includes("value: `gb${++__nextEngineId}`") &&
    !originalEngine.includes('preserveAspectRatio="none"') &&
    !originalEngine.includes('width="${outerWidth.toFixed(3)}"') &&
    !originalEngine.includes('height="${outerHeight.toFixed(3)}"') &&
    originalEngine.includes("Number(this.options.previewScale) || 1") &&
    originalEngine.includes("this.previewTopGutter") &&
    originalEngine.includes("L.current &&") &&
    originalEngine.includes("Math.max(ce.t, 1.32)") &&
    originalEngine.includes("Math.max(_e.t, 1.18)") &&
    originalEngine.includes("const __pausedEyeOpen = L.current ? 1.18 : 1") &&
    originalEngine.includes("const pausedVisualChanged =") &&
    originalEngine.includes("this.environment.paint()") &&
    originalEngine.includes("const outerMinimumX = minimumX") &&
    originalEngine.includes(
      "const translateX = viewWidth * __PET_ANCHOR_OFFSET_X_RATIO",
    ) &&
    originalEngine.includes(
      "__TOP_MOTION_GUTTER_RATIO + this.previewTopGutter",
    ) &&
    originalEngine.includes(
      "translateX + centerX * (1 - viewportScale) - outerMinimumX",
    ) &&
    originalEngine.includes(
      "translateY + centerY * (1 - viewportScale) - outerMinimumY",
    ) &&
    originalEngine.includes(
      "`matrix(${viewportScale.toFixed(6)} 0 0 ${viewportScale.toFixed(6)} `",
    ) &&
    originalEngine.includes(
      '`viewBox="0 0 ${outerWidth.toFixed(3)} ${outerHeight.toFixed(3)}">`',
    ) &&
    originalEngine.includes("firstRender") &&
    originalEngine.includes("declaredAttributes") &&
    !originalEngine.includes('from "react"'),
  "原始程序化 SVG 引擎、弹簧积分、动态视口和无跳帧桥接不得被近似实现替换",
);
assert(
  setupScript.includes("shapeOptions: SHAPE_OPTIONS") &&
    setupScript.includes("colorOptions: PET_COLORS") &&
    setupScript.includes("draftEnabled") &&
    setupScript.includes("draftEnhanced") &&
    setupScript.includes("onPetEnabledChange") &&
    setupScript.includes("onPetEnhancedChange") &&
    setupScript.includes("persistSelection(patch: SelectionPatch)") &&
    setupScript.includes("savePetSelection(account") &&
    setupScript.includes("skipPetSetup(account)") &&
    !setupScript.includes(
      "wx.nextTick(() => this.setData({ drawerOpen: true }))",
    ) &&
    setupTemplate.includes('wx:for="{{shapeOptions}}"') &&
    setupTemplate.includes('class="shape-pet-frame"') &&
    setupTemplate.includes('class="pet-drawer-card') &&
    setupTemplate.includes('class="setup-nav-skip') &&
    setupTemplate.includes("跳过选择") &&
    setupTemplate.includes('bindchange="onPetEnabledChange"') &&
    setupTemplate.includes('bindchange="onPetEnhancedChange"') &&
    setupTemplate.includes("增强状态") &&
    setupTemplate.includes('title="我的伙伴"') &&
    setupTemplate.includes('preview-offset-x="{{0.1}}"') &&
    setupTemplate.includes('preview-offset-y="{{0.11}}"') &&
    setupTemplate.includes('preview-offset-y="{{0.1}}"') &&
    setupTemplate.includes('preview-scale="{{0.92}}"') &&
    (setupTemplate.match(/preview-scale=/g) || []).length === 1 &&
    setupTemplate.includes('preview-top-gutter="{{0.22}}"') &&
    (setupTemplate.match(/preview-top-gutter=/g) || []).length === 1 &&
    setupTemplate.includes('class="selected-stage-shell') &&
    setupTemplate.includes('class="selected-pet-layer"') &&
    setupTemplate.includes('enhanced="{{draftEnhanced}}"') &&
    setupTemplate.includes('reduced-motion="{{reducedMotion}}"') &&
    !setupTemplate.includes(
      'reduced-motion="{{reducedMotion || drawerOpen}}"',
    ) &&
    setupTemplate.includes('auto-cycle="{{!drawerOpen}}"') &&
    setupTemplate.includes(
      'reduced-motion="{{reducedMotion || selectedShape !== item.id}}"',
    ) &&
    setupTemplate.includes('auto-cycle="{{selectedShape === item.id}}"') &&
    !setupTemplate.includes('cycle-offset="{{index}}"') &&
    !setupTemplate.includes("animate-eyes") &&
    !setupTemplate.includes("gallery-mode") &&
    !setupTemplate.includes("animation-delay") &&
    setupStyles.includes(".shape-pet-frame") &&
    setupStyles.includes(".selected-stage-shell") &&
    setupStyles.includes(".selected-pet-layer") &&
    setupStyles.includes(".pet-drawer-scroll") &&
    setupStyles.includes("justify-content: space-between") &&
    setupStyles.includes("width: 202rpx; height: 202rpx") &&
    setupStyles.includes("width: 68rpx; height: 68rpx") &&
    setupStyles.includes("width: 50rpx; height: 50rpx") &&
    setupStyles.includes("box-sizing: border-box") &&
    setupTemplate.indexOf('class="partner-toggle-list') <
      setupTemplate.indexOf('class="pet-drawer-layer') &&
    !setupTemplate.includes("保存设置") &&
    !setupTemplate.includes("当前选择会完整播放动效") &&
    !setupTemplate.includes("关闭后保留当前形状与颜色") &&
    !setupTemplate.includes("放大表情，强化状态表现") &&
    !setupTemplate.includes("挑选喜欢的形状与颜色") &&
    !setupTemplate.includes("形状、颜色和显示状态均可调整") &&
    !setupTemplate.includes("留一只在身边") &&
    !setupScript.includes("confirmSelection") &&
    !setupTemplate.includes("{{item.id}}<"),
  "独立设置页必须即时保存三列形状、颜色和开关，并让外部大预览实时同步当前选择",
);
assert(
  petStore.includes('PET_PREFERENCES_KEY_PREFIX = "easy-swu:pet:v1:"') &&
    petStore.includes("completed: true") &&
    petStore.includes("selected: false") &&
    petStore.includes("skipped: true") &&
    petStore.includes("enabled: false") &&
    petStore.includes("enhanced: false") &&
    petStore.includes("stored.enhanced === true") &&
    petStore.includes("export function skipPetSetup") &&
    petStore.includes("export function setPetEnabled") &&
    petStore.includes("export function hasStoredPetPreferences") &&
    petStore.includes("export function storeServerPetPreferences") &&
    petStore.includes("preferences.selected && preferences.enabled") &&
    companionService.includes("if (!hasStoredPetPreferences(account))") &&
    companionService.includes("if (server) storeServerPetPreferences") &&
    companionService.includes("if (samePreferences(local, server))") &&
    companionService.includes(
      'apiRequest<CompanionPreferencesData>("/auth/companion"',
    ) &&
    companionService.includes("uploadQueues") &&
    authService.includes("synchronizeCompanionPreferences") &&
    apiTypes.includes("companion: CompanionPreferencesData | null") &&
    loginScript.includes(
      "function routeAfterAuthentication(onFailure?: () => void): void",
    ) &&
    loginScript.includes('url: "/pages/home/index"') &&
    loginScript.includes("void getPreloadedCurrentUser().catch") &&
    !loginScript.includes("/pages/pet-setup/index?source=login") &&
    !loginScript.includes("wx.redirectTo") &&
    homeScript.includes("openPendingPetSetup(sessionAccount)") &&
    homeScript.includes(
      "const petSetupPending = this.openPendingPetSetup(sessionAccount);",
    ) &&
    !homeScript.includes(
      "if (this.openPendingPetSetup(sessionAccount)) return",
    ) &&
    !homeScript.includes("/pages/pet-setup/index?source=home") &&
    homeScript.includes("petSetupDrawerMounted: true") &&
    homeScript.includes("savePetSelection(account") &&
    homeScript.includes("skipPetSetup(account)") &&
    homeScript.includes("uploadLocalCompanionPreferences(account)") &&
    setupScript.includes("uploadLocalCompanionPreferences(account)") &&
    homeTemplate.includes("<pet-picker-drawer") &&
    homeTemplate.includes('<root-portal wx:if="{{petSetupDrawerMounted}}">') &&
    !homeTemplate.includes('class="home-pet-setup-action') &&
    homeTemplate.includes('scroll-y="{{!petSetupDrawerOpen}}"') &&
    pickerScript.includes("shapeOptions: SHAPE_OPTIONS") &&
    pickerScript.includes('this.triggerEvent("finish")') &&
    pickerTemplate.includes('wx:for="{{shapeOptions}}"') &&
    pickerTemplate.includes('wx:for="{{colorOptions}}"') &&
    pickerTemplate.includes("选择一个伙伴") &&
    pickerTemplate.includes("{{selected ? '完成' : '跳过'}}") &&
    pickerTemplate.includes(
      'reduced-motion="{{reducedMotion || selectedShape !== item.id}}"',
    ) &&
    pickerStyles.includes("width: 202rpx; height: 202rpx") &&
    pickerStyles.includes(".pet-picker-layer scroll-view") &&
    pickerStyles.includes("box-sizing: border-box") &&
    pickerStyles.includes("font-size: 40rpx") &&
    pickerStyles.includes("transform: translateY(104%)") &&
    navigationScript.includes("let loginRouteOpening = false") &&
    navigationScript.includes("if (loginRouteOpening) return") &&
    navigationScript.includes("if (getSession()?.token) return true") &&
    !homeScript.includes("wx.reLaunch({") &&
    !homeScript.includes("wx.showModal({") &&
    !homeScript.includes("promptLegacyPetSetup"),
  "首次选择必须在首页抽屉中即时保存并允许跳过，独立设置页只能由设置入口使用",
);
assert(
  !homeTemplate.includes("preview-scale") &&
    !profileTemplate.includes("preview-scale") &&
    !homeTemplate.includes("preview-top-gutter") &&
    !profileTemplate.includes("preview-top-gutter"),
  "大预览缩放只能用于我的伙伴页面，不得改变首页或姓名卡片",
);
const homePetCount = (homeTemplate.match(/<geometric-pet/g) || []).length;
assert(
  homeTemplate.includes(
    "state=\"{{publicationUnreadCount ? 'notifying' : 'idle'}}\"",
  ) &&
    homeTemplate.includes('badge-text="{{publicationUnreadLabel}}"') &&
    homeTemplate.includes('enhanced="{{petEnhanced}}"') &&
    homeScript.includes("petEnhanced: preferences.enhanced") &&
    homeTemplate.includes('auto-cycle="{{!publicationUnreadCount}}"') &&
    homeTemplate.includes('class="publication-pet-frame"') &&
    homeTemplate.includes('<lucide-icon name="bell"') &&
    homePetCount === 1 &&
    !homeTemplate.includes('state="sleeping"') &&
    !homeTemplate.includes('state="drowsy"') &&
    !homeTemplate.includes('state="playful"') &&
    homeStyles.includes("width: 118rpx; height: 118rpx") &&
    homeStyles.includes("top: 10rpx; left: -10rpx") &&
    !homeStyles.includes("translate3d(-10rpx, 10rpx, 0)") &&
    homeStyles.includes("overflow: visible"),
  "主页只能在右上角展示宠物，并为通知徽标和动效保留完整溢出空间",
);
const publicationToggle =
  /togglePublicationPanel\(\) \{([\s\S]*?)\n  \},\n  measurePublicationPanel/.exec(
    homeScript,
  )?.[1] || "";
assert(
  publicationToggle.includes("this.createSelectorQuery()") &&
    !publicationToggle.includes("wx.createSelectorQuery()"),
  "宠物触发通知弹层时必须使用页面实例查询，避免 Skyline 丢失 caller",
);
assert(
  profileTemplate.includes('class="identity-pet-frame"') &&
    profileTemplate.includes('wx:if="{{petVisible}}"') &&
    profileTemplate.includes('wx:else class="avatar"') &&
    profileTemplate.includes('auto-cycle="{{true}}"') &&
    profileTemplate.includes('enhanced="{{petEnhanced}}"') &&
    profileScript.includes("petEnhanced: preferences.enhanced") &&
    profileTemplate.includes('label="点击和校园伙伴互动"') &&
    profileTemplate.includes('bindtap="openPetSetup"') &&
    profileTemplate.includes("设置校园伙伴") &&
    !profileTemplate.includes('bindchange="onPetEnabledChange"') &&
    !profileScript.includes("setPetEnabled") &&
    profileStyles.includes(".identity-pet-frame") &&
    profileStyles.includes("width: 122rpx; height: 122rpx") &&
    !/<geometric-pet[^>]*class="identity-pet/.test(profileTemplate),
  "姓名卡片必须用定高容器承载互动宠物，未开启时恢复头像，并只保留独立设置入口",
);
assert(
  appConfig.pages.includes("pages/pet-setup/index") &&
    appConfig.usingComponents["geometric-pet"] ===
      "/components/geometric-pet/geometric-pet",
  "校园伙伴页面和组件必须在 app.json 注册",
);

function runOriginalEngineSmokeTest() {
  const output = ts.transpileModule(originalEngine, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );

  let currentTime = 100_000;
  let nextFrameId = 0;
  const scheduledFrames = new Map();
  const canvas = {
    width: 1,
    height: 1,
    requestAnimationFrame(callback) {
      const frameId = ++nextFrameId;
      scheduledFrames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(frameId) {
      scheduledFrames.delete(frameId);
    },
  };
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    { canvas },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "createLinearGradient" || key === "createRadialGradient") {
          return () => gradient;
        }
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  canvas.getContext = () => context;
  const originalNow = Date.now;
  Date.now = () => currentTime;
  try {
    const runtime = moduleRecord.exports.createOriginalPetEngine(
      canvas,
      context,
      {
        shape: "blob",
        state: "idle",
        color: "#111214",
        background: "#fff",
        reduceMotion: false,
        paused: false,
        emphasis: false,
        gazeTarget: null,
      },
    );
    runtime.setMetrics(240, 240, 1, 2.4, -70, -70);
    const pump = (frameCount) => {
      for (let frame = 0; frame < frameCount; frame++) {
        currentTime += 1000 / 60;
        const callbacks = [...scheduledFrames.values()];
        scheduledFrames.clear();
        for (const callback of callbacks) callback(currentTime);
      }
    };
    pump(60);
    for (const state of [
      "thinking",
      "orbit",
      "loading",
      "notifying",
      "progress",
      "spawning",
      "writing",
      "alerting",
    ]) {
      runtime.update({ state });
      pump(45);
    }
    runtime.update({ shape: "cloud", color: "#2a92fe" });
    runtime.spin(1);
    runtime.bounce();
    runtime.burst();
    pump(120);
    runtime.destroy();
    assert(scheduledFrames.size === 0, "原始引擎销毁后不得遗留动画帧");

    let coloredTrailMarkup = "";
    const trailRuntime = moduleRecord.exports.createOriginalPetEngine(
      null,
      null,
      {
        shape: "blob",
        state: "idle",
        color: "#111214",
        background: "#fff",
        reduceMotion: false,
        paused: false,
        emphasis: false,
        gazeTarget: null,
        scheduler: canvas,
        onFrame(source) {
          const markup = decodeURIComponent(source.split(",", 2)[1] ?? "");
          if (markup.includes("data-trail") && markup.includes("stop-color=")) {
            coloredTrailMarkup = markup;
          }
        },
      },
    );
    trailRuntime.setMetrics(240, 240, 1, 2.4, 0, 0);
    pump(20);
    trailRuntime.spin(1);
    pump(180);
    trailRuntime.destroy();
    const trailColors = new Set(
      [...coloredTrailMarkup.matchAll(/stop-color="(#[0-9a-f]{6})"/gi)].map(
        (match) => match[1].toLowerCase(),
      ),
    );
    assert(
      trailColors.size >= 4 && !coloredTrailMarkup.includes("hsl("),
      "旋转流线必须保留原始彩虹色相，并转换为 Skyline 可解析的 SVG 颜色",
    );
    assert(scheduledFrames.size === 0, "彩色流线运行时销毁后不得遗留动画帧");

    const svgFrames = [];
    const svgRuntime = moduleRecord.exports.createOriginalPetSvgEngine(
      {
        shape: "cloud",
        state: "celebrate",
        color: "#2a92fe",
        background: "#fff",
        reduceMotion: false,
        paused: false,
        emphasis: false,
        gazeTarget: null,
      },
      (source) => svgFrames.push(source),
    );
    svgRuntime.setMetrics(240, 240, 1, 2.4, -70, -70);
    const svgSource = svgFrames.at(-1) ?? "";
    const svgMarkup = decodeURIComponent(svgSource.split(",", 2)[1] ?? "");
    const svgViewBox = /viewBox="([^"]+)"/
      .exec(svgMarkup)?.[1]
      ?.trim()
      .split(/\s+/)
      .map(Number);
    const svgTransform =
      /<g transform="matrix\(([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+)\)"/.exec(
        svgMarkup,
      );
    const sourceViewHeight = Number(svgViewBox?.[3]) / 2.4;
    const sourceCenter = 114.5;
    const geometricAnchorXRatio =
      (sourceCenter * Number(svgTransform?.[1]) + Number(svgTransform?.[3])) /
      sourceViewHeight;
    const geometricAnchorYRatio =
      (sourceCenter * Number(svgTransform?.[2]) + Number(svgTransform?.[4])) /
      sourceViewHeight;
    assert(
      svgSource.startsWith("data:image/svg+xml;charset=utf-8,") &&
        svgMarkup.includes('<svg xmlns="http://www.w3.org/2000/svg"') &&
        svgMarkup.includes("<path") &&
        svgMarkup.includes("#2a92fe") &&
        svgMarkup.includes("viewBox="),
      "Skyline 图像通道必须输出包含原始路径、颜色和动态视口的 SVG 帧",
    );
    assert(
      svgViewBox?.length === 4 &&
        svgViewBox.every(Number.isFinite) &&
        svgViewBox[0] === 0 &&
        svgViewBox[1] === 0 &&
        Number(svgTransform?.[1]) > 0 &&
        Number(svgTransform?.[2]) > 0 &&
        Number.isFinite(Number(svgTransform?.[3])) &&
        Number.isFinite(Number(svgTransform?.[4])) &&
        Math.abs(geometricAnchorXRatio - 0.4) <= 0.005 &&
        Math.abs(geometricAnchorYRatio - 0.5) <= 0.005 &&
        0.33 > (48 / 229) * 0.96 + 0.1,
      "SVG 与原生图像层必须共同保留完整跳跃区，并保持静止光学中心",
    );
    svgRuntime.destroy();

    let pausedMarkup = "";
    const pausedRuntime = moduleRecord.exports.createOriginalPetEngine(
      null,
      null,
      {
        shape: "blob",
        state: "idle",
        color: "#111214",
        background: "#fff",
        reduceMotion: true,
        paused: true,
        emphasis: false,
        gazeTarget: null,
        scheduler: canvas,
        onFrame(source) {
          pausedMarkup = decodeURIComponent(source.split(",", 2)[1] ?? "");
        },
      },
    );
    pausedRuntime.setMetrics(240, 240, 1, 2.4, -70, -70);
    pump(2);
    pausedRuntime.update({ color: "#2a92fe", emphasis: true });
    const synchronouslyRecoloredMarkup = pausedMarkup;
    pump(2);
    const enhancedPausedMarkup = pausedMarkup;
    assert(
      synchronouslyRecoloredMarkup.includes("#2a92fe") &&
        enhancedPausedMarkup.includes("#2a92fe") &&
        enhancedPausedMarkup !== synchronouslyRecoloredMarkup,
      "静态形状必须即时同步颜色，并在单帧刷新后同步增强状态",
    );
    pausedRuntime.destroy();
    assert(scheduledFrames.size === 0, "静态形状刷新后不得遗留动画帧");
  } finally {
    Date.now = originalNow;
  }
}

async function runCompanionSyncSmokeTest() {
  const runtime = loadCompanionService(petStoreRuntime.store);
  petStoreRuntime.store.savePetSelection("local-priority", {
    shape: "leaf",
    color: "#2a92fe",
    enabled: false,
    enhanced: true,
  });
  await runtime.service.synchronizeCompanionPreferences("local-priority", {
    selected: true,
    skipped: false,
    enabled: true,
    enhanced: false,
    shape: "cloud",
    color: "#f0449d",
    updatedAt: "2026-08-19T03:00:00.000Z",
  });
  assert(
    runtime.writes.length === 1 &&
      runtime.writes[0].path === "/auth/companion" &&
      runtime.writes[0].data.shape === "leaf" &&
      runtime.writes[0].data.color === "#2a92fe" &&
      runtime.writes[0].data.enabled === false,
    "本机与服务端不同时必须用本机完整设置覆盖服务器",
  );

  const serverOnly = {
    selected: true,
    skipped: false,
    enabled: true,
    enhanced: true,
    shape: "cloud",
    color: "#f0449d",
    updatedAt: "2026-08-20T03:00:00.000Z",
  };
  await runtime.service.synchronizeCompanionPreferences(
    "fresh-device",
    serverOnly,
  );
  const hydrated = petStoreRuntime.store.loadPetPreferences("fresh-device");
  assert(
    runtime.writes.length === 1 &&
      hydrated.shape === "cloud" &&
      hydrated.color === "#f0449d" &&
      hydrated.enabled &&
      hydrated.enhanced,
    "本机没有伙伴记录时必须直接采用服务器副本且不得反向写入",
  );
}

async function main() {
  runOriginalEngineSmokeTest();
  await runCompanionSyncSmokeTest();
  console.log("Pet system checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
