import type {
  ElectricityBuildingsData,
  ElectricityCachedData,
  ElectricityQuery,
} from "../../types/api";
import { apiRequest, teachingRequest } from "../../services/request";
import type { TeachingResult } from "../../services/teaching";

export function getElectricityBuildings(): Promise<ElectricityBuildingsData> {
  return apiRequest<ElectricityBuildingsData>(
    "/utilities/electricity/buildings",
    { retry: false },
  );
}

export function queryElectricity(
  query: ElectricityQuery,
): Promise<TeachingResult<ElectricityCachedData>> {
  return teachingRequest<ElectricityCachedData>(
    "/utilities/electricity/query",
    {
      method: "POST",
      data: query,
      retry: false,
    },
  );
}

export function getElectricityAccount(): Promise<
  TeachingResult<ElectricityCachedData>
> {
  return teachingRequest<ElectricityCachedData>(
    "/utilities/electricity/account",
    { retry: false },
  );
}
