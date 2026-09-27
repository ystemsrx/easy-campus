import type { ShuttleRoute } from "../../types/shuttle";

export function routeNames(routes: Pick<ShuttleRoute, "name">[]): string {
  const numbers = new Set<number>(),
    others = new Set<string>();
  for (const { name } of routes) {
    const match = /^(\d+)号线$/.exec(name.trim());
    if (match) numbers.add(Number(match[1]));
    else others.add(name.trim());
  }
  return [
    ...(numbers.size
      ? [
          [...numbers].sort((a, b) => a - b).join("/") +
            (numbers.size > 1 ? " 号线" : "号线"),
        ]
      : []),
    ...others,
  ].join(" / ");
}
