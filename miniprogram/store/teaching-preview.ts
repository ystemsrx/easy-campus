import type { Notice, TeachingMessage, QueryMeta } from "../types/api";

const PREFIX = "easy-swu:teaching-preview:";
const MESSAGE_ITEM_LIMIT = 15;
const NOTICE_ITEM_LIMIT = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MESSAGE_SCHEMA_VERSION = 4;
const NOTICE_SCHEMA_VERSION = 3;
let teachingPreviewRevision = 0;

export function getTeachingPreviewRevision(): number {
  return teachingPreviewRevision;
}

export interface TeachingPreview {
  messageSchemaVersion: number;
  noticeSchemaVersion: number;
  messages: TeachingMessage[];
  notices: Notice[];
  updatedAt: number;
  lastCleanupAt: number;
  messageFetchedAt?: string;
  noticeFetchedAt?: string;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

export function loadTeachingPreview(account: string): TeachingPreview | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<TeachingPreview> | undefined;
  if (!value || typeof value !== "object") return null;
  const schemaMatches =
    Number(value.messageSchemaVersion) === MESSAGE_SCHEMA_VERSION;
  const noticeSchemaMatches =
    Number(value.noticeSchemaVersion) === NOTICE_SCHEMA_VERSION;
  const legacyMessages = Array.isArray(value.messages) ? value.messages : [];
  return {
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
    noticeSchemaVersion: NOTICE_SCHEMA_VERSION,
    messages: (schemaMatches
      ? legacyMessages
      : legacyMessages.filter(
          (message) =>
            !(
              message?.type === "course_rescheduled" ||
              message?.type === "makeup_class" ||
              message?.type === "course_cancelled" ||
              (message?.type === "other" &&
                /(?:调课|补课|停课)提醒/.test(
                  `${message.title || ""}${message.content || ""}`,
                ))
            ),
        )
    ).slice(0, MESSAGE_ITEM_LIMIT),
    notices:
      noticeSchemaMatches && Array.isArray(value.notices)
        ? value.notices.slice(0, NOTICE_ITEM_LIMIT)
        : [],
    updatedAt: Number(value.updatedAt) || 0,
    lastCleanupAt: Number(value.lastCleanupAt) || 0,
    ...(value.messageFetchedAt
      ? { messageFetchedAt: value.messageFetchedAt }
      : {}),
    ...(value.noticeFetchedAt
      ? { noticeFetchedAt: value.noticeFetchedAt }
      : {}),
  };
}

export function saveTeachingPreview(
  account: string,
  patch: Partial<Pick<TeachingPreview, "messages" | "notices">>,
  meta?: Pick<QueryMeta, "fetchedAt" | "deleted">,
): void {
  if (!account.trim()) return;
  const current = loadTeachingPreview(account) || {
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
    noticeSchemaVersion: NOTICE_SCHEMA_VERSION,
    messages: [],
    notices: [],
    updatedAt: 0,
    lastCleanupAt: 0,
  };
  const incomingAt = new Date(meta?.fetchedAt || 0).getTime();
  const accept = (timestamp?: string) =>
    !timestamp || incomingAt >= new Date(timestamp).getTime();
  const messages =
    patch.messages && accept(current.messageFetchedAt)
      ? patch.messages
      : current.messages;
  const notices =
    patch.notices && accept(current.noticeFetchedAt)
      ? patch.notices
      : current.notices;
  const messageFetchedAt =
    messages === patch.messages && meta?.fetchedAt
      ? meta.fetchedAt
      : current.messageFetchedAt;
  const noticeFetchedAt =
    notices === patch.notices && meta?.fetchedAt
      ? meta.fetchedAt
      : current.noticeFetchedAt;
  try {
    wx.setStorageSync(storageKey(account), {
      messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
      noticeSchemaVersion: NOTICE_SCHEMA_VERSION,
      messages: messages.slice(0, MESSAGE_ITEM_LIMIT),
      notices: notices.slice(0, NOTICE_ITEM_LIMIT),
      updatedAt: Date.now(),
      lastCleanupAt: current.lastCleanupAt,
      ...(messageFetchedAt ? { messageFetchedAt } : {}),
      ...(noticeFetchedAt ? { noticeFetchedAt } : {}),
    } satisfies TeachingPreview);
    teachingPreviewRevision += 1;
  } catch {
    // 本地预览只是加速层，写入失败时服务器持久快照仍然可用。
  }
}

export function cleanupTeachingPreview(
  account: string,
  now = Date.now(),
): TeachingPreview | null {
  const current = loadTeachingPreview(account);
  if (!current || now - current.lastCleanupAt < WEEK_MS) return current;
  const cleaned: TeachingPreview = {
    ...current,
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
    noticeSchemaVersion: NOTICE_SCHEMA_VERSION,
    messages: current.messages.slice(0, MESSAGE_ITEM_LIMIT),
    notices: current.notices.slice(0, NOTICE_ITEM_LIMIT),
    updatedAt: current.updatedAt,
    lastCleanupAt: now,
  };
  try {
    wx.setStorageSync(storageKey(account), cleaned);
  } catch {
    return current;
  }
  return cleaned;
}

export {
  MESSAGE_ITEM_LIMIT as TEACHING_MESSAGE_PREVIEW_ITEM_LIMIT,
  NOTICE_ITEM_LIMIT as SCHOOL_NOTICE_PREVIEW_ITEM_LIMIT,
};
