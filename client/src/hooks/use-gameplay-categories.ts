import { useQuery } from '@tanstack/react-query';
import { contentFacetsQuery } from '@client/src/query/public-queries';
import { gameplayCategoryPath } from '@shared/gameplay-category';

/** 一个分类导航项；children 为其二级分类（Base 里「父项」指向它的那些）。 */
export interface GameplayNavNode {
  name: string;
  path: string;
  /** 该分类的文章数（父项含其全部子项）。 */
  count: number;
  children: GameplayNavNode[];
}

/**
 * 玩法分类导航数据：直接取文章库 facets 的无参结果 —— 分类与父子关系完全
 * 由 Base 两列的实际取值派生。Base 里加一个选项并给文章打标，导航、筛选栏、
 * 玩法页三处随下一次读取同时出现，无需改代码。
 *
 * 与首页品类胶囊、文章库筛选栏共用同一 React Query 缓存（无参 facets），
 * 因此整站只多一次读取，且随 60s staleTime 复用。
 */
export function useGameplayCategories(): GameplayNavNode[] {
  const facets = useQuery(contentFacetsQuery({}));
  return (facets.data?.gameplay ?? []).map((node) => ({
    name: node.value,
    path: gameplayCategoryPath(node.value),
    count: node.count,
    children: node.children.map((child) => ({
      name: child.value,
      path: gameplayCategoryPath(child.value),
      count: child.count,
      children: [],
    })),
  }));
}
