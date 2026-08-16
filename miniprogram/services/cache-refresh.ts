import { loadExamsSnapshot, saveExamsSnapshot } from "../store/exams";
import { getSession } from "../store/session";
import type { Session } from "../types/api";
import { getExams } from "./teaching";

const EXAM_PAGE_SIZE = 50;
const examRefreshes = new Map<
  string,
  Promise<ReturnType<typeof loadExamsSnapshot>>
>();

/**
 * 每次真正登录只刷新一次默认学期考试。旧快照始终可以先渲染；调用方不必等待。
 */
export function refreshExamsAfterSignIn(
  session: Session | null = getSession(),
): Promise<ReturnType<typeof loadExamsSnapshot>> {
  if (!session) return Promise.resolve(null);
  const account = session.user.account;
  const current = loadExamsSnapshot(account);
  if (current?.refreshedForSignInAt === session.signedInAt) {
    return Promise.resolve(current);
  }

  const key = `${account}:${session.signedInAt}`;
  const active = examRefreshes.get(key);
  if (active) return active;

  const pending = getExams({ page: 1, pageSize: EXAM_PAGE_SIZE, refresh: true })
    .then((result) => {
      const latestSession = getSession();
      if (
        latestSession?.user.account !== account ||
        latestSession.signedInAt !== session.signedInAt
      ) {
        return null;
      }
      return saveExamsSnapshot(account, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
        refreshedForSignInAt: session.signedInAt,
      });
    })
    .catch(() => loadExamsSnapshot(account))
    .finally(() => examRefreshes.delete(key));
  examRefreshes.set(key, pending);
  return pending;
}
