const REFRESH_CONFIRMATION_EXIT_DURATION_MS = 300;

interface RefreshConfirmationTimers {
  hide?: ReturnType<typeof setTimeout>;
  unmount?: ReturnType<typeof setTimeout>;
}

const refreshConfirmationTimers = new WeakMap<
  object,
  RefreshConfirmationTimers
>();

function clearRefreshConfirmationTimers(instance: object): void {
  const active = refreshConfirmationTimers.get(instance);
  if (!active) return;
  if (active.hide !== undefined) clearTimeout(active.hide);
  if (active.unmount !== undefined) clearTimeout(active.unmount);
  refreshConfirmationTimers.delete(instance);
}

Component({
  properties: {
    reducedMotion: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
    visualTheme: { type: String, value: "default" },
  },
  data: {
    mounted: false,
    visible: false,
    message: "已刷新",
  },
  lifetimes: {
    detached() {
      clearRefreshConfirmationTimers(this as unknown as object);
    },
  },
  methods: {
    show(message = "已刷新") {
      const instance = this as unknown as object;
      clearRefreshConfirmationTimers(instance);
      this.setData({
        mounted: true,
        visible: true,
        message: message.trim() || "已刷新",
      });

      const active: RefreshConfirmationTimers = {};
      active.hide = setTimeout(() => {
        this.setData({ visible: false });
        active.unmount = setTimeout(() => {
          refreshConfirmationTimers.delete(instance);
          if (!this.data.visible) this.setData({ mounted: false });
        }, REFRESH_CONFIRMATION_EXIT_DURATION_MS);
      }, 3000);
      refreshConfirmationTimers.set(instance, active);
    },
  },
});
