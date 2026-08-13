import { loadPreferences } from "./store/preferences";
import { loadCurrentUser, loadSession } from "./store/session";

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
  },
});
