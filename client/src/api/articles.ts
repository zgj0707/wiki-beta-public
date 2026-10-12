import { queryOptions } from '@tanstack/react-query';
import {
  backendGet,
  PUBLIC_READ_REVALIDATION_CONFIG,
} from './backend';
import { withClientBasePath } from '@client/src/lib/base-path';
import type {
  ArticleDetailData,
  ArticleListItem,
} from '@client/src/types/content';
import { cachePolicy, queryMeta } from '@client/src/query/cache-policy';

/**
 * 文章库/文章详情公开数据访问层：对接新 /api/articles 契约。
 * 查询选项与 fetcher 同文件维护（与 query/public-queries 的拆分仅是位置差异），
 * 供 content-loaders 预取与页面 useQuery 共用同一 query key。
 */

export interface FetchArticleListParams {
  search?: string;
  /** 玩法分类名（Base 原文）；传父项名命中其自身与全部子项。 */
  gameplayCategory?: string;
  /** 内容类型原文（深度报告 / 快讯转载 / 竞品周报）。 */
  contentType?: string;
  /** 来源发布方（Base「发布方」列原文）。 */
  sourcePublisher?: string;
  limit?: number;
  offset?: number;
  /** 时间窗天数（1/7/30/180）；按「飞书来源日期」过滤，无日期记录被排除。 */
  days?: number;
  order?: 'asc' | 'desc';
}

export interface FetchArticleListResult {
  items: ArticleListItem[];
  total: number;
  nextCursor: number | null;
}

export async function fetchArticleList(
  params: FetchArticleListParams = {},
): Promise<FetchArticleListResult> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.gameplayCategory)
    qs.set('gameplayCategory', params.gameplayCategory);
  if (params.contentType) qs.set('contentType', params.contentType);
  if (params.sourcePublisher)
    qs.set('sourcePublisher', params.sourcePublisher);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.days) qs.set('days', String(params.days));
  if (params.order) qs.set('order', params.order);

  const data = await backendGet<Partial<FetchArticleListResult>>(
    `/api/articles?${qs.toString()}`,
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    nextCursor: data?.nextCursor ?? null,
  };
}

export async function fetchArticleDetail(
  docId: string,
): Promise<ArticleDetailData | null> {
  try {
    return (
      (await backendGet<ArticleDetailData | null>(
        `/api/articles/${encodeURIComponent(docId)}`,
      )) ?? null
    );
  } catch {
    return null;
  }
}

export const articleListQuery = (params: FetchArticleListParams = {}) =>
  queryOptions({
    queryKey: ['articles', 'list', { ...params }] as const,
    queryFn: () => fetchArticleList(params),
    ...cachePolicy.publicList,
    meta: queryMeta(),
  });

export const articleDetailQuery = (docId: string) =>
  queryOptions({
    queryKey: ['articles', 'detail', docId] as const,
    queryFn: () => fetchArticleDetail(docId),
    enabled: Boolean(docId),
    ...cachePolicy.publicDetail,
    meta: queryMeta(),
  });
