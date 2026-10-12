import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame } from 'lucide-react';
import { findLatestBoardPeriodLive } from '@client/src/data/rankings/latest-period';
import { Skeleton } from '@client/src/components/ui/skeleton';

/**
 * 首页 Steam 周报入口卡（横卡）：链接到最新一期有真实内容的 Steam 周报页，
 * 不在首页解析榜单内容。最新期双源选取（Base 远端优先 + 静态兜底，口径见
 * data/rankings/latest-period.ts）——榜单已 Base 化后静态产物停更，
 * 只读静态会停留在旧期（曾因此把第 37 周当成最新一期）。
 */
export default function SteamBoardCard() {
  const steamQuery = useQuery({
    queryKey: ['home', 'steam-weekly-card'] as const,
    queryFn: async () => {
      const period = await findLatestBoardPeriodLive('steam');
      return period ? { label: period.label, slug: period.slug } : null;
    },
    // 运行时数据（后端另有 60s 缓存），不能再用构建期静态时代的 Infinity。
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
  });

  if (steamQuery.isError) return null;
  if (steamQuery.isPending) {
    return (
      <section className="min-h-[15.5rem] rounded-[14px] border bg-card p-4">
        <Skeleton className="mb-3 h-5 w-44" />
        <div className="grid h-[calc(15.5rem-3.25rem)] place-items-center">
          <Skeleton className="h-24 w-40" />
        </div>
      </section>
    );
  }

  const data = steamQuery.data;
  if (!data) return null;

  return (
    <Link
      to={`/ranking/steam/${data.slug}`}
      className="group flex min-h-[15.5rem] shrink-0 flex-col rounded-[14px] border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-md"
      aria-label={`打开 Steam 热销榜周报 ${data.label}`}
    >
      {/* 头部行：与上一版榜单卡同位同尺寸，外形不变 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold group-hover:text-primary">
          Steam 热销榜周报 · {data.label}
        </h3>
        <span className="shrink-0 text-xs font-medium text-primary transition-colors group-hover:underline">
          查看周报 →
        </span>
      </div>
      {/* 内容区：撑起原榜单卡的卡身高度，链接卡信息居中呈现 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span
          aria-hidden
          className="grid h-12 w-12 place-items-center rounded-[12px] bg-gradient-to-br from-primary to-violet-600 text-primary-foreground"
        >
          <Flame className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold">最新一期已更新</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {data.label} · 热销排行与排名变化
            <br />
            点击进入完整周报
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          查看完整榜单
        </span>
      </div>
    </Link>
  );
}
