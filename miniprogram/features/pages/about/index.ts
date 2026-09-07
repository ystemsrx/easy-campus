import { APP_NAME } from "../../../config/app";
import { getPreloadedCurrentUser } from "../../../services/primary-tab-preload";
import { loadPreferences } from "../../../store/preferences";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  loadCurrentUser,
} from "../../../store/session";
import { loadVisitHistory } from "../../../store/visits";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { ensureAuthenticated } from "../../../utils/navigation";
import { haptic } from "../../../utils/haptics";
import { exportAboutPrint } from "../../utils/about-print";
import { shareGeneratedImage } from "../../utils/share-image";
import { buildVisitWall, daysSinceRegistration } from "../../utils/visit-wall";

const INITIAL_APPEARANCE = resolveAppearance(loadPreferences());

function appVersion(): string {
  try {
    return wx.getAccountInfoSync().miniProgram.version || "";
  } catch {
    return "";
  }
}

Page({
  data: {
    ...INITIAL_APPEARANCE,
    appName: APP_NAME,
    version: appVersion(),
    wall: buildVisitWall({ version: 1, startedOn: "", days: {} }),
    accompaniedDays: null as number | null,
    legend: [0, 1, 2, 3, 4],
    shareBusy: false,
  },
  shareJob: 0,
  pageVisible: false,
  profileJob: 0,
  onShow() {
    this.pageVisible = true;
    if (!ensureAuthenticated()) return;
    const appearance = resolveAppearance(loadPreferences());
    syncWindowBackground(appearance);
    wx.setNavigationBarColor({
      frontColor: appearance.theme === "dark" ? "#ffffff" : "#000000",
      backgroundColor: appearance.theme === "dark" ? "#171613" : "#f7f5ef",
      fail: () => undefined,
    });
    const session = getSession();
    const lease = captureSessionLease(session);
    if (!session || !lease) return;
    const job = ++this.profileJob;
    const cachedUser = loadCurrentUser();
    const registeredAt =
      cachedUser &&
      cachedUser.id === session.user.id &&
      cachedUser.account === session.user.account &&
      cachedUser.registeredAt
        ? cachedUser.registeredAt
        : session.user.registeredAt;
    const history = loadVisitHistory(session.user.account);
    const wall = buildVisitWall(history);
    this.setData({
      ...appearance,
      wall,
      accompaniedDays: daysSinceRegistration(registeredAt),
    });
    if (this.data.accompaniedDays === null) {
      void getPreloadedCurrentUser()
        .then((user) => {
          if (
            this.pageVisible &&
            job === this.profileJob &&
            isSessionLeaseCurrent(lease) &&
            user &&
            user.id === session.user.id &&
            user.account === session.user.account
          )
            this.setData({
              accompaniedDays: daysSinceRegistration(user.registeredAt),
            });
        })
        .catch(() => undefined);
    }
  },
  onHide() {
    this.pageVisible = false;
    this.profileJob += 1;
    this.shareJob += 1;
    this.setData({ shareBusy: false });
  },
  onUnload() {
    this.pageVisible = false;
    this.profileJob += 1;
    this.shareJob += 1;
  },
  async sharePoster() {
    if (this.data.shareBusy || !ensureAuthenticated()) return;
    const session = getSession();
    const lease = captureSessionLease(session);
    if (!session || !lease) return;
    const job = ++this.shareJob;
    const isCurrent = () =>
      this.pageVisible && job === this.shareJob && isSessionLeaseCurrent(lease);
    this.setData({ shareBusy: true });
    haptic("light");
    let imageReady = false;
    try {
      const wall = buildVisitWall(loadVisitHistory(session.user.account));
      this.setData({ wall });
      const path = await exportAboutPrint({
        wall,
      });
      if (!isCurrent()) return;
      imageReady = true;
      await shareGeneratedImage(path);
    } catch {
      if (isCurrent())
        wx.showToast({
          title: imageReady ? "暂时无法分享，请重试" : "图片生成失败，请重试",
          icon: "none",
        });
    } finally {
      if (this.pageVisible && job === this.shareJob)
        this.setData({ shareBusy: false });
    }
  },
});
