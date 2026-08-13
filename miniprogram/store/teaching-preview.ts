import type { Notice, TeachingMessage } from "../types/api";

const PREFIX = "easy-swu:teaching-preview:";
const ITEM_LIMIT = 3;

export interface TeachingPreview {
  messages: TeachingMessage[];
  notices: Notice[];
  updatedAt: number;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

export function loadTeachingPreview(account: string): TeachingPreview | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<TeachingPreview> | undefined;
  if (!value || typeof value !== "object") return null;
  return {
    messages: Array.isArray(value.messages)
      ? value.messages.slice(0, ITEM_LIMIT)
      : [],
    notices: Array.isArray(value.notices)
      ? value.notices.slice(0, ITEM_LIMIT)
      : [],
    updatedAt: Number(value.updatedAt) || 0,
  };
}

export function saveTeachingPreview(
  account: string,
  patch: Partial<Pick<TeachingPreview, "messages" | "notices">>,
): void {
  if (!account.trim()) return;
  const current = loadTeachingPreview(account) || {
    messages: [],
    notices: [],
    updatedAt: 0,
  };
  try {
    wx.setStorageSync(storageKey(account), {
      messages: (patch.messages || current.messages).slice(0, ITEM_LIMIT),
      notices: (patch.notices || current.notices).slice(0, ITEM_LIMIT),
      updatedAt: Date.now(),
    } satisfies TeachingPreview);
  } catch {
    // 本地预览只是加速层，写入失败时服务器持久快照仍然可用。
  }
}

export { ITEM_LIMIT as TEACHING_PREVIEW_ITEM_LIMIT };
