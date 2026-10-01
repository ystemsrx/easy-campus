import type {
  ShuttleSelection as BaseSelection,
  ShuttleVehicle as BaseVehicle,
} from "../../types/shuttle";

export interface ShuttleBoardingVisit {
  routeId: string;
  stopId: string;
  serviceDirection?: number;
  serviceOrder?: number;
  platformHeading?: number;
}
export interface ShuttleArrival {
  board: ShuttleBoardingVisit;
  status: "waiting" | "approaching" | "passed" | "unconfirmed";
  seconds: number | null;
  stops?: number | null;
  departureSeconds?: number | null;
  text: string;
  detail: string;
  distance: number | null;
  source: "history" | "position" | "unknown";
}
export interface ShuttleSelection extends BaseSelection {
  boardingVisits?: ShuttleBoardingVisit[];
}
export interface ShuttleVehicle extends BaseVehicle {
  arrivals?: ShuttleArrival[];
}
