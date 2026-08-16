import type {
  ElectricityAccount,
  ElectricityBuildingsData,
  ElectricityQuery,
} from "../types/api";
import { apiRequest } from "./request";

export function getElectricityBuildings(): Promise<ElectricityBuildingsData> {
  return apiRequest<ElectricityBuildingsData>(
    "/utilities/electricity/buildings",
    { retry: false },
  );
}

export function queryElectricity(
  query: ElectricityQuery,
): Promise<ElectricityAccount> {
  return apiRequest<ElectricityAccount>("/utilities/electricity/query", {
    method: "POST",
    data: query,
    retry: false,
  });
}
