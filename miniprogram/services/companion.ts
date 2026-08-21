import {
  hasStoredPetPreferences,
  loadPetPreferences,
  storeServerPetPreferences,
  type PetPreferences,
} from "../store/pet";
import type { CompanionPreferencesData } from "../types/api";
import { apiRequest } from "./request";
import { captureSessionLease, isSessionLeaseCurrent } from "../store/session";

type CompanionPreferencesInput = Omit<CompanionPreferencesData, "updatedAt">;

const uploadQueues = new Map<
  string,
  Promise<CompanionPreferencesData | null>
>();

function inputFromLocal(
  preferences: PetPreferences,
): CompanionPreferencesInput {
  return {
    selected: preferences.selected,
    skipped: preferences.skipped,
    enabled: preferences.enabled,
    enhanced: preferences.enhanced,
    shape: preferences.shape,
    color: preferences.color,
  };
}

function samePreferences(
  local: PetPreferences,
  server: CompanionPreferencesData | null,
): boolean {
  if (!server) return false;
  const input = inputFromLocal(local);
  return (
    input.selected === server.selected &&
    input.skipped === server.skipped &&
    input.enabled === server.enabled &&
    input.enhanced === server.enhanced &&
    input.shape === server.shape &&
    input.color === server.color.toLowerCase()
  );
}

function dataFromLocal(preferences: PetPreferences): CompanionPreferencesData {
  return {
    ...inputFromLocal(preferences),
    updatedAt: preferences.updatedAt
      ? new Date(preferences.updatedAt).toISOString()
      : null,
  };
}

async function putLocalPreferences(
  preferences: PetPreferences,
): Promise<CompanionPreferencesData> {
  return apiRequest<CompanionPreferencesData>("/auth/companion", {
    method: "PUT",
    data: inputFromLocal(preferences),
    retry: false,
  });
}

function queueLocalCompanionPreferences(
  account: string,
  joinCurrent: boolean,
): Promise<CompanionPreferencesData | null> {
  if (!account || !hasStoredPetPreferences(account)) {
    return Promise.resolve(null);
  }
  const current = uploadQueues.get(account);
  if (joinCurrent && current) return current;
  const previous = current || Promise.resolve(null);
  const queued = previous
    .catch(() => null)
    .then(async () => {
      const lease = captureSessionLease();
      if (!lease || lease.account !== account) return null;
      const local = loadPetPreferences(account);
      const saved = await putLocalPreferences(local);
      if (
        isSessionLeaseCurrent(lease) &&
        samePreferences(loadPetPreferences(account), saved)
      ) {
        storeServerPetPreferences(account, saved);
      }
      return isSessionLeaseCurrent(lease) ? saved : null;
    })
    .catch(() => null)
    .finally(() => {
      if (uploadQueues.get(account) === queued) uploadQueues.delete(account);
    });
  uploadQueues.set(account, queued);
  return queued;
}

/**
 * 本机记录始终优先；只有本机从未保存过伙伴设置时才接收服务端副本。
 */
export async function synchronizeCompanionPreferences(
  account: string,
  server: CompanionPreferencesData | null,
): Promise<CompanionPreferencesData | null> {
  if (!account) return server;
  const lease = captureSessionLease();
  if (!lease || lease.account !== account) return null;
  if (!hasStoredPetPreferences(account)) {
    if (server && isSessionLeaseCurrent(lease)) {
      storeServerPetPreferences(account, server);
    }
    return server;
  }

  const local = loadPetPreferences(account);
  if (samePreferences(local, server)) return server;
  const saved = await queueLocalCompanionPreferences(account, true);
  if (!isSessionLeaseCurrent(lease)) return null;
  return saved || dataFromLocal(local);
}

/** 将刚写入本地的最新设置串行同步，避免快速切换形状时旧请求反向覆盖。 */
export function uploadLocalCompanionPreferences(account: string): void {
  void queueLocalCompanionPreferences(account, false);
}
