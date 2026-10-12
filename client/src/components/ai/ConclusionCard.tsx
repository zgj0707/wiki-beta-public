import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@client/src/components/ui/badge';
import { cn } from '@client/src/lib/utils';
import type {
  CompileClaimType,
  CompileConfidence,
  CompileUnitDetail,
} from '@shared/ai-compile';

/**
 * 结论卡渲染（结论优先）。
 *
 * 数据来源只有一处：`GET /api/compile/unit/:slug`（已落库产物）。
 * 本组件**不发任何请求、不调任何模型** —— 编译产物是缓存，重复访问零成本。
 *
 * 信息层级：一句话结论是主角，主体名与元信息退居辅助行。
 * 每条结论的引用编号**内联在句尾**——编号来自后端校验过的 `sourceDocIds`，
 * 不是文本匹配猜的，因此不存在挂错句的可能；与下方来源列表 hover 双向高亮，
 * 省掉读者自己拼「这句话出自哪篇」。
 */

const CONFIDENCE_STYLE: Record<CompileConfidence, string> = {
  high: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  medium:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  // 低置信度必须可一眼看到（规范：低置信度红字供判断）。
  low: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400',
};

const CONFIDENCE_LABEL: Record<CompileConfidence, string> = {
  high: '置信度 高',
  medium: '置信度 中',
  low: '置信度 低',
};

const CLAIM_TYPE_LABEL: Record<CompileClaimType, string> = {
  fact: '事实',
  judgment: '判断',
  metric: '数值',
};

const REVISION_LABEL: Record<string, string> = {
  created: '首次编译',
  headline_changed: '结论变更',
  confidence_changed: '置信度变化',
  unchanged_recompiled: '重编译（结论未变）',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

/** 千分位：token 是给人看的量级感知，不是要精确到个位。 */
function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * 日期明显不可信：晚于今天，或早于 2020-01-01（知识库不存在那么早的资料），
 * 或根本无法解析。只标客观异常，不猜「哪一篇错了」。
 */
function isDateSuspicious(value: string | null): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return true;
  return time > Date.now() || time < Date.UTC(2020, 0, 1);
}

export default function ConclusionCard({ unit }: { unit: CompileUnitDetail }) {
  // docId → 编号（与来源列表顺序一致）；claim 里只存 docId，编号在此派生。
  const indexByDoc = useMemo(
    () => new Map(unit.evidence.map((item, index) => [item.docId, index + 1])),
    [unit.evidence],
  );
  /** 联动锚点：claim 里的编号 与 来源列表行 共用同一个高亮态。 */
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  /**
   * 「最新来源」而非「来源区间」：区间端点被一份日期标注错误的资料拉长后
   * 会得出「这批资料横跨 9 个月」的错误印象，而最新日期对异常端点免疫。
   */
  const latestSourceDate = useMemo(() => {
    const dates = unit.evidence
      .map((item) => item.sourceDate)
      .filter((value): value is string => Boolean(value))
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [unit.evidence]);

  const suspiciousCount = useMemo(
    () => unit.evidence.filter((item) => isDateSuspicious(item.sourceDate)).length,
    [unit.evidence],
  );

  const recentRevisions = unit.revisions.slice(0, 5);

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {unit.subjectName}
          </span>
          <Badge
            variant="outline"
            className={CONFIDENCE_STYLE[unit.confidence]}
          >
            {CONFIDENCE_LABEL[unit.confidence]}
          </Badge>
          {unit.conflictCount > 0 && (
            <Badge
              variant="outline"
              className="border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400"
            >
              {unit.conflictCount} 处来源冲突
            </Badge>
          )}
          {unit.stale && (
            <Badge variant="outline" className="text-muted-foreground">
              输入已变更，结论待重编
            </Badge>
          )}
        </div>

        <h1 className="text-lg leading-relaxed font-semibold">{unit.headline}</h1>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{unit.sourceCount} 篇独立来源</span>
          <span>最新来源 {formatDate(latestSourceDate)}</span>
          <TokenUsage unit={unit} />
          <span title="编译时使用的模型标识（决定读哪一份预估校准系数）">
            编译模型 {unit.modelFingerprint}
          </span>
          <span>生成于 {unit.generatedAt.replace('T', ' ').slice(0, 16)}</span>
        </div>
      </header>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          结论（{unit.claims.length} 条）
        </h2>
        <ol className="flex flex-col gap-4">
          {unit.claims.map((claim) => (
            <li key={claim.id} className="flex gap-3">
              <span className="mt-0.5 h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {CLAIM_TYPE_LABEL[claim.type]}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-sm leading-relaxed">
                  {claim.text}
                  {/* 编号内联句尾：来自后端校验过的 sourceDocIds，精确。 */}
                  {claim.sourceDocIds.map((docId) => {
                    const no = indexByDoc.get(docId);
                    const active = activeDocId === docId;
                    return (
                      <Link
                        key={docId}
                        to={`/article/${docId}`}
                        title="查看原文"
                        onMouseEnter={() => setActiveDocId(docId)}
                        onMouseLeave={() => setActiveDocId(null)}
                        className={cn(
                          'ml-1 inline-block rounded border border-primary/30 align-baseline text-[11px] tabular-nums',
                          active
                            ? 'bg-primary/15 text-primary'
                            : 'bg-primary/5 text-primary hover:bg-primary/10',
                        )}
                      >
                        [{no ?? '?'}]
                      </Link>
                    );
                  })}
                </p>
                {claim.sourceQuote && (
                  <p className="border-l-2 border-muted pl-2 text-xs leading-relaxed text-muted-foreground">
                    “{claim.sourceQuote}”
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {unit.gaps.length > 0 && (
        <section className="rounded-xl border border-dashed bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            证据缺口（{unit.gaps.length}）
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {unit.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      )}

      {unit.contradictions.length > 0 && (
        <section className="rounded-xl border border-orange-500/40 bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold text-orange-700 dark:text-orange-400">
            来源冲突（{unit.contradictions.length}）
          </h2>
          <ul className="flex flex-col gap-3">
            {unit.contradictions.map((item, index) => (
              <li key={`${item.a}-${index}`} className="text-sm">
                <p className="text-muted-foreground">A：{item.a}</p>
                <p className="text-muted-foreground">B：{item.b}</p>
                {item.note && <p className="mt-1 text-xs">冲突点：{item.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          来源（{unit.evidence.length}）
        </h2>
        {suspiciousCount > 0 && (
          <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
            其中 {suspiciousCount} 篇的日期标注明显异常（早于 2020 年或晚于今天），
            已单独标记，未参与「最新来源」的计算口径。
          </p>
        )}
        <ol className="flex flex-col gap-0.5">
          {unit.evidence.map((item, index) => {
            const active = activeDocId === item.docId;
            const suspicious = isDateSuspicious(item.sourceDate);
            return (
              <li
                key={item.docId}
                onMouseEnter={() => setActiveDocId(item.docId)}
                onMouseLeave={() => setActiveDocId(null)}
                className={cn(
                  'flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  active && 'bg-primary/5',
                )}
              >
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    active ? 'font-medium text-primary' : 'text-muted-foreground',
                  )}
                >
                  [{index + 1}]
                </span>
                <Link
                  to={item.url}
                  className="min-w-0 truncate text-primary hover:underline"
                  title={item.title}
                >
                  {item.title || item.docId}
                </Link>
                <span
                  className={cn(
                    'ml-auto shrink-0 text-xs',
                    suspicious
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-muted-foreground',
                  )}
                  title={suspicious ? '日期标注异常，请核对原文' : undefined}
                >
                  {formatDate(item.sourceDate)}
                  {suspicious && ' ⚠'}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {recentRevisions.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            结论变更史（最近 {recentRevisions.length} 次）
          </h2>
          <ol className="flex flex-col gap-2">
            {recentRevisions.map((revision) => (
              <li key={revision.revisionNo} className="text-xs">
                <span className="text-muted-foreground">
                  #{revision.revisionNo} ·{' '}
                  {revision.createdAt.replace('T', ' ').slice(0, 16)} ·{' '}
                  {REVISION_LABEL[revision.changeType] ?? revision.changeType}
                </span>
                {revision.headline && (
                  <p className="mt-0.5 text-sm">{revision.headline}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

/**
 * 实测用量按**编译通道**区分呈现（两者都展示，不隐藏）：
 * - 站内直连（浏览器 → 网关）：网关返回 usage，落库为实测值 —— 显示真实数字。
 * - WorkBuddy 批跑通道：拿不到 usage，落库为 null —— 明说未回传，不用破折号糊过去。
 */
function TokenUsage({ unit }: { unit: CompileUnitDetail }) {
  const { actualPromptTokens, actualCompletionTokens } = unit;
  if (actualPromptTokens == null && actualCompletionTokens == null) {
    return (
      <span
        className="text-muted-foreground/70"
        title="该批产物由 WorkBuddy 批跑通道编译，网关未返回 usage；站内直连编译的产物会显示实测值。"
      >
        用量未回传
      </span>
    );
  }
  return (
    <span
      className="tabular-nums"
      title="网关返回的实测 usage（提示 tokens / 生成 tokens）"
    >
      实测 {formatTokens(actualPromptTokens ?? 0)} in ·{' '}
      {formatTokens(actualCompletionTokens ?? 0)} out
    </span>
  );
}
