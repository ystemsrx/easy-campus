export type QueryValue =
  string | number | boolean | Array<string | number> | undefined | null;

export function buildQuery(values: Record<string, QueryValue>): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const serialized = Array.isArray(value) ? value.join(",") : String(value);
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(serialized)}`);
  }

  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}
