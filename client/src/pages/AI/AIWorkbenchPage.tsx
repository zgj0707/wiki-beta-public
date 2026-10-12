import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  History,
  Layers,
  ListChecks,
  RefreshCw,
} from 'lucide-react';

import { fetchWorkbench } from '@client/src/api/ai-compile';
import CalibrationPanel from '@client/src/components/ai/CalibrationPanel';
import SubjectPane from '@client/src/components/ai/SubjectPane';
import SectionHeader from '@client/src/components/SectionHeader';
import StatCard from '@client/src/components/StatCard';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import EmptyState from '@client/src/components/ui/empty-state';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { cn } from '@client/src/lib/utils';
import type {
  CompileConfidence,
  CompileQueueItem,
  CompileWorkbenchView,
} from '@shared/ai-compile';

/**
 * /ai 工作台：左栏挑主体、右栏读结论。
 *
 * 布局取向（B 方案）：主体列表升级为**常驻左栏**，列表项里直接给结论首句 +
 * 置信度 + 状态——「挑」这一步就能看到结论，不必逐个点开再返回。
 * 右栏复用 `/ai/e/:slug` 的同一个组件，两个入口不可能各说各话。
 *
 * 「结论变化」直接读 compile_revision（0 次 LLM 调用），是编译层的副产品，
 * 不是另建一套定时任务。
 */
export default function AIWorkbenchPage() {
  const [data, setData] = useState<CompileWorkbenchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 不传模型：产物与统计一律按实体口径，不随浏览器里配的模型名变化。
      setData(await fetchWorkbench());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = data?.stats.compiledUnits ?? 0;
  const total = data?.stats.totalUnits ?? 0;
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;

  const queue = data?.queue ?? [];
  /** 选中态放 URL：可分享、可前进后退，刷新不丢。未指定时默认看队列首个。 */
  const selectedSlug = searchParams.get('subject') ?? queue[0]?.subjectSlug ?? null;

  /**
   * 窄屏没有「右栏」可言：直接去独立卡页（单列阅读更合适），
   * 而不是把右栏塞到列表下方让用户自己找。
   */
  const selectSubject = (slug: string) => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSearchParams({ subject: slug }, { replace: true });
    } else {
      navigate(`/ai/e/${encodeURIComponent(slug)}`);
    }
  };

  return (
    <div className="page-scroll">
      <div className="page-container flex flex-col gap-6">
        <header className="page-header">
          <div className="min-w-0">
            <p className="page-eyebrow">AI 编译层</p>
            <h1 className="page-title">工作台</h1>
            <p className="page-desc">
              把实体的全部关联文章编译成「结论 + 证据 + 未知项」，全库共享；
              打开结论卡不再消耗模型调用。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && 'animate-spin')} />
              刷新
            </Button>
            <Button asChild size="sm">
              <Link to="/ai/compile">
                <ListChecks />
                批跑编译
              </Link>
            </Button>
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-lg" />
            ))}
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatCard
                icon={Check}
                label="已编译"
                value={done}
                hint={total > 0 ? `完成度 ${completion}%` : undefined}
              />
              <StatCard icon={Layers} label="可编译主体" value={total} />
              <StatCard icon={Clock} label="待编译" value={data.stats.pendingJobs} />
              <StatCard
                icon={AlertTriangle}
                label="已过期"
                value={data.stats.staleUnits}
                hint={data.stats.staleUnits > 0 ? '输入已变更，待重编' : undefined}
                className={cn(data.stats.staleUnits > 0 && 'border-amber-500/40')}
              />
              <StatCard
                icon={AlertCircle}
                label="失败"
                value={data.stats.failedJobs}
                hint={data.stats.failedJobs > 0 ? '可在批跑页原地重试' : undefined}
                className={cn(data.stats.failedJobs > 0 && 'border-red-500/40')}
              />
            </section>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
              <aside className="rounded-xl border bg-card lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:w-[21rem] lg:shrink-0 lg:self-start lg:overflow-y-auto">
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">
                    主体（{queue.length}）
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    已编译优先 · 按参考篇数
                  </span>
                </div>
                {queue.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    没有「产品」类型且有关联资料的实体。
                  </p>
                ) : (
                  <ul className="divide-y">
                    {queue.map((item) => (
                      <li key={item.subjectId}>
                        <SubjectRow
                          item={item}
                          active={item.subjectSlug === selectedSlug}
                          onSelect={() => selectSubject(item.subjectSlug)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </aside>

              <section className="min-w-0 flex-1">
                {selectedSlug ? (
                  <SubjectPane slug={selectedSlug} onCompiled={() => void load()} />
                ) : (
                  <EmptyState
                    icon={Layers}
                    title="还没有可读的结论"
                    description="等有主体进入队列后，左栏挑一个就能在这里读它的结论与证据。"
                    action={
                      <Button asChild size="sm">
                        <Link to="/ai/compile">去批跑编译</Link>
                      </Button>
                    }
                  />
                )}
              </section>
            </div>

            <section className="flex flex-col gap-4">
              <SectionHeader
                icon={History}
                title="结论变化"
                description="编译产物的副产品，按时间倒序；点主体名进结论卡。"
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/ai/compile">全部队列</Link>
                  </Button>
                }
              />
              {data.recentRevisions.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="还没有编译产物"
                  description="去批跑页生成第一批，这里就会按时间列出结论的变更。"
                  action={
                    <Button asChild size="sm">
                      <Link to="/ai/compile">去批跑编译</Link>
                    </Button>
                  }
                />
              ) : (
                <ol className="divide-y rounded-xl border bg-card">
                  {data.recentRevisions.map((revision) => (
                    <li
                      key={`${revision.subjectSlug}-${revision.revisionNo}`}
                      className="flex flex-col gap-1 px-5 py-3.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/ai/e/${encodeURIComponent(revision.subjectSlug)}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {revision.subjectName}
                        </Link>
                        <Badge variant="outline" className="text-muted-foreground">
                          {CHANGE_LABEL[revision.changeType] ?? revision.changeType}
                        </Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          #{revision.revisionNo} ·{' '}
                          {revision.createdAt.replace('T', ' ').slice(0, 16)}
                        </span>
                      </div>
                      {revision.headline && (
                        <p className="text-sm leading-relaxed">{revision.headline}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <CalibrationPanel calibration={data.calibration} />
          </>
        )}
      </div>
    </div>
  );
}

/** 左栏一行：主体名 + 结论首句 + 来源数 + 置信度/状态。挑主体时就能看到结论。 */
function SubjectRow({
  item,
  active,
  onSelect,
}: {
  item: CompileQueueItem;
  active: boolean;
  onSelect: () => void;
}) {
  const hasHeadline = Boolean(item.headline);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full flex-col gap-1.5 border-l-2 px-4 py-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:bg-muted/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'min-w-0 truncate text-sm font-medium',
            active && 'text-primary',
          )}
        >
          {item.subjectName}
        </span>
        <StateChip state={item.state} />
      </div>

      {hasHeadline ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.headline}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/80">
          {item.state === 'failed' ? '上次编译失败' : '尚未编译'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {item.sourceCount != null
            ? `${item.sourceCount} 篇来源`
            : `${item.docCount} 篇资料`}
        </span>
        {item.confidence && <ConfidenceText value={item.confidence} />}
        <span className="ml-auto">
          {item.estTokensLow ?? '—'}–{item.estTokensHigh ?? '—'} tok
        </span>
      </div>
    </button>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  created: '首次编译',
  headline_changed: '结论变更',
  confidence_changed: '置信度变化',
  unchanged_recompiled: '重编译',
};

const STATE_LABEL: Record<string, { text: string; className: string }> = {
  done: {
    text: '已编译',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  pending: { text: '待编译', className: 'text-muted-foreground' },
  running: { text: '编译中', className: 'border-primary/40 text-primary' },
  failed: {
    text: '失败',
    className: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400',
  },
};

function StateChip({ state }: { state: string }) {
  const config = STATE_LABEL[state] ?? STATE_LABEL.pending;
  return (
    <Badge
      variant="outline"
      className={cn('ml-auto shrink-0 text-[10px]', config.className)}
    >
      {config.text}
    </Badge>
  );
}

const CONFIDENCE_TEXT: Record<CompileConfidence, { text: string; className: string }> =
  {
    high: { text: '置信度高', className: 'text-emerald-700 dark:text-emerald-400' },
    medium: { text: '置信度中', className: 'text-amber-700 dark:text-amber-400' },
    low: { text: '置信度低', className: 'text-red-700 dark:text-red-400' },
  };

function ConfidenceText({ value }: { value: CompileConfidence }) {
  const config = CONFIDENCE_TEXT[value];
  return <span className={config.className}>{config.text}</span>;
}
