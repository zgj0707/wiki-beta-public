import { ChatRankingSource } from './chat-ranking-source';
import type { RankingBoardService } from '../wiki-beta/ranking-board.service';

describe('ChatRankingSource', () => {
  function createSource() {
    const rankingBoard = {
      listBoardsMeta: jest.fn().mockResolvedValue({
        steam: {
          title: 'Steam 畅销榜',
          type: 'periods',
          periods: [
            { slug: 'w40', label: '2026年第40周' },
            { slug: 'w39', label: '2026年第39周' },
          ],
        },
      }),
      loadContent: jest
        .fn()
        .mockResolvedValue(
          '<table><tr><td>1</td><td>合成产品</td></tr></table>',
        ),
    };
    return {
      rankingBoard,
      source: new ChatRankingSource(
        rankingBoard as unknown as RankingBoardService,
      ),
    };
  }

  it('命中在线历史精确期次，并用对应期次标注引用', async () => {
    const { rankingBoard, source } = createSource();

    const docs = await source.retrieve(['steam'], {
      kind: 'exact',
      label: '2026年第39周',
    });

    expect(rankingBoard.loadContent).toHaveBeenCalledWith('steam', 'w39');
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toContain('2026年第39周');
    expect(docs[0].url).toBe('/ranking/steam/w39');
  });

  it('上一期请求读取前一条记录，不冒用最新一期', async () => {
    const { rankingBoard, source } = createSource();

    const docs = await source.retrieve(['steam'], {
      kind: 'previous',
      label: '上一期',
    });

    expect(rankingBoard.loadContent).toHaveBeenCalledWith('steam', 'w39');
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toContain('2026年第39周');
    expect(docs[0].title).not.toContain('2026年第40周');
  });

  it('找不到精确期次时不回退为最新榜单', async () => {
    const { rankingBoard, source } = createSource();

    const docs = await source.retrieve(['steam'], {
      kind: 'exact',
      label: '2025年第37周',
    });

    expect(docs).toEqual([]);
    expect(rankingBoard.listBoardsMeta).toHaveBeenCalled();
    expect(rankingBoard.loadContent).not.toHaveBeenCalled();
  });

  it('线上榜单缺少记录时仍能读取网站使用的本地静态归档', async () => {
    const { rankingBoard, source } = createSource();
    rankingBoard.listBoardsMeta.mockResolvedValue({});
    rankingBoard.loadContent.mockImplementation(async () => null);

    const docs = await source.retrieve(['steam'], {
      kind: 'exact',
      label: '2026年第2周',
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].docId).toBe('ranking:steam:w2');
    expect(docs[0].title).toContain('2026年第2周');
    expect(docs[0].url).toBe('/ranking/steam/w2');
    expect(docs[0].snippet.length).toBeGreaterThan(0);
  });

  it('同一期同时存在在线与静态记录时优先引用在线记录', async () => {
    const { rankingBoard, source } = createSource();
    rankingBoard.listBoardsMeta.mockResolvedValue({
      steam: {
        title: 'Steam 榜单',
        type: 'periods',
        periods: [{ slug: 'live-w37', label: '2026年第37周' }],
      },
    });

    const docs = await source.retrieve(['steam'], {
      kind: 'exact',
      label: '2026年第37周',
    });

    expect(rankingBoard.loadContent).toHaveBeenCalledWith('steam', 'live-w37');
    expect(docs).toHaveLength(1);
    expect(docs[0].docId).toBe('ranking:steam:live-w37');
  });

  it('最近三周请求返回最多三条周榜，不混入其他粒度', async () => {
    const { rankingBoard, source } = createSource();
    rankingBoard.listBoardsMeta.mockResolvedValue({
      steam: {
        title: 'Steam 畅销榜',
        type: 'periods',
        periods: [
          { slug: 'w40', label: '2026年第40周' },
          { slug: 'w39', label: '2026年第39周' },
          { slug: 'w38', label: '2026年第38周' },
          { slug: 'm09', label: '2026年9月' },
        ],
      },
    });

    const docs = await source.retrieve(['steam'], {
      kind: 'range',
      label: '最近三周',
    });

    expect(docs.map((doc) => doc.title)).toEqual([
      'Steam 畅销榜 · 2026年第40周',
      'Steam 畅销榜 · 2026年第39周',
      'Steam 畅销榜 · 2026年第38周',
    ]);
    expect(rankingBoard.loadContent).toHaveBeenCalledTimes(3);
    expect(rankingBoard.loadContent).not.toHaveBeenCalledWith('steam', 'm09');
  });

  it('最近三个月按月筛选；超出上下文预算时返回可用的三期', async () => {
    const { rankingBoard, source } = createSource();
    rankingBoard.listBoardsMeta.mockResolvedValue({
      steam: {
        title: 'Steam 畅销榜',
        type: 'periods',
        periods: [
          { slug: 'w40', label: '2026年第40周' },
          { slug: 'm10', label: '2026年10月' },
          { slug: 'm09', label: '2026年9月' },
          { slug: 'm08', label: '2026年8月' },
          { slug: 'm07', label: '2026年7月' },
        ],
      },
    });

    const monthlyDocs = await source.retrieve(['steam'], {
      kind: 'range',
      label: '最近三个月',
    });
    const fiveWeekDocs = await source.retrieve(['steam'], {
      kind: 'range',
      label: '最近五周',
    });

    expect(monthlyDocs.map((doc) => doc.docId)).toEqual([
      'ranking:steam:m10',
      'ranking:steam:m09',
      'ranking:steam:m08',
    ]);
    expect(fiveWeekDocs.map((doc) => doc.docId)).toEqual([
      'ranking:steam:w40',
      'ranking:steam:w2',
      'ranking:steam:w1',
    ]);
  });

  it('允许读取最新期，并把 HTML 转为表格文本', async () => {
    const { rankingBoard, source } = createSource();

    const docs = await source.retrieve(['steam'], {
      kind: 'latest',
      label: '最新',
    });

    expect(rankingBoard.loadContent).toHaveBeenCalledWith('steam', 'w40');
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toContain('2026年第40周');
    expect(docs[0].snippet).toContain('1|合成产品');
  });
});
