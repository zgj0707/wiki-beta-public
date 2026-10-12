import { queryClient } from '@client/src/query/query-client';
import { mechanismDetailQuery } from '@client/src/api/insight';

/**
 * 「机制观察」列表卡片 hover 时的预取入口：只暖缓存 / 预热代码块，
 * 全程不阻塞路由、失败静默——预取是锦上添花，绝不能影响点击交互。
 */

/** 详情页代码块是否已预取过：模块级去重，避免重复触发动态 import。 */
let detailChunkPrefetched = false;

/** 预取详情数据：只暖 React Query 缓存，不阻塞路由。失败静默。 */
export function prefetchMechanismDetailData(stableKey: string): void {
  if (!stableKey) return;
  // 重复调用由 React Query 按 queryKey 自行去重，无需额外判断。
  void queryClient.prefetchQuery(mechanismDetailQuery(stableKey)).catch(() => {});
}

/** 预取详情页代码块。路径必须与 public-routes.tsx 里 lazyPage 用的是同一模块。失败静默。 */
export function prefetchMechanismDetailChunk(): void {
  if (detailChunkPrefetched) return;
  detailChunkPrefetched = true;
  void import('@client/src/pages/MechanismObservatory/MechanismDetailPage').catch(
    () => {},
  );
}
