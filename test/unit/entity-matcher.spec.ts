import { findEntityTextMatches } from '../../server/common/entity/entity-matcher';

// 2026-09-11：matcher 从 server/modules/entity/（未注册死模块）迁到 server/common/entity/。
// 它是实体高亮与提及投影两条链路共用的纯函数，故补上独立单测固化行为。
describe('findEntityTextMatches', () => {
  it('prefers the longest term and skips ASCII word interiors', () => {
    const matches = findEntityTextMatches('Peglin 与 Peglin Deluxe', [
      { entityId: 'a', term: 'Peglin' },
      { entityId: 'b', term: 'Peglin Deluxe' },
    ]);

    // 第一处只能是短名（长名不匹配），第二处长名优先。
    expect(matches).toEqual([
      { entityId: 'a', term: 'Peglin', index: 0, end: 6 },
      { entityId: 'b', term: 'Peglin Deluxe', index: 9, end: 22 },
    ]);
  });

  it('does not match a term inside an ASCII word or digit run', () => {
    expect(
      findEntityTextMatches('superpeglin peglin2', [
        { entityId: 'a', term: 'peglin' },
      ]),
    ).toEqual([]);
  });

  it('numbers every occurrence of the same term in document order', () => {
    const matches = findEntityTextMatches('原神、原神与星铁', [
      { entityId: 'genshin', term: '原神' },
      { entityId: 'starrail', term: '星铁' },
    ]);

    expect(
      matches.map((item) => [item.entityId, item.term, item.index]),
    ).toEqual([
      ['genshin', '原神', 0],
      ['genshin', '原神', 3],
      ['starrail', '星铁', 6],
    ]);
  });

  it('ignores blank terms and matches case-insensitively', () => {
    expect(
      findEntityTextMatches('Roblox', [
        { entityId: 'a', term: '   ' },
        { entityId: 'b', term: 'roblox' },
      ]),
    ).toEqual([{ entityId: 'b', term: 'roblox', index: 0, end: 6 }]);
  });

  it('returns nothing for empty input', () => {
    expect(findEntityTextMatches('', [{ entityId: 'a', term: '原神' }])).toEqual(
      [],
    );
  });
});
