import { loadPreferences } from "./store/preferences";
import { loadCurrentUser, loadSession } from "./store/session";
import { refreshExamsAfterSignIn } from "./services/cache-refresh";
import { preloadPrimaryTabs } from "./services/primary-tab-preload";
import { beginAutomaticRefreshCycle } from "./store/cache-policy";
import { loadTimetableSnapshot } from "./store/timetable";
import { prewarmTimetableFirstScreen } from "./data/timetable-render";
import { loadTimetableThemeId } from "./data/timetable-theme";
import {
  preloadPrimaryTabAssets,
  preloadTimetableThemeAssets,
} from "./utils/icon-preload";

App<IAppOption>({
  globalData: {
    session: null,
    user: null,
    preferences: loadPreferences(),
    selectedGrade: null,
    foregroundEntryId: 0,
  },
  onLaunch() {
    this.globalData.session = loadSession();
    this.globalData.user = loadCurrentUser();
    preloadPrimaryTabAssets();
    const timetableThemeId = loadTimetableThemeId();
    preloadTimetableThemeAssets(timetableThemeId);
    const account = this.globalData.session?.user.account || "";
    const timetable = account ? loadTimetableSnapshot(account) : null;
    if (timetable) {
      try {
        prewarmTimetableFirstScreen(account, timetable, timetableThemeId);
      } catch {
        // 首屏预渲染失败时由课表页使用同一份本地快照即时构建。
      }
    }
    void refreshExamsAfterSignIn(this.globalData.session);
  },
  onShow() {
    this.globalData.foregroundEntryId += 1;
    beginAutomaticRefreshCycle();
    const session = this.globalData.session;
    setTimeout(() => preloadPrimaryTabs(session), 0);
  },
});
