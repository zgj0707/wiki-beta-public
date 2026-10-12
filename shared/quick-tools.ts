/**
 * 「便捷工具」承载约定（Bitable schema and DTO mapping).
 * Table and attachment field IDs are configured on the server via environment variables.
 */

/** 「便捷工具表」的专用列名。 */
export const QUICK_TOOLS_FIELD_NAMES = {
  name: '工具名称',
  description: '工具描述',
  category: '分类',
  url: '链接',
  /** 2026-10-08 由「游戏文件」改名：现在承载任意 HTML 附件（H5 游戏 / 评测页等）。 */
  attachment: '附件',
  icon: '图标',
  /** 手动填写的日期（datetime）；按此降序排列，最新在上。 */
  date: '日期',
  enabled: '启用',
  /** 正文 README（markdown）；按行内容决定是否弹窗展示。 */
  readme: 'README',
} as const;

/**
 * 「发现」页主网格的分类枚举（单选原文 = 前端筛选键）。
 * 互动内容 / 机制周报不进主网格，各自独立成区（见下方常量）。
 */
export const QUICK_TOOLS_CATEGORIES = ['链接', '文档'] as const;
export type QuickToolCategory = (typeof QUICK_TOOLS_CATEGORIES)[number];

/** 分类 → 前端筛选标签。 */
export const QUICK_TOOLS_CATEGORY_LABELS: Record<QuickToolCategory, string> = {
  链接: '链接',
  文档: '文档',
};

export const QUICK_TOOLS_INTERACTIVE_CATEGORY = '互动内容';

export const QUICK_TOOLS_MECHANISM_WEEKLY_CATEGORY = '机制周报';

/** 行 → 前端 DTO。 */
export interface QuickToolItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  url: string | null;
  attachmentToken: string | null;
  iconFileToken: string | null;
  readme: string | null;
  date: string | null;
}

export type QuickToolTarget =
  | { kind: 'readme' }
  | { kind: 'proxy' }
  | { kind: 'external'; url: string };

export function quickToolTarget(item: QuickToolItem): QuickToolTarget | null {
  if (item.readme?.trim()) return { kind: 'readme' };
  if (item.attachmentToken) return { kind: 'proxy' };
  if (item.url) return { kind: 'external', url: item.url };
  return null;
}
