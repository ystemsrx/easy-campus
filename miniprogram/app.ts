import { loadPreferences } from "./store/preferences";
import { loadCurrentUser, loadSession } from "./store/session";
import { refreshExamsAfterSignIn } from "./services/cache-refresh";
import { beginAutomaticRefreshCycle } from "./store/cache-policy";
import { loadTimetableSnapshot } from "./store/timetable";
import { prewarmTimetableFirstScreen } from "./data/timetable-render";
import { preloadAllSvgIcons } from "./utils/icon-preload";

App<IAppOption>({
  globalData: {
    session: null,
    user: null,
    preferences: loadPreferences(),
    selectedGrade: null,
  },
  onLaunch() {
    this.globalData.session = loadSession();
    this.globalData.user = loadCurrentUser();
    preloadAllSvgIcons();
    const account = this.globalData.session?.user.account || "";
    const timetable = account ? loadTimetableSnapshot(account) : null;
    if (timetable) {
      try {
        prewarmTimetableFirstScreen(account, timetable);
      } catch {
        // 首屏预渲染失败时由课表页使用同一份本地快照即时构建。
      }
    }
    void refreshExamsAfterSignIn(this.globalData.session);
  },
  onShow() {
    beginAutomaticRefreshCycle();
  },
});
