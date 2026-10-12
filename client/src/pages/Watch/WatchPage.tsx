import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Radar, Sparkles } from 'lucide-react';
import { articleListQuery } from '@client/src/api/articles';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import {
  gameplayCategoryLabel,
} from '@shared/gameplay-category';

/**
 * 「问 AI 盯厂商」预置问题：点击带 q 进 /ask。P3 预置路径已上线：
 * 含厂商实体名（三七互娱）的问题命中厂商意图模板（实体提及文章 + 共现产品清单）；
 * 「4399」暂未入实体词典，走兜底跨来源检索（后续词典补录即自动命中）。
 */
const VENDOR_QUESTIONS = [
  '三七互娱有哪些产品？各自的核心玩法是什么？',
  '4399 近期在测试什么新品？',
] as const;

/**
 * 盯竞品（任务化 P1 骨架）：竞品信息周报列表（内容类型=竞品周报）
 * + 「问 AI 盯厂商」预置路径卡。实体词典/关系网络不在此页（v2 决策）。
 */
export default function WatchPage() {
  const navigate = useNavigate();

  const weeklyQuery = useQuery({
    ...articleListQuery({
      contentType: '竞品周报',
      limit: 20,
      offset: 0,
      order: 'desc',
    }),
    placeholderData: keepPreviousData,
  });
  const items = weeklyQuery.data?.items ?? [];
  const firstLoading = weeklyQuery.isPending && !weeklyQuery.data;

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5 pb-10">
        {/* 任务语境条 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            盯竞品
          </span>
          <span className="text-xs text-muted-foreground">
            竞品信息周报 + 问 AI 盯厂商
          </span>
        </div>

        {/* 问 AI 盯厂商 */}
        <div className="mt-6 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">问 AI 盯厂商</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            直接问厂商或产品名，AI 会检索站内报告与机制观察后总结；
            以下问题点击即问。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {VENDOR_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() =>
                  navigate(`/ask?q=${encodeURIComponent(question)}`)
                }
                className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        {/* 竞品周报列表 */}
        <section className="mt-10">
          <div className="mb-5 flex items-center gap-4">
            <span className="text-[13px] font-bold tracking-[0.25em]">
              竞品周报
            </span>
            {weeklyQuery.data && (
              <span className="text-xs text-muted-foreground">
                共 {weeklyQuery.data.total} 期
              </span>
            )}
            <span className="h-px flex-1 bg-border" />
            <Link
              to="/library?type=竞品周报"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              在文章库中查看
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {firstLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : weeklyQuery.isError && !weeklyQuery.data ? (
            <EmptyState title="周报数据暂时无法加载，请稍后重试" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="暂无已批准的竞品周报"
              description="周报经文章工作台审批流批准后自动进站。"
            />
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <Link
                  key={item.docId}
                  to={`/article/${item.docId}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
                >
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    周报
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold group-hover:text-primary">
                      {item.title}
                    </span>
                    {item.summary && (
                      <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                        {item.summary}
                      </span>
                    )}
                  </span>
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
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {formatRelativeSourceDate(item.sourceDate)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
