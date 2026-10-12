import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { articleListQuery } from '@client/src/api/articles';
import AiAskBar from '@client/src/components/AiAskBar';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import {
  gameplayCategoryLabel,
} from '@shared/gameplay-category';

/**
 * 预置问题 chips（任务化 P1）：点击带 q 进 /ask。
 * P3 预置路径已上线：这些问题分别命中 品类（开箱like/放置RPG）/
 * 厂商（三七互娱）/ 榜单（Steam+卖得好）意图模板。
 */
const PRESET_QUESTIONS = [
  '开箱like 的核心循环是什么？',
  '三七互娱有哪些产品？',
  'Steam 本周什么卖得好？',
  '放置RPG 近期有什么新品？',
] as const;

const REPORT_COUNT = 12;

/**
 * 找结论（任务化 P1 骨架）：AI 问答第一入口（hero + 预置问题）+ 深度研究报告流。
 * 内容类型=深度报告 的文章流复用文章库同一 query key 口径；完整筛选仍在 /library。
 */
export default function InsightsPage() {
  const navigate = useNavigate();

  const handleAsk = (query: string) => {
    const q = query.trim();
    navigate(q ? `/ask?q=${encodeURIComponent(q)}` : '/ask');
  };

  const reportsQuery = useQuery({
    ...articleListQuery({
      contentType: '深度报告',
      limit: REPORT_COUNT,
      offset: 0,
      order: 'desc',
    }),
    placeholderData: keepPreviousData,
  });
  const items = reportsQuery.data?.items ?? [];
  const firstLoading = reportsQuery.isPending && !reportsQuery.data;

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5 pb-10">
        {/* 任务语境条 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            找结论
          </span>
          <span className="text-xs text-muted-foreground">
            直接问 AI，或翻深度研究报告
          </span>
        </div>

        {/* AI 问答 hero（复用呼吸边框唯一实现）+ 预置问题 */}
        <div className="mx-auto mt-8 max-w-2xl">
          <AiAskBar
            onAsk={handleAsk}
            hero
            placeholder="问厂商、问品类、问机制，或描述你的研究问题…"
          />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {PRESET_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => handleAsk(question)}
                className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
                {question}
              </button>
            ))}
          </div>
        </div>

        {/* 深度研究报告流 */}
        <section className="mt-12">
          <div className="mb-5 flex items-center gap-4">
            <span className="text-[13px] font-bold tracking-[0.25em]">
              深度报告
            </span>
            {reportsQuery.data && (
              <span className="text-xs text-muted-foreground">
                共 {reportsQuery.data.total} 份
              </span>
            )}
            <span className="h-px flex-1 bg-border" />
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              文章库看全部（含转载/周报）
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {firstLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : reportsQuery.isError && !reportsQuery.data ? (
            <EmptyState title="报告数据暂时无法加载，请稍后重试" />
          ) : items.length === 0 ? (
            <EmptyState
              title="暂无已批准的深度报告"
              description="可到文章库查看快讯转载与竞品周报。"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((item) => (
                <Link
                  key={item.docId}
                  to={`/article/${item.docId}`}
                  className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        gameplayCategoryStyle(
                          item.gameplayParent,
                          item.gameplayChild,
                        ).badge
                      }
                    >
                      {gameplayCategoryLabel(
                        item.gameplayParent,
                        item.gameplayChild,
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {formatRelativeSourceDate(item.sourceDate)}
                    </span>
                  </div>
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-primary">
                    {item.title}
                  </h3>
                  {item.summary && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
