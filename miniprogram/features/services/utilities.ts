import type { ElectricityBuildingsData } from "../../types/api";
import { apiRequest } from "../../services/request";

export function getElectricityBuildings(): Promise<ElectricityBuildingsData> {
  return apiRequest<ElectricityBuildingsData>(
    "/utilities/electricity/buildings",
    { retry: false },
  );
}
