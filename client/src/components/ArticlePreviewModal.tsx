import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ExternalLink, Heart } from 'lucide-react';
import { toast } from 'sonner';
import {
  isFavorite,
  toggleFavorite,
} from '@client/src/lib/favorites';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { cn } from '@client/src/lib/utils';
import ArticleCover, { hasCoverSrc } from '@client/src/components/ArticleCover';
import ArticleDetail from '@client/src/components/ArticleDetail';
import { articleDetailQuery } from '@client/src/api/articles';
import { withClientBasePath } from '@client/src/lib/base-path';
import {
  gameplayCategoryColor,
  gameplayCategoryLabel,
} from '@shared/gameplay-category';
import type { ArticleListItem } from '@client/src/types/content';

/**
 * 首页卡片预览弹窗：点击卡片就地展示完整摘要与元信息，不跳转路由。
 * 普通文章的「全文预览」在弹窗右侧展开 ArticleDetail；有文件附件时
 * 直接在新标签页打开原始附件。
 */
export default function ArticlePreviewModal({
  item,
  onClose,
}: {
  item: ArticleListItem | null;
  onClose: () => void;
}) {
  const [faved, setFaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 本弹窗摘要卡的 DOM 引用：Esc 分级关闭时用于区分「自己」与内层 Radix Dialog。
  const cardRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const detailQuery = useQuery({
    ...articleDetailQuery(item?.docId ?? ''),
    enabled: Boolean(item),
  });

  const open = item != null;
  const attachmentPreviewUrl = detailQuery.data?.attachmentPreviewUrl
    ? withClientBasePath(detailQuery.data.attachmentPreviewUrl)
    : null;
  const detailResolved = detailQuery.isSuccess || detailQuery.isError;
  // 标签口径与卡片一致：有子项显示 `父项 › 子项`；配色按父项名哈希。
  const categoryLabel = item
    ? gameplayCategoryLabel(item.gameplayParent, item.gameplayChild)
    : '';
  const categoryColor = item
    ? gameplayCategoryColor(item.gameplayParent || item.gameplayChild)
    : 'gray';

  // 详情查询与全文面板共用缓存；弹窗关闭时清掉缓存并复位面板。
  useEffect(() => {
    if (!item) return;
    const detailKey = articleDetailQuery(item.docId).queryKey;
    return () => {
      queryClient.removeQueries({ queryKey: detailKey });
      setPreviewOpen(false);
    };
  }, [item, queryClient]);

  // 收藏状态同步 + 背景滚动锁 + Esc 分级关闭（先关全文面板，再关弹窗）。
  useEffect(() => {
    if (!item) return;
    setFaved(isFavorite(item.docId));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Esc 分层（P4b 批4）：焦点落在内层 Radix Dialog（如实体反馈弹窗）上时
      // 交还给内层自行关闭，document 级监听不得再叠加关闭本弹窗/全文面板。
      if (event.target instanceof Element) {
        const dialog = event.target.closest('[role="dialog"]');
        if (dialog && dialog !== cardRef.current) return;
      }
      if (previewOpen) setPreviewOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [item, onClose, previewOpen]);

  if (!item) return null;

  // 无封面时不留图位：关闭按钮改到元信息行右端，避免浮在空白处。
  const hasCover = hasCoverSrc(item.coverUrl);

  // 快讯转载（原外链文章）无站内正文；如有附件仍提供原件入口。
  const isExternal = item.contentType === '快讯转载';

  const handleFav = () => {
    const next = toggleFavorite(item.docId);
    setFaved(next);
    toast(next ? '已加入收藏' : '已取消收藏');
  };

  const handleSource = () => {
    if (!item.sourceUrl) return;
    window.open(item.sourceUrl, '_blank', 'noopener');
  };

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm md:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'flex w-full',
          previewOpen
            ? // 全文模式：详情卡与全文面板整体占满，两面板约 1:2
              'h-[min(92vh,64rem)] flex-col gap-3 lg:flex-row lg:gap-4'
            : 'max-w-[45rem]',
        )}
      >
        {/* 摘要详情卡：全文模式压到左侧 1 份宽度让位 */}
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label="文章摘要预览"
          className={cn(
            'relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl',
            previewOpen
              ? 'lg:h-full lg:flex-[1_1_0%]'
              : // 非全文模式限高：摘要过长时卡片内滚动，底部胶囊操作条始终贴卡片右下角
                'max-h-[min(92vh,52rem)] flex-1',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {!hasCover && (
            /* 无封面：不留图位，关闭按钮钉在卡片右上角（不随摘要滚动） */
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="absolute right-3.5 top-3.5 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          )}
          {hasCover && (
            <div className="relative shrink-0">
              <ArticleCover
                src={item.coverUrl}
                label={categoryLabel}
                color={categoryColor}
                className="aspect-[16/9]"
                zoomable
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="absolute right-3.5 top-3.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
              >
                ✕
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-5">
            <div className="flex items-center gap-2 text-xs">
              {(() => {
                const relative = formatRelativeSourceDate(item.sourceDate);
                return (
                  <>
                    {relative === '今天' && (
                      <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
                        NEW
                      </span>
                    )}
                    <span
                      className={
                        gameplayCategoryStyle(
                          item.gameplayParent,
                          item.gameplayChild,
                        ).badge
                      }
                    >
                      {categoryLabel}
                    </span>
                    {relative && (
                      <span className="font-semibold text-primary">
                        {relative}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
            <h2 className="mt-2 text-xl font-extrabold leading-snug">
              {item.title}
            </h2>
            {item.summary.trim() && (
              <p className="mt-3.5 text-sm leading-[1.95] text-foreground">
                {item.summary}
              </p>
            )}
            <dl className="mt-5 grid grid-cols-1 gap-x-5 gap-y-2.5 rounded-xl border border-dashed p-4 text-[13px] sm:grid-cols-2">
              {[
                ['来源发布方', item.sourcePublisher || item.sourceAuthor || '未记录'],
                ['玩法品类', categoryLabel],
                ['来源日期', item.sourceDate || '未记录'],
                ['摘要字数', `${item.summary.length} 字`],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="mt-0.5 font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* 右下角胶囊操作条：常驻卡片底部，与摘要滚动区分隔。
              主操作=跳原文（高亮引导），全文预览降为描边次按钮。 */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-6 py-3.5">
            {item.sourceUrl ? (
              <button
                type="button"
                onClick={handleSource}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                阅读原文
              </button>
            ) : null}
            {attachmentPreviewUrl ? (
              <a
                href={attachmentPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`在新标签页打开 ${detailQuery.data?.attachmentFileName || item.title}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                全文预览
              </a>
            ) : !isExternal ? (
              <button
                type="button"
                onClick={() => setPreviewOpen((value) => !value)}
                aria-pressed={previewOpen}
                aria-busy={!detailResolved}
                disabled={!detailResolved}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-50"
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                {detailResolved
                  ? previewOpen
                    ? '收起全文'
                    : '全文预览'
                  : '读取附件中…'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleFav}
              aria-label={faved ? '取消收藏' : '加入收藏'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors',
                faved
                  ? 'border-rose-300 text-rose-600 hover:bg-rose-500/10'
                  : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              <Heart
                className={cn('h-4 w-4', faved && 'fill-rose-600')}
                aria-hidden
              />
              {faved ? '已收藏' : '收藏'}
            </button>
          </div>
        </div>

        {/* 全文面板：右侧 2 份宽度，内嵌 ArticleDetail（命中预取缓存，秒开） */}
        {previewOpen ? (
          <div
            className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl max-lg:h-[58vh] lg:h-full lg:flex-[2_1_0%]"
            aria-label="全文预览"
            onClick={(event) => event.stopPropagation()}
          >
            <ArticleDetail
              docId={item.docId}
              mode="split"
              onClose={() => setPreviewOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
