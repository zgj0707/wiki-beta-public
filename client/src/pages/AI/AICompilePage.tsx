import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Loader2, Play, RefreshCw, Square } from 'lucide-react';

import { fetchWorkbench } from '@client/src/api/ai-compile';
import CalibrationPanel from '@client/src/components/ai/CalibrationPanel';
import { useCompileRunner } from '@client/src/components/ai/use-compile-runner';
import AiSettingsDialog from '@client/src/components/chat/AiSettingsDialog';
import SectionHeader from '@client/src/components/SectionHeader';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import EmptyState from '@client/src/components/ui/empty-state';
import { cn } from '@client/src/lib/utils';
import {
  COMPILE_MAX_BATCH_SIZE,
  COMPILE_MAX_DOCS,
  type CompileWorkbenchView,
} from '@shared/ai-compile';

/**
 * /ai/compile 批跑页（维护者向）。
 *
 * 三种触发里的第①种：这里跑出来的产物全库共享，是冷启动的种子。
 * 顺序执行而非并发：一是便于随时中断，二是让预算消耗可见、可停。
 */
export default function AICompilePage() {
  const [data, setData] = useState<CompileWorkbenchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<{
    total: number;
    done: number;
    failed: number;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cancelledRef = useRef(false);
  const { state, run, cancel } = useCompileRunner();

  const load = useCallback(async () => {
    setError(null);
    try {
      // 不传模型：与工作台同口径。
      setData(await fetchWorkbench());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.needsConfig) setSettingsOpen(true);
  }, [state.needsConfig]);

  const pending = useMemo(
    () => (data?.queue ?? []).filter((item) => item.state !== 'done'),
    [data],
  );
  const nextBatch = pending.slice(0, COMPILE_MAX_BATCH_SIZE);

  /**
   * 批量预算：用队列的预估上界求和。这是**粗估**（队列预估按篇均片段长度算，
   * 不含 system prompt 与编号开销），真实值由 prepare 给出，偏差由校准面板跟踪。
   */
  const batchEstimateHigh = nextBatch.reduce(
    (sum, item) => sum + (item.estTokensHigh ?? 0),
    0,
  );

  const stop = () => {
    cancelledRef.current = true;
    cancel();
    setBatch(null);
  };

  const runBatch = async () => {
    if (!nextBatch.length) return;
    cancelledRef.current = false;
    setBatch({ total: nextBatch.length, done: 0, failed: 0 });
    for (const item of nextBatch) {
      if (cancelledRef.current) break;
      const ok = await run(item.subjectId);
      setBatch((prev) =>
        prev
          ? {
              ...prev,
              done: prev.done + (ok ? 1 : 0),
              failed: prev.failed + (ok ? 0 : 1),
            }
          : prev,
      );
    }
    // 保留 batch 汇总（便于看最终失败数），刷新队列反映最新状态。
    await load();
  };

  const finished = batch ? batch.done + batch.failed : 0;
  const progress = batch && batch.total > 0 ? (finished / batch.total) * 100 : 0;

  return (
    <div className="page-scroll">
      <div className="page-container flex flex-col gap-6">
        <header className="page-header">
          <div className="min-w-0">
            <p className="page-eyebrow">AI 编译层</p>
            <h1 className="page-title">批跑编译</h1>
            <p className="page-desc">
              顺序执行，逐个实体：组装输入 → 调用模型 → 校验落库。
              单实体上限 {COMPILE_MAX_DOCS} 篇资料，单批最多{' '}
              {COMPILE_MAX_BATCH_SIZE} 个实体。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw />
              刷新
            </Button>
            {state.running || batch ? (
              <Button
                variant="outline"
                size="sm"
                onClick={stop}
                className="border-red-500/40 text-red-700 dark:text-red-400"
              >
                <Square />
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void runBatch()}
                disabled={!nextBatch.length}
              >
                <Play />
                编译前 {nextBatch.length} 个（预估上界 ≈
                {(batchEstimateHigh / 1000).toFixed(0)}k tokens）
              </Button>
            )}
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {(state.running || state.message || batch) && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            {batch && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    批量进度 {finished}/{batch.total}
                  </span>
                  {batch.failed > 0 && (
                    <span className="text-red-700 dark:text-red-400">
                      失败 {batch.failed}
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            )}
            {state.running && (
              <span className="flex items-center gap-2 text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {state.subjectId} · {state.message}
              </span>
            )}
            {!state.running && state.message && (
              <span className="text-emerald-700 dark:text-emerald-400">
                {state.message}
              </span>
            )}
            {!state.running && state.error && (
              <span className="text-red-700 dark:text-red-400">
                {state.subjectId}：{state.error}
              </span>
            )}
          </div>
        )}

        <CalibrationPanel calibration={data?.calibration ?? null} />

        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={Play}
            title={`队列（${data?.queue.length ?? 0} 个可编译主体，未编译 ${pending.length}）`}
            description="失败不落半成品；中断后重跑同一实体不会产生重复产物（一个主体一行状态机）。"
          />
          {!data?.queue.length ? (
            <EmptyState
              icon={Play}
              title="队列为空"
              description="没有「产品」类型且资料齐备的实体。"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="max-h-[32rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-4 py-2.5 text-left font-medium">主体</th>
                      <th className="px-2 py-2.5 text-right font-medium">资料</th>
                      <th className="px-2 py-2.5 text-right font-medium">送入</th>
                      <th className="px-2 py-2.5 text-right font-medium">
                        预估 tokens
                      </th>
                      <th className="px-2 py-2.5 text-left font-medium">状态</th>
                      <th className="px-4 py-2.5 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.queue ?? []).map((item) => (
                      <tr
                        key={item.subjectId}
                        className="border-b transition-colors last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-2">
                          <Link
                            to={`/ai/e/${encodeURIComponent(item.subjectSlug)}`}
                            className="text-primary hover:underline"
                          >
                            {item.subjectName}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {item.docCount}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {item.usedDocCount}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {item.estTokensLow ?? '—'}–{item.estTokensHigh ?? '—'}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              STATE_CLASS[item.state] ?? 'text-muted-foreground',
                            )}
                            title={item.error ?? undefined}
                          >
                            {STATE_LABEL[item.state] ?? item.state}
                            {item.error ? ' ⓘ' : ''}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void run(item.subjectId).then(() => load())
                            }
                            disabled={state.running}
                          >
                            编译
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
      <AiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  done: '已编译',
  pending: '待编译',
  running: '编译中',
  failed: '失败',
};

const STATE_CLASS: Record<string, string> = {
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  running: 'border-primary/40 text-primary',
  failed: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400',
};
