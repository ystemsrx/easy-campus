import { apiRequest } from "./request";
import { captureSessionLease } from "../store/session";

type Options = NonNullable<Parameters<typeof apiRequest>[1]>;
interface Gate {
  nextAt: number;
  failures: number;
  starts?: number[];
  flight?: { key: string; promise: Promise<unknown> };
  plans?: Map<string, Promise<unknown>>;
  serial?: number;
}
const gates = new Map<string, Gate>();
/** Background map work is coalesced and paced per account and endpoint. */
export function shuttleRequest<T>(
  path: string,
  options: Options = {},
): Promise<T> {
  const lease = captureSessionLease();
  const key = JSON.stringify([
    lease?.userId,
    lease?.signedInAt,
    path,
    options.method || "GET",
  ]);
  let gate = gates.get(key);
  if (!gate) {
    gate = { nextAt: 0, failures: 0 };
    gates.set(key, gate);
    if (gates.size > 64) {
      const old = [...gates].find(
        ([id, value]) => id !== key && !value.flight && !value.plans?.size,
      );
      if (old) gates.delete(old[0]);
    }
  }
  const requestKey = JSON.stringify(options.data);
  if (gate.flight && gate.flight.key === requestKey)
    return gate.flight.promise as Promise<T>;
  const planning = path.endsWith("/plans");
  const existing = planning ? gate.plans?.get(requestKey) : undefined;
  if (existing) return existing as Promise<T>;
  if (planning) {
    gate.starts = (gate.starts || []).filter((t) => Date.now() - t < 60000);
    // Match the server's 20/minute ceiling without imposing five seconds of
    // latency on every new destination. In-flight work remains coalesced.
    if (gate.starts.length >= 20)
      gate.nextAt = Math.max(gate.nextAt, gate.starts[0] + 60000);
  }
  if (
    gate.flight ||
    (planning && (gate.plans?.size || 0) >= 2) ||
    Date.now() < gate.nextAt
  )
    return Promise.reject(
      Object.assign(new Error("Map refresh deferred"), {
        statusCode: 429,
        code: "SHUTTLE_REFRESH_DEFERRED",
        retryAfterMs: Math.max(1000, gate.nextAt - Date.now()),
      }),
    );
  const interval = path.endsWith("/walking") ? 5000 : planning ? 1000 : 0;
  gate.nextAt = Date.now() + interval;
  if (planning) gate.starts!.push(Date.now());
  const current = gate;
  const serial = (current.serial = (current.serial || 0) + 1);
  const promise = apiRequest<T>(path, {
    ...options,
    retry: false,
    rateLimitFeedback: false,
  })
    .then((result) => {
      if (!planning || current.serial === serial) current.failures = 0;
      return result;
    })
    .catch((error: { statusCode?: number; retryAfterMs?: number }) => {
      // A superseded intent's network failure cannot delay the new destination.
      // Server rate limits still apply to the entire account/endpoint.
      if (planning && current.serial !== serial && error.statusCode !== 429)
        throw error;
      current.failures++;
      const delay =
        error.statusCode === 429 || error.statusCode === 404
          ? Math.max(60000, error.retryAfterMs || 0)
          : Math.min(60000, 5000 * 2 ** Math.min(4, current.failures - 1));
      current.nextAt = Date.now() + delay;
      throw error;
    })
    .finally(() => {
      if (current.flight?.promise === promise) current.flight = undefined;
      if (current.plans?.get(requestKey) === promise)
        current.plans.delete(requestKey);
    });
  if (planning) {
    current.plans ||= new Map();
    current.plans.set(requestKey, promise);
  } else current.flight = { key: requestKey, promise };
  return promise;
}
