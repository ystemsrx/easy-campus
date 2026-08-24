export interface RefreshFlight<T> {
  id: number;
  key: string;
  completion: Promise<T>;
}

export interface RefreshFlightStart<T> {
  flight: RefreshFlight<T>;
  started: boolean;
}

const activeRefreshFlights = new Map<string, RefreshFlight<unknown>>();
let refreshFlightSequence = 0;
let refreshPageSequence = 0;
const visibleRefreshPages = new Set<number>();

export function createRefreshPageToken(): number {
  return ++refreshPageSequence;
}

export function markRefreshPageVisible(token: number): void {
  if (token > 0) visibleRefreshPages.add(token);
}

export function markRefreshPageHidden(token: number): void {
  visibleRefreshPages.delete(token);
}

export function isRefreshPageVisible(token: number): boolean {
  return token > 0 && visibleRefreshPages.has(token);
}

export function findRefreshFlight<T>(key: string): RefreshFlight<T> | null {
  return (
    (activeRefreshFlights.get(key) as RefreshFlight<T> | undefined) || null
  );
}

export function startRefreshFlight<T>(
  key: string,
  task: () => Promise<T>,
): RefreshFlightStart<T> {
  const existing = findRefreshFlight<T>(key);
  if (existing) return { flight: existing, started: false };

  const flight = {
    id: ++refreshFlightSequence,
    key,
    completion: Promise.resolve(undefined as T),
  } as RefreshFlight<T>;
  const completion = Promise.resolve()
    .then(task)
    .finally(() => {
      if (activeRefreshFlights.get(key) === flight) {
        activeRefreshFlights.delete(key);
      }
    });
  flight.completion = completion;
  activeRefreshFlights.set(key, flight as RefreshFlight<unknown>);
  return { flight, started: true };
}
