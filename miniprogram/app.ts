import { loadPreferences } from "./store/preferences";
import { prepareDemoData } from "./demo/bootstrap";
import { loadCurrentUser, loadSession } from "./store/session";
import { refreshExamsOnForeground } from "./services/cache-refresh";
import { startHeartbeat, stopHeartbeat } from "./services/heartbeat";
import { startVisitTracking, stopVisitTracking } from "./services/visits";
import { preloadPrimaryTabs } from "./services/primary-tab-preload";
import { beginAutomaticRefreshCycle } from "./store/cache-policy";
import { loadTimetableSnapshot } from "./store/timetable";
import { prewarmTimetableFirstScreen } from "./data/timetable-render";
import { loadTimetableThemeId } from "./data/timetable-theme";
import { preloadPrimaryTabAssets } from "./utils/icon-preload";
import { registerAuthenticationRoute } from "./utils/navigation";

App<IAppOption>({
  globalData: {
    session: null,
    user: null,
    preferences: loadPreferences(),
    selectedGrade: null,
    foregroundEntryId: 0,
  },
  onLaunch() {
    registerAuthenticationRoute();
    this.globalData.session = loadSession();
    this.globalData.user = loadCurrentUser();
    prepareDemoData();
    preloadPrimaryTabAssets();
    const timetableThemeId = loadTimetableThemeId();
    const account = this.globalData.session?.user.account || "";
    const timetable = account ? loadTimetableSnapshot(account) : null;
    if (timetable) {
      try {
        prewarmTimetableFirstScreen(account, timetable, timetableThemeId);
      } catch {
        // 首屏预渲染失败时由课表页使用同一份本地快照即时构建。
      }
    }
  },
  onShow() {
    prepareDemoData();
    this.globalData.foregroundEntryId += 1;
    startVisitTracking();
    beginAutomaticRefreshCycle();
    startHeartbeat();
    const session = this.globalData.session;
    void refreshExamsOnForeground(session);
    setTimeout(() => preloadPrimaryTabs(session), 0);
  },
  onHide() {
    stopVisitTracking();
    stopHeartbeat();
  },
});
