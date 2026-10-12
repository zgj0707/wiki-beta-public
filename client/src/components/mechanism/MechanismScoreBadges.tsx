import { Badge } from '@client/src/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';
import type { MechanismScoreHints } from '@client/src/api/insight';

/**
 * 指数分值的展示口径（**唯一实现**）。
 *
 * 列表卡片与详情 Hero 都要展示这两个指数，两处各写一份 `toFixed(2)` +
 * 各自的标签文案必然分叉（本项目已有「显示名派生」因就地复刻而漂移的前例）。
 * 故收敛到此处：格式化、标签文案、缺值不渲染三个决定都只在这里做一次。
 *
 * - `toFixed(2)`：与 Base 列的两位小数形态一致，排序切换时视觉不跳字。
 * - 缺值（null / undefined）**不渲染占位**，不留空洞。
 */
export function formatMechanismScore(
  value: number | null | undefined,
): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : null;
}

/** 是否有任一分值可展示；调用方据此决定徽标行要不要渲染（避免空行留白）。 */
export function hasMechanismScore(
  marketScore: number | null | undefined,
  innovationScore: number | null | undefined,
): boolean {
  return (
    formatMechanismScore(marketScore) !== null ||
    formatMechanismScore(innovationScore) !== null
  );
}

export interface MechanismScoreBadgesProps {
  marketScore: number | null | undefined;
  innovationScore: number | null | undefined;
  /**
   * 两个指数列的 **Base 字段描述**（方法论说明：分档含义、量纲），
   * 作为悬停提示展示。
   *
   * 缺省或拿不到时**不加提示**，徽标本身照常渲染 —— 提示是附加信息，
   * 不该因为它缺失就影响分值展示。
   */
  hints?: MechanismScoreHints | null;
}

/**
 * 单个分值徽标：**有描述才套 Tooltip**。
 *
 * 不用原生 `title` 属性：原生提示的样式、出现延迟不受控，且与 Radix
 * 的 tooltip 能力重复；两者同时存在还会一次冒出两个气泡。
 */
function ScoreBadge({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  const badge = (
    <Badge variant="outline">
      {label} {value}
    </Badge>
  );
  if (!hint) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 指数徽标组：只输出两个徽标本身（不带容器），便于直接放进已有的徽标行。
 * 名称与列表排序维度逐字一致（「认可 / 创新」↔「市场认可度 / 机制创新度」），
 * 让「为什么这样排序」在卡片上可自解释。
 */
export default function MechanismScoreBadges({
  marketScore,
  innovationScore,
  hints,
}: MechanismScoreBadgesProps) {
  const market = formatMechanismScore(marketScore);
  const innovation = formatMechanismScore(innovationScore);
  if (!market && !innovation) return null;
  return (
    <>
      {market ? (
        <ScoreBadge
          label="认可"
          value={market}
          hint={hints?.market ?? null}
        />
      ) : null}
      {innovation ? (
        <ScoreBadge
          label="创新"
          value={innovation}
          hint={hints?.innovation ?? null}
        />
      ) : null}
    </>
  );
}
