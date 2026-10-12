import { ArticlesService } from '../../server/modules/articles/articles.service';

const rows = [
  {
    baseRecordId: 'rec-1',
    title: 'MMO 研究',
    appDocId: 'doc-token',
    docLink: 'https://example.feishu.cn/docx/doc-token',
    approvalStatus: '已批准',
    abstract: '公开摘要',
    keyFindings: '关键结论',
    board: '竞品信息周报',
    contentType: '研究报告',
    sourceAuthor: '作者',
    sourcePublisher: '发布方',
    gameplayParent: 'MMO',
    gameplayChild: '',
    sourceDateFeishu: '2026-09-09',
    coverFileToken: null,
    updateTime: new Date('2026-09-09T00:00:00.000Z'),
  },
  {
    baseRecordId: 'rec-2',
    title: '待审文章',
    appDocId: null,
    docLink: null,
    approvalStatus: '待审核',
    abstract: '不应公开',
    keyFindings: null,
    board: '其他',
    contentType: '外链文章',
    sourceAuthor: '',
    sourcePublisher: '',
    gameplayParent: 'MMO',
    gameplayChild: '挂机嗨游',
    sourceDateFeishu: '2026-09-10',
    coverFileToken: null,
    updateTime: new Date('2026-09-10T00:00:00.000Z'),
  },
] as const;

function makeService(list: readonly unknown[] = rows) {
  return new ArticlesService(
    { listArticleRows: jest.fn().mockResolvedValue([...list]) } as any,
    {} as any,
    {} as any,
  );
}

function makeDetailService(document: { readArticle: jest.Mock }) {
  return new ArticlesService(
    {
      listArticleRows: jest
        .fn()
        .mockResolvedValue(rows.map((row) => ({ ...row, appDocId: null }))),
    } as any,
    document as any,
    {} as any,
  );
}

const day = 24 * 60 * 60 * 1000;
const dateOnly = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * day).toISOString().slice(0, 10);

describe('direct Feishu Base article service', () => {
  it('uses approval status as the public gate and groups current Base fields', async () => {
    const facets = await makeService().facets();
    // 内容类型与玩法分类均以 Base 原文为筛选值，不再翻译成固定 slug。
    expect(facets.contentTypes).toEqual([
      { value: '研究报告', label: '研究报告', count: 1 },
    ]);
    expect(facets.gameplay).toEqual([
      { value: 'MMO', label: 'MMO', count: 1, selfCount: 1, children: [] },
    ]);
    expect(facets.types).toEqual([{ kind: '研究报告', count: 1 }]);
    expect(facets.categories).toEqual([{ type: 'MMO', count: 1 }]);
    expect(facets.tags).toEqual([]);
  });

  it('aggregates a parent category over its children and filters by either level', async () => {
    const base = {
      ...rows[0],
      approvalStatus: '已批准',
      contentType: '研究报告',
    };
    const service = makeService([
      { ...base, baseRecordId: 'p', gameplayParent: 'MMO', gameplayChild: '' },
      {
        ...base,
        baseRecordId: 'c1',
        gameplayParent: 'MMO',
        gameplayChild: '挂机嗨游',
      },
      {
        ...base,
        baseRecordId: 'c2',
        gameplayParent: 'MMO',
        gameplayChild: '轻端游',
      },
      { ...base, baseRecordId: 'x', gameplayParent: 'x-slg', gameplayChild: '' },
    ]);
    const facets = await service.facets();
    expect(facets.gameplay).toEqual([
      {
        value: 'MMO',
        label: 'MMO',
        count: 3,
        selfCount: 1,
        children: [
          { value: '挂机嗨游', label: '挂机嗨游', count: 1 },
          { value: '轻端游', label: '轻端游', count: 1 },
        ],
      },
      { value: 'x-slg', label: 'x-slg', count: 1, selfCount: 1, children: [] },
    ]);
    // 传父项名命中自身 + 全部子项；传子项名只命中该子项。
    expect((await service.list({ gameplayCategory: 'MMO' })).total).toBe(3);
    expect((await service.list({ gameplayCategory: '挂机嗨游' })).total).toBe(1);
    // 旧英文 slug 归一化后仍可命中，历史链接不断。
    expect((await service.list({ gameplayCategory: 'idle-mmo' })).total).toBe(1);
    expect((await service.list({ contentType: '研究报告' })).total).toBe(4);
  });

  it('derives the category tree from Base values without a hardcoded enum', async () => {
    const base = { ...rows[0], approvalStatus: '已批准' };
    const service = makeService([
      {
        ...base,
        baseRecordId: 'n',
        gameplayParent: '新分类',
        gameplayChild: '',
      },
    ]);
    const facets = await service.facets();
    expect(facets.gameplay.map((node) => node.value)).toEqual(['新分类']);
  });

  it('applies the days window on the Feishu source date and drops undated rows', async () => {
    const base = { ...rows[0], approvalStatus: '已批准' };
    const service = makeService([
      { ...base, baseRecordId: 'recent', sourceDateFeishu: dateOnly(2) },
      { ...base, baseRecordId: 'old', sourceDateFeishu: dateOnly(40) },
      { ...base, baseRecordId: 'none', sourceDateFeishu: '' },
    ]);
    expect((await service.list({})).total).toBe(3);
    expect((await service.list({ days: 7 })).total).toBe(1);
    expect((await service.list({ days: 60 })).total).toBe(2);
  });

  it('sorts by Feishu source date and keeps undated rows last in both directions', async () => {
    const base = { ...rows[0], approvalStatus: '已批准' };
    const service = makeService([
      { ...base, baseRecordId: 'newer', sourceDateFeishu: '2026-01-02' },
      { ...base, baseRecordId: 'older', sourceDateFeishu: '2026-01-01' },
      { ...base, baseRecordId: 'undated', sourceDateFeishu: '' },
    ]);
    const asc = await service.list({ order: 'asc' });
    expect(asc.items.map((item) => item.docId)).toEqual([
      'older',
      'newer',
      'undated',
    ]);
    const desc = await service.list({ order: 'desc' });
    expect(desc.items.map((item) => item.docId)).toEqual([
      'newer',
      'older',
      'undated',
    ]);
  });

  it('filters the live Base rows and keeps the Feishu source date unchanged', async () => {
    const result = await makeService().list({ search: 'MMO', limit: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      docId: 'rec-1',
      sourceDate: '2026-09-09',
      structured: { keyFindings: '关键结论' },
    });
  });

  it('exposes the parent/child pair and a single-value fallback for cards', async () => {
    const listed = await makeService().list({});
    expect(listed.items[0]).toMatchObject({
      gameplayParent: 'MMO',
      gameplayChild: '',
      gameplayCategory: 'MMO',
    });
  });

  it('reads a valid Feishu document link and preserves a successful body', async () => {
    const document = {
      readArticle: jest
        .fn()
        .mockResolvedValue({ status: 'ready', body: '# 正文' }),
    };
    const result = await makeDetailService(document).detail('rec-1');
    expect(document.readArticle).toHaveBeenCalledWith(null, rows[0].docLink);
    expect(result).toMatchObject({
      bodyMarkdown: '# 正文',
      documentStatus: 'ready',
    });
  });

  it('keeps the summary fallback and explicit status when Feishu body access fails', async () => {
    const document = {
      readArticle: jest.fn().mockResolvedValue({
        status: 'unavailable',
        body: null,
        errorCode: 'FEISHU_HTTP_403',
      }),
    };
    const result = await makeDetailService(document).detail('rec-1');
    expect(result).toMatchObject({
      summary: '公开摘要',
      bodyMarkdown: null,
      documentStatus: 'unavailable',
      errorCode: 'FEISHU_HTTP_403',
    });
  });
});
