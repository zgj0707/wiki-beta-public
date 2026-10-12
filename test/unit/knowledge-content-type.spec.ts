import {
  DEFAULT_EXTERNAL_ARTICLE_CONTENT_TYPE,
  DEFAULT_FEISHU_CONTENT_TYPE,
  KNOWLEDGE_CONTENT_TYPE_LABELS,
  KNOWLEDGE_CONTENT_TYPES,
  isKnowledgeContentType,
} from '@shared/knowledge-content-type';

describe('knowledge content type contract', () => {
  it('exposes exactly the three supported article classifications', () => {
    expect(KNOWLEDGE_CONTENT_TYPES).toEqual([
      { value: 'research_report', label: '研究报告' },
      { value: 'data_analysis', label: '数据分析' },
      { value: 'external_article', label: '外链文章' },
    ]);
    expect(Object.keys(KNOWLEDGE_CONTENT_TYPE_LABELS)).toEqual([
      'research_report',
      'data_analysis',
      'external_article',
    ]);
  });

  it('keeps source-specific defaults and rejects removed classifications', () => {
    expect(DEFAULT_FEISHU_CONTENT_TYPE).toBe('research_report');
    expect(DEFAULT_EXTERNAL_ARTICLE_CONTENT_TYPE).toBe('external_article');
    expect(isKnowledgeContentType('research_report')).toBe(true);
    expect(isKnowledgeContentType('data_analysis')).toBe(true);
    expect(isKnowledgeContentType('external_article')).toBe(true);
    expect(isKnowledgeContentType('competitor_analysis')).toBe(false);
    expect(isKnowledgeContentType('methodology')).toBe(false);
  });
});
