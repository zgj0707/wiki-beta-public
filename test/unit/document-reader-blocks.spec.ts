import { FeishuDocumentReader } from '../../server/modules/wiki-beta/document-reader.service';

const DOC_ID = 'docxEXAMPLEPUBLICDOC01';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function blocksResponse(items: unknown[], extra: Record<string, unknown> = {}) {
  return jsonResponse({
    code: 0,
    msg: 'success',
    data: { items, has_more: false, ...extra },
  });
}

describe('FeishuDocumentReader blocks pipeline', () => {
  beforeEach(() => {
    process.env.FEISHU_TENANT_ACCESS_TOKEN = 'test-tenant-token';
  });

  afterEach(() => {
    delete process.env.FEISHU_TENANT_ACCESS_TOKEN;
    jest.restoreAllMocks();
  });

  it('prefers the docx blocks API and converts blocks into markdown', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        blocksResponse([
          { block_id: 'page', block_type: 1, children: ['h', 'p'] },
          {
            block_id: 'h',
            block_type: 3,
            heading1: { elements: [{ text_run: { content: '标题' } }] },
          },
          {
            block_id: 'p',
            block_type: 2,
            text: {
              elements: [
                { text_run: { content: '正文', text_element_style: { bold: true } } },
              ],
            },
          },
        ]),
      );

    const result = await new FeishuDocumentReader().read(DOC_ID);

    expect(result.status).toBe('ready');
    expect(result.body).toBe('# 标题\n**正文**');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks`,
    );
  });

  it('falls back to raw_content when the blocks API fails with an HTTP error', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { content: '原始正文\r\n第二行' } }),
      );

    const result = await new FeishuDocumentReader().read(DOC_ID);

    expect(result.status).toBe('ready');
    expect(result.body).toBe('原始正文\n第二行');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/raw_content');
  });

  it('aggregates paginated block responses via page_token', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        blocksResponse([{ block_id: 'page', block_type: 1, children: ['a'] }], {
          has_more: true,
          page_token: 'page-2-token',
        }),
      )
      .mockResolvedValueOnce(
        blocksResponse([
          {
            block_id: 'a',
            block_type: 2,
            text: { elements: [{ text_run: { content: '分页内容' } }] },
          },
        ]),
      );

    const result = await new FeishuDocumentReader().read(DOC_ID);

    expect(result.status).toBe('ready');
    expect(result.body).toBe('分页内容');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      'page_token=page-2-token',
    );
  });

  it('returns not_configured without calling any API when credentials are missing', async () => {
    delete process.env.FEISHU_TENANT_ACCESS_TOKEN;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await expect(new FeishuDocumentReader().read(DOC_ID)).resolves.toMatchObject({
      status: 'not_configured',
      errorCode: 'FEISHU_AUTH_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a wiki link via get_node instead of using the wiki token as a document id', async () => {
    // 回归：Base「文档ID」列在走 wiki 链接录入时存的是节点 token，它长得
    // 像合法 document_id，但拿去调 docx blocks API 会 1770002 not found。
    const WIKI_TOKEN = 'wikEXAMPLEWIKINODE03';
    const REAL_DOCX = 'docxEXAMPLEWIKIRESOLVE1';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { node: { obj_type: 'docx', obj_token: REAL_DOCX } },
        }),
      )
      .mockResolvedValueOnce(
        blocksResponse([
          {
            block_id: 'p',
            block_type: 2,
            text: { elements: [{ text_run: { content: '周报正文' } }] },
          },
        ]),
      );

    const result = await new FeishuDocumentReader().readArticle(
      WIKI_TOKEN,
      `[https://example.feishu.cn/wiki/${WIKI_TOKEN}](https://example.feishu.cn/wiki/${WIKI_TOKEN})`,
    );

    expect(result.status).toBe('ready');
    expect(result.body).toBe('周报正文');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/open-apis/wiki/v2/spaces/get_node');
    expect(urls.some((url) => url.includes(`/documents/${WIKI_TOKEN}/`))).toBe(
      false,
    );
    expect(urls[1]).toContain(`/documents/${REAL_DOCX}/blocks`);
  });

  it('falls back to the document id when the synced link is not a Feishu doc link', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      blocksResponse([
        {
          block_id: 'p',
          block_type: 2,
          text: { elements: [{ text_run: { content: '兜底正文' } }] },
        },
      ]),
    );

    const result = await new FeishuDocumentReader().readArticle(
      DOC_ID,
      'https://mp.weixin.qq.com/s/not-a-feishu-doc',
    );

    expect(result.status).toBe('ready');
    expect(result.body).toBe('兜底正文');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/documents/${DOC_ID}/blocks`,
    );
  });
});
