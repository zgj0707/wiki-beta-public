import {
  mapMechanismRecord,
  normalizeInsightBoolean,
  normalizeInsightDate,
  normalizeInsightInt,
} from '../../server/modules/base-sync/base-sync-insight.service';
import {
  parseScoreColumn,
  scoreColumnValue,
} from '../../server/modules/base-sync/base-sync-insight.schema';

describe('index score column round-trip (复用已下线 text 列)', () => {
  it('writes two-decimal text and reads it back as a number', () => {
    expect(parseScoreColumn(scoreColumnValue(0.93))).toBe(0.93);
    expect(parseScoreColumn(scoreColumnValue(2.2))).toBe(2.2);
    expect(parseScoreColumn(scoreColumnValue(0))).toBe(0);
  });

  it('returns null for empty or malformed values on both sides', () => {
    expect(scoreColumnValue(null)).toBeNull();
    expect(scoreColumnValue(undefined)).toBeNull();
    expect(scoreColumnValue('')).toBeNull();
    expect(scoreColumnValue('abc')).toBeNull();
    expect(parseScoreColumn(null)).toBeNull();
    expect(parseScoreColumn(undefined)).toBeNull();
    // 关键边界：Number('') === 0，不显式挡掉就会把「无分值」当 0 分渲染并参与排序。
    expect(parseScoreColumn('')).toBeNull();
    expect(parseScoreColumn('   ')).toBeNull();
    expect(parseScoreColumn('abc')).toBeNull();
    // 而真正的 0 分必须保留。
    expect(parseScoreColumn('0.00')).toBe(0);
  });
});

describe('insight field normalization helpers', () => {
  it('converts millisecond timestamps and ISO strings into Date', () => {
    expect(normalizeInsightDate(1746800000000)).toEqual(
      new Date(1746800000000),
    );
    expect(normalizeInsightDate('1746800000000')).toEqual(
      new Date(1746800000000),
    );
    expect(normalizeInsightDate('2026-09-04T07:49:42.000Z')).toEqual(
      new Date('2026-09-04T07:49:42.000Z'),
    );
    expect(normalizeInsightDate('不是时间')).toBeNull();
    expect(normalizeInsightDate('')).toBeNull();
    expect(normalizeInsightDate(null)).toBeNull();
    expect(normalizeInsightDate(undefined)).toBeNull();
  });

  it('treats true and "true" as published booleans', () => {
    expect(normalizeInsightBoolean(true)).toBe(true);
    expect(normalizeInsightBoolean('true')).toBe(true);
    expect(normalizeInsightBoolean('TRUE')).toBe(true);
    expect(normalizeInsightBoolean(false)).toBe(false);
    expect(normalizeInsightBoolean('false')).toBe(false);
    expect(normalizeInsightBoolean('是')).toBeNull();
    expect(normalizeInsightBoolean(null)).toBeNull();
    expect(normalizeInsightBoolean(undefined)).toBeNull();
  });

  it('parses integers from numbers and numeric strings', () => {
    expect(normalizeInsightInt(3)).toBe(3);
    expect(normalizeInsightInt(2.7)).toBe(2);
    expect(normalizeInsightInt('5')).toBe(5);
    expect(normalizeInsightInt('v3')).toBeNull();
    expect(normalizeInsightInt(null)).toBeNull();
    expect(normalizeInsightInt(undefined)).toBeNull();
  });
});

describe('mapMechanismRecord', () => {
  it('maps the three-paragraph field set onto the projection', () => {
    // 2026-09-29：Base「审核时间」列已删除 ⇒ 时间来自记录级 last_modified_time
    //（请求体 automatic_fields: true 才会返回），作为第二参数传入而不是从 fields 取。
    const mapped = mapMechanismRecord(
      {
        '稳定键': 'feishu-block:doxcnAN6fiTrnzr4YisiEc4OCrc',
        '条目类型': '机制拆解',
        '游戏名': 'Sandustry',
        '机制': { text: '玩家用像素搭建一条受重力与温度影响的产业链。' },
        '优点': ['上手成本低', '反馈即时'],
        '利用方法': [{ type: 'text', text: '可复用公式是材料流动加产线扩张。' }],
        '审核状态': '已发布',
        '当前发布': true,
        '来源链接': {
          type: 'url',
          text: 'Steam 商店页',
          link: 'https://store.steampowered.com/app/1/',
        },
      },
      1746800000000,
    );

    expect(mapped).toEqual({
      stableKey: 'feishu-block:doxcnAN6fiTrnzr4YisiEc4OCrc',
      entryType: '机制拆解',
      gameName: 'Sandustry',
      displayName: null,
      coreHook: '玩家用像素搭建一条受重力与温度影响的产业链。',
      buyValue: '上手成本低、反馈即时',
      reuseNote: '可复用公式是材料流动加产线扩张。',
      reviewStatus: '已发布',
      currentPublished: true,
      sourceLink: 'https://store.steampowered.com/app/1/',
      reviewTime: new Date(1746800000000),
      marketScore: null,
      innovationScore: null,
    });
  });

  it('maps 市场认可指数 / 核心创新指数 onto the reused text columns', () => {
    // 两个指数复用已下线的 text 列承载（零 DDL）⇒ 入库前统一归一成两位小数文本，
    // 这样 0.9 与 0.90 的形态一致，前端排序不会因字符串差异抖动。
    const mapped = mapMechanismRecord({
      '市场认可指数': 0.9,
      '核心创新指数': 2.2,
    });
    expect(mapped.marketScore).toBe('0.90');
    expect(mapped.innovationScore).toBe('2.20');

    // Base 数值列可能以字符串形态抵达（records/search 的历史行为）。
    expect(
      mapMechanismRecord({ '市场认可指数': '0.93', '核心创新指数': '1.46' })
        .marketScore,
    ).toBe('0.93');
    expect(
      mapMechanismRecord({ '市场认可指数': '0.93', '核心创新指数': '1.46' })
        .innovationScore,
    ).toBe('1.46');

    // 缺列 / 空值 / 非数字一律 null（消费侧按「无分值」处理，不渲染、排序沉底）。
    expect(mapMechanismRecord({}).marketScore).toBeNull();
    expect(mapMechanismRecord({}).innovationScore).toBeNull();
    expect(mapMechanismRecord({ '市场认可指数': '' }).marketScore).toBeNull();
    expect(mapMechanismRecord({ '市场认可指数': null }).marketScore).toBeNull();
    expect(
      mapMechanismRecord({ '市场认可指数': '不是数字' }).marketScore,
    ).toBeNull();
    // 0 分是合法值，不能被当成空。
    expect(mapMechanismRecord({ '市场认可指数': 0 }).marketScore).toBe('0.00');
  });

  it('keeps 更新时间 absent when the record carries no last_modified_time', () => {
    // automatic_fields 未生效（或旧响应）时必须回退 null，绝不写 "现在"：
    // 否则全表时间会被刷成同步时刻，月份分组与"最新优先"排序双双失真。
    expect(mapMechanismRecord({ '稳定键': 'k-1' }).reviewTime).toBeNull();
    expect(
      mapMechanismRecord({ '稳定键': 'k-1' }, null).reviewTime,
    ).toBeNull();
  });

  it('maps 「中文名」 onto displayName (chat 引用标题与机制页主标题同口径)', () => {
    // 2026-09-20：中文名同步进 PG（复用已下线的 mechanism_title 列），
    // chat 机制来源据此生成引用标题。缺列时必须回退 null，交给调用方降级到游戏名。
    expect(mapMechanismRecord({ '中文名': '沙金工业' }).displayName).toBe(
      '沙金工业',
    );
    // 富文本分段数组按同目录既有口径拼接。
    expect(
      mapMechanismRecord({ '中文名': [{ type: 'text', text: '沙金工业' }] })
        .displayName,
    ).toBe('沙金工业');
    expect(mapMechanismRecord({}).displayName).toBeNull();
    // ⚠️ normalizeFieldValue 不做 trim、空串返空串（既有口径，不改）——
    // 消费侧（ChatMechanismSource）用 `?.trim() || 回退` 兜住这两种情况。
    expect(mapMechanismRecord({ '中文名': '  沙金工业  ' }).displayName).toBe(
      '  沙金工业  ',
    );
    expect(mapMechanismRecord({ '中文名': '' }).displayName).toBe('');
  });

  it('returns null for paragraph columns Base does not provide', () => {
    const mapped = mapMechanismRecord({
      '稳定键': 'feishu-block:doxcnvKuxEDj1gy8umEC1lt87Jd',
    });
    expect(mapped.stableKey).toBe('feishu-block:doxcnvKuxEDj1gy8umEC1lt87Jd');
    expect(mapped.coreHook).toBeNull();
    expect(mapped.buyValue).toBeNull();
    expect(mapped.reuseNote).toBeNull();
    expect(mapped.displayName).toBeNull();
    expect(mapped.entryType).toBeNull();
    expect(mapped.gameName).toBeNull();
    expect(mapped.reviewStatus).toBeNull();
    expect(mapped.currentPublished).toBeNull();
    expect(mapped.sourceLink).toBeNull();
    expect(mapped.reviewTime).toBeNull();
    expect(mapped.marketScore).toBeNull();
    expect(mapped.innovationScore).toBeNull();
  });

  it('normalizes "当前发布" string values and keeps an empty stable key detectable', () => {
    expect(mapMechanismRecord({ '当前发布': 'true' }).currentPublished).toBe(
      true,
    );
    expect(mapMechanismRecord({ '当前发布': 'false' }).currentPublished).toBe(
      false,
    );
    expect(mapMechanismRecord({ '稳定键': '' }).stableKey).toBe('');
  });
});

// mapEntityRecord 的用例已随 Phase 4 语料冻结下线（2026-10-09）：
// Base「实体词典」表删除，entity_dictionary 投影停止写入。
// mapEntityRelRecord 的用例已随「文章实体提及」表于 2026-09-11 下线一并移除
//（快照见 snapshots/2026-09-11-mention-table/）。
