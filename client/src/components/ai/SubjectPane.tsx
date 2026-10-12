import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BookOpen, Loader2, Sparkles } from 'lucide-react';

import { fetchUnit } from '@client/src/api/ai-compile';
import ConclusionCard from '@client/src/components/ai/ConclusionCard';
import { useCompileRunner } from '@client/src/components/ai/use-compile-runner';
import AiSettingsDialog from '@client/src/components/chat/AiSettingsDialog';
import { Button } from '@client/src/components/ui/button';
import EmptyState from '@client/src/components/ui/empty-state';
import { Skeleton } from '@client/src/components/ui/skeleton';
import type { CompileUnitDetail } from '@shared/ai-compile';

/**
 * 主体结论阅读窗（有产物读缓存 / 无产物给编译入口）。
 *
 * 刻意抽成组件给两处共用：`/ai/e/:slug` 整页，以及工作台右栏（B 布局）。
 * 这两处若各写一份「加载 + 编译 + 空态」，迟早出现口径分叉——本页签已经
 * 踩过一次：队列说 done、详情说未编译。共用组件让这件事不可能再发生。
 *
 * 本组件只在**用户点编译**时才产生模型调用；打开卡片读的是落库产物（零调用）。
 */
export default function SubjectPane({
  slug,
  onCompiled,
}: {
  slug: string;
  /** 编译成功后的回调（工作台用它刷新左栏的结论首句与状态）。 */
  onCompiled?: () => void;
}) {
  const [unit, setUnit] = useState<CompileUnitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state, run } = useCompileRunner();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 不传模型：产物按 slug 取最新一份（与工作台/队列同口径）。
      setUnit(await fetchUnit(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state.needsConfig) setSettingsOpen(true);
  }, [state.needsConfig]);

  const compile = async () => {
    if (await run(slug)) {
      await load();
      onCompiled?.();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/entity/${encodeURIComponent(slug)}`}>
            <BookOpen />
            实体词典页
          </Link>
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => void compile()}
          disabled={state.running}
        >
          {state.running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {unit ? '重新编译' : '编译这一次'}
        </Button>
      </div>

      {state.message && !state.error && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          {state.message}
        </div>
      )}
      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm break-words text-red-700 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{state.error}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !unit && (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {unit ? (
        <>
          {unit.stale && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              该实体的关联资料已有更新，当前结论基于旧输入。点「重新编译」刷新。
            </div>
          )}
          <ConclusionCard unit={unit} />
        </>
      ) : (
        !loading &&
        !error && (
          <EmptyState
            icon={Sparkles}
            title="这个主体还没有编译过"
            description="编译会读取该实体的全部关联文章，让模型输出结论与证据，再由服务端逐条校验引用后落库。编译一次，全库共享——其他同事再打开这张卡片不会再消耗任何模型调用。"
            action={
              <Button onClick={() => void compile()} disabled={state.running}>
                {state.running && <Loader2 className="animate-spin" />}
                编译这一次（使用我配置的模型）
              </Button>
            }
          />
        )
      )}

      <AiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
