import { Fragment, useMemo, useState } from 'react';
import {
  Gamepad2,
  Image as ImageIcon,
  Newspaper,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import EmptyState from '@client/src/components/ui/empty-state';
import { Skeleton } from '@client/src/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';
import {
  mechanismScoreHintsQuery,
  mechanismsQuery,
} from '@client/src/api/insight';
import {
  fetchQuickTools,
  openQuickTool,
} from '@client/src/api/quick-tools';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import type { MechanismListItem } from '@client/src/types/insight';
import MechanismScoreBadges, {
  hasMechanismScore,
} from '@client/src/components/mechanism/MechanismScoreBadges';
import { displayNameOf } from '@client/src/lib/mechanism-display-name';
import { resolveMediaSrc } from '@client/src/lib/media-src';
import {
  prefetchMechanismDetailChunk,
  prefetchMechanismDetailData,
} from '@client/src/lib/mechanism-prefetch';
import {
  QUICK_TOOLS_MECHANISM_WEEKLY_CATEGORY,
  quickToolTarget,
} from '@shared/quick-tools';
import type { QuickToolItem } from '@shared/quick-tools';
import {
  decodeHtmlEntities,
  normalizeExternalUrl,
} from '@shared/base-text';

/**
 * 排序键（2026-09-29 起按用户指定收敛为三种，去掉原「游戏名 A-Z」）：
 * - `updated`：更新时间（= Base 系统「修改时间」）新 → 旧
 * - `market`：市场认可指数 高 → 低
 * - `innovation`：核心创新指数 高 → 低
 */
type SortKey = 'updated' | 'market' | 'innovation';

const DEFAULT_SORT: SortKey = 'updated';

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'updated', label: '更新时间' },
  { key: 'market', label: '市场认可度' },
  { key: 'innovation', label: '机制创新度' },
];

/**
 * URL `?sort=` 解析。旧链接里的 `latest` / `name` 一律落到默认键，
 * 不做兼容分支（`name` 排序已下线）。
 */
function parseSortKey(raw: string | null): SortKey {
  return raw === 'market' || raw === 'innovation' ? raw : DEFAULT_SORT;
}

/** 从更新时间派生月份（YYYY-MM）；解析不出来返回 null，该条不进月份 chips。 */
function updateMonth(value: string | null): string | null {
  const month = value?.trim().slice(0, 7);
  return month && /^\d{4}-\d{2}$/u.test(month) ? month : null;
}

function formatMonthLabel(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/u);
  return match ? `${match[1]}年${Number(match[2])}月` : month;
}

/**
 * 时间降序（新的在前）。比较函数一律写成显式三分支：
 * 返回负数 = a 排在前，正数 = a 排在后 —— 不用 `Number(a) - Number(b)` 这类写法（历史上写反过方向）。
 */
function compareByUpdatedDesc(
  a: MechanismListItem,
  b: MechanismListItem,
): number {
  const left = a.updatedAt ?? '';
  const right = b.updatedAt ?? '';
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}

/**
 * 指数降序（高分在前），**null 一律沉底**。
 * 同样显式三分支：不要写成 `(b ?? -Infinity) - (a ?? -Infinity)`（方向容易写反，
 * 且 null 与 0 分会被混为一谈）。
 */
function compareByScoreDesc(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  if (typeof left !== 'number' && typeof right !== 'number') return 0;
  if (typeof left !== 'number') return 1;
  if (typeof right !== 'number') return -1;
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

const SORT_COMPARATORS: Record<
  SortKey,
  (a: MechanismListItem, b: MechanismListItem) => number
> = {
  updated: compareByUpdatedDesc,
  market: (a, b) => compareByScoreDesc(a.marketScore, b.marketScore),
  innovation: (a, b) =>
    compareByScoreDesc(a.innovationScore, b.innovationScore),
};

/**
 * 悬停/聚焦即预取：同时暖代码块与详情数据，把「点击→出内容」的等待挪到
 * 用户移动指针的那几百毫秒里。两个预取都静默失败，不影响任何交互。
 */
function prefetchMechanismDetail(stableKey: string): void {
  prefetchMechanismDetailChunk();
  prefetchMechanismDetailData(stableKey);
}

function buildParams(input: {
  q: string;
  month: string;
  sort: SortKey;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.month) params.set('month', input.month);
  if (input.sort !== DEFAULT_SORT) params.set('sort', input.sort);
  return params;
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1.5 text-sm transition ${
    active
      ? 'border-primary bg-primary/10 font-medium text-primary'
      : 'text-muted-foreground hover:border-primary hover:text-primary'
  }`;
}

function sortClass(active: boolean): string {
  return `rounded-md px-2 py-1 transition ${
    active ? 'bg-primary/10 font-medium text-primary' : 'hover:text-primary'
  }`;
}

/** 机制观察列表：搜索（服务端）+ 月份分组 / 排序（前端派生）+ 机制卡片。 */
export default function MechanismObservatoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const month = searchParams.get('month') ?? '';
  const sort: SortKey = parseSortKey(searchParams.get('sort'));
  const [input, setInput] = useState(query);

  const mechanismsQueryResult = useQuery(mechanismsQuery({ search: query }));

  /**
   * 两个指数列的字段描述（Base 侧的方法论说明），供排序按钮与分值徽标悬停提示。
   * 描述与列表数据无关（key 不带参数），页面级取一次即可 —— 不在每张卡片里
   * 各自请求，否则一屏十几张卡就是十几次相同请求。
   */
  const scoreHintsQueryResult = useQuery(mechanismScoreHintsQuery());
  const scoreHints = scoreHintsQueryResult.data ?? null;

  const items = mechanismsQueryResult.data?.items ?? [];
  const loading = mechanismsQueryResult.isPending;

  /**
   * 机制周报（2026-10-10）：周报原件的 SSOT = 便捷工具表「分类=机制周报」行
   * （与互动内容同勾稽）。打开方式与主网格同规则（有什么读什么，读列解锁
   * 2026-10-10）：附件行 openQuickTool() fetch→Blob 新窗渲染、链接行外链新标签；
   * 仅 README 无原件的行不进横条（周报语义=可打开的期报原件）。
   * 服务端已按「日期」降序，前端只过滤；周报不是机制条目，不进下方卡片网格，
   * 独立横条展示。空数组时整段不渲染（本页不出现「暂无周报」噪音）。
   */
  const weeklyQuery = useQuery({
    queryKey: ['quick-tools', 'mechanism-weekly'],
    queryFn: fetchQuickTools,
  });
  const weeklyItems = useMemo(
    () =>
      (weeklyQuery.data ?? []).filter((item) => {
        if (item.category !== QUICK_TOOLS_MECHANISM_WEEKLY_CATEGORY)
          return false;
        const target = quickToolTarget(item);
        return target !== null && target.kind !== 'readme';
      }),
    [weeklyQuery.data],
  );

  /** 周报附件行点击：fetch→Blob 新窗渲染（手势内同步开窗，勿改成 <a> 导航）。 */
  const openWeekly = (item: QuickToolItem) => {
    void openQuickTool(item).catch(() => {
      window.alert(`「${item.name}」打开失败，请稍后重试。`);
    });
  };

  /** 月份 chips：接口没有月份参数，由更新时间前端派生（新月份在前）。 */
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const value = updateMonth(item.updatedAt);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (a.value < b.value) return 1;
        if (a.value > b.value) return -1;
        return 0;
      });
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered = month
      ? items.filter((item) => updateMonth(item.updatedAt) === month)
      : [...items];
    filtered.sort(SORT_COMPARATORS[sort]);
    return filtered;
  }, [items, month, sort]);

  const figureCount = visibleItems.filter((item) => Boolean(item.figureUrl)).length;

  /**
   * entryType 目前 37 条全同值（「游戏分析」），全同值渲染就是冗余；
   * 只有当当前数据集里真的存在 ≥2 种类型时才展示该 badge。
   */
  const hasMultipleEntryTypes = useMemo(() => {
    const types = new Set<string>();
    for (const item of items) {
      const value = decodeHtmlEntities(item.entryType ?? '').trim();
      if (value) types.add(value);
    }
    return types.size >= 2;
  }, [items]);

  const setQuery = (value: string) => {
    setSearchParams(buildParams({ q: value, month, sort }), { replace: true });
  };

  const setMonth = (value: string) => {
    setSearchParams(buildParams({ q: query, month: value, sort }), {
      replace: true,
    });
  };

  const setSort = (value: SortKey) => {
    setSearchParams(buildParams({ q: query, month, sort: value }), {
      replace: true,
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(input.trim());
  };

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5">
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="搜索游戏名、机制、优点或利用方法"
              className="pl-9"
              aria-label="搜索机制"
            />
          </div>
          <Button type="submit">筛选</Button>
        </form>

        {/* 机制周报横条：便捷工具表「分类=机制周报」，按行内容打开（附件新窗 / 链接外链） */}
        {weeklyItems.length > 0 ? (
          <section className="mt-3 rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">机制周报</h2>
              <span className="text-xs text-muted-foreground">
                每周机制观察原件，按行内容在新窗或外链打开
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {weeklyItems.map((item) => {
                const target = quickToolTarget(item);
                if (!target || target.kind === 'readme') return null;
                const cardInner = (
                  <>
                    <div className="flex items-center gap-2">
                      <Newspaper
                        className="h-4 w-4 shrink-0 text-primary"
                        aria-hidden
                      />
                      <h3 className="min-w-0 truncate text-sm font-medium group-hover:text-primary">
                        {item.name}
                      </h3>
                    </div>
                    {item.description ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    <span className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
                      <span>
                        {target.kind === 'external' ? '外部链接 ↗' : 'HTML 原件'}
                      </span>
                      <span className="shrink-0">
                        {formatRelativeSourceDate(item.date?.slice(0, 10))}
                      </span>
                    </span>
                  </>
                );
                const cardClass =
                  'group flex flex-col rounded-lg border bg-background p-3 text-left transition hover:border-primary/50 hover:shadow-sm';
                if (target.kind === 'external') {
                  return (
                    <a
                      key={item.id}
                      href={target.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cardClass}
                    >
                      {cardInner}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openWeekly(item)}
                    className={cardClass}
                  >
                    {cardInner}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {months.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMonth('')}
                className={chipClass(month === '')}
              >
                全部月份
              </button>
              {months.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setMonth(entry.value)}
                  className={chipClass(month === entry.value)}
                >
                  {formatMonthLabel(entry.value)} · {entry.count}
                </button>
              ))}
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            <span className="mr-1">排序</span>
            {SORT_OPTIONS.map((option) => {
              // 只有两个指数列在 Base 里带字段描述；「更新时间」是系统字段，
              // 没有描述可读 ⇒ 该按钮不加提示（是有意为之，不是漏做）。
              const hint =
                option.key === 'market'
                  ? scoreHints?.market
                  : option.key === 'innovation'
                    ? scoreHints?.innovation
                    : null;
              const button = (
                <button
                  type="button"
                  onClick={() => setSort(option.key)}
                  className={sortClass(sort === option.key)}
                >
                  {option.label}
                </button>
              );
              // 无描述时用 Fragment 原样输出按钮：不引入额外 DOM 节点，
              // 父容器的 flex 间距不受影响。
              if (!hint) {
                return <Fragment key={option.key}>{button}</Fragment>;
              }
              return (
                <Tooltip key={option.key}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent className="max-w-xs leading-relaxed">
                    {hint}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>共 {visibleItems.length} 条机制条目</span>
          {figureCount > 0 ? <span>已标注流程图 {figureCount} 条</span> : null}
        </div>

        {loading ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <Skeleton key={value} className="h-44 w-full rounded-xl" />
            ))}
          </div>
        ) : mechanismsQueryResult.isError ? (
          <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            机制观察暂时无法加载，请稍后重试。
          </div>
        ) : visibleItems.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => {
              const coreHook = decodeHtmlEntities(item.coreHook ?? '').trim();
              const entryType = decodeHtmlEntities(item.entryType ?? '').trim();
              const sourceUrl = normalizeExternalUrl(item.sourceLink);
              const displayName = displayNameOf(item);
              const iconSrc = resolveMediaSrc(item.iconUrl);
              const showEntryType = hasMultipleEntryTypes && Boolean(entryType);
              const hasBadges = showEntryType || Boolean(item.figureUrl);
              // 指数徽标：与排序维度同名同值，让「为什么这样排」在卡片上可自解释。
              const hasScores = hasMechanismScore(
                item.marketScore,
                item.innovationScore,
              );

              return (
                <div
                  key={item.stableKey}
                  className="group relative block cursor-pointer rounded-xl border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm focus-within:ring-2 focus-within:ring-ring"
                >
                  <div className="flex items-start gap-3">
                    {/*
                      图标位固定 56px（h-14 w-14）且**恒渲染**：无图标时占位方块补位，
                      保证同排卡片文字起始列对齐；object-cover 兜住非 1:1 素材不拉伸。
                      src 必须过 resolveMediaSrc：服务端下发的是根相对路径 /media/...，
                      不补 CLIENT_BASE_PATH 前缀会打到站点根 → 线上整列表裂图。
                    */}
                    <div className="mt-0.5 h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted/40">
                      {iconSrc ? (
                        <img
                          src={iconSrc}
                          alt=""
                          width={56}
                          height={56}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Gamepad2 className="h-5 w-5" aria-hidden />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <h2 className="min-w-0 flex-1 line-clamp-2 text-[15px] font-semibold group-hover:text-primary">
                          {displayName.primary}
                        </h2>
                        {displayName.tentative ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            title="该中文名为试译，非官方定名"
                          >
                            试译
                          </Badge>
                        ) : null}
                      </div>
                      {displayName.secondary ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {displayName.secondary}
                        </p>
                      ) : null}
                      <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-muted-foreground">
                        {coreHook || '暂无机制摘要'}
                      </p>
                    </div>
                  </div>

                  {/* 徽标与出处合并成一行：徽标左、出处右，避免两行留白挤掉正文高度 */}
                  {hasBadges || hasScores || sourceUrl ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {showEntryType ? (
                        <Badge variant="secondary">{entryType}</Badge>
                      ) : null}
                      {item.figureUrl ? (
                        <Badge variant="outline" className="gap-1">
                          <ImageIcon className="h-3 w-3" aria-hidden />
                          流程图
                        </Badge>
                      ) : null}
                      <MechanismScoreBadges
                        marketScore={item.marketScore}
                        innovationScore={item.innovationScore}
                        hints={scoreHints}
                      />
                      {sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="relative z-20 ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          原始出处
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 热区放在内容之后并抬到 z-10：内容节点不再定位，整卡（含留白）因此都可点开 */}
                  <Link
                    to={`/mechanism-observatory/${encodeURIComponent(item.stableKey)}`}
                    onMouseEnter={() => prefetchMechanismDetail(item.stableKey)}
                    onFocus={() => prefetchMechanismDetail(item.stableKey)}
                    className="absolute inset-0 z-10 rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`打开机制「${displayName.primary}」详情`}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState
              icon={Sparkles}
              title="暂无已发布的机制条目"
              description={
                query || month
                  ? '当前筛选条件下没有匹配条目，试试调整搜索或月份。'
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
