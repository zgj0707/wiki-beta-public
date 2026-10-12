import {
  FeishuBaseReader,
  FeishuBaseReadError,
  extractBaseToken,
  parseBasePage,
  toFieldDescriptions,
} from '../../server/modules/wiki-beta/feishu-base-reader.service';

describe('FeishuBaseReader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.WIKI_BETA_BASE_TOKEN;
    delete process.env.WIKI_BETA_BASE_URL;
    delete process.env.FEISHU_OPENAPI_BASE_URL;
  });

  it('keeps only fields that actually carry a non-blank description', () => {
    expect(
      toFieldDescriptions([
        {
          field_name: '市场认可指数',
          description: '  市场认可度（Jev 双维判定）…  ',
        },
        // 未设置描述的字段：接口里**根本没有 description 键**（不是 null）
        { field_name: '更新时间', type: 'updated_at' },
        { field_name: '审核状态', description: null },
        // 描述只有空白字符 —— 与「没描述」等价，不能写进映射
        { field_name: '只有空格', description: '   ' },
        // 类型不对的一律丢弃，别把数字当描述
        { field_name: '数字描述', description: 42 },
        { description: '缺字段名' },
        null,
        'not-an-object',
      ]),
    ).toEqual({ 市场认可指数: '市场认可度（Jev 双维判定）…' });
  });

  it('extracts the Base token and parses paginated records', () => {
    expect(extractBaseToken('https://example.feishu.cn/base/app-token')).toBe(
      'app-token',
    );
    expect(
      parseBasePage({
        code: 0,
        data: {
          items: [{ record_id: 'rec-1', fields: { 标题: '文章' } }],
          has_more: false,
        },
      }),
    ).toEqual({
      apiCode: 0,
      items: [{ record_id: 'rec-1', fields: { 标题: '文章' } }],
      hasMore: false,
      pageToken: null,
    });
  });

  it('reads the current Base tables with the shared Feishu token and maps fields', async () => {
    process.env.WIKI_BETA_BASE_TOKEN = 'base-token';
    process.env.FEISHU_OPENAPI_BASE_URL = 'https://open.example.test';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec-article',
                fields: {
                  标题: '公开研究',
                  文档链接: 'https://example.feishu.cn/docx/doc-token',
                  审批状态: '已批准',
                  摘要: '摘要',
                  关键结论: '结论',
                  内容类型: '研究报告',
                  玩法分类父项: 'MMO',
                  玩法分类子项: '挂机嗨游',
                  飞书来源日期: '2026-09-09',
                },
              },
            ],
            has_more: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const documentReader = {
      getTenantAccessToken: jest
        .fn()
        .mockResolvedValue({ token: 'tenant-token' }),
    };

    const rows = await new FeishuBaseReader(
      documentReader as any,
    ).listArticleRows();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://open.example.test/open-apis/bitable/v1/apps/base-token/tables/${process.env.WIKI_BETA_ARTICLE_TABLE_ID}/records?page_size=500&text_field_as_array=true`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-token',
        }),
      }),
    );
    expect(rows[0]).toMatchObject({
      baseRecordId: 'rec-article',
      title: '公开研究',
      approvalStatus: '已批准',
      // 内容类型与分类均按 Base 原文透传，不再翻译成固定 slug。
      contentType: '研究报告',
      gameplayParent: 'MMO',
      gameplayChild: '挂机嗨游',
    });
  });

  it('falls back to the pre-rename 「玩法分类」 column so a field rename has no gap', async () => {
    process.env.WIKI_BETA_BASE_TOKEN = 'base-token';
    process.env.FEISHU_OPENAPI_BASE_URL = 'https://open.example.test';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec-legacy',
                fields: { 标题: '旧列文章', 玩法分类: '挂机嗨游' },
              },
            ],
            has_more: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const rows = await new FeishuBaseReader({
      getTenantAccessToken: jest
        .fn()
        .mockResolvedValue({ token: 'tenant-token' }),
    } as any).listArticleRows();
    expect(rows[0]).toMatchObject({
      gameplayParent: '挂机嗨游',
      gameplayChild: '',
    });
  });

  it('accepts a successful empty table page when Feishu omits the item list', () => {
    expect(
      parseBasePage({ code: 0, data: { total: 0, has_more: false } }),
    ).toEqual({
      apiCode: 0,
      items: [],
      hasMore: false,
      pageToken: null,
    });
  });

  it('keeps Feishu HTTP failures distinguishable from empty data', async () => {
    process.env.WIKI_BETA_BASE_TOKEN = 'base-token';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 403 }));
    const reader = new FeishuBaseReader({
      getTenantAccessToken: jest
        .fn()
        .mockResolvedValue({ token: 'tenant-token' }),
    } as any);

    // Phase 4 后 reader 无实体表方法；HTTP 错误语义用文章表验证（同错误通道）。
    await expect(
      reader.listArticleRows(),
    ).rejects.toMatchObject<FeishuBaseReadError>({
      errorCode: 'FEISHU_BASE_HTTP_403',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
