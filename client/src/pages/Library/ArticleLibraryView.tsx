import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { contentFacetsQuery } from '@client/src/query/public-queries';
import { articleListQuery } from '@client/src/api/articles';
import type { FetchArticleListResult } from '@client/src/api/articles';
import type { ContentGameplayFacet } from '@client/src/api/content';
import type { ArticleListItem } from '@client/src/types/content';
import ArticleWaterfallCard from '@client/src/components/ArticleWaterfallCard';
import ArticlePreviewModal from '@client/src/components/ArticlePreviewModal';
import { useWaterfallColumns } from '@client/src/hooks/use-waterfall-columns';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import Pagination from '@client/src/components/ui/pagination';
import { cn } from '@client/src/lib/utils';
import type { InitialDataPayload } from '@client/src/types/initial-data';

const PAGE_SIZE = 20;

/** B2 注入式首屏预取：服务端渲染 HTML 时注入的默认视图第一页数据（与 list 响应同构）。 */
/** 每次页面加载只允许消费一次注入数据，避免 SPA 回退时读到过期快照。 */
let initialDataConsumed = false;

function readInitialLibrary(): FetchArticleListResult | null {
  if (initialDataConsumed) return null;
  const data = (
    window as unknown as { __INITIAL_DATA__?: InitialDataPayload | null }
  ).__INITIAL_DATA__;
  if (!data?.library?.items?.length) return null;
  return {
    items: data.library.items,
    total: data.library.total ?? data.library.items.length,
    nextCursor: null,
  };
}

/** 时间窗选项；与后端 days 过滤口径对齐（按「飞书来源日期」，无日期记录被排除）。 */
const DAY_OPTIONS = [
  { value: '0', label: '全部时间' },
  { value: '1', label: '最近 1 天' },
  { value: '7', label: '最近一周' },
  { value: '30', label: '最近一月' },
  { value: '180', label: '最近半年' },
] as const;

const ORDER_OPTIONS = [
  { value: 'desc', label: '最新优先' },
  { value: 'asc', label: '最早优先' },
] as const;

/** 单枚筛选胶囊：选中=主色实心，未选中=描边；计数以弱化色跟随。 */
function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
        active
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      <span className="truncate">{children}</span>
      {typeof count === 'number' && (
        <span
          className={cn(
            'tabular-nums',
            active ? 'text-primary-foreground/80' : 'text-muted-foreground/70',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** 一行胶囊：左侧固定宽标签保证多行对齐，胶囊组可换行。 */
function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <span className="w-9 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export interface ArticleLibraryViewProps {
  title: string;
  description?: string;
  /** 固定分类页（/gameplay/<分类名>）传入分类名；有值时分类筛选行隐藏。 */
  fixedGameplayCategory?: string;
  gameplayCategoryLabel?: string;
}

export default function ArticleLibraryView({
  title,
  description,
  fixedGameplayCategory,
  gameplayCategoryLabel,
}: ArticleLibraryViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const rawTypeParam = searchParams.get('type') ?? '';
  // 旧链接兼容：`?type=cat:<分类名>` 曾是「分类」的编码方式，读取时归一到 ?cat=。
  const legacyCategory = rawTypeParam.startsWith('cat:')
    ? rawTypeParam.slice(4)
    : '';
  const typeParam = legacyCategory ? '' : rawTypeParam;
  const categoryParam =
    fixedGameplayCategory || legacyCategory || searchParams.get('cat') || '';
  const daysParam = searchParams.get('days') ?? '0';
  const orderParam = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

  const [input, setInput] = useState(q);
  const [offset, setOffset] = useState(0);
  // 卡片预览弹窗：点击瀑布流卡就地查看摘要与元信息（与首页同一交互）。
  const [previewItem, setPreviewItem] = useState<ArticleListItem | null>(null);

  useEffect(() => setInput(q), [q]);

  /** 统一改 URL：所有筛选状态都在 query string，可分享、可回退。 */
  const updateParams = useCallback(
    (patch: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            const defaultValue = key === 'days' ? '0' : '';
            if (!value || value === defaultValue) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: false },
      );
      setOffset(0);
    },
    [setSearchParams],
  );

  const listParams = {
    search: q || undefined,
    contentType: typeParam || undefined,
    gameplayCategory: categoryParam || undefined,
    days: Number(daysParam) || undefined,
    order: orderParam as 'asc' | 'desc',
    limit: PAGE_SIZE,
    offset,
  };
  const initialData = useMemo(() => {
    const isDefaultView =
      !fixedGameplayCategory &&
      !q &&
      !rawTypeParam &&
      !searchParams.get('cat') &&
      daysParam === '0' &&
      orderParam === 'desc' &&
      offset === 0;
    if (!isDefaultView) {
      initialDataConsumed = true;
      return undefined;
    }
    const injected = readInitialLibrary();
    if (injected) initialDataConsumed = true;
    return injected ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fixedGameplayCategory,
    q,
    rawTypeParam,
    searchParams,
    daysParam,
    orderParam,
    offset,
  ]);
  const listQuery = useQuery({
    ...articleListQuery(listParams),
    initialData,
    initialDataUpdatedAt: initialData ? Date.now() : undefined,
  });
  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const loading = listQuery.isPending;
  const error = listQuery.isError;

  const columnCount = useWaterfallColumns();
  // 按索引取模分桶：翻页/筛选时卡片列位置稳定，不整列重排。
  const columns = useMemo(() => {
    const cols: ArticleListItem[][] = Array.from(
      { length: columnCount },
      () => [],
    );
    items.forEach((item, index) => {
      cols[index % columnCount]!.push(item);
    });
    return cols;
  }, [items, columnCount]);

  // facets 的每个维度都在「已应用另一维度筛选」的集合上统计：
  // 内容类型计数随选中分类收敛，分类树计数随选中类型收敛，互不干扰。
  const facetsQuery = useQuery(
    contentFacetsQuery({
      search: q || undefined,
      contentType: typeParam || undefined,
      gameplayCategory: categoryParam || undefined,
    }),
  );
  const facets = facetsQuery.data;
  const contentTypes = facets?.contentTypes ?? [];
  const gameplayNodes = facets?.gameplay ?? [];

  // facets 的每个维度都在「已应用另一维度筛选」的集合上统计，计数为 0 的项会被
  // 后端省略 —— 若当前选中项恰好被另一维筛到 0，它会从筛选行消失、无法取消。
  // 这里为选中项补一条 0 计数占位，保证可点选可取消。
  const typeChips = useMemo(
    () =>
      !typeParam || contentTypes.some((option) => option.value === typeParam)
        ? contentTypes
        : [
            ...contentTypes,
            { value: typeParam, label: typeParam, count: 0 },
          ],
    [contentTypes, typeParam],
  );
  const categoryChips = useMemo(() => {
    if (
      !categoryParam ||
      gameplayNodes.some(
        (node) =>
          node.value === categoryParam ||
          node.children.some((child) => child.value === categoryParam),
      )
    )
      return gameplayNodes;
    return [
      ...gameplayNodes,
      {
        value: categoryParam,
        label: categoryParam,
        count: 0,
        selfCount: 0,
        children: [],
      },
    ];
  }, [gameplayNodes, categoryParam]);

  const facetsLoading = facetsQuery.isFetching;

  // 当前选中的分类若命中某个父项（自身或其一子项），则展开该父项的子项行。
  const activeParent = useMemo<ContentGameplayFacet | null>(() => {
    if (!categoryParam) return null;
    return (
      categoryChips.find(
        (node) =>
          node.value === categoryParam ||
          node.children.some((child) => child.value === categoryParam),
      ) ?? null
    );
  }, [categoryChips, categoryParam]);
  const isChildSelected =
    activeParent !== null && activeParent.value !== categoryParam;
  // 子项同样可能因另一维筛选被省略；补占位让已选项始终可见可取消。
  const childChips = useMemo(() => {
    if (!activeParent || !isChildSelected) return activeParent?.children ?? [];
    return activeParent.children.some((child) => child.value === categoryParam)
      ? activeParent.children
      : [
          ...activeParent.children,
          { value: categoryParam, label: categoryParam, count: 0 },
        ];
  }, [activeParent, isChildSelected, categoryParam]);
  const showChildRow = activeParent !== null && childChips.length > 0;

  const activeFilters = useMemo(
    () =>
      [
        typeParam && { key: 'type', label: `类型：${typeParam}`, value: typeParam },
        !fixedGameplayCategory &&
          categoryParam && {
            key: 'cat',
            label: `分类：${categoryParam}`,
            value: categoryParam,
          },
        daysParam !== '0' &&
          daysParam !== '' && {
            key: 'days',
            label:
              DAY_OPTIONS.find((option) => option.value === daysParam)?.label ??
              '时间窗',
            value: daysParam,
          },
        q && { key: 'q', label: `搜索：${q}`, value: q },
      ].filter(Boolean) as { key: string; label: string; value: string }[],
    [typeParam, categoryParam, fixedGameplayCategory, daysParam, q],
  );

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    updateParams({ q: input.trim() });
  };

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5">
        <form onSubmit={submitSearch} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="搜索标题、摘要、结论……"
              className="h-10 pl-9"
              aria-label="搜索文章库"
            />
          </div>
          <Button type="submit" className="h-10">
            搜索
          </Button>
        </form>

        <section
          className="mt-4 rounded-xl border bg-card p-4"
          aria-label="筛选条件"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={daysParam}
              onValueChange={(value) => updateParams({ days: value })}
            >
              <SelectTrigger
                className="h-8 w-[128px] text-xs"
                aria-label="按时间窗筛选"
              >
                <SelectValue placeholder="时间窗" />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={orderParam}
              onValueChange={(value) => updateParams({ order: value })}
            >
              <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="排序方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3 space-y-2.5">
            <FilterRow label="类型">
              <FilterChip
                active={!typeParam}
                onClick={() => updateParams({ type: '' })}
              >
                全部
              </FilterChip>
              {typeChips.map((option) => (
                <FilterChip
                  key={option.value}
                  active={typeParam === option.value}
                  count={option.count}
                  onClick={() =>
                    updateParams({
                      type: typeParam === option.value ? '' : option.value,
                    })
                  }
                >
                  {option.label || option.value}
                </FilterChip>
              ))}
            </FilterRow>

            {!fixedGameplayCategory && (
              <>
                <FilterRow label="分类">
                  <FilterChip
                    active={!categoryParam}
                    onClick={() => updateParams({ cat: '' })}
                  >
                    全部
                  </FilterChip>
                  {categoryChips.map((node) => (
                    <FilterChip
                      key={node.value}
                      // 钻入子项时父项仍保持高亮，表示当前仍在该父项范围内。
                      active={
                        node.value === categoryParam ||
                        node.value === activeParent?.value
                      }
                      count={node.count}
                      onClick={() =>
                        updateParams({
                          cat: node.value === categoryParam ? '' : node.value,
                        })
                      }
                    >
                      {node.label || node.value}
                    </FilterChip>
                  ))}
                </FilterRow>

                {showChildRow && activeParent && (
                  <FilterRow label="细分">
                    <FilterChip
                      active={!isChildSelected}
                      onClick={() => updateParams({ cat: activeParent.value })}
                    >
                      全部
                    </FilterChip>
                    {childChips.map((child) => (
                      <FilterChip
                        key={child.value}
                        active={child.value === categoryParam}
                        count={child.count}
                        onClick={() =>
                          updateParams({
                            cat:
                              child.value === categoryParam
                                ? activeParent.value
                                : child.value,
                          })
                        }
                      >
                        {child.label || child.value}
                      </FilterChip>
                    ))}
                  </FilterRow>
                )}
              </>
            )}
          </div>

          {activeFilters.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              {activeFilters.map((filter) => (
                <Badge
                  key={filter.key}
                  variant="secondary"
                  className="gap-1 py-1 pl-2.5"
                >
                  {filter.label}
                  <button
                    type="button"
                    aria-label={`移除${filter.label}`}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-background"
                    onClick={() =>
                      updateParams({
                        [filter.key]: filter.key === 'days' ? '0' : '',
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setSearchParams({}, { replace: false });
                  setOffset(0);
                }}
              >
                清空全部
              </Button>
            </div>
          )}
        </section>

        <section className="mt-6 pb-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="section-title">资料列表</h2>
              {fixedGameplayCategory && gameplayCategoryLabel && (
                <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  玩法标签：{gameplayCategoryLabel}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">共 {total} 条</span>
          </div>

          {loading ? (
            <div
              className="grid gap-5"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <div key={columnIndex} className="flex min-w-0 flex-col gap-5">
                  {[0, 1].map((rowIndex) => (
                    <Skeleton
                      key={rowIndex}
                      className="h-56 w-full rounded-[14px]"
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState title="文章库暂时无法加载" description="请稍后重试。" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="当前筛选组合下暂无资料"
              description="试试移除部分条件。"
            />
          ) : (
            <>
              <div
                className="grid gap-5"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                }}
              >
                {columns.map((column, columnIndex) => (
                  <div key={columnIndex} className="flex min-w-0 flex-col gap-5">
                    {column.map((item) => (
                      <ArticleWaterfallCard
                        key={item.docId}
                        item={item}
                        onPreview={setPreviewItem}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {total > PAGE_SIZE && (
                <div className="mt-5">
                  <Pagination
                    page={Math.floor(offset / PAGE_SIZE) + 1}
                    pageSize={PAGE_SIZE}
                    total={total}
                    onPageChange={(page) => setOffset((page - 1) * PAGE_SIZE)}
                  />
                </div>
              )}
            </>
          )}
          {facetsLoading && <span className="sr-only">正在更新筛选计数</span>}
        </section>
      </div>

      <ArticlePreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  );
}
