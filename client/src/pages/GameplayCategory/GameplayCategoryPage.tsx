import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ArticleLibraryView from '@client/src/pages/Library/ArticleLibraryView';
import NotFound from '@client/src/pages/NotFound/NotFound';
import { contentFacetsQuery } from '@client/src/query/public-queries';
import { Skeleton } from '@client/src/components/ui/skeleton';
import {
  gameplayCategoryPath,
  normalizeGameplayName,
} from '@shared/gameplay-category';

/**
 * 固定分类页 `/gameplay/<分类名>`。
 *
 * 分类是否合法不看代码里的清单，而看 Base 里是否真有文章落在该分类上
 * （facets 由「父项 / 子项」两列的实际组合派生）—— Base 里新增一个分类
 * 并打标，这一页自动可用，无需改代码。
 *
 * 传父项名 = 聚合页（含其全部子项），传子项名 = 该子项单独一页。
 */
export default function GameplayCategoryPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  // 旧英文 slug（/gameplay/idle-mmo）归一为分类名，历史分享链接不断。
  const name = normalizeGameplayName(categorySlug);
  const facets = useQuery(contentFacetsQuery({}));
  const nodes = facets.data?.gameplay ?? [];
  const node = nodes.find(
    (candidate) =>
      candidate.value === name ||
      candidate.children.some((child) => child.value === name),
  );

  if (!name) return <NotFound />;
  if (categorySlug !== name) {
    return <Navigate to={gameplayCategoryPath(name)} replace />;
  }
  // 分类树尚未拿到时不能判定「不存在」，否则会误报 404。
  if (!node && facets.isPending) {
    return (
      <div className="page-scroll">
        <div className="page-container page-container-wide pt-5">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="mt-4 h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  if (!node) return <NotFound />;

  const childNames = node.children.map((child) => child.value);
  const scopeDescription =
    childNames.length > 0
      ? `只展示已审核、未归档且玩法标签属于「${name}」（含 ${childNames.join('、')}）的文章。`
      : `只展示已审核、未归档且玩法标签为「${name}」的文章。`;

  return (
    <ArticleLibraryView
      key={name}
      title={name}
      description={`${scopeDescription}可继续按类型、分类和时间窗筛选。`}
      fixedGameplayCategory={name}
      gameplayCategoryLabel={name}
    />
  );
}
