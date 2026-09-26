import { apiRequest } from "./request";
import { captureSessionLease } from "../store/session";

type Options = NonNullable<Parameters<typeof apiRequest>[1]>;
interface Gate {
  nextAt: number;
  failures: number;
  flight?: { key: string; promise: Promise<unknown> };
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
      const old = [...gates].find(([id, value]) => id !== key && !value.flight);
      if (old) gates.delete(old[0]);
    }
  }
  const requestKey = JSON.stringify(options.data);
  if (gate.flight && gate.flight.key === requestKey)
    return gate.flight.promise as Promise<T>;
  if (gate.flight || Date.now() < gate.nextAt)
    return Promise.reject(
      Object.assign(new Error("Map refresh deferred"), {
        statusCode: 429,
        code: "SHUTTLE_REFRESH_DEFERRED",
        retryAfterMs: Math.max(1000, gate.nextAt - Date.now()),
      }),
    );
  const interval =
    path.endsWith("/walking") || path.endsWith("/plans") ? 5000 : 0;
  gate.nextAt = Date.now() + interval;
  const current = gate;
  const promise = apiRequest<T>(path, {
    ...options,
    retry: false,
    rateLimitFeedback: false,
  })
    .then((result) => {
      current.failures = 0;
      return result;
    })
    .catch((error: { statusCode?: number; retryAfterMs?: number }) => {
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
    });
  current.flight = { key: requestKey, promise };
  return promise;
}
