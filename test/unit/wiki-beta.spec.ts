import {
  extractDocumentReference,
  FeishuDocumentReader,
  isSafeDocumentId,
  normalizeDocumentBody,
} from '../../server/modules/wiki-beta/document-reader.service';
import { extractOriginalUrl } from '../../server/modules/wiki-beta/publication-policy';

const publicRow = {
  id: '00000000-0000-0000-0000-000000000001',
  baseRecordId: 'recvueB8UdmIaD',
  title: 'wiki-beta API 试验文章',
  appDocId: 'docxEXAMPLEPUBLICDOC01',
  docLink:
    '[在飞书打开原文](https://example.feishu.cn/docx/docxEXAMPLEPUBLICDOC01)',
  approvalStatus: '已批准',
  abstract: '该记录已通过飞书多维表格人工审批，可进入站内阅读器。',
  updateTime: new Date('2026-09-04T07:49:42.000Z'),
};

describe('wiki-beta publishing policy', () => {
  it('preserves the synced source link', () => {
    expect(extractOriginalUrl(publicRow.docLink)).toBe(
      'https://example.feishu.cn/docx/docxEXAMPLEPUBLICDOC01',
    );
    expect(extractOriginalUrl(null)).toBeNull();
    // http:// 外链（微信文人工粘贴形态）不可被过滤成空——2026-09-16 线上回归。
    expect(
      extractOriginalUrl(
        'http://mp.weixin.qq.com/s?__biz=MzkzMDM4NzI4NA==&mid=2247520413&sn=d827#rd',
      ),
    ).toBe(
      'http://mp.weixin.qq.com/s?__biz=MzkzMDM4NzI4NA==&mid=2247520413&sn=d827#rd',
    );
    // 中文句尾标点不编进 URL。
    expect(extractOriginalUrl('原文：https://mp.weixin.qq.com/s/abc。')).toBe(
      'https://mp.weixin.qq.com/s/abc',
    );
  });
});

describe('Feishu document reader boundaries', () => {
  it('validates document tokens and normalizes line endings', () => {
    expect(isSafeDocumentId('docxEXAMPLEPUBLICDOC01')).toBe(true);
    expect(isSafeDocumentId('https://example.com/docx/anything')).toBe(false);
    expect(normalizeDocumentBody('标题\r\n\r\n正文\r')).toBe('标题\n\n正文');
    expect(
      extractDocumentReference(
        'https://example.feishu.cn/wiki/wikEXAMPLEWIKINODE01',
      ),
    ).toEqual({
      type: 'wiki',
      token: 'wikEXAMPLEWIKINODE01',
    });
    expect(
      extractDocumentReference(
        '[原文](https://example.feishu.cn/wiki/wikEXAMPLEWIKINODE02)',
      ),
    ).toEqual({
      type: 'wiki',
      token: 'wikEXAMPLEWIKINODE02',
    });
    expect(
      extractDocumentReference(
        '[原文](https://example.feishu.cn/docx/docxEXAMPLEPUBLICDOC01)',
      ),
    ).toEqual({
      type: 'docx',
      token: 'docxEXAMPLEPUBLICDOC01',
    });
  });

  it('returns a structured configuration status without a server credential', async () => {
    delete process.env.FEISHU_TENANT_ACCESS_TOKEN;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    await expect(
      new FeishuDocumentReader().read('docxEXAMPLEPUBLICDOC01'),
    ).resolves.toMatchObject({
      status: 'not_configured',
      errorCode: 'FEISHU_AUTH_NOT_CONFIGURED',
    });
    await expect(
      new FeishuDocumentReader().readFromLink(
        'https://example.feishu.cn/wiki/wikEXAMPLEWIKINODE01',
      ),
    ).resolves.toMatchObject({
      status: 'not_configured',
      errorCode: 'FEISHU_AUTH_NOT_CONFIGURED',
    });
  });

  it('distinguishes rejected app credentials from missing configuration', async () => {
    process.env.FEISHU_APP_ID = 'cli_test_app';
    process.env.FEISHU_APP_SECRET = 'test-secret';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 99991663, msg: 'invalid app credential' }),
    } as Response);

    await expect(
      new FeishuDocumentReader().read('docxEXAMPLEPUBLICDOC01'),
    ).resolves.toMatchObject({
      status: 'unavailable',
      errorCode: 'FEISHU_TOKEN_EXCHANGE_API_99991663',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });
});
