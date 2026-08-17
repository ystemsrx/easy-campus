import type { Notice, TeachingMessage } from "../types/api";

const PREFIX = "easy-swu:teaching-preview:";
const ITEM_LIMIT = 15;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MESSAGE_SCHEMA_VERSION = 3;

export interface TeachingPreview {
  messageSchemaVersion: number;
  messages: TeachingMessage[];
  notices: Notice[];
  updatedAt: number;
  lastCleanupAt: number;
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
  const legacyMessages = Array.isArray(value.messages) ? value.messages : [];
  return {
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
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
    ).slice(0, ITEM_LIMIT),
    notices: Array.isArray(value.notices)
      ? value.notices.slice(0, ITEM_LIMIT)
      : [],
    updatedAt: Number(value.updatedAt) || 0,
    lastCleanupAt: Number(value.lastCleanupAt) || 0,
  };
}

export function saveTeachingPreview(
  account: string,
  patch: Partial<Pick<TeachingPreview, "messages" | "notices">>,
): void {
  if (!account.trim()) return;
  const current = loadTeachingPreview(account) || {
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
    messages: [],
    notices: [],
    updatedAt: 0,
    lastCleanupAt: 0,
  };
  try {
    wx.setStorageSync(storageKey(account), {
      messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
      messages: (patch.messages || current.messages).slice(0, ITEM_LIMIT),
      notices: (patch.notices || current.notices).slice(0, ITEM_LIMIT),
      updatedAt: Date.now(),
      lastCleanupAt: current.lastCleanupAt,
    } satisfies TeachingPreview);
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
    messageSchemaVersion: MESSAGE_SCHEMA_VERSION,
    messages: current.messages.slice(0, ITEM_LIMIT),
    notices: current.notices.slice(0, ITEM_LIMIT),
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

export { ITEM_LIMIT as TEACHING_PREVIEW_ITEM_LIMIT };
