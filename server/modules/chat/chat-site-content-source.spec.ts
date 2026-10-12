import { ChatSiteContentSource } from './chat-site-content-source';
import type { QuickToolsService } from '../wiki-beta/quick-tools.service';
import type { InsightService } from '../insight/insight.service';
import type { ArticlesService } from '../articles/articles.service';

describe('ChatSiteContentSource', () => {
  function createSource() {
    const quickTools = {
      listTools: jest.fn().mockResolvedValue([]),
      loadAttachment: jest.fn(),
    };
    const insight = {
      mechanismScoreHints: jest
        .fn()
        .mockResolvedValue({ market: null, innovation: null }),
    };
    const articles = {
      facets: jest.fn().mockResolvedValue({
        gameplay: [],
        contentTypes: [],
        publishers: [],
      }),
    };
    return {
      quickTools,
      insight,
      articles,
      source: new ChatSiteContentSource(
        quickTools as unknown as QuickToolsService,
        insight as unknown as InsightService,
        articles as unknown as ArticlesService,
      ),
    };
  }

  it('检索到前端展示的历史 changelog 日期与条目', async () => {
    const { source } = createSource();

    const docs = await source.retrieve(['看数据页签移除']);

    expect(docs.some((doc) => doc.docId === 'site:changelog:2026-10-09')).toBe(
      true,
    );
    expect(docs.find((doc) => doc.docId === 'site:changelog:2026-10-09')?.snippet)
      .toContain('看数据');
  });

  it('覆盖用户截图中的最近网站更新问法，并返回最新更新正文', async () => {
    const { source } = createSource();

    const docs = await source.retrieve(['在最近一次网站更新里，你有什么新的功能实现']);
    const latest = docs.find((doc) => doc.docId === 'site:changelog:2026-10-10');

    expect(latest).toBeDefined();
    expect(latest?.snippet).toContain('机制周报');
    expect(latest?.snippet).toContain('一键新窗查看');
  });

  it('可检索网站公开的文章库分类目录、类型和发布方计数', async () => {
    const { articles, source } = createSource();
    articles.facets.mockResolvedValue({
      gameplay: [
        {
          value: '放置 RPG',
          label: '放置 RPG',
          count: 8,
          selfCount: 3,
          children: [{ value: '放置卡牌', label: '放置卡牌', count: 5 }],
        },
      ],
      contentTypes: [{ value: '深度报告', label: '深度报告', count: 12 }],
      publishers: [{ value: '研究团队', label: '研究团队', count: 4 }],
    });

    const docs = await source.retrieve(['放置 RPG 有哪些子类？']);
    const catalog = docs.find((doc) => doc.docId === 'site:article-catalog');

    expect(catalog).toBeDefined();
    expect(catalog?.snippet).toContain('放置卡牌（5 篇）');
    expect(catalog?.snippet).toContain('深度报告（12 篇）');
    expect(catalog?.snippet).toContain('研究团队（4 篇）');
  });

  it('按 HTML 可见正文召回附件，并排除脚本和隐藏内容', async () => {
    const { quickTools, source } = createSource();
    quickTools.listTools.mockResolvedValue([
      {
        id: 'record-1',
        name: '机制周报互动页',
        category: '机制周报',
        description: 'HTML 报告原件',
        url: null,
        attachmentToken: 'file-token-1',
        iconFileToken: null,
        readme: null,
        date: '2026-09-25T00:00:00.000+08:00',
      },
    ]);
    quickTools.loadAttachment.mockResolvedValue({
      data: Buffer.from(
        '<!DOCTYPE html><html><head><title>忽略的标题</title></head><body><script title="隐藏属性密钥">隐藏脚本密钥</script><div hidden><span>隐藏词条</span></div><div aria-hidden="true"><span>无障碍隐藏词条</span></div><div style="display:none">样式隐藏词条</div><main><h1>海岛经济循环分析</h1><button aria-label="展开海岛经济图">展开</button></main></body></html>',
      ),
      contentType: 'text/html',
    });

    const docs = await source.retrieve(['海岛经济循环分析']);
    const hit = docs.find((doc) => doc.docId === 'site:quick-tool:record-1');

    expect(hit).toBeDefined();
    expect(hit?.snippet).toContain('海岛经济循环分析');
    expect(hit?.snippet).toContain('展开海岛经济图');
    expect(hit?.snippet).not.toContain('隐藏脚本密钥');
    expect(hit?.snippet).not.toContain('隐藏属性密钥');
    expect(hit?.snippet).not.toContain('隐藏词条');
    expect(hit?.snippet).not.toContain('无障碍隐藏词条');
    expect(hit?.snippet).not.toContain('样式隐藏词条');
    expect(hit?.sourceDate).toBe('2026-09-25');
    expect(quickTools.loadAttachment).toHaveBeenCalledTimes(1);
  });

  it('把公开指数说明加入可检索内容', async () => {
    const { insight, source } = createSource();
    insight.mechanismScoreHints.mockResolvedValue({
      market: '0.90 以上表示市场认可度较高',
      innovation: '分值越高，机制创新越突出',
    });

    const docs = await source.retrieve(['市场认可度较高的区间']);

    expect(
      docs.some((doc) => doc.docId === 'site:mechanism-score-hints'),
    ).toBe(true);
    expect(docs.find((doc) => doc.docId === 'site:mechanism-score-hints')?.snippet)
      .toContain('0.90 以上');
  });

  it('发现页数据或指数说明暂不可读时，静态来源仍可检索', async () => {
    const { quickTools, insight, source } = createSource();
    quickTools.listTools.mockRejectedValue(new Error('mock unavailable'));
    insight.mechanismScoreHints.mockRejectedValue(new Error('mock unavailable'));

    const docs = await source.retrieve(['看数据页签移除']);

    expect(docs.some((doc) => doc.docId === 'site:changelog:2026-10-09')).toBe(
      true,
    );
  });
});
