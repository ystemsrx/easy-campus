import type { FeedbackType } from "../types/api";

const activeDrafts = new Map<string, unknown>();

export interface InteractionDrafts {
  feedback: { type: FeedbackType | ""; content: string };
  review: { rating: number; keywords: string[]; content: string };
  schedule: {
    title: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    endDirty: boolean;
  };
}

function draftKey(account: string, kind: keyof InteractionDrafts, id: string) {
  return `easy-swu:interaction-draft:v1:${encodeURIComponent(account)}:${kind}:${encodeURIComponent(id)}`;
}

export function loadInteractionDraft<K extends keyof InteractionDrafts>(
  account: string,
  kind: K,
  id = "",
): InteractionDrafts[K] | null {
  if (!account.trim()) return null;
  try {
    const key = draftKey(account, kind, id);
    const draft = (
      activeDrafts.has(key) ? activeDrafts.get(key) : wx.getStorageSync(key)
    ) as InteractionDrafts[K] | null;
    if (!draft || typeof draft !== "object") return null;
    if (kind === "schedule") {
      const value = draft as InteractionDrafts["schedule"];
      if (
        typeof value.title !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.endDate) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.endTime)
      )
        return null;
    } else if (
      typeof (draft as InteractionDrafts["feedback"]).content !== "string"
    )
      return null;
    if (kind === "review") {
      const value = draft as InteractionDrafts["review"];
      if (
        !Number.isInteger(value.rating) ||
        value.rating < 0 ||
        value.rating > 5 ||
        !Array.isArray(value.keywords) ||
        value.keywords.length > 5 ||
        value.keywords.some((key: unknown) => typeof key !== "string")
      )
        return null;
    }
    return draft as InteractionDrafts[K];
  } catch {
    return null;
  }
}

export function saveInteractionDraft<K extends keyof InteractionDrafts>(
  account: string,
  kind: K,
  draft: InteractionDrafts[K],
  id = "",
): void {
  if (!account.trim()) return;
  const key = draftKey(account, kind, id);
  activeDrafts.set(key, draft);
  try {
    wx.setStorageSync(key, draft);
  } catch {
    // Keep the current form intact if local storage is temporarily unavailable.
  }
}

export function clearInteractionDraft(
  account: string,
  kind: keyof InteractionDrafts,
  id = "",
): void {
  if (!account.trim()) return;
  const key = draftKey(account, kind, id);
  activeDrafts.set(key, null);
  try {
    wx.removeStorageSync(key);
  } catch {
    /* Form remains usable. */
  }
}
