"use strict";
// Public, reviewed campus geometry only. No location observations or vehicle IDs.
const fs = require("node:fs");
const path = require("node:path");
const { CampusMapStore } = require("../../backend/src/shuttle/map-store");
const { BehaviorModel } = require("../../backend/src/shuttle/behavior-model");
const { publicTrack } = require("../../backend/src/shuttle/public-geometry");
const { network, ...source } = new CampusMapStore().refresh();
const model = new BehaviorModel({ ...source, network });
model.seed = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/data/shuttle-behavior-seed.json"),
    "utf8",
  ),
).stats;
const place = (p) => {
  const { roadNodes, ...publicPlace } = p;
  return publicPlace;
};
const demo = {
  ...source,
  revision: `demo-${source.revision}`,
  places: source.places.map(place),
  paths: source.paths.map(
    ({ id, routeIds, points, direction, directionByRoute }) => ({
      id,
      routeIds,
      points,
      direction,
      directionByRoute,
      color: "#4D8DB6",
    }),
  ),
  serviceTracks: Object.fromEntries(
    source.routes.map((r) => [
      r.id,
      model
        .patterns(r.id, Date.parse("2026-09-30T12:00:00+08:00"))
        .slice(0, 2)
        .map((t) => {
          const track = publicTrack(t);
          return {
            ...track,
            stops: track.stops.map((s) => ({ ...s, place: place(s.place) })),
          };
        }),
    ]),
  ),
};
const points = [],
  lookup = new Map();
const point = (p) => {
  const xy = [
    Math.round((p.longitude - 106) * 1e7),
    Math.round((p.latitude - 29) * 1e7),
  ];
  const k = xy.join(",");
  if (!lookup.has(k)) {
    lookup.set(k, points.length);
    points.push(xy);
  }
  return lookup.get(k);
};
const ids = demo.places.map((p) => p.id);
const packed = {
  revision: demo.revision,
  center: point(demo.center),
  scale: demo.scale,
  bounds: [point(demo.bounds.southwest), point(demo.bounds.northeast)],
  places: demo.places.map((p, i) => [
    `demo-place-${i}`,
    p.name,
    p.shortName || "",
    p.category,
    p.routeIds,
    point(p),
    p.platformHeading ?? null,
  ]),
  paths: demo.paths.map((p) => [
    p.id,
    p.routeIds,
    p.points.map(point),
    p.direction,
  ]),
  routes: demo.routes.map((r) => [
    r.id,
    r.name,
    r.color,
    r.stopIds.map((id) => ids.indexOf(id)),
    r.orderedStops.map((s) => [ids.indexOf(s.stopId), s.order]),
  ]),
  tracks: Object.fromEntries(
    Object.entries(demo.serviceTracks).map(([id, tracks]) => [
      id,
      tracks.map((t) => [
        t.id,
        t.points.map(point),
        t.stops.map((s) => [ids.indexOf(s.place.id), s.at, s.order]),
        t.loop,
      ]),
    ]),
  ),
  points,
};
packed.points = points
  .map((xy, i) =>
    xy.map((n, j) => (n - (i ? points[i - 1][j] : 0)).toString(36)).join(","),
  )
  .join(";");
fs.writeFileSync(
  path.resolve(__dirname, "../miniprogram/demo/shuttle-map.ts"),
  "// Generated public geometry; coordinate quantization below 2 cm. No personal data.\n" +
    `export const packedDemoMap = ${JSON.stringify(packed)};\n`,
);
console.log(
  `Packed demo map: ${Buffer.byteLength(JSON.stringify(packed))} bytes`,
);
