const ENTER_DURATION_MS = 220;
const VISIBLE_DURATION_MS = 3000;
const EXIT_DURATION_MS = 220;
const REVEAL_DELAY_MS = 20;

interface ToastTimers {
  reveal?: ReturnType<typeof setTimeout>;
  hide?: ReturnType<typeof setTimeout>;
  unmount?: ReturnType<typeof setTimeout>;
}

const timers = new WeakMap<object, ToastTimers>();

function clearTimers(instance: object): void {
  const active = timers.get(instance);
  if (!active) return;
  if (active.reveal !== undefined) clearTimeout(active.reveal);
  if (active.hide !== undefined) clearTimeout(active.hide);
  if (active.unmount !== undefined) clearTimeout(active.unmount);
  timers.delete(instance);
}

Component({
  data: {
    mounted: false,
    visible: false,
    message: "访问速度太快了",
  },
  lifetimes: {
    detached() {
      clearTimers(this as unknown as object);
    },
  },
  methods: {
    show(message = "访问速度太快了") {
      const instance = this as unknown as object;
      clearTimers(instance);
      const nextMessage = message.trim() || "访问速度太快了";
      if (this.data.message !== nextMessage) {
        this.setData({ message: nextMessage });
      }

      const scheduleHide = (delay: number) => {
        const active = timers.get(instance) || {};
        active.hide = setTimeout(() => {
          this.setData({ visible: false });
          active.unmount = setTimeout(() => {
            timers.delete(instance);
            if (!this.data.visible) this.setData({ mounted: false });
          }, EXIT_DURATION_MS);
        }, delay);
        timers.set(instance, active);
      };

      if (this.data.mounted && this.data.visible) {
        scheduleHide(VISIBLE_DURATION_MS);
        return;
      }

      this.setData({ mounted: true, visible: false }, () => {
        const active: ToastTimers = {};
        active.reveal = setTimeout(() => {
          this.setData({ visible: true });
          scheduleHide(ENTER_DURATION_MS + VISIBLE_DURATION_MS);
        }, REVEAL_DELAY_MS);
        timers.set(instance, active);
      });
    },
  },
});
