import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
// 报头衬线标题字体（思源宋体 800 自托管子集，3 分包 ~107KB 随本页 chunk 加载）。
// ⚠️ 勿改回 @fontsource 整包：196 个字体资产会让平台构建撞 10 分钟硬超时（已实测 failed）；
// ⚠️ 勿移入入口：@font-face 规则进 entry css 会撑破 budget:check（实测 gzip 76.7KB>25KB）。
import '@client/src/styles/masthead-font.css';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, Compass, Radar, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { articleListQuery } from '@client/src/api/articles';
import AiAskBar from '@client/src/components/AiAskBar';
import ArticlePreviewModal from '@client/src/components/ArticlePreviewModal';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import type { ArticleListItem } from '@client/src/types/content';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import {
  gameplayCategoryLabel,
} from '@shared/gameplay-category';

const NEW_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const RECENT_COUNT = 6;

/** 品类快捷入口：与顶栏 SearchBar 同语义，跳文章库并带搜索词。 */
const QUICK_LINKS = [
  { label: '吃丹like', q: '吃丹like' },
  { label: '赛季制 SLG', q: '赛季制' },
  { label: '副玩法设计', q: '副玩法' },
  { label: '开箱like', q: '开箱like' },
] as const;

/** 任务入口卡（任务化导航 P1）：按研究任务组织站内动线（方案 docs/nav-tasks-redesign-plan.md §2）。 */
const TASK_CARDS: { label: string; desc: string; path: string; Icon: LucideIcon }[] = [
  { label: '找结论', desc: '问 AI · 翻深度报告', path: '/insights', Icon: Sparkles },
  { label: '看数据', desc: '榜单与市场行情', path: '/ranking', Icon: BarChart3 },
  { label: '玩法/数据', desc: '玩法分类树找品类', path: '/explore', Icon: Compass },
  { label: '盯竞品', desc: '竞品周报 · 问 AI', path: '/watch', Icon: Radar },
];

/**
 * 首页（V3 杂志卡片版）：报头 masthead + AI 问答大入口（渐变呼吸边框）+
 * 最近收录 6 篇文章卡片。顶栏导航保持全局 Layout 不变；
 * 旧版头版头条 + 瀑布流版式见 tag `pre-homepage-v3`，可整体回退。
 */
export default function HomePage() {
  const navigate = useNavigate();
  // 卡片摘要就地预览（单例弹窗，页级共享状态）
  const [previewItem, setPreviewItem] = useState<ArticleListItem | null>(null);
  const recentQuery = useQuery({
    ...articleListQuery({ limit: RECENT_COUNT, offset: 0, order: 'desc' }),
    placeholderData: keepPreviousData,
  });
  const items = recentQuery.data?.items ?? [];
  const firstLoading = recentQuery.isPending && !recentQuery.data;

  const handleAsk = (query: string) => {
    const q = query.trim();
    navigate(q ? `/ask?q=${encodeURIComponent(q)}` : '/ask');
  };

  const renderSkeletonGrid = () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: RECENT_COUNT }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );

  return (
    <div className="page-scroll">
      {/* Google 式首屏：内容块在视口剩余高度内垂直+水平居中；超高时自然滚动 */}
      <div className="flex min-h-full flex-col justify-center">
        <div className="page-container mx-auto w-full max-w-6xl px-6 pb-10 pt-6">
        {/* 报头 masthead */}
        <div className="mb-10 text-center">
          <p className="mb-3 text-[11px] tracking-[0.4em] text-muted-foreground">
            PRODUCT RESEARCH WIKI
          </p>
          <h1 className="text-4xl font-extrabold tracking-wide sm:text-[44px]">
            产品研究
            <span className="font-serif italic">知识库</span>
          </h1>
          <div className="mx-auto mt-5 h-[3px] w-16 rounded bg-foreground" />
        </div>

        {/* AI 问答大入口（渐变呼吸边框，唯一实现复用 AiAskBar） */}
        <div className="mx-auto max-w-2xl">
          <AiAskBar
            onAsk={handleAsk}
            hero
            autoFocus
            placeholder="搜索机制、品类、公司，或直接提问 AI…"
          />
          <div className="mt-4 text-center text-xs text-muted-foreground">
            试试：
            {QUICK_LINKS.map((link, index) => (
              <span key={link.q}>
                {index > 0 && <span className="mx-1.5">·</span>}
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/library?q=${encodeURIComponent(link.q)}`)
                  }
                  className="border-b border-dotted border-muted-foreground/60 pb-px transition-colors hover:border-foreground hover:text-foreground"
                >
                  {link.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* 任务入口卡：四大研究任务直达 */}
        <section className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 lg:grid-cols-4">
          {TASK_CARDS.map(({ label, desc, path, Icon }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className="group flex flex-col items-start gap-1.5 rounded-xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold group-hover:text-primary">
                {label}
              </span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </section>

        {/* 最近收录 */}
        <section className="mt-16">
          <div className="mb-6 flex items-center gap-4">
            <span className="text-[13px] font-bold tracking-[0.25em]">
              最近收录
            </span>
            <span className="h-px flex-1 bg-border" />
            <button
              type="button"
              onClick={() => navigate('/library')}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              全部文章
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {firstLoading ? (
            renderSkeletonGrid()
          ) : recentQuery.isError && !recentQuery.data ? (
            <EmptyState title="首页数据暂时无法加载，请稍后重试" />
          ) : items.length === 0 ? (
            <EmptyState title="暂无已批准文章" />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <HomeCompactCard
                  key={item.docId}
                  item={item}
                  onPreview={setPreviewItem}
                />
              ))}
            </div>
          )}
        </section>

        <ArticlePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
        </div>
      </div>
    </div>
  );
}

/**
 * 首页小卡片：无封面、无摘要，仅品类徽标 + 相对时间 + 标题；
 * 标签/日期派生口径与瀑布流卡同源（tag-color / relative-date），点击行为一致（就地预览）。
 */
function HomeCompactCard({
  item,
  onPreview,
}: {
  item: ArticleListItem;
  onPreview: (item: ArticleListItem) => void;
}) {
  const label = gameplayCategoryLabel(item.gameplayParent, item.gameplayChild);
  const relativeTime = formatRelativeSourceDate(item.sourceDate);
  const sourceTime = item.sourceDate ? new Date(item.sourceDate).getTime() : NaN;
  const showNew = Number.isFinite(sourceTime) && Date.now() - sourceTime < NEW_THRESHOLD_MS;

  return (
    <Link
      to={`/article/${item.docId}`}
      onClick={(event) => {
        event.preventDefault();
        onPreview(item);
      }}
      className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className={gameplayCategoryStyle(item.gameplayParent, item.gameplayChild).badge}>
          {label}
        </span>
        {showNew && (
          <span className="rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
            NEW
          </span>
        )}
        {relativeTime && (
          <span className="ml-auto shrink-0 text-muted-foreground">{relativeTime}</span>
        )}
      </div>
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-primary">
        {item.title}
      </h3>
    </Link>
  );
}
