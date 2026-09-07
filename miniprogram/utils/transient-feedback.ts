import { cancelPresence, setPresence } from "./motion";

interface FeedbackHost {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
}

const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();

export function clearFeedback(host: object): void {
  const timer = timers.get(host);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(host);
  cancelPresence(host);
}

export function showFeedback(host: FeedbackHost, message: string): void {
  clearFeedback(host);
  host.setData({ message });
  setPresence(host, true, { active: "visible" });
  const timer = setTimeout(() => {
    if (timers.get(host) !== timer) return;
    timers.delete(host);
    setPresence(host, false, {
      active: "visible",
      exitMs: 160,
      reducedMotion: Boolean(host.data.reducedMotion),
    });
  }, 3000);
  timers.set(host, timer);
}
