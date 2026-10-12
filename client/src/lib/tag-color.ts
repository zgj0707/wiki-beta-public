import {
  gameplayCategoryColor,
  gameplayCategoryLabel,
  type GameplayCategoryTone,
} from '@shared/gameplay-category';

export const NEUTRAL_TAG_STYLE = {
  badge: 'bg-muted text-muted-foreground',
  bar: 'bg-muted-foreground/40',
} as const;

export const GAMEPLAY_CATEGORY_STYLES: Record<
  GameplayCategoryTone,
  { badge: string; bar: string }
> = {
  gray: {
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
    bar: 'bg-slate-400 dark:bg-slate-500',
  },
  blue: {
    badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    bar: 'bg-blue-500',
  },
  violet: {
    badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
  },
  orange: {
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    bar: 'bg-orange-500',
  },
  green: {
    badge: 'bg-green-500/15 text-green-700 dark:text-green-300',
    bar: 'bg-green-500',
  },
  rose: {
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
  },
  teal: {
    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    bar: 'bg-teal-500',
  },
};

/**
 * 分类标签样式：颜色由分类名哈希稳定取色（见 shared/gameplay-category），
 * 文案口径与卡片一致 —— 有子项时显示 `父项 › 子项`。
 * 传单个值（父项名）也成立；空值 → 未分类（中性灰）。
 */
export function gameplayCategoryStyle(parent: unknown, child?: unknown) {
  return {
    label: gameplayCategoryLabel(parent, child),
    ...GAMEPLAY_CATEGORY_STYLES[gameplayCategoryColor(parent ?? child)],
  };
}

/** 兼容仍未迁移的调用方：非玩法维度统一返回中性色。 */
export function tagColor(
  _value: string,
  _dimension: 'category' | 'source' = 'category',
) {
  return NEUTRAL_TAG_STYLE;
}
