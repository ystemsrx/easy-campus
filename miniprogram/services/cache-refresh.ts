import {
  getElectricityAccount,
  queryElectricity,
} from "../features/services/utilities";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  THREE_DAYS_MS,
} from "../store/cache-policy";
import {
  loadElectricitySnapshot,
  saveElectricitySnapshot,
  type ElectricitySnapshot,
} from "../store/electricity";
import { loadExamsSnapshot, saveExamsSnapshot } from "../store/exams";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../store/session";
import type { Session } from "../types/api";
import { getExams } from "./teaching";

const EXAM_PAGE_SIZE = 50;
export const EXAMS_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const examRefreshes = new Map<
  string,
  Promise<ReturnType<typeof loadExamsSnapshot>>
>();
const electricityRefreshes = new Map<
  string,
  Promise<ElectricitySnapshot | null>
>();

/**
 * 首页进入前台时先保留本地余额，再同步服务端绑定；快照满三天后才查询校园能源。
 */
export function refreshElectricityOnForeground(
  session: Session | null = getSession(),
): Promise<ElectricitySnapshot | null> {
  if (!session) return Promise.resolve(null);
  const lease = captureSessionLease(session);
  if (!lease) return Promise.resolve(null);

  const key = sessionLeaseKey(lease);
  const active = electricityRefreshes.get(key);
  if (active) return active;
  if (!claimAutomaticRefresh("electricity", lease.account)) {
    return Promise.resolve(loadElectricitySnapshot(lease.account));
  }

  const pending = (async () => {
    let current = loadElectricitySnapshot(lease.account);
    try {
      const result = await getElectricityAccount();
      if (!isSessionLeaseCurrent(lease)) return null;
      const serverBindingCleared = !result.data.binding && !result.data.account;
      if (
        serverBindingCleared ||
        shouldUseServerSnapshot(current, result.meta.fetchedAt)
      ) {
        current = saveElectricitySnapshot(
          lease.account,
          result.data,
          result.meta.fetchedAt,
        );
      }
    } catch {
      if (!isSessionLeaseCurrent(lease)) return null;
      // 服务端快照读取失败时仍可按本地绑定尝试到期刷新。
    }

    if (!current?.data.binding || !isCacheStale(current, THREE_DAYS_MS)) {
      return current;
    }
    const binding = current.data.binding;
    const roomNumber = /^\d{3}$/.test(binding.roomNumber)
      ? `0${binding.roomNumber}`
      : binding.roomNumber;
    try {
      const result = await queryElectricity({
        buildingId: binding.buildingId,
        buildingName: binding.buildingName,
        roomNumber,
      });
      if (!isSessionLeaseCurrent(lease)) return null;
      return saveElectricitySnapshot(
        lease.account,
        result.data,
        result.meta.fetchedAt,
      );
    } catch {
      return isSessionLeaseCurrent(lease)
        ? loadElectricitySnapshot(lease.account)
        : null;
    }
  })().finally(() => electricityRefreshes.delete(key));
  electricityRefreshes.set(key, pending);
  return pending;
}

/**
 * 判断考试自动刷新是否已超过 24 小时间隔。没有成功记录时立即刷新。
 */
export function isExamAutomaticRefreshDue(
  lastAutomaticRefreshAt: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(lastAutomaticRefreshAt) || lastAutomaticRefreshAt <= 0) {
    return true;
  }
  if (!Number.isFinite(now) || now <= lastAutomaticRefreshAt) return false;
  return now - lastAutomaticRefreshAt > EXAMS_AUTO_REFRESH_INTERVAL_MS;
}

/**
 * 每次进入小程序前台时检查默认学期考试，距上次成功自动刷新超过 24 小时才刷新。
 * 旧快照始终可以先渲染；手动刷新不经过此入口，也不会被这里的间隔限制。
 */
export function refreshExamsOnForeground(
  session: Session | null = getSession(),
): Promise<ReturnType<typeof loadExamsSnapshot>> {
  if (!session) return Promise.resolve(null);
  const lease = captureSessionLease(session);
  if (!lease) return Promise.resolve(null);
  const account = session.user.account;
  const current = loadExamsSnapshot(account);
  if (!isExamAutomaticRefreshDue(current?.lastAutomaticRefreshAt || 0)) {
    return Promise.resolve(current);
  }

  const key = sessionLeaseKey(lease);
  const active = examRefreshes.get(key);
  if (active) return active;

  const pending = getExams({ page: 1, pageSize: EXAM_PAGE_SIZE, refresh: true })
    .then((result) => {
      if (!isSessionLeaseCurrent(lease)) {
        return null;
      }
      return saveExamsSnapshot(account, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
        lastAutomaticRefreshAt: Date.now(),
      });
    })
    .catch(() =>
      isSessionLeaseCurrent(lease) ? loadExamsSnapshot(account) : null,
    )
    .finally(() => examRefreshes.delete(key));
  examRefreshes.set(key, pending);
  return pending;
}
