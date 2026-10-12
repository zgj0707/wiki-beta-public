/**
 * 本地收藏（localStorage）：无用户体系阶段的轻量收藏边界。
 * 数据结构仅存 docId 列表；跨组件同步用 window 事件广播。
 */

const STORAGE_KEY = 'wiki-beta:favorites';

export const FAVORITES_CHANGED = 'wiki-beta:favorites-changed';

function readStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

function writeStorage(docIds: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(docIds));
  } catch {
    // 存储不可用（隐私模式/超限）时静默失败，收藏视为不可持久化。
  }
}

function notifyChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FAVORITES_CHANGED));
}

export function getFavoriteIds(): string[] {
  return readStorage();
}

export function isFavorite(docId: string): boolean {
  return readStorage().includes(docId);
}

/** 切换收藏状态并广播变更；返回切换后的状态（true=已收藏）。 */
export function toggleFavorite(docId: string): boolean {
  const ids = readStorage();
  const index = ids.indexOf(docId);
  const next = index >= 0
    ? ids.filter((id) => id !== docId)
    : [...ids, docId];
  writeStorage(next);
  notifyChanged();
  return index < 0;
}

export function onFavoritesChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(FAVORITES_CHANGED, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(FAVORITES_CHANGED, callback);
    window.removeEventListener('storage', callback);
  };
}
