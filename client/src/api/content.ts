// 公开内容数据访问层：文章库多维筛选（facets）与筛选计数类型。
// 旧的 `/api/content/list` 契约与 Board 板块页已于 2026-09-21 一并下线
// （端点唯一提供者是死模块 `content`，页面全站零入口）；
// 文章库与详情走 `/api/articles` 契约，见 api/articles.ts。

import { backendGet, PUBLIC_READ_REVALIDATION_CONFIG } from './backend';

/** 一个可筛选项：value 即筛选值（Base 原文），label 为界面显示文案。 */
export interface ContentFacetOption {
  value: string;
  label: string;
  count: number;
}

/** 玩法分类父项节点；count 含其全部子项，与筛选口径一致。 */
export interface ContentGameplayFacet extends ContentFacetOption {
  /** 仅属于父项自身（未细分）的条数。 */
  selfCount: number;
  children: ContentFacetOption[];
}

export interface ContentFacets {
  /** @deprecated 旧筛选栏字段，P2 改造后仅后端兼容保留。 */
  types: { kind: string; count: number }[];
  /** @deprecated 旧筛选栏字段，P2 改造后仅后端兼容保留。 */
  categories: { type: string; count: number }[];
  /** 内容类型计数（深度报告 / 快讯转载 / 竞品周报…，由 Base 实际值派生）。 */
  contentTypes: ContentFacetOption[];
  /** 玩法分类父子树，由 Base「玩法分类父项 / 子项」两列的实际组合派生。 */
  gameplay: ContentGameplayFacet[];
  /** 来源发布方计数（首页「最新发布」胶囊筛选的数据源）。 */
  publishers: ContentFacetOption[];
  tags: never[];
}

/** facets 查询维度：每个维度的计数都在「已应用其他维度筛选」的集合上统计。 */
export interface ContentFacetsParams {
  search?: string;
  contentType?: string;
  gameplayCategory?: string;
  sourcePublisher?: string;
}

/** 文章库多维筛选计数；走新 /api/articles/facets 端点。 */
export async function fetchContentFacets(
  params: ContentFacetsParams = {},
): Promise<ContentFacets> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.contentType) qs.set('contentType', params.contentType);
  if (params.gameplayCategory)
    qs.set('gameplayCategory', params.gameplayCategory);
  if (params.sourcePublisher)
    qs.set('sourcePublisher', params.sourcePublisher);
  const data = await backendGet<Partial<ContentFacets>>(
    `/api/articles/facets?${qs.toString()}`,
    PUBLIC_READ_REVALIDATION_CONFIG,
  );
  return {
    types: data?.types ?? [],
    categories: data?.categories ?? [],
    contentTypes: data?.contentTypes ?? [],
    gameplay: data?.gameplay ?? [],
    publishers: data?.publishers ?? [],
    tags: [],
  };
}
