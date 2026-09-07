import type {
  ElectricityCachedData,
  ElectricityQuery,
  QueryMeta,
} from "../types/api";
import { isUpstreamRefreshResult } from "../store/cache-policy";
import { teachingRequest } from "./request";
import type { TeachingResult } from "./teaching";

export function isElectricityQueryResult(meta: QueryMeta): boolean {
  return (
    isUpstreamRefreshResult(meta) ||
    (meta.shared === true && meta.stale !== true && meta.deleted !== true)
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
