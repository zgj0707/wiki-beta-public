/**
 * 文章统计分类的唯一配置源。
 *
 * 这是文章类型（knowledge_profile.content_type），不要与 content.content_kind
 * 的来源形态混用；外链文章只是其中一个允许的统计分类值。
 */
export const KNOWLEDGE_CONTENT_TYPES = [
  { value: 'research_report', label: '研究报告' },
  { value: 'data_analysis', label: '数据分析' },
  { value: 'external_article', label: '外链文章' },
] as const;

export type KnowledgeContentType =
  (typeof KNOWLEDGE_CONTENT_TYPES)[number]['value'];

export const KNOWLEDGE_CONTENT_TYPE_VALUES = KNOWLEDGE_CONTENT_TYPES.map(
  (item) => item.value,
) as KnowledgeContentType[];

export const KNOWLEDGE_CONTENT_TYPE_LABELS: Record<
  KnowledgeContentType,
  string
> = {
  research_report: '研究报告',
  data_analysis: '数据分析',
  external_article: '外链文章',
};

export const DEFAULT_FEISHU_CONTENT_TYPE: KnowledgeContentType =
  'research_report';
export const DEFAULT_EXTERNAL_ARTICLE_CONTENT_TYPE: KnowledgeContentType =
  'external_article';

export function isKnowledgeContentType(
  value: unknown,
): value is KnowledgeContentType {
  return KNOWLEDGE_CONTENT_TYPE_VALUES.includes(value as KnowledgeContentType);
}
