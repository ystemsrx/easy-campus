// Keep these timings aligned with motion.wxss; check:motion verifies the pair.
export const MOTION = {
  select: 180,
  page: 200,
  switch: 240,
  container: 260,
  sheetEnter: 260,
  sheetExit: 200,
  popoverEnter: 180,
  popoverExit: 140,
  fade: 120,
} as const;

interface PresenceHost {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
}

interface PresenceOptions {
  mounted?: string;
  active?: string;
  exitMs?: number;
  reducedMotion?: boolean;
}

interface PresenceRun {
  timer?: ReturnType<typeof setTimeout>;
}

const runs = new WeakMap<object, Map<string, PresenceRun>>();

export function cancelPresence(host: object, mounted?: string): void {
  const entries = runs.get(host);
  if (!entries) return;
  entries.forEach((run, key) => {
    if (mounted && mounted !== key) return;
    if (run.timer !== undefined) clearTimeout(run.timer);
    entries.delete(key);
  });
  if (!entries.size) runs.delete(host);
}

// Mount the closed state before revealing it. Each intent invalidates older
// render/nextTick/timer callbacks, including callbacks delivered after detach.
// An already mounted surface retargets its transition without replaying entry.
export function setPresence(
  host: PresenceHost,
  visible: boolean,
  options: PresenceOptions = {},
): void {
  const mounted = options.mounted || "mounted";
  const active = options.active || "active";
  cancelPresence(host, mounted);
  const entries = runs.get(host) || new Map<string, PresenceRun>();
  const run: PresenceRun = {};
  entries.set(mounted, run);
  runs.set(host, entries);
  const current = () => runs.get(host)?.get(mounted) === run;

  if (visible) {
    if (host.data[mounted]) {
      host.setData({ [active]: true });
    } else {
      host.setData({ [mounted]: true, [active]: false }, () => {
        if (!current()) return;
        wx.nextTick(() => {
          if (current()) host.setData({ [active]: true });
        });
      });
    }
    return;
  }

  host.setData({ [active]: false }, () => {
    if (!current()) return;
    if (!host.data[mounted]) {
      cancelPresence(host, mounted);
      return;
    }
    const delay = options.reducedMotion
      ? MOTION.fade
      : (options.exitMs ?? MOTION.sheetExit);
    run.timer = setTimeout(() => {
      if (!current()) return;
      cancelPresence(host, mounted);
      host.setData({ [mounted]: false });
    }, delay);
  });
}
