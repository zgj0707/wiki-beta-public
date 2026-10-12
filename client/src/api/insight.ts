import { queryOptions } from '@tanstack/react-query';
import {
  backendGet,
  PUBLIC_READ_REVALIDATION_CONFIG,
} from './backend';
import type {
  CoverageData,
  MechanismDetailData,
  MechanismListItem,
  MechanismTrendItem,
} from '@client/src/types/insight';
import { cachePolicy, queryMeta } from '@client/src/query/cache-policy';
import { insightKeys } from '@client/src/query/query-keys';

/**
 * 机制观察/结论/数据中心公开数据访问层：对接新 insight API 契约。
 * 查询选项与 fetcher 同文件维护（与 articles.ts 模式一致），
 * 供 insight-loaders 预取与页面 useQuery 共用同一 query key。
 * v2 实体链路退场（2026-10-09）：/api/entities 系列已下线，实体相关
 * fetcher/query 移除；实体数据仍经后台投影服务喂 chatbot 检索。
 */

export interface FetchMechanismsParams {
  search?: string;
  type?: string;
}

export interface FetchMechanismsResult {
  items: MechanismListItem[];
  total: number;
}

function appendQueryParam(qs: URLSearchParams, key: string, value?: string) {
  const trimmed = value?.trim();
  if (trimmed) qs.set(key, trimmed);
}

export async function fetchMechanisms(
  params: FetchMechanismsParams = {},
): Promise<FetchMechanismsResult> {
  const qs = new URLSearchParams();
  appendQueryParam(qs, 'search', params.search);
  appendQueryParam(qs, 'type', params.type);

  const data = await backendGet<Partial<FetchMechanismsResult>>(
    `/api/mechanisms?${qs.toString()}`,
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
  };
}

export async function fetchMechanismTrends(): Promise<{
  trends: MechanismTrendItem[];
}> {
  const data = await backendGet<{ trends?: MechanismTrendItem[] }>(
    '/api/mechanisms/trends',
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return { trends: data?.trends ?? [] };
}

/**
 * 两个指数列的字段描述（Base 侧的方法论说明）。
 * 服务端读不到时降级为 null（不报错），这里同样把缺省值收敛成 null，
 * 调用方只需判断「有没有描述」决定要不要渲染悬停提示。
 */
export interface MechanismScoreHints {
  market: string | null;
  innovation: string | null;
}

export async function fetchMechanismScoreHints(): Promise<MechanismScoreHints> {
  const data = await backendGet<Partial<MechanismScoreHints>>(
    '/api/mechanisms/score-hints',
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return {
    market: data?.market || null,
    innovation: data?.innovation || null,
  };
}

export async function fetchMechanismDetail(
  stableKey: string,
): Promise<MechanismDetailData | null> {
  try {
    return (
      (await backendGet<MechanismDetailData | null>(
        `/api/mechanisms/${encodeURIComponent(stableKey)}`,
        PUBLIC_READ_REVALIDATION_CONFIG,
      )) ?? null
    );
  } catch {
    return null;
  }
}

export async function fetchCoverage(): Promise<CoverageData> {
  const data = await backendGet<Partial<CoverageData>>(
    '/api/research/coverage',
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return {
    totals: {
      articles: data?.totals?.articles ?? 0,
      mechanisms: data?.totals?.mechanisms ?? 0,
      entities: data?.totals?.entities ?? 0,
      relations: data?.totals?.relations ?? 0,
    },
    articlesByMonth: data?.articlesByMonth ?? [],
  };
}

export const mechanismsQuery = (params: FetchMechanismsParams = {}) =>
  queryOptions({
    queryKey: insightKeys.mechanisms(params),
    queryFn: () => fetchMechanisms(params),
    ...cachePolicy.publicList,
    meta: queryMeta(),
  });

export const mechanismTrendsQuery = () =>
  queryOptions({
    queryKey: insightKeys.mechanismTrends(),
    queryFn: fetchMechanismTrends,
    ...cachePolicy.publicList,
    meta: queryMeta(),
  });

/**
 * 字段描述是低频变更的 schema 元数据，前端缓存与服务端 TTL 都取 60s，
 * 保证「Base 改完描述 ≤ 约 2 分钟内生效且不需要发版」。
 */
export const mechanismScoreHintsQuery = () =>
  queryOptions({
    queryKey: insightKeys.mechanismScoreHints(),
    queryFn: fetchMechanismScoreHints,
    ...cachePolicy.publicList,
    meta: queryMeta(),
  });

export const mechanismDetailQuery = (stableKey: string) =>
  queryOptions({
    queryKey: insightKeys.mechanismDetail(stableKey),
    queryFn: () => fetchMechanismDetail(stableKey),
    enabled: Boolean(stableKey),
    ...cachePolicy.publicDetail,
    meta: queryMeta(),
  });

export const coverageQuery = () =>
  queryOptions({
    queryKey: insightKeys.coverage(),
    queryFn: fetchCoverage,
    ...cachePolicy.publicStats,
    meta: queryMeta(),
  });
