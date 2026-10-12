import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Compass, Sparkles, Trophy } from 'lucide-react';
import { contentFacetsQuery } from '@client/src/query/public-queries';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';

/**
 * 玩法/数据（任务化 P1 骨架）：玩法分类树（Base「父项/子项」SSOT，与文章库同源 facets）
 * 点击分类进入既有 /gameplay/:categorySlug 完整筛选页；右栏快捷入口卡
 * 收编机制观察 / 榜单等「深挖」相关内容。P2 将在本页升级为二维筛选内容流。
 */
export default function ExplorePage() {
  const navigate = useNavigate();
  const facetsQuery = useQuery(contentFacetsQuery({}));
  const gameplay = facetsQuery.data?.gameplay ?? [];
  const loading = facetsQuery.isPending;

  const goCategory = (name: string) => {
    navigate(`/gameplay/${encodeURIComponent(name)}`);
  };

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5 pb-10">
        {/* 任务语境条 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            玩法/数据
          </span>
          <span className="text-xs text-muted-foreground">
            沿玩法分类树找品类：报告、机制观察、榜单一站聚合
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          {/* 左：玩法分类树 */}
          <div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : facetsQuery.isError && !facetsQuery.data ? (
              <EmptyState title="分类数据暂时无法加载，请稍后重试" />
            ) : gameplay.length === 0 ? (
              <EmptyState
                title="暂无玩法分类数据"
                description="分类由文章库「玩法分类父项/子项」派生，录入后自动出现。"
              />
            ) : (
              <div className="space-y-3">
                {gameplay.map((parent) => (
                  <div
                    key={parent.value}
                    className="rounded-xl border bg-card p-4"
                  >
                    <button
                      type="button"
                      onClick={() => goCategory(parent.value)}
                      className="group flex w-full items-center gap-2 text-left"
                    >
                      <span className="text-sm font-semibold group-hover:text-primary">
                        {parent.label}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {parent.count}
                      </span>
                      <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </button>
                    {parent.children.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {parent.children.map((child) => (
                          <button
                            key={child.value}
                            type="button"
                            onClick={() => goCategory(child.value)}
                            className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                          >
                            {child.label}
                            <span className="ml-1 text-[11px] opacity-70">
                              {child.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  部分存量文章尚未打玩法分类（约一半），未覆盖的内容可在
                  <Link
                    to="/library"
                    className="mx-1 text-primary hover:underline"
                  >
                    文章库
                  </Link>
                  按时间浏览；AI 打标方案上线后将自动补全。
                </p>
              </div>
            )}
          </div>

          {/* 右：快捷入口卡（机制观察 / 榜单） */}
          <aside className="space-y-3">
            <Link
              to="/mechanism-observatory"
              className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold group-hover:text-primary">
                  机制观察
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  一游戏一条的结构化玩法拆解
                </span>
              </span>
            </Link>
            <Link
              to="/ranking"
              className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Trophy className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold group-hover:text-primary">
                  榜单数据
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Steam / AppStore / 微信畅销榜
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
              <Compass className="h-4 w-4 shrink-0" />
              二维筛选（玩法 × 内容形态混排）将在下一阶段上线
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
