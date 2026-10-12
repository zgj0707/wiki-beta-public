import { Gauge } from 'lucide-react';

import SectionHeader from '@client/src/components/SectionHeader';
import EmptyState from '@client/src/components/ui/empty-state';
import type { CompileCalibrationView } from '@shared/ai-compile';
import { formatTokenRange } from '@shared/ai-compile';

/**
 * 校准面板：token 预估的可证伪判据。
 *
 * 立场（见 docs/ai-compile-layer-plan.md §6）：不试图"算得更准"，
 * 而是设计成"算不准也不出事"。因此面板会**在数据不足时主动降级**——
 * 样本少于 5 次、或偏差 P90 > 25% 时隐藏精确数字，只给低/中/高档。
 *
 * 文案立场：**解释跟着数字走**。每个数字的正下方就是它的说明，而不是集中
 * 堆在底部一段长文里——读者看某个数时不必回头找注释。因此卡片自带解释，
 * 面板底部不再重复一份说明块。
 *
 * ⚠️ 样本只统计「网关回传了 usage」的编译。WorkBuddy 批跑通道拿不到 usage，
 * 那批产物不计入校准 —— 所以实测样本数**不会**等于产物总数。
 */

function percent(value: number | null): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function count(value: number): string {
  return value.toLocaleString('zh-CN');
}

/** 系数最直观的说法：每 1000 字大约耗多少 token。 */
function factorAsPerThousand(factor: number | null): string {
  if (factor == null) return '每 1000 字 ≈ 1,300 token';
  return `每 1000 字 ≈ ${Math.round(factor * 1000).toLocaleString('zh-CN')} token`;
}

/** 降级原因讲清是「条数不够」还是「偏差太大」——只说「样本不足」会让人困惑。 */
function describeDowngrade(
  reason: CompileCalibrationView['displayModeReason'],
): string {
  switch (reason) {
    case 'no-samples':
      return '还没有拿回真实用量的编译，暂时不算它。';
    case 'too-few-samples':
      return '样本不足 5 次，此值仅供参考。';
    case 'too-deviated':
      return '偏差超过 25%，报精确数字会误导，只给档位。';
    default:
      return '';
  }
}

export default function CalibrationPanel({
  calibration,
}: {
  calibration: CompileCalibrationView | null;
}) {
  if (!calibration) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeader
          icon={Gauge}
          title="预估校准"
          description="预估 token 准不准，由每次编译回传的真实用量说了算。"
        />
        <EmptyState
          icon={Gauge}
          title="尚无校准数据"
          description="在站内直连跑一次编译后，这里会显示实测偏差与预估比例。"
        />
      </section>
    );
  }

  const numeric = calibration.displayMode === 'number';
  const thresholds = calibration.confidenceThresholds;
  const p90Known = calibration.deviationP90 != null;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        icon={Gauge}
        title="预估校准"
        description="预估 token 准不准，由每次编译回传的真实用量说了算；数字不够踏实时就只给档位。"
      />
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat
            label="实测样本"
            value={`${count(calibration.deviationSampleCount)} 次`}
            desc="只算拿回真实用量的编译；批量跑的那批拿不到用量，不计入。"
          />
          <Stat
            label="换算比例"
            value={factorAsPerThousand(calibration.charFactor)}
            desc={
              calibration.charFactor == null
                ? '预估 = 字数 × 它。还没有真实用量，先用保守的默认值。'
                : '预估 = 字数 × 它。不套经验公式，按真实用量滚动更新。'
            }
          />
          <Stat
            label="最差一成偏差"
            value={p90Known ? percent(calibration.deviationP90) : '—'}
            desc={
              p90Known
                ? `十次里有九次的偏差不超过它：实际落在预估范围内记 0，落在范围外才记超出多少。${
                    numeric ? '' : ` ${describeDowngrade(calibration.displayModeReason)}`
                  }`
                : describeDowngrade(calibration.displayModeReason)
            }
          />
          <Stat
            label="累计实测消耗"
            value={`${count(calibration.totalPromptTokens)} / ${count(
              calibration.totalCompletionTokens,
            )}`}
            desc="输入 / 输出 token（输入含正文与指令）。只累计拿回用量的编译。"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3.5 text-xs text-muted-foreground">
          <span>
            预估当前显示：
            {numeric
              ? `数字区间（示例 ${formatTokenRange(18_000, 24_000, 'number')}）`
              : `档位（示例 ${formatTokenRange(18_000, 24_000, 'band')}）`}
          </span>
          <span>
            结论置信度：来源 ≥{thresholds.sufficientMinSources} 篇且最新资料 ≤
            {thresholds.freshDays} 天 → 高 · 来源 ≥{thresholds.thinMinSources} 篇 →
            中 · 来源不足 {thresholds.thinMinSources} 篇或最新资料超{' '}
            {thresholds.agingDays} 天 → 低
          </span>
          {calibration.updatedAt && (
            <span>
              更新于 {calibration.updatedAt.replace('T', ' ').slice(0, 16)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  desc,
}: {
  label: string;
  value: string;
  desc?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
      {desc && (
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          {desc}
        </span>
      )}
    </div>
  );
}
