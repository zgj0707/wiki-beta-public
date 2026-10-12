import { useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { articleListQuery } from '@client/src/api/articles';
import {
  getFavoriteIds,
  onFavoritesChanged,
} from '@client/src/lib/favorites';
import ArticleWaterfallCard from '@client/src/components/ArticleWaterfallCard';
import ArticlePreviewModal from '@client/src/components/ArticlePreviewModal';
import { useWaterfallColumns } from '@client/src/hooks/use-waterfall-columns';
import EmptyState from '@client/src/components/ui/empty-state';
import { Skeleton } from '@client/src/components/ui/skeleton';
import type { ArticleListItem } from '@client/src/types/content';

/**
 * 我的收藏：收藏只存 localStorage docId 列表；复用文章列表接口
 * （limit 100 一次拉取后本地过滤），避免逐条详情请求。
 */
export default function FavoritesPage() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    getFavoriteIds(),
  );
  const [previewItem, setPreviewItem] = useState<ArticleListItem | null>(null);

  useEffect(() => {
    setFavoriteIds(getFavoriteIds());
    return onFavoritesChanged(() => setFavoriteIds(getFavoriteIds()));
  }, []);

  const listQuery = useQuery(articleListQuery({ limit: 100, offset: 0 }));

  const items = (listQuery.data?.items ?? []).filter((item) =>
    favoriteIds.includes(item.docId),
  );
  const loading = listQuery.isPending && favoriteIds.length > 0;

  const columnCount = useWaterfallColumns();
  // 按索引取模分桶：收藏增删时卡片列位置稳定。
  const columns = useMemo(() => {
    const cols: ArticleListItem[][] = Array.from(
      { length: columnCount },
      () => [],
    );
    items.forEach((item, index) => {
      cols[index % columnCount]!.push(item);
    });
    return cols;
  }, [items, columnCount]);

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5">
        {favoriteIds.length ? (
          <div className="flex items-center justify-end">
            <span className="text-xs text-muted-foreground">
              共 {favoriteIds.length} 篇
            </span>
          </div>
        ) : null}

        {loading ? (
          <div
            className="mt-4 grid gap-5"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <div key={columnIndex} className="flex min-w-0 flex-col gap-5">
                {[0, 1].map((rowIndex) => (
                  <Skeleton
                    key={rowIndex}
                    className="h-56 w-full rounded-[14px]"
                  />
                ))}
              </div>
            ))}
          </div>
        ) : !favoriteIds.length ? (
          <EmptyState
            icon={Heart}
            title="还没有收藏"
            description="在文章卡片或详情页点击心形图标，即可把文章加入收藏。"
          />
        ) : items.length ? (
          <div
            className="mt-4 grid gap-5"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((column, columnIndex) => (
              <div key={columnIndex} className="flex min-w-0 flex-col gap-5">
                {column.map((item) => (
                  <ArticleWaterfallCard
                    key={item.docId}
                    item={item}
                    onPreview={setPreviewItem}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={Heart}
              title="收藏的文章暂时无法加载"
              description="可能是文章列表接口不可用，或收藏的文章已被归档。"
            />
          </div>
        )}

        {items.length ? (
          <p className="mt-4 text-xs text-muted-foreground">
            点击卡片打开预览弹窗，弹窗内的心形按钮可取消收藏。
          </p>
        ) : null}
      </div>
      <ArticlePreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  );
}
