import { ViewController } from '../../server/modules/view/view.controller';
import { safeJson } from '../../server/modules/view/safe-json';
import type { ArticleListItem } from '../../server/modules/articles/articles.service';

const item: ArticleListItem = {
  docId: 'rec-ssr',
  title: '</script><script>alert(1)</script>',
  summary: '摘要',
  sourceDate: '2026-09-06',
  sourceAuthor: '分析师 A',
  sourcePublisher: '某研究机构',
  contentType: '月度报告',
  gameplayCategory: '开放世界',
  sourceUrl: 'https://example.feishu.cn/wiki/LzZcw1BYNiBCOhkOwQWcLthun8e',
  structured: {
    keyFindings: '关键结论',
  },
};

function fakeArticlesService(items: ArticleListItem[]) {
  return {
    list: jest.fn().mockResolvedValue({
      items,
      total: items.length,
      nextCursor: null,
    }),
  } as any;
}

function fakeBaseReader(latest: Date | null, total: number) {
  return {
    listArticleRows: jest.fn().mockResolvedValue(
      Array.from({ length: total }, (_, index) => ({
        baseRecordId: `rec-${index}`,
        title: `文章 ${index}`,
        appDocId: null,
        docLink: null,
        approvalStatus: '已批准',
        abstract: null,
        keyFindings: null,
        board: '其他',
        contentKind: 'research_report',
        sourceAuthor: '',
        sourcePublisher: '',
        gameplayCategory: null,
        sourceDateFeishu: '',
        updateTime: latest,
      })),
    ),
  } as any;
}

describe('SSR initial data boundary', () => {
  it('escapes HTML parser-sensitive characters in inline JSON', () => {
    const output = safeJson({ value: '</script>\u2028\u2029' });
    expect(output).toContain('\\u003c/script>');
    expect(output).toContain('\\u2028');
    expect(output).toContain('\\u2029');
    expect(output).not.toContain('</script>');
  });

  it('builds the initial library snapshot from ArticlesService with ArticleListItem shape', async () => {
    const articlesService = fakeArticlesService([item]);
    const controller = new ViewController(
      articlesService,
      fakeBaseReader(new Date('2026-09-06T00:00:00.000Z'), 1),
    );
    const result = await controller.render({
      __platform_data__: { tenant: 'public' },
    } as any);
    const initialData = JSON.parse(result.__initial_data__) as {
      revision: string;
      library: { items: Array<Record<string, unknown>>; total: number };
      bootstrap: { revision: string; generatedAt: string; recent: unknown[] };
    };

    expect(JSON.parse(result.__platform__)).toEqual({ tenant: 'public' });
    expect(articlesService.list).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
    });
    expect(initialData.revision).toBe('2026-09-06T00:00:00.000Z:1');
    expect(initialData.bootstrap.revision).toBe(initialData.revision);
    expect(initialData.library.total).toBe(1);
    expect(initialData.bootstrap.recent).toHaveLength(1);

    const first = initialData.library.items[0];
    // ArticleListItem 契约字段（client/src/types/content.ts）
    expect(Object.keys(first).sort()).toEqual(
      [
        'docId',
        'title',
        'summary',
        'sourceDate',
        'sourceAuthor',
        'sourcePublisher',
        'contentType',
        'gameplayCategory',
        'sourceUrl',
        'structured',
      ].sort(),
    );
    expect(first).toMatchObject({
      docId: 'rec-ssr',
      title: item.title,
      summary: item.summary,
      sourceDate: item.sourceDate,
      sourceAuthor: item.sourceAuthor,
      sourcePublisher: item.sourcePublisher,
      contentType: item.contentType,
      gameplayCategory: item.gameplayCategory,
      sourceUrl: item.sourceUrl,
      structured: item.structured,
    });
  });

  it('falls back to a null snapshot when the catalog cannot be loaded', async () => {
    const articlesService = fakeArticlesService([item]);
    articlesService.list = jest.fn().mockRejectedValue(new Error('db down'));
    const controller = new ViewController(
      articlesService,
      fakeBaseReader(null, 0),
    );
    const result = await controller.render({} as any);
    expect(JSON.parse(result.__initial_data__)).toBeNull();
  });

  it('keeps the initial data free of admin navigation fields', async () => {
    const controller = new ViewController(
      fakeArticlesService([item]),
      fakeBaseReader(new Date('2026-09-06T00:00:00.000Z'), 1),
    );
    const result = await controller.render({} as any);
    const initialData = JSON.parse(result.__initial_data__) as Record<
      string,
      unknown
    >;
    expect(initialData).not.toHaveProperty('adminLinks');
    expect(initialData).not.toHaveProperty('adminAccess');
  });
});
