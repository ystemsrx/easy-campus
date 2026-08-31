import type { ElectricityCachedData, ElectricityQuery } from "../types/api";
import { teachingRequest } from "./request";
import type { TeachingResult } from "./teaching";

export function queryElectricity(
  query: ElectricityQuery,
): Promise<TeachingResult<ElectricityCachedData>> {
  return teachingRequest<ElectricityCachedData>(
    "/utilities/electricity/query",
    {
      method: "POST",
      data: query,
      retry: false,
      credentialReauthFeedback: true,
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
