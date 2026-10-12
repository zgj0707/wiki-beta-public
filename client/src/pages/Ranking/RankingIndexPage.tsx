import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gamepad2, LineChart, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BOARDS_META, type BoardKey } from '@client/src/data/rankings';
import { fetchBoardsMeta, type RemoteBoardsMeta } from '@client/src/data/rankings/remote';

/** 榜单入口页条目：三份榜单资料的静态描述（正文仍在 /ranking/:board 按期按需加载）。 */
const RANKING_ENTRIES: Array<{
  key: BoardKey;
  icon: LucideIcon;
  description: string;
}> = [
  {
    key: 'appstore',
    icon: LineChart,
    description: 'App Store SLG 周下载榜与历史周期',
  },
  {
    key: 'weixin',
    icon: Smartphone,
    description: '微信小游戏畅销榜资料',
  },
  {
    key: 'steam',
    icon: Gamepad2,
    description: 'Steam 周期榜单资料',
  },
];

/**
 * 榜单：原「数据中心」页的三个榜单入口迁入本页（数据中心页已下线），
 * 卡片点击进入 /ranking/:board，该页默认展示最新一期。
 */
export default function RankingIndexPage() {
  // 「最新一期」标签双源：服务端（Base 驱动）优先，静态兜底；
  // 静态产物只在构建时更新，Base 新增的周期仅经远端 meta 可见。
  const [remoteMeta, setRemoteMeta] = useState<RemoteBoardsMeta | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchBoardsMeta().then((meta) => {
      if (alive) setRemoteMeta(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5">
        {/* 工具条承担语境（无标题横幅，与首页/板块页一致） */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            榜单资料
          </span>
          <span className="text-xs text-muted-foreground">
            三份真实榜单原始资料，点卡片进入对应榜单（默认展示最新一期）
          </span>
        </div>

        <div className="mt-5 pb-10">
          <div className="grid gap-4 md:grid-cols-3">
            {RANKING_ENTRIES.map((entry) => {
              const Icon = entry.icon;
              const board = { ...BOARDS_META[entry.key], ...(remoteMeta?.[entry.key] ?? {}) };
              const latest =
                board.type === 'periods'
                  ? (board.periods[0]?.label ?? '暂无周期')
                  : '单页资料';
              return (
                <Link
                  key={entry.key}
                  to={`/ranking/${entry.key}`}
                  className="group flex flex-col rounded-2xl border bg-card p-5 transition hover:border-primary/50 hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <h3 className="min-w-0 text-sm font-semibold group-hover:text-primary">
                      {board.title}
                    </h3>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    最新：{latest}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-primary">
                    打开榜单
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            榜单保持原始资料展示；榜单中的产品若已建立实体，会在榜单页直接提供实体跳转，未建立的项目不被强行推断关联。
          </p>
        </div>
      </div>
    </div>
  );
}
