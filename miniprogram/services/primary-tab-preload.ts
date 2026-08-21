import { prewarmScheduleFirstScreen } from "../data/schedule-render";
import { shouldUseServerSnapshot, timestampValue } from "../store/cache-policy";
import { loadScheduleData, storeScheduleData } from "../store/schedule";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../store/session";
import {
  loadTimetableSnapshot,
  saveTimetableSnapshot,
} from "../store/timetable";
import type {
  CurrentUserData,
  LocalScheduleData,
  Session,
  TimetableData,
} from "../types/api";
import { getCurrentUser } from "./auth";
import {
  getLocalSchedule,
  getTimetable,
  putLocalSchedule,
  type TeachingResult,
} from "./teaching";

interface PrimaryTabPreloadState {
  key: string;
  account: string;
  lease: SessionLease;
  timetable: TimetableData | null;
  timetableStoredAt: number;
  schedule: LocalScheduleData;
  userPromise: Promise<CurrentUserData | null>;
  timetablePromise: Promise<TeachingResult<TimetableData> | null>;
  schedulePromise: Promise<LocalScheduleData>;
}

let activeState: PrimaryTabPreloadState | null = null;

function preloadKey(session: Session): string {
  let foregroundEntryId = 0;
  try {
    foregroundEntryId = getApp<IAppOption>().globalData.foregroundEntryId;
  } catch {
    // 单元检查或应用初始化早期没有 App 实例时，登录时间仍可隔离账号会话。
  }
  const lease = captureSessionLease(session);
  if (!lease) return "";
  return `${sessionLeaseKey(lease)}:${foregroundEntryId}`;
}

function isActive(state: PrimaryTabPreloadState): boolean {
  return activeState === state && isSessionLeaseCurrent(state.lease);
}

function warmSchedule(
  state: PrimaryTabPreloadState,
  refreshStoredSources = true,
): void {
  if (!isActive(state)) return;
  try {
    if (refreshStoredSources) {
      const timetable = loadTimetableSnapshot(state.account);
      if (timetable && timetable.localStoredAt > state.timetableStoredAt) {
        state.timetable = timetable.data;
        state.timetableStoredAt = timetable.localStoredAt;
      }
      const schedule = loadScheduleData(state.account);
      if (
        timestampValue(schedule.clientUpdatedAt || undefined) >=
        timestampValue(state.schedule.clientUpdatedAt || undefined)
      ) {
        state.schedule = schedule;
      }
    }
    prewarmScheduleFirstScreen(state.account, state.timetable, state.schedule, {
      timetableStoredAt: state.timetableStoredAt,
    });
  } catch {
    // 预构建失败时，日程页仍会使用相同的本地数据即时构建。
  }
}

async function preloadTimetable(
  state: PrimaryTabPreloadState,
): Promise<TeachingResult<TimetableData>> {
  const result = await getTimetable();
  if (!isActive(state)) return result;
  const local = loadTimetableSnapshot(state.account);
  let current = local;
  if (shouldUseServerSnapshot(local, result.meta.fetchedAt)) {
    current =
      saveTimetableSnapshot(state.account, result.data, {
        serverFetchedAt: result.meta.fetchedAt,
      }) || local;
  }
  state.timetable = current?.data || result.data;
  state.timetableStoredAt = current?.localStoredAt || 0;
  warmSchedule(state);
  return result;
}

async function preloadSchedule(
  state: PrimaryTabPreloadState,
): Promise<LocalScheduleData> {
  const result = await getLocalSchedule();
  if (!isActive(state)) return state.schedule;

  const local = loadScheduleData(state.account);
  let resolved = local;
  if (local.clientUpdatedAt) {
    if (JSON.stringify(local) !== JSON.stringify(result.data)) {
      await putLocalSchedule(local);
    }
  } else if (result.data.clientUpdatedAt || result.data.plans.length) {
    resolved = storeScheduleData(state.account, result.data);
  }

  if (isActive(state)) {
    state.schedule = resolved;
    warmSchedule(state);
  }
  return resolved;
}

function startPreload(session: Session): PrimaryTabPreloadState {
  const lease = captureSessionLease(session);
  if (!lease) {
    throw new Error("无法为无效登录创建预加载任务。");
  }
  const account = session.user.account;
  const timetableSnapshot = loadTimetableSnapshot(account);
  const timetable = timetableSnapshot?.data || null;
  const schedule = loadScheduleData(account);
  const state: PrimaryTabPreloadState = {
    key: preloadKey(session),
    account,
    lease,
    timetable,
    timetableStoredAt: timetableSnapshot?.localStoredAt || 0,
    schedule,
    userPromise: Promise.resolve(null),
    timetablePromise: Promise.resolve(null),
    schedulePromise: Promise.resolve(schedule),
  };
  activeState = state;
  warmSchedule(state, false);

  state.userPromise = getCurrentUser();
  state.timetablePromise = preloadTimetable(state);
  state.schedulePromise = preloadSchedule(state);
  void state.userPromise.catch(() => undefined);
  void state.timetablePromise.catch(() => undefined);
  void state.schedulePromise.catch(() => undefined);
  return state;
}

function ensurePreload(
  session: Session | null = getSession(),
): PrimaryTabPreloadState | null {
  if (!session) return null;
  const key = preloadKey(session);
  return activeState?.key === key ? activeState : startPreload(session);
}

/** 每次进入小程序前台时，为“我的”和“日程”启动一次静默预加载。 */
export function preloadPrimaryTabs(
  session: Session | null = getSession(),
): void {
  ensurePreload(session);
}

/** 页面与首页共享本次前台周期的个人资料请求，避免首次切换时重复加载。 */
export function getPreloadedCurrentUser(
  refresh = false,
): Promise<CurrentUserData | null> {
  const state = ensurePreload();
  if (!state) return Promise.resolve(null);
  if (refresh) {
    state.userPromise = getCurrentUser();
    void state.userPromise.catch(() => undefined);
  }
  return state.userPromise;
}

/** 页面复用启动阶段的课表请求；刷新请求仍由页面显式发起。 */
export function getPreloadedTimetable(): Promise<TeachingResult<TimetableData> | null> {
  return ensurePreload()?.timetablePromise || Promise.resolve(null);
}

/** 页面复用启动阶段的日程同步，完成后返回最终采用的本地数据。 */
export function getPreloadedSchedule(): Promise<LocalScheduleData> {
  const state = ensurePreload();
  return (
    state?.schedulePromise ||
    Promise.resolve({ plans: [], clientUpdatedAt: null })
  );
}
