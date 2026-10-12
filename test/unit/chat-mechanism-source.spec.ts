import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import {
  ChatMechanismSource,
  MECHANISM_TOP_K,
} from '../../server/modules/chat/chat-mechanism-source';

interface Row {
  stableKey: string;
  nameCn: string | null;
  gameName: string | null;
  coreHook: string | null;
  buyValue: string | null;
  reuseNote: string | null;
  updatedAt: Date | null;
}

function row(partial: Partial<Row> & { stableKey: string }): Row {
  return {
    nameCn: null,
    gameName: null,
    coreHook: null,
    buyValue: null,
    reuseNote: null,
    updatedAt: null,
    ...partial,
  };
}

const SAND = row({
  stableKey: 'k-sand',
  nameCn: '沙金工业',
  gameName: 'Sandustry',
  coreHook: '用像素搭建一条受重力与温度影响的产业链。',
  buyValue: '上手成本低，反馈即时。',
  reuseNote: '可复用公式是材料流动加产线扩张。',
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
});

/** 游戏名不含 sandustry，只有正文提到——用来验证「标题命中 2 分 > 正文命中 1 分」。 */
const PEGLIN = row({
  stableKey: 'k-peglin',
  gameName: 'Peglin',
  coreHook: '把弹珠与肉鸽卡牌缝合，Sandustry 式的产线思路并不适用。',
  buyValue: '重玩性强。',
  reuseNote: '回合制弹射。',
  updatedAt: new Date('2026-08-20T00:00:00.000Z'),
});

/** 三段内容皆空：标题能命中也不该入选（送进 prompt 是纯噪声）。 */
const EMPTY = row({
  stableKey: 'k-empty',
  nameCn: '空条目',
  gameName: 'EmptyGame',
});

let logSpy: jest.SpyInstance;

/** 极简 drizzle 链 stub：select().from().where() → Promise<rows>。 */
function makeSource(rows: Row[]) {
  const where = jest.fn(async () => rows);
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const source = new ChatMechanismSource(
    { select } as unknown as PostgresJsDatabase,
  );
  return { source, select };
}

beforeEach(() => {
  // ⚠️ Nest 的 Logger 直写 stdout，不经 console.log —— 必须 spy 原型方法。
  logSpy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('ChatMechanismSource', () => {
  it('空问句不打库', async () => {
    const { source, select } = makeSource([SAND]);
    await expect(source.retrieve(['   ', ''])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('门槛：无关键词命中不上榜（避免无关机制污染每次提问）', async () => {
    const { source } = makeSource([SAND, PEGLIN, EMPTY]);
    await expect(source.retrieve(['zzzznope'])).resolves.toEqual([]);
  });

  it('标题命中 2 分优先于正文命中 1 分，且用中文名+游戏名一并匹配', async () => {
    // SAND 的中文名是「沙金工业」，若只拿中文名当标题，问英文名就命中不了。
    const docs = await makeSource([SAND, PEGLIN, EMPTY]).source.retrieve([
      'Sandustry',
    ]);
    expect(docs.map((doc) => doc.docId)).toEqual([
      'mechanism:k-sand',
      'mechanism:k-peglin',
    ]);
    expect(docs[0].score).toBe(2);
    expect(docs[1].score).toBe(1);
  });

  it('三段皆空的条目被过滤，即使标题命中', async () => {
    await expect(
      makeSource([EMPTY]).source.retrieve(['EmptyGame']),
    ).resolves.toEqual([]);
  });

  it('输出形状：来源前缀 docId / 展示名 / 审核日期 / 三段式片段', async () => {
    const [doc] = await makeSource([SAND]).source.retrieve(['Sandustry']);
    expect(doc).toMatchObject({
      docId: 'mechanism:k-sand',
      title: '沙金工业',
      sourceDate: '2026-09-01',
      url: '/mechanism-observatory/k-sand',
      source: 'mechanism',
      matchedEntities: [],
    });
    expect(doc.snippet).toContain('【机制】用像素搭建一条受重力与温度影响的产业链。');
    expect(doc.snippet).toContain('【优点】上手成本低，反馈即时。');
    expect(doc.snippet).toContain('【利用方法】可复用公式是材料流动加产线扩张。');
  });

  it('stableKey 含 / 与 : 时 URL 必须编码（机制稳定键形如 feishu-block:doxcn…）', async () => {
    const weird = row({
      stableKey: 'feishu-block:doxcnA/B',
      nameCn: '怪键游戏',
      coreHook: '机制正文。',
    });
    const [doc] = await makeSource([weird]).source.retrieve(['怪键游戏']);
    expect(doc.url).toBe('/mechanism-observatory/feishu-block%3AdoxcnA%2FB');
  });

  it('配额上限：命中超过 MECHANISM_TOP_K 也只给 MECHANISM_TOP_K 条', async () => {
    const many = Array.from({ length: MECHANISM_TOP_K + 3 }, (_, index) =>
      row({
        stableKey: `k-${index}`,
        gameName: `Game${index}`,
        coreHook: 'sharedtoken 机制正文。',
      }),
    );
    const docs = await makeSource(many).source.retrieve(['sharedtoken']);
    expect(docs).toHaveLength(MECHANISM_TOP_K);
  });

  it('多路改写：同一路命中越多分越高（best + 每多一路 +2）', async () => {
    const docs = await makeSource([SAND, PEGLIN]).source.retrieve([
      'Sandustry',
      '沙金',
    ]);
    expect(docs[0].docId).toBe('mechanism:k-sand');
    // 「沙金」现在同时命中公开中文名标题与可检索正文（3 分），
    // 再叠加另一条改写命中加分（2 分）。
    expect(docs[0].score).toBe(5);
  });

  it('查询投影必须带上中文名列（否则引用标题会退化成英文名）', async () => {
    const { source, select } = makeSource([SAND]);
    await source.retrieve(['Sandustry']);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        nameCn: expect.anything(),
        gameName: expect.anything(),
        coreHook: expect.anything(),
      }),
    );
  });

  it('显示名走 shared 唯一实现：剥「（试译）」后缀、解码 HTML 实体', async () => {
    // 就地复刻 fallback（`nameCn ?? gameName`）会漏掉这两步 →
    // 机制页主标题显示「沙金工业」，chat 引用却显示「沙金工业（试译）」。
    const tentative = row({
      stableKey: 'k-tentative',
      nameCn: '沙金工业（试译）',
      gameName: 'Sandustry',
      coreHook: '机制正文。',
    });
    const entity = row({
      stableKey: 'k-entity',
      nameCn: 'Fell &amp; Sell',
      coreHook: '机制正文。',
    });
    const [byChinese] = await makeSource([tentative]).source.retrieve(['沙金']);
    expect(byChinese.title).toBe('沙金工业');
    const [byEnglish] = await makeSource([entity]).source.retrieve(['Fell']);
    expect(byEnglish.title).toBe('Fell & Sell');
  });
});
