/**
 * 玩法分类：父子关系来自 Base「文章工作台」的两个 select 列
 * （「玩法分类父项」/「玩法分类子项」），分类值即中文原文，
 * 同时充当筛选值与 URL 段。
 *
 * 分类清单**不在代码里维护** —— Base 里加一个选项并给文章打标，导航、筛选栏、
 * 玩法页三处随下一次读取同时出现（facets 有 60s 缓存）。本文件只提供与具体
 * 分类无关的工具：旧链接归一、URL 片段生成、按名称稳定取色、标签拼装。
 */
export const GAMEPLAY_PARENT_FIELD = '玩法分类父项';
export const GAMEPLAY_CHILD_FIELD = '玩法分类子项';
/** 改名前的旧列名，读取时兜底，避免字段改名出现空窗。 */
export const GAMEPLAY_LEGACY_PARENT_FIELD = '玩法分类';

/**
 * 旧英文 slug → 分类名。
 * 仅供历史 URL 与旧客户端兼容，不是分类来源，也不影响新分类的自动出现。
 */
export const GAMEPLAY_LEGACY_SLUG_ALIASES: Record<string, string> = {
  mmo: 'MMO',
  'idle-mmo': '挂机嗨游',
  'light-client': '轻端游',
  'idle-rpg': '放置 RPG',
  'simulation-breeding': '模拟经营、育成',
  'X+SLG': 'x-slg',
};

/** 分类名不得包含会破坏 URL / query 的保留字符。 */
const UNSAFE_GAMEPLAY_NAME = /[/?#&+]/u;

export function isSafeGameplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !UNSAFE_GAMEPLAY_NAME.test(value)
  );
}

/** 归一化分类入参：空 → ''；旧 slug → 分类名；其余原样透传。 */
export function normalizeGameplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return GAMEPLAY_LEGACY_SLUG_ALIASES[trimmed] ?? trimmed;
}

/**
 * 分类配色板：按分类名哈希稳定取色 —— 与文章数、排序都无关，
 * 分类名不变则颜色不变，新增分类自动分到一个固定色。
 */
export const GAMEPLAY_CATEGORY_COLORS = [
  'blue',
  'violet',
  'green',
  'orange',
  'rose',
  'teal',
] as const;

export type GameplayCategoryColor = (typeof GAMEPLAY_CATEGORY_COLORS)[number];
/** 含「未分类」的中性灰。 */
export type GameplayCategoryTone = GameplayCategoryColor | 'gray';

export const UNCLASSIFIED_GAMEPLAY = {
  label: '未分类',
  color: 'gray',
} as const satisfies { label: string; color: GameplayCategoryTone };

/** 分类名 → 稳定配色；空值/未分类 → gray。 */
export function gameplayCategoryColor(name: unknown): GameplayCategoryTone {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) return UNCLASSIFIED_GAMEPLAY.color;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return GAMEPLAY_CATEGORY_COLORS[hash % GAMEPLAY_CATEGORY_COLORS.length]!;
}

/** 分类名 → 玩法页路径（中文名百分号编码，浏览器地址栏仍显示中文）。 */
export function gameplayCategoryPath(name: string): string {
  return `/gameplay/${encodeURIComponent(name)}`;
}

/** 路径 → 分类名；非法或含保留字符的段返回 undefined。 */
export function gameplayCategoryFromPath(path: string): string | undefined {
  const matched = /^\/gameplay\/([^/]+)$/u.exec(path);
  if (!matched) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(matched[1]!);
  } catch {
    return undefined;
  }
  const name = normalizeGameplayName(decoded);
  return isSafeGameplayName(name) ? name : undefined;
}

/**
 * 标签文案：有子项时 `父项 › 子项`，否则取有值的一侧；都为空 → 未分类。
 * 卡片、头版、预览弹窗、详情页共用同一口径。
 */
export function gameplayCategoryLabel(
  parent: unknown,
  child?: unknown,
): string {
  const parentName = typeof parent === 'string' ? parent.trim() : '';
  const childName = typeof child === 'string' ? child.trim() : '';
  if (parentName && childName) return `${parentName} › ${childName}`;
  return parentName || childName || UNCLASSIFIED_GAMEPLAY.label;
}

/**
 * @deprecated 兼容层：仅供未注册进 AppModule 的历史模块编译（content /
 * knowledge / research / review）。这些模块不参与任何线上路径，分类语义已
 * 由 Base 两列 + 上面的名称工具承担，新代码不得引用本段。
 */
export type GameplayCategorySlug = string;
export type GameplayCategoryValue = GameplayCategorySlug | null;

/** @deprecated 见上；现义为「是个合法分类名」。 */
export function isGameplayCategorySlug(
  value: unknown,
): value is GameplayCategorySlug {
  return isSafeGameplayName(value);
}

/**
 * @deprecated 见上；trim 后仍合法即原样返回，否则 null（保持「恒等」语义，
 * 不做旧 slug → 分类名 的改写，那一层只属于活路径的 normalizeGameplayName）。
 */
export function normalizeGameplayCategory(
  value: unknown,
): GameplayCategoryValue {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isSafeGameplayName(trimmed) ? trimmed : null;
}

/** @deprecated 见上；父子聚合已由 Base 两列在查询层完成，这里只回自身。 */
export function getGameplayCategoryFilterSlugs(
  value: GameplayCategorySlug,
): GameplayCategorySlug[] {
  return value ? [value] : [];
}

/** @deprecated 见上；现义为「把值归一成分类名」，拿不到则是 null。 */
export function gameplaySlugFromLabel(
  value: unknown,
): GameplayCategorySlug | null {
  return normalizeGameplayCategory(value);
}
