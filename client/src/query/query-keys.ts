import type { ContentFacetsParams } from '@client/src/api/content';

/**
 * 归一化 facets 查询参数，保证等价筛选得到同一个 query key。
 * 空串/undefined 不参与，值统一 trim 后按键名排序。
 */
export function normalizeContentParams(params: ContentFacetsParams = {}) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    const trimmed = String(value).trim();
    if (trimmed) normalized[key] = trimmed;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)));
}

export const contentKeys = {
  all: ['content'] as const,
  detail: (docId: string, includePending = false) => ['content', 'detail', docId, includePending] as const,
  facets: (params: ContentFacetsParams = {}) => ['content', 'facets', normalizeContentParams(params)] as const,
};

export const insightKeys = {
  all: ['insight'] as const,
  mechanisms: (params: { search?: string; type?: string } = {}) => {
    const search = params.search?.trim() || '';
    const type = params.type?.trim() || '';
    return ['insight', 'mechanisms', { search, type }] as const;
  },
  mechanismTrends: () => ['insight', 'mechanisms', 'trends'] as const,
  /** 两个指数列的 Base 字段描述（悬停提示用）；全站共用一份。 */
  mechanismScoreHints: () => ['insight', 'mechanisms', 'score-hints'] as const,
  mechanismDetail: (stableKey: string) =>
    ['insight', 'mechanisms', 'detail', stableKey] as const,
  coverage: () => ['insight', 'coverage'] as const,
};

export const favoriteKeys = {
  all: ['favorites'] as const,
  list: (userScope: string) => ['favorites', 'list', userScope] as const,
  pages: ['favorites', 'page'] as const,
  page: (params: { limit: number; offset: number }) =>
    ['favorites', 'page', params.limit, params.offset] as const,
};

export const adminKeys = {
  all: ['admin'] as const,
};
