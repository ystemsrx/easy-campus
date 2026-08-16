import { loadPreferences } from "./store/preferences";
import { loadCurrentUser, loadSession } from "./store/session";
import { refreshExamsAfterSignIn } from "./services/cache-refresh";
import { beginAutomaticRefreshCycle } from "./store/cache-policy";

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
    void refreshExamsAfterSignIn(this.globalData.session);
  },
  onShow() {
    beginAutomaticRefreshCycle();
  },
});
