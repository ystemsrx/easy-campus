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
