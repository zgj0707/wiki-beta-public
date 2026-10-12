import { Link } from 'react-router-dom';
import type { ArticleListItem } from '@client/src/types/content';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import ArticleCover from '@client/src/components/ArticleCover';
import {
  gameplayCategoryColor,
  gameplayCategoryLabel,
} from '@shared/gameplay-category';
import { displaySourceDate } from '@shared/source-date';

const NEW_THRESHOLD_MS = 48 * 60 * 60 * 1000;

function isNewSourceDate(sourceDate: string | undefined) {
  if (!sourceDate) return false;
  const time = new Date(sourceDate).getTime();
  return Number.isFinite(time) && Date.now() - time < NEW_THRESHOLD_MS;
}

/**
 * 首页瀑布流卡：对齐 v4 原型 articleCard 结构——
 * 顶部时间行（NEW 药丸 + 相对时间，主色）→ 标题 → 摘要（不截断）→ meta 置底；
 * 点击打开预览弹窗（onPreview），中键/新标签页语义由 Link 保留。
 */
export default function ArticleWaterfallCard({
  item,
  onPreview,
}: {
  item: ArticleListItem;
  onPreview?: (item: ArticleListItem) => void;
}) {
  // 标签口径：有子项显示 `父项 › 子项`；配色按父项名哈希，不随文章数变化。
  const label = gameplayCategoryLabel(item.gameplayParent, item.gameplayChild);
  const color = gameplayCategoryColor(item.gameplayParent || item.gameplayChild);
  const summary = item.summary?.trim() ?? '';
  const showNew = isNewSourceDate(item.sourceDate);
  const relativeTime = formatRelativeSourceDate(item.sourceDate);

  return (
    <Link
      to={`/article/${item.docId}`}
      onClick={(event) => {
        if (!onPreview) return;
        event.preventDefault();
        onPreview(item);
      }}
      className="group flex flex-col overflow-hidden rounded-[14px] border bg-card transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <ArticleCover
        src={item.coverUrl}
        label={label}
        color={color}
        className="aspect-[16/9]"
      />
      <div className="flex flex-1 flex-col p-4 pb-3">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-primary">
          {showNew && (
            <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
              NEW
            </span>
          )}
          {relativeTime && <span>{relativeTime}</span>}
        </div>
        <div className="mb-3">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug group-hover:text-primary">
            {item.title}
          </h3>
          {summary && (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-dashed pt-3 text-xs text-muted-foreground">
          <span
            className={
              gameplayCategoryStyle(item.gameplayParent, item.gameplayChild)
                .badge
            }
          >
            {label}
          </span>
          {item.sourcePublisher && (
            <span className="max-w-[10rem] truncate">{item.sourcePublisher}</span>
          )}
          <span className="ml-auto">
            {displaySourceDate(item.sourceDate, '未记录')}
          </span>
        </div>
      </div>
    </Link>
  );
}
