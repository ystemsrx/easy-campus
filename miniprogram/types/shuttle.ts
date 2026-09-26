export interface GeoPoint {
  longitude: number;
  latitude: number;
}
export interface NamedPoint extends GeoPoint {
  name: string;
  shortName?: string;
}
export interface ShuttlePlace extends NamedPoint {
  id: string;
  aliases?: string[];
  category: string;
  routeIds: string[];
}
export interface ShuttleRoad {
  id: string;
  routeIds: string[];
  points: GeoPoint[];
  color: string;
  direction: "both" | "forward" | "backward";
}
export interface ShuttleRoute {
  id: string;
  name: string;
  color: string;
  stopIds: string[];
  orderedStops: { stopId: string; order: number }[];
}
export interface CampusShuttleMap {
  revision: string;
  crs: "gcj02";
  name: string;
  center: GeoPoint;
  scale: number;
  bounds: { southwest: GeoPoint; northeast: GeoPoint };
  paths: ShuttleRoad[];
  places: ShuttlePlace[];
  routes: ShuttleRoute[];
}
export interface ShuttleSelection {
  routeIds?: string[];
  routeId?: string;
  destinationId?: string;
  boardingId?: string;
  destinationPoint?: NamedPoint;
}
export interface ShuttleWalkingLeg {
  stopId: string;
  available: boolean;
  points?: GeoPoint[];
  meters?: number;
  seconds?: number;
  destination?: GeoPoint;
}
export interface ShuttleVehicle extends GeoPoint {
  id: string;
  vehicleNo: string;
  lineId: string;
  speed: number | null;
  direction: number | null;
  state: string;
  distance: number;
}
export interface LocationSample {
  captureSession: string;
  seq: number;
  clientTime: number;
  source: "preview" | "initial" | "change" | "resume";
  crs: "gcj02";
  raw: GeoPoint & Record<string, unknown>;
}
export interface SampleReceipt {
  captureSession: string;
  seq: number;
}
export interface ShuttleSnapshot {
  type: "snapshot";
  protocol: 2;
  serverTime: number;
  fetchedAt: number;
  stale: boolean;
  available: boolean;
  mapRevision: string;
  selectionValid: boolean;
  selection: ShuttleSelection & { routeIds: string[]; filtered: boolean };
  vehicles: ShuttleVehicle[];
  accepted?: SampleReceipt[];
}
export interface ShuttleMarker extends GeoPoint {
  id: number;
  iconPath: string;
  width: number;
  height: number;
  zIndex?: number;
  rotate?: number;
  alpha?: number;
  anchor?: { x: number; y: number };
  label?: {
    content: string;
    color: string;
    fontSize: number;
    bgColor?: string;
    borderRadius?: number;
    padding?: number;
    anchorX?: number;
    anchorY?: number;
    textAlign?: string;
  };
  callout?: {
    content: string;
    color?: string;
    fontSize?: number;
    bgColor?: string;
    borderRadius?: number;
    padding?: number;
    display?: string;
  };
}
export interface ShuttlePolyline {
  points: GeoPoint[];
  color: string;
  width: number;
  dottedLine?: boolean;
  arrowLine?: boolean;
  borderColor?: string;
  borderWidth?: number;
}
