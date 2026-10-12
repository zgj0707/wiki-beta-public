import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ArticleDetailData } from '@client/src/types/content';
import { articleDetailQuery } from '@client/src/api/articles';
import {
  isFavorite,
  onFavoritesChanged,
  toggleFavorite,
} from '@client/src/lib/favorites';
import Markdown from '@client/src/components/Markdown';
import {
  setPaneSnapshot,
  usePaneNavigation,
} from '@client/src/components/pane-navigation';
import ArticleSectionNav from '@client/src/components/ArticleSectionNav';
import { extractHeadings } from '@client/src/lib/toc';
import { withClientBasePath } from '@client/src/lib/base-path';
import { documentUnavailableMessage } from '@client/src/lib/document-errors';
import {
  gameplayCategoryStyle,
  NEUTRAL_TAG_STYLE,
} from '@client/src/lib/tag-color';
import { cn } from '@client/src/lib/utils';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Separator } from '@client/src/components/ui/separator';
import { Skeleton } from '@client/src/components/ui/skeleton';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  X,
  ExternalLink,
  Calendar,
  Globe,
  FileText,
  Heart,
} from 'lucide-react';

function normalizeFocusText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  if (!value || value === '-') return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

interface ArticleDetailProps {
  /** 文章 id */
  docId?: string;
  /** 分节导航模式：split=可拖动悬浮球，page=常驻 sticky 目录 */
  mode?: 'split' | 'page';
  /** 分栏模式下关闭详情；不传则按路由页处理（显示返回按钮） */
  onClose?: () => void;
  /** 窄窗口全屏阅读模式：顶部按钮显示「返回列表」而非「关闭」 */
  narrow?: boolean;
  /** 从实体探索进入时，用证据文本定位到正文对应段落。 */
  focusText?: string;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

/**
 * 文章详情内容组件：可在路由页（整页）或列表页右侧分栏中复用。
 * 不含路由跳转逻辑，只负责按 docId 拉取并渲染详情与收藏。
 * v2 实体链路退场（2026-10-09）：实体高亮/悬停卡/「本篇实体」chips 已移除。
 */
export default function ArticleDetail({
  docId,
  mode,
  onClose,
  narrow,
  focusText,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ArticleDetailProps) {
  const navigate = useNavigate();
  const paneNavigation = usePaneNavigation();
  const articleBodyRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fav, setFav] = useState(() => (docId ? isFavorite(docId) : false));
  const [readingProgress, setReadingProgress] = useState(0);

  // 收藏状态跨组件同步：本页切换或其它组件切换后保持一致。
  useEffect(() => {
    if (!docId) return;
    setFav(isFavorite(docId));
    return onFavoritesChanged(() => setFav(isFavorite(docId)));
  }, [docId]);

  const toggleFav = () => {
    if (!docId) return;
    setFav(toggleFavorite(docId));
  };

  const itemQuery = useQuery({
    ...articleDetailQuery(docId ?? ''),
    enabled: Boolean(docId),
  });
  const item = itemQuery.data ?? null;
  const loading = Boolean(docId) && itemQuery.isPending;

  // 阅读进度：监听本文自身的滚动容器（进度条见内容区顶部）。
  // 依赖 item 加载完成：内容分支渲染后 scrollRef 才会挂载。
  // rAF 节流：scroll 高频触发，同一帧只提交一次 setState，避免整组件每帧 reconcile。
  useEffect(() => {
    setReadingProgress(0);
    const el = scrollRef.current;
    if (!el) return;
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const max = el.scrollHeight - el.clientHeight;
        setReadingProgress(
          max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0,
        );
      });
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', onScroll);
    };
  }, [docId, item?.docId]);

  const sectionNavMode: 'split' | 'page' = mode ?? (onClose ? 'split' : 'page');
  const headings = useMemo(() => extractHeadings(item?.bodyMarkdown), [item]);

  /** 文章工作台的关键结论是唯一结构化摘要字段。 */
  const structuredSections = useMemo(() => {
    const structured = item?.structured;
    if (!structured) return [];
    const text = structured.keyFindings?.trim();
    return text ? [{ label: '关键结论', text }] : [];
  }, [item]);
  // 标签口径与卡片一致：有子项显示 `父项 › 子项`；配色按父项名哈希。
  const gameplayStyle = gameplayCategoryStyle(
    item?.gameplayParent,
    item?.gameplayChild,
  );
  // 后端按 Base 原文透传内容类型（深度报告 / 快讯转载 / 竞品周报…），无需再映射。
  const contentTypeLabel = item?.contentType ?? '';
  const attachmentPreviewUrl = item?.attachmentPreviewUrl
    ? withClientBasePath(item.attachmentPreviewUrl)
    : null;
  const attachmentDownloadUrl = attachmentPreviewUrl
    ? `${attachmentPreviewUrl}?download=1`
    : null;

  useEffect(() => {
    if (!paneNavigation || !item?.docId) return;
    setPaneSnapshot(paneNavigation.side, {
      kind: 'article',
      id: item.docId,
      label: item.title,
    });
    return () => setPaneSnapshot(paneNavigation.side, null);
  }, [item?.docId, item?.title, paneNavigation]);

  useEffect(() => {
    if (!item?.bodyMarkdown || !focusText?.trim()) return;
    let frame = 0;
    let timer: number | undefined;
    frame = window.requestAnimationFrame(() => {
      const needle = normalizeFocusText(focusText);
      if (!needle) return;
      const candidates =
        articleBodyRef.current?.querySelectorAll<HTMLElement>(
          'p, li, td, th, blockquote, pre, figcaption, h1, h2, h3, h4, h5, h6',
        ) ?? [];
      const target = Array.from(candidates).find((element) => {
        const text = normalizeFocusText(element.textContent ?? '');
        return text.includes(needle);
      });
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('doc-focus-target');
      timer = window.setTimeout(
        () => target.classList.remove('doc-focus-target'),
        2600,
      );
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [item?.docId, item?.bodyMarkdown, focusText]);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl xl:max-w-[880px] 2xl:max-w-[960px] mx-auto px-6 py-8 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full mt-6" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center h-full overflow-y-auto">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">未找到该文章</h2>
        <p className="text-sm text-muted-foreground mt-1">
          它可能已被归档或链接有误
        </p>
        <Button className="mt-4" onClick={() => navigate('/')}>
          返回主页
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <article className="max-w-3xl xl:max-w-[880px] 2xl:max-w-[960px] mx-auto px-6 py-8">
          {/* 阅读进度条：随本文滚动容器填充 */}
          <div
            aria-hidden
            className="pointer-events-none sticky top-0 z-20 -mx-6 h-0.5"
          >
            <div
              className="h-full bg-gradient-to-r from-primary to-violet-600 transition-[width] duration-150 ease-out"
              style={{ width: `${readingProgress}%` }}
            />
          </div>
          <div className="flex items-center gap-2 mb-4">
            {onClose ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                onClick={onClose}
              >
                {narrow ? (
                  <ArrowLeft className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                {narrow ? '返回列表' : '关闭'}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-4 w-4" />
                返回
              </Button>
            )}

            {/* 上一篇 / 下一篇 */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasPrev}
                onClick={onPrev}
                className="text-muted-foreground"
              >
                <ArrowUp className="h-4 w-4" />
                上一篇
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasNext}
                onClick={onNext}
                className="text-muted-foreground"
              >
                <ArrowDown className="h-4 w-4" />
                下一篇
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={toggleFav}
              title={fav ? '取消收藏' : '收藏本文'}
              aria-pressed={fav}
            >
              <Heart
                className={`h-4 w-4 ${fav ? 'fill-current text-primary' : ''}`}
              />
              {fav ? '已收藏' : '收藏'}
            </Button>
          </div>

          {/* Header：玩法分类 × 内容类型 chips（非空才渲染） */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {item.gameplayParent || item.gameplayChild ? (
              <Badge
                variant="outline"
                className={cn('font-normal', gameplayStyle.badge)}
              >
                {gameplayStyle.label}
              </Badge>
            ) : null}
            {contentTypeLabel ? (
              <Badge
                variant="outline"
                className={cn('font-normal', NEUTRAL_TAG_STYLE.badge)}
              >
                {contentTypeLabel}
              </Badge>
            ) : null}
          </div>

          <h1 className="text-2xl font-bold leading-snug">{item.title}</h1>

          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              在飞书打开原文
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
            {item.sourceDate ? (
              <MetaItem icon={Calendar} label="发布" value={item.sourceDate} />
            ) : null}
            <MetaItem
              icon={FileText}
              label="作者"
              value={item.sourceAuthor || ''}
            />
            <MetaItem
              icon={Globe}
              label="发布方"
              value={item.sourcePublisher || ''}
            />
          </div>

          <Separator className="my-6" />

          {/* 结构化结论优先；缺失时回退展示录入摘要。 */}
          {structuredSections.length > 0 ? (
            <section className="mb-6 rounded-lg border bg-muted/30 p-4">
              <h2 className="text-sm font-semibold">结构化摘要</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed">
                {structuredSections.map((section) => (
                  <div key={section.label}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {section.label}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{section.text}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : item.summary?.trim() ? (
            <section className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <h2 className="text-sm font-semibold">文章摘要</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {item.summary}
              </p>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <ExternalLink className="h-4 w-4" />
                  在飞书打开原文
                </a>
              )}
            </section>
          ) : null}

          {attachmentPreviewUrl ? (
            <section
              className="mb-6 rounded-lg border bg-muted/30 p-4"
              aria-labelledby="attachment-preview-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2
                    id="attachment-preview-heading"
                    className="text-sm font-semibold"
                  >
                    附件原件
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.attachmentFileName || '在新标签页中打开原始附件。'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <a
                    href={attachmentPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`在新标签页打开 ${item.attachmentFileName || item.title}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <ExternalLink className="h-4 w-4" />
                    新标签页打开附件
                  </a>
                  {attachmentDownloadUrl ? (
                    <a
                      href={attachmentDownloadUrl}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      下载附件
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* 正文 */}
          {item.bodyMarkdown ? (
            <section ref={articleBodyRef} className="mb-6">
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                正文
              </h2>
              <Markdown
                content={item.bodyMarkdown}
                headingIds={headings.map((h) => h.id)}
              />
            </section>
          ) : !attachmentPreviewUrl &&
            item.documentStatus &&
            item.documentStatus !== 'ready' ? (
            <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <h2 className="text-sm font-semibold">正文暂时无法读取</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {documentUnavailableMessage(item.errorCode)}
              </p>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  通过原文入口查看
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </section>
          ) : null}

          {/* 来源锚点：让报告、结论与外部原文之间保持可回溯关系。 */}
          <section
            id="source-citation"
            className="mt-6 rounded-lg border border-dashed bg-muted/20 p-4"
          >
            <h2 className="text-sm font-semibold">来源与引用</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              该锚点用于从结论或外部分享回到本报告的来源位置；更细的段落锚点见正文标题与段落右侧链接。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href="#source-citation"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                来源锚点：#source-citation
              </a>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  在飞书打开原文
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </section>
        </article>
      </div>

      {headings.length > 0 && (
        <ArticleSectionNav headings={headings} mode={sectionNavMode} />
      )}
    </div>
  );
}
