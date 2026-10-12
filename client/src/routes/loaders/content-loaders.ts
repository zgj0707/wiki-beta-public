import type { LoaderFunctionArgs } from 'react-router-dom';
import { queryClient } from '@client/src/query/query-client';
import {
  articleDetailQuery,
  articleListQuery,
} from '@client/src/api/articles';
import { mechanismsQuery } from '@client/src/api/insight';
import { contentFacetsQuery } from '@client/src/query/public-queries';
import { normalizeGameplayName } from '@shared/gameplay-category';

function paramsFromRequest(request: Request) {
  return new URL(request.url).searchParams;
}

export async function loadHome({ request }: LoaderFunctionArgs) {
  const params = paramsFromRequest(request);
  const search = params.get('q') ?? undefined;
  // 与 HomePage 的「最近收录」查询同 key（limit 6），确保预热命中同一份缓存。
  return queryClient.ensureQueryData(articleListQuery({ search, limit: 6, offset: 0, order: 'desc' }));
}

/**
 * 顶栏「玩法分类」菜单与首页品类胶囊的数据源（无参 facets）。
 * 分类清单完全由 Base 实际取值派生，与页面筛选栏共用同一份查询缓存。
 * 失败时静默放行 —— 分类菜单是增强项，不应因它拿不到数据而卡住整站导航。
 */
export async function loadGameplayCategories() {
  try {
    await queryClient.ensureQueryData(contentFacetsQuery({}));
  } catch {
    // 忽略：TopNav / 首页会退化为「本次不显示分类条目」。
  }
  return null;
}

export async function loadLibrary({
  request,
  fixedGameplayCategory,
}: LoaderFunctionArgs & { fixedGameplayCategory?: string }) {
  const params = paramsFromRequest(request);
  // 筛选参数与 ArticleLibraryView 保持同一口径：
  //   ?type=<内容类型原文>  ?cat=<玩法分类名>  ?days=<天数>  ?order=<asc|desc>
  // 旧链接 `?type=cat:<分类名>` 在读取时归一为 cat。
  const rawType = params.get('type') ?? '';
  const legacyCategory = rawType.startsWith('cat:') ? rawType.slice(4) : '';
  const gameplayName = normalizeGameplayName(
    legacyCategory || params.get('cat'),
  );
  const filters = {
    search: params.get('q') ?? undefined,
    days: params.get('days') ? Number(params.get('days')) : undefined,
    order: params.get('order') === 'asc' ? ('asc' as const) : ('desc' as const),
    contentType: legacyCategory ? undefined : rawType || undefined,
    // 固定分类页的段可能是旧英文 slug，同样过一遍归一化，否则预取的 query key
    // 与页面实际请求的参数对不上，首屏会白跑一次。
    gameplayCategory:
      normalizeGameplayName(fixedGameplayCategory) ||
      gameplayName ||
      undefined,
  };
  await Promise.all([
    queryClient.ensureQueryData(
      articleListQuery({ ...filters, limit: 20, offset: 0 }),
    ),
    queryClient.ensureQueryData(
      contentFacetsQuery({
        search: filters.search,
        contentType: filters.contentType,
        gameplayCategory: filters.gameplayCategory,
      }),
    ),
  ]);
  return null;
}

export async function loadArticle({ params }: LoaderFunctionArgs) {
  return params.docId ? queryClient.ensureQueryData(articleDetailQuery(params.docId)) : null;
}

/**
 * 找结论页（/insights）预取：深度报告流（内容类型=深度报告，与 InsightsPage 同 key）。
 * 失败静默放行——页面 useQuery 会自行重试，不阻断导航。
 */
export async function loadInsights() {
  try {
    await queryClient.ensureQueryData(
      articleListQuery({
        contentType: '深度报告',
        limit: 12,
        offset: 0,
        order: 'desc',
      }),
    );
  } catch {
    // 忽略：页面内 useQuery 兜底。
  }
  return null;
}

/** 盯竞品页（/watch）预取：竞品周报流（内容类型=竞品周报，与 WatchPage 同 key）。 */
export async function loadWatch() {
  try {
    await queryClient.ensureQueryData(
      articleListQuery({
        contentType: '竞品周报',
        limit: 20,
        offset: 0,
        order: 'desc',
      }),
    );
  } catch {
    // 忽略：页面内 useQuery 兜底。
  }
  return null;
}

/**
 * 全站搜索页（/search）预取：按 q 预热文章与机制观察两路结果。
 * 空查询不预取（页面显示引导空态）；失败静默放行。
 */
export async function loadSearch({ request }: LoaderFunctionArgs) {
  const q = (paramsFromRequest(request).get('q') ?? '').trim();
  if (!q) return null;
  await Promise.allSettled([
    queryClient.ensureQueryData(
      articleListQuery({ search: q, limit: 8, offset: 0 }),
    ),
    queryClient.ensureQueryData(mechanismsQuery({ search: q })),
  ]);
  return null;
}
