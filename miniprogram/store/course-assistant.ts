const FAVORITES_PREFIX = "easy-swu:course-assistant:favorites:";

function storageKey(account: string): string {
  return `${FAVORITES_PREFIX}${encodeURIComponent(account.trim())}`;
}

export function loadCourseAssistantFavorites(account: string): string[] {
  if (!account.trim()) return [];
  const stored = wx.getStorageSync(storageKey(account)) as unknown;
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.map(String).filter(isCourseKey))];
}

export function toggleCourseAssistantFavorite(
  account: string,
  courseKey: string,
): string[] {
  const favorites = new Set(loadCourseAssistantFavorites(account));
  if (favorites.has(courseKey)) favorites.delete(courseKey);
  else favorites.add(courseKey);
  const result = [...favorites];
  wx.setStorageSync(storageKey(account), result);
  return result;
}

function isCourseKey(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
