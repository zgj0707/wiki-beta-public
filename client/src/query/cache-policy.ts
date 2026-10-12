export const PUBLIC_CACHE_SCHEMA = 'public-approved-v1';

export type QueryClassification = 'PUBLIC_APPROVED' | 'USER_SCOPED' | 'ADMIN_STRONG';

export const cachePolicy = {
  publicList: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 1 },
  publicDetail: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1 },
  publicStats: { staleTime: 120_000, gcTime: 30 * 60_000, retry: 1 },
  favorites: { staleTime: 0, gcTime: 10 * 60_000, retry: 1 },
  adminQueue: { staleTime: 0, gcTime: 5 * 60_000, retry: 0 },
} as const;

export function queryMeta(classification: QueryClassification = 'PUBLIC_APPROVED') {
  return { classification, cacheSchema: PUBLIC_CACHE_SCHEMA } as const;
}
