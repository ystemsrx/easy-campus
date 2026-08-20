const hideTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

function clearHideTimer(instance: object): void {
  const timer = hideTimers.get(instance);
  if (timer !== undefined) clearTimeout(timer);
  hideTimers.delete(instance);
}

Component({
  properties: {
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    visible: false,
  },
  lifetimes: {
    detached() {
      clearHideTimer(this as unknown as object);
    },
  },
  methods: {
    show() {
      const instance = this as unknown as object;
      clearHideTimer(instance);
      this.setData({ visible: true });
      hideTimers.set(
        instance,
        setTimeout(() => {
          hideTimers.delete(instance);
          this.setData({ visible: false });
        }, 3000),
      );
    },
  },
});
