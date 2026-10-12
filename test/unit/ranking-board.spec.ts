import {
  RankingBoardService,
} from '../../server/modules/wiki-beta/ranking-board.service';
import type { WikiBetaRankingRow } from '../../server/modules/wiki-beta/feishu-base-reader.service';
import {
  rankingSheetDefaults,
  parseRankingDataSource,
  deriveAppstoreSheetName,
  rankingBoardKey,
  normalizeRankingSlug,
  rankingPeriodSortKey,
} from '../../shared/rankings';
import { renderAppstoreInner, buildWeixinInner } from '../../shared/ranking-render';

function row(
  overrides: Partial<WikiBetaRankingRow>,
): WikiBetaRankingRow {
  return {
    baseRecordId: 'rec-x',
    board: 'Steam',
    slug: 'steam-w1',
    label: '2026年第32周',
    htmlFileToken: 'file-token',
    dataSource: '',
    ...overrides,
  };
}

function makeService(rows: WikiBetaRankingRow[], sheets?: Record<string, any>) {
  const attachment = { data: Buffer.from('<html>榜单正文</html>'), contentType: 'text/html' };
  const baseReader = {
    listRankingRows: jest.fn().mockResolvedValue(rows),
    downloadAttachment: jest.fn().mockResolvedValue(attachment),
  };
  const sheetsReader = {
    resolveWikiSpreadsheet: jest.fn().mockResolvedValue(sheets?.wikiToken ?? null),
    listSheets: jest.fn().mockResolvedValue(sheets?.list ?? []),
    readValues: jest.fn().mockResolvedValue(sheets?.values ?? null),
  };
  return {
    service: new RankingBoardService(baseReader as any, sheetsReader as any),
    baseReader,
    sheetsReader,
  };
}

describe('rankingBoardKey', () => {
  it('映射三个板块原文并忽略未知值', () => {
    expect(rankingBoardKey('AppStore')).toBe('appstore');
    expect(rankingBoardKey('微信')).toBe('weixin');
    expect(rankingBoardKey('Steam')).toBe('steam');
    expect(rankingBoardKey('抖音')).toBeNull();
    expect(rankingBoardKey('')).toBeNull();
  });
});

describe('rankingPeriodSortKey（口径与原静态生成器一致）', () => {
  it('AppStore 周榜取区间结束日，跨年周抬高到次年', () => {
    expect(rankingPeriodSortKey('appstore', 'w08260902', '周榜 0826-0902')).toBe(902);
    expect(rankingPeriodSortKey('appstore', 'w12290104', '周榜 1229-0104')).toBe(10104);
  });
  it('AppStore 周榜兼容带板块前缀的 slug（Base 行实际格式）', () => {
    expect(rankingPeriodSortKey('appstore', 'appstore-w08260902', '周榜 0826-0902')).toBe(902);
  });
  it('AppStore 月榜按月末参与排序，落在相邻周榜之间', () => {
    const monthly = rankingPeriodSortKey('appstore', 'monthly', '收入月榜 8月');
    expect(monthly).toBe(831);
    expect(monthly).toBeGreaterThan(rankingPeriodSortKey('appstore', 'w08120818', '周榜 0812-0818'));
    expect(monthly).toBeLessThan(rankingPeriodSortKey('appstore', 'w08260902', '周榜 0826-0902'));
  });
  it('Steam 标签「2026年第37周」键 = 年*100+周', () => {
    expect(rankingPeriodSortKey('steam', 'steam-w6', '2026年第37周')).toBe(202637);
  });
});

describe('RankingBoardService.listBoardsMeta', () => {
  it('periods 按时间倒序（索引 0 = 最新一期）', async () => {
    const { service } = makeService([
      row({ slug: 'steam-w1', label: '2026年第32周' }),
      row({ slug: 'steam-w6', label: '2026年第37周' }),
      row({ slug: 'steam-w3', label: '2026年第34周' }),
    ]);
    const meta = await service.listBoardsMeta();
    expect(meta.steam?.periods.map((p) => p.slug)).toEqual([
      'w6',
      'w3',
      'w1',
    ]);
    expect(meta.steam?.type).toBe('periods');
  });

  it('单行 index 的板块投影为 single；无附件行也进 meta（可能是 sheet 驱动行）', async () => {
    const { service } = makeService([
      row({ board: '微信', slug: 'index', label: '单页资料' }),
      row({ slug: 'steam-w9', htmlFileToken: null, dataSource: '' }),
    ]);
    const meta = await service.listBoardsMeta();
    expect(meta.weixin?.type).toBe('single');
    expect(meta.steam?.periods.map((p) => p.slug)).toEqual(['w9']);
  });

  it('未知板块与缺 slug 的行被忽略', async () => {
    const { service } = makeService([
      row({ board: '抖音', slug: 'douyin-1' }),
      row({ slug: '' }),
    ]);
    const meta = await service.listBoardsMeta();
    expect(meta).toEqual({});
  });
});

describe('RankingBoardService.loadContent', () => {
  it('命中行时下载附件并以 utf8 返回正文', async () => {
    const { service, baseReader } = makeService([
      row({ baseRecordId: 'rec-target', slug: 'steam-w6' }),
    ]);
    const html = await service.loadContent('steam', 'steam-w6');
    expect(html).toBe('<html>榜单正文</html>');
    expect(baseReader.downloadAttachment).toHaveBeenCalledWith(
      'rec-target',
      'file-token',
      process.env.WIKI_BETA_RANKING_HTML_FIELD_ID,
      process.env.WIKI_BETA_RANKING_TABLE_ID,
    );
  });

  it('未知板块/slug 未命中时返回 null（前端回退静态兜底）', async () => {
    const { service } = makeService([row({ slug: 'steam-w6' })]);
    expect(await service.loadContent('douyin', 'steam-w6')).toBeNull();
    expect(await service.loadContent('steam', 'steam-w9')).toBeNull();
  });

  it('同一期 60s 内命中内容缓存，不重复下载附件', async () => {
    const { service, baseReader } = makeService([row()]);
    await service.loadContent('steam', 'steam-w1');
    await service.loadContent('steam', 'steam-w1');
    expect(baseReader.downloadAttachment).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeRankingSlug', () => {
  it('剥板块前缀，裸 slug 原样保留', () => {
    expect(normalizeRankingSlug('steam', 'steam-w7')).toBe('w7');
    expect(normalizeRankingSlug('appstore', 'appstore-w08260902')).toBe('w08260902');
    expect(normalizeRankingSlug('weixin', 'weixin-index')).toBe('index');
    expect(normalizeRankingSlug('steam', 'w7')).toBe('w7');
    expect(normalizeRankingSlug('steam', 'monthly')).toBe('monthly');
  });

  it('meta 输出与 loadContent 均按归一化 slug 口径', async () => {
    const { service } = makeService([
      row({ slug: 'steam-w7', label: '2026年第38周' }),
      row({ slug: 'steam-w6', label: '2026年第37周' }),
    ]);
    const meta = await service.listBoardsMeta();
    expect(meta.steam?.periods.map((p) => p.slug)).toEqual(['w7', 'w6']);
    expect(await service.loadContent('steam', 'steam-w7')).toBe('<html>榜单正文</html>');
    expect(await service.loadContent('steam', 'w7')).toBe('<html>榜单正文</html>');
  });
});

describe('sheet 驱动渲染（无附件行）', () => {
  const appstoreRows = [
    ['更新时间 0908', '', ''],
    ['排名', '应用', '下载量'],
    ['1', 'Game A', '100k'],
    ['2', 'Game B', '80k'],
  ];

  it('AppStore：「数据源」sheet 名经默认源（固定年度工作簿）实时渲染 inner 片段', async () => {
    const { service, sheetsReader } = makeService(
      [row({ board: 'AppStore', slug: 'w09020908', label: '周榜 0902-0908', htmlFileToken: null, dataSource: '0902-0908' })],
      {
        list: [{ sheetId: 'sh1', title: '0902-0908' }],
        values: appstoreRows,
      },
    );
    const html = await service.loadContent('appstore', 'w09020908');
    expect(html).toContain('table-card');
    expect(html).toContain('<div class="note">更新时间 0908</div>');
    expect(sheetsReader.readValues).toHaveBeenCalledWith(
      rankingSheetDefaults().appstoreSpreadsheetToken,
      'sh1',
    );
  });

  it('AppStore：「数据源」留空时从 slug 推导 sheet 名（w09020908 → 0902-0908）', async () => {
    const { service, sheetsReader } = makeService(
      [row({ board: 'AppStore', slug: 'appstore-w09020908', label: '周榜 0902-0908', htmlFileToken: null, dataSource: '' })],
      {
        list: [{ sheetId: 'sh1', title: '0902-0908' }],
        values: appstoreRows,
      },
    );
    const html = await service.loadContent('appstore', 'w09020908');
    expect(html).toContain('table-card');
    expect(sheetsReader.readValues).toHaveBeenCalledWith(
      rankingSheetDefaults().appstoreSpreadsheetToken,
      'sh1',
    );
  });

  it('微信：无附件行走默认 wiki 节点 Sheet1 渲染 like-grid', async () => {
    const { service, sheetsReader } = makeService(
      [row({ board: '微信', slug: 'index', label: '单页资料', htmlFileToken: null, dataSource: '' })],
      {
        wikiToken: 'sp-weixin',
        list: [{ sheetId: 'shw', title: 'Sheet1' }],
        values: [
          ['靶心like', '', '', '无尽-like', ''],
          ['Game X', '融合点', '', 'Game Y', ''],
        ],
      },
    );
    const html = await service.loadContent('weixin', 'index');
    expect(html).toContain('like-grid');
    expect(html).toContain('Game X');
    expect(sheetsReader.resolveWikiSpreadsheet).toHaveBeenCalledWith(
      rankingSheetDefaults().weixinNodeToken,
    );
  });

  it('sheet 渲染失败（权限/sheet 缺失/空榜）返回 null，不影响附件行', async () => {
    const failing = makeService(
      [row({ board: 'AppStore', slug: 'w1', label: '周榜', htmlFileToken: null, dataSource: 'no-such-sheet' })],
      { list: [{ sheetId: 's', title: 'other' }] },
    );
    expect(await failing.service.loadContent('appstore', 'w1')).toBeNull();
    const ok = makeService([row()]);
    expect(await ok.service.loadContent('steam', 'steam-w1')).toBe('<html>榜单正文</html>');
  });
});

describe('parseRankingDataSource', () => {
  it('空值 → 微信走默认节点+Sheet1，AppStore 走默认年度工作簿（sheet 名待从 slug 推导）', () => {
    expect(parseRankingDataSource('', 'weixin')).toEqual({
      sourceToken: rankingSheetDefaults().weixinNodeToken,
      isWikiNode: true,
      sheetName: 'Sheet1',
    });
    expect(parseRankingDataSource('', 'appstore')).toEqual({
      sourceToken: rankingSheetDefaults().appstoreSpreadsheetToken,
      isWikiNode: false,
      sheetName: '',
    });
    expect(parseRankingDataSource('', 'steam')).toBeNull();
  });
  it('纯文本 → 板块默认源 + sheet 名；显式格式可覆盖 token', () => {
    expect(parseRankingDataSource('0902-0908', 'appstore')).toEqual({
      sourceToken: rankingSheetDefaults().appstoreSpreadsheetToken,
      isWikiNode: false,
      sheetName: '0902-0908',
    });
    expect(parseRankingDataSource('sheet:sp123#8月', 'appstore')).toEqual({
      sourceToken: 'sp123',
      isWikiNode: false,
      sheetName: '8月',
    });
    expect(parseRankingDataSource('wiki:nodeAbc#Sheet2', 'weixin')).toEqual({
      sourceToken: 'nodeAbc',
      isWikiNode: true,
      sheetName: 'Sheet2',
    });
  });
});

describe('deriveAppstoreSheetName', () => {
  it('周 slug（兼容板块前缀）→ 区间 sheet 名；非周 slug 返回 null', () => {
    expect(deriveAppstoreSheetName('w08260902')).toBe('0826-0902');
    expect(deriveAppstoreSheetName('appstore-w09090915')).toBe('0909-0915');
    expect(deriveAppstoreSheetName('monthly')).toBeNull();
    expect(deriveAppstoreSheetName('')).toBeNull();
  });
});

describe('ranking-render 移植口径', () => {
  it('buildRankingTable 无「排名」表头 → 空榜 null；有空列时剔除', () => {
    expect(renderAppstoreInner([['说明'], ['排名', '应用', '图标'], ['1', 'A', '']])).toContain('table-card');
    expect(renderAppstoreInner([['随便什么', 'x']])).toBeNull();
  });
  it('说明行文本含「排名」（如“地区排名”）不误判为表头——0909-0915 期回归', () => {
    const html = renderAppstoreInner([
      ['海外SLG周下载榜Top30（AppStore + Google Play）', ''],
      ['数据范围：2026-09-09 至 2026-09-15。按 App Store 与 Google Play 源榜合计排序，不代表合并后的地区排名。', ''],
      [''],
      ['周排名', '游戏名称', '上线日期'],
      ['1', 'Kingshot', '2025-02-22'],
    ]);
    expect(html).toContain('<div class="note">海外SLG周下载榜Top30（AppStore + Google Play）</div>');
    expect(html).toContain('<th class="rank">周排名</th>');
    expect(html).not.toContain('数据范围');
  });
  it('收入月榜表头「收入排名」命中；图片说明行不误判', () => {
    const html = renderAppstoreInner([
      ['海外SLG 2026年8月预估收入排行榜 Top20', ''],
      ['<img>', ''],
      [''],
      ['收入排名', '游戏名称', '8月预估净收入（美元）'],
      ['1', 'Kingshot', '$72M'],
    ]);
    expect(html).toContain('<th class="rank">收入排名</th>');
    expect(html).toContain('<div class="note">海外SLG 2026年8月预估收入排行榜 Top20</div>');
  });
  it('buildWeixinInner 保留 like 卡片结构', () => {
    const html = buildWeixinInner([
      ['靶心like', '', '', '无尽-like', ''],
      ['Game X', '融合点', '', 'Game Y', ''],
    ]);
    expect(html).toContain('like-card');
    expect(html).toContain('靶心like');
  });
});
