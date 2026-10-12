import { resolveChatIntent, type ChatIntentContext } from './chat-intent';

function ctx(overrides: Partial<ChatIntentContext> = {}): ChatIntentContext {
  return {
    entityTerms: [
      { entityId: 'e1', term: '三七互娱' },
      { entityId: 'e2', term: '三七游戏' },
      { entityId: 'p1', term: '寻道大千' },
      { entityId: 'p2', term: 'Puzzles & Chaos' },
    ],
    entityById: new Map([
      ['e1', { name: '三七互娱', type: '厂商' }],
      ['e2', { name: '三七游戏', type: '厂商' }],
      ['p1', { name: '寻道大千', type: '产品' }],
      ['p2', { name: 'Puzzles & Chaos', type: '产品' }],
    ]),
    categoryNames: ['开箱like', '放置RPG', 'SLG', '修仙'],
    mechanismTitles: [
      { stableKey: 'm1', primary: '开箱循环设计', secondary: 'Box Cycle' },
    ],
    ...overrides,
  };
}

describe('resolveChatIntent', () => {
  it('问句含厂商实体 → vendor（别名同样命中）', () => {
    expect(resolveChatIntent('三七互娱有哪些产品？', ctx())).toMatchObject({
      kind: 'vendor',
      matchedTerm: '三七互娱',
      entityId: 'e1',
    });
    expect(resolveChatIntent('三七游戏近期动态', ctx())).toMatchObject({
      kind: 'vendor',
      entityId: 'e2',
    });
  });

  it('问句含产品实体 → product', () => {
    expect(resolveChatIntent('寻道大千的商业化设计', ctx())).toMatchObject({
      kind: 'product',
      entityId: 'p1',
    });
    // ASCII 词大小写不敏感 + 边界谓词（entity-matcher 语义）。
    expect(resolveChatIntent('puzzles & chaos 的商业化', ctx())).toMatchObject({
      kind: 'product',
      entityId: 'p2',
    });
  });

  it('实体优先于机制/品类/榜单', () => {
    const c = ctx({
      mechanismTitles: [
        { stableKey: 'm1', primary: '三七互娱机制', secondary: '' },
      ],
    });
    expect(resolveChatIntent('三七互娱的机制观察说了什么', c).kind).toBe(
      'vendor',
    );
  });

  it('机制显示名被问句包含 → mechanism（主/次标题均可）', () => {
    expect(resolveChatIntent('开箱循环设计值得抄吗', ctx())).toMatchObject({
      kind: 'mechanism',
      matchedTerm: '开箱循环设计',
    });
    expect(resolveChatIntent('Box Cycle 的利用方法', ctx())).toMatchObject({
      kind: 'mechanism',
      matchedTerm: 'Box Cycle',
    });
  });

  it('没有明确榜单目标时，机制优先于品类', () => {
    // 「开箱like」含「开箱」，但机制标题「开箱循环设计」未被包含 → 品类命中。
    expect(resolveChatIntent('开箱like 的核心循环', ctx()).kind).toBe(
      'category',
    );
    const c = ctx({
      mechanismTitles: [
        { stableKey: 'm1', primary: '开箱like', secondary: '' },
      ],
    });
    expect(resolveChatIntent('开箱like 的核心循环设计', c).kind).toBe(
      'mechanism',
    );
  });

  it('品类命中取最长名（子项比父项更具体时取子项）', () => {
    const c = ctx({ categoryNames: ['SLG', 'SLG出海'] });
    expect(resolveChatIntent('SLG出海市场怎么样', c)).toMatchObject({
      kind: 'category',
      categoryName: 'SLG出海',
    });
  });

  it('枚举名带空格而问句不带（放置 RPG vs 放置RPG）仍命中', () => {
    const c = ctx({ categoryNames: ['放置 RPG', '开箱like'] });
    expect(resolveChatIntent('放置RPG 近期有什么新品？', c)).toMatchObject({
      kind: 'category',
      categoryName: '放置 RPG',
    });
    expect(resolveChatIntent('开箱 like 的核心循环', c)).toMatchObject({
      kind: 'category',
      categoryName: '开箱like',
    });
  });

  it('榜单关键词命中（含板块指名与全榜两种）', () => {
    expect(resolveChatIntent('Steam 本周什么卖得好？', ctx())).toMatchObject({
      kind: 'ranking',
      matchedTerm: 'steam',
      entityId: null,
      boardKeys: ['steam'],
      categoryName: null,
      periodRequest: { kind: 'latest', label: '本周' },
    });
    expect(resolveChatIntent('最近有什么畅销榜？', ctx())).toMatchObject({
      kind: 'ranking',
      boardKeys: ['weixin'],
    });
    expect(resolveChatIntent('看看最新销量数据', ctx())).toMatchObject({
      kind: 'ranking',
      boardKeys: [],
      periodRequest: { kind: 'latest', label: '最新' },
    });
  });

  it('明确榜单目标优先于实体、机制和品类，避免来源被遮蔽', () => {
    const c = ctx({
      mechanismTitles: [
        { stableKey: 'm1', primary: '开箱like', secondary: '' },
      ],
    });

    expect(
      resolveChatIntent('寻道大千最新 Steam 榜单第几名？', c),
    ).toMatchObject({ kind: 'ranking', boardKeys: ['steam'] });
    expect(
      resolveChatIntent('开箱like 在微信畅销榜排名如何？', c),
    ).toMatchObject({ kind: 'ranking', boardKeys: ['weixin'] });
    expect(resolveChatIntent('畅销玩法的核心循环设计', c).kind).not.toBe(
      'ranking',
    );
  });

  it('历史或相对期次作为约束保留，避免静默降为最新期', () => {
    expect(
      resolveChatIntent('Puzzles & Chaos 2025年第37周 Steam 排名', ctx()),
    ).toMatchObject({
      kind: 'ranking',
      boardKeys: ['steam'],
      periodRequest: { kind: 'exact', label: '2025年第37周' },
    });
    expect(
      resolveChatIntent('寻道大千上一期微信畅销榜排名', ctx()),
    ).toMatchObject({
      kind: 'ranking',
      periodRequest: { kind: 'previous', label: '上一期' },
    });
    expect(
      resolveChatIntent('微信最近三个月销量榜', ctx()),
    ).toMatchObject({
      kind: 'ranking',
      periodRequest: { kind: 'range', label: '最近三个月' },
    });
    expect(
      resolveChatIntent('Steam 最近一周畅销榜', ctx()),
    ).toMatchObject({
      kind: 'ranking',
      periodRequest: { kind: 'latest', label: '最近一周' },
    });
  });

  it('全不中 → fallback；空问句 → fallback', () => {
    expect(resolveChatIntent('今天天气如何', ctx()).kind).toBe('fallback');
    expect(resolveChatIntent('', ctx()).kind).toBe('fallback');
  });

  it('非厂商/产品类型的实体不触发路径', () => {
    const c = ctx({
      entityTerms: [{ entityId: 'x1', term: '某品类' }],
      entityById: new Map([['x1', { name: '某品类', type: '其他' }]]),
    });
    expect(resolveChatIntent('某品类怎么样', c).kind).toBe('fallback');
  });
});
