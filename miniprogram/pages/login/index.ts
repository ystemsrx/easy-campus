import { getCurrentUser, login } from "../../services/auth";
import { refreshExamsAfterSignIn } from "../../services/cache-refresh";
import { getErrorMessage } from "../../services/request";
import { isAuthenticated } from "../../store/session";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";

Page({
  data: {
    account: "",
    password: "",
    passwordVisible: false,
    accountFocused: false,
    passwordFocused: false,
    loading: false,
    errorMessage: "",
    privacyNotice:
      "账号与密码会按约定保存在服务端，仅用于持续同步教务信息。请确认你信任当前部署。",
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
  },
  onLoad() {
    if (isAuthenticated()) {
      wx.switchTab({ url: "/pages/home/index" });
      return;
    }
    this.applyAppearance();
  },
  onShow() {
    this.applyAppearance();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  onAccountInput(event: WechatMiniprogram.Input) {
    this.setData({ account: event.detail.value, errorMessage: "" });
  },
  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value, errorMessage: "" });
  },
  onAccountFocus() {
    this.setData({ accountFocused: true });
  },
  onAccountBlur() {
    this.setData({ accountFocused: false });
  },
  onPasswordFocus() {
    this.setData({ passwordFocused: true });
  },
  onPasswordBlur() {
    this.setData({ passwordFocused: false });
  },
  togglePassword() {
    haptic("light");
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },
  async onSubmit() {
    if (this.data.loading) {
      return;
    }

    const account = this.data.account.trim();
    const password = this.data.password;
    if (!account || !password) {
      haptic("heavy");
      this.setData({ errorMessage: "请输入学号和统一身份认证密码。" });
      return;
    }

    this.setData({ loading: true, errorMessage: "" });
    try {
      const session = await login(account, password);
      await getCurrentUser().catch(() => undefined);
      void refreshExamsAfterSignIn(session);
      haptic("medium");
      wx.switchTab({ url: "/pages/home/index" });
    } catch (error) {
      haptic("heavy");
      this.setData({
        errorMessage: getErrorMessage(
          error,
          "登录失败，请检查账号、密码和网络。",
        ),
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
