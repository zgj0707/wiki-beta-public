import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Search, Sparkles } from 'lucide-react';
import { articleListQuery } from '@client/src/api/articles';
import { mechanismsQuery } from '@client/src/api/insight';
import SearchBar from '@client/src/components/SearchBar';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import { gameplayCategoryLabel } from '@shared/gameplay-category';
import MechanismScoreBadges from '@client/src/components/mechanism/MechanismScoreBadges';

/**
 * 全站搜索结果页（任务化 P2）：SearchBar 的统一落点。
 * 聚合文章库与机制观察两路结果；更精确的过滤仍在各自板块（/library、
 * /mechanism-observatory）完成。厂商/产品类问题引导走 AI 问答（预置路径承接）。
 */
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();

  const articlesQuery = useQuery({
    ...articleListQuery({ search: q || undefined, limit: 8, offset: 0 }),
    enabled: Boolean(q),
    placeholderData: keepPreviousData,
  });
  const mechanisms = useQuery({
    ...mechanismsQuery({ search: q || undefined }),
    enabled: Boolean(q),
    placeholderData: keepPreviousData,
  });

  const articleItems = articlesQuery.data?.items ?? [];
  const mechanismItems = mechanisms.data?.items ?? [];
  const articleTotal = articlesQuery.data?.total ?? 0;
  const loading = Boolean(q) && (articlesQuery.isPending || mechanisms.isPending);

  const submitSearch = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5 pb-10">
        {/* 任务语境条 + 搜索框 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            搜索
          </span>
          <span className="text-xs text-muted-foreground">
            全站报告与机制观察一次查完
          </span>
        </div>
        <div className="mt-4 max-w-2xl">
          <SearchBar
            onSearch={submitSearch}
            value={q}
            placeholder="搜索报告、机制观察、关键词..."
          />
        </div>

        {!q ? (
          <div className="mt-10">
            <EmptyState
              icon={Search}
              title="输入关键词开始搜索"
              description="想直接要结论？试试 AI 问答——支持问厂商、产品、品类与榜单。"
              action={
                <Link
                  to="/ask"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  去 AI 问答
                </Link>
              }
            />
          </div>
        ) : loading ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : articleItems.length === 0 && mechanismItems.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              icon={Search}
              title={`没有找到与「${q}」相关的内容`}
              description="换个关键词，或让 AI 直接回答。"
              action={
                <Link
                  to={`/ask?q=${encodeURIComponent(q)}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  问 AI：「{q}」
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {/* 文章结果 */}
            <section>
              <div className="mb-4 flex items-center gap-4">
                <span className="text-[13px] font-bold tracking-[0.25em]">
                  报告与文章
                </span>
                <span className="text-xs text-muted-foreground">
                  {articleTotal} 条
                </span>
                <span className="h-px flex-1 bg-border" />
                {articleTotal > articleItems.length && (
                  <Link
                    to={`/library?q=${encodeURIComponent(q)}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    在文章库中查看全部
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
              {articleItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  文章库无匹配结果
                </p>
              ) : (
                <div className="space-y-3">
                  {articleItems.map((item) => (
                    <Link
                      key={item.docId}
                      to={`/article/${item.docId}`}
                      className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
                    >
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {item.contentType || '文章'}
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
                      {item.gameplayCategory && (
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
                      )}
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {formatRelativeSourceDate(item.sourceDate)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* 机制观察结果 */}
            <section>
              <div className="mb-4 flex items-center gap-4">
                <span className="text-[13px] font-bold tracking-[0.25em]">
                  机制观察
                </span>
                <span className="text-xs text-muted-foreground">
                  {mechanismItems.length} 条
                </span>
                <span className="h-px flex-1 bg-border" />
                <Link
                  to={`/mechanism-observatory?q=${encodeURIComponent(q)}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  在机制观察中查看
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {mechanismItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  机制观察无匹配结果
                </p>
              ) : (
                <div className="space-y-3">
                  {mechanismItems.map((item) => (
                    <Link
                      key={item.stableKey}
                      to={`/mechanism-observatory/${item.stableKey}`}
                      className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
                    >
                      <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                        机制
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold group-hover:text-primary">
                          {item.gameName || item.stableKey}
                        </span>
                        {item.coreHook && (
                          <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
                            {item.coreHook}
                          </span>
                        )}
                      </span>
                      <MechanismScoreBadges
                        marketScore={item.marketScore}
                        innovationScore={item.innovationScore}
                      />
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {formatRelativeSourceDate(item.updatedAt ?? '')}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* 兜底引导：文章形态说明（空态由 EmptyState 承担） */}
        {q && articleItems.length === 0 && mechanismItems.length === 0 ? null : (
          <p className="mt-10 flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            搜索覆盖文章标题、摘要与结论，以及机制观察的游戏名与机制描述
          </p>
        )}
      </div>
    </div>
  );
}
