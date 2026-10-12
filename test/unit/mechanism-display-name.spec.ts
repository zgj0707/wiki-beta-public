import { displayNameOf, TENTATIVE_SUFFIX } from '@client/src/lib/mechanism-display-name';

/**
 * 显示名口径是列表卡片、详情页 Hero、A-Z 排序三者共用的单一实现，
 * 一旦被就地改写（如 `item.nameCn ?? item.gameName`）就会出现
 * 「列表显示中文名、详情显示英文名」或「排序与显示名不一致」的分叉。
 * 这里锁住四条回退与试译拆分的边界。
 */
describe('displayNameOf', () => {
  it('官方中文名：主标题用中文名，副标题给英文名', () => {
    const result = displayNameOf({
      nameCn: '沙金工业',
      gameName: 'Sandustry',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('沙金工业');
    expect(result.secondary).toBe('Sandustry');
    expect(result.tentative).toBe(false);
    expect(result.nameCn).toBe('沙金工业');
  });

  it('试译：剥掉后缀，并置 tentative=true', () => {
    const result = displayNameOf({
      nameCn: `代词宫${TENTATIVE_SUFFIX}`,
      gameName: 'Pronoun Palace',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('代词宫');
    expect(result.tentative).toBe(true);
    // 后缀绝不能残留在标题里
    expect(result.primary.includes('试译')).toBe(false);
    expect(result.secondary).toBe('Pronoun Palace');
  });

  it('只有后缀、没有正文时不算试译，也不把标题清空', () => {
    const result = displayNameOf({
      nameCn: TENTATIVE_SUFFIX,
      gameName: 'MOLE',
      stableKey: 'feishu-block:abc',
    });
    expect(result.nameCn).toBe('');
    expect(result.tentative).toBe(false);
    expect(result.primary).toBe('MOLE');
  });

  it('无中文名时回退到英文名', () => {
    const result = displayNameOf({
      nameCn: null,
      gameName: 'Birdwatching Notebook',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('Birdwatching Notebook');
    expect(result.secondary).toBeNull();
  });

  it('中文名与英文名都缺失时回退到稳定键（真实存在的趋势报告记录即此形态）', () => {
    const result = displayNameOf({
      nameCn: null,
      gameName: null,
      stableKey: 'feishu-block:doxcnmWqFJ3nvmWZwH13497eZwd',
    });
    expect(result.primary).toBe('feishu-block:doxcnmWqFJ3nvmWZwH13497eZwd');
    expect(result.secondary).toBeNull();
  });

  it('中文名与英文名同值时不给副标题（避免同一串渲染两遍）', () => {
    const result = displayNameOf({
      nameCn: '整理工坊',
      gameName: '整理工坊',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('整理工坊');
    expect(result.secondary).toBeNull();
  });

  it('英文名是真子集（含中文）时照样作副标题渲染', () => {
    const result = displayNameOf({
      nameCn: '整理工坊',
      gameName: '整理工坊 The Sorting Bureau',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('整理工坊');
    expect(result.secondary).toBe('整理工坊 The Sorting Bureau');
  });

  it('HTML 实体先解码再比较（Base 原文里有 &amp; 这类残留）', () => {
    const result = displayNameOf({
      nameCn: '坠落 &amp; 出售',
      gameName: 'Fell &amp; Sell',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('坠落 & 出售');
    expect(result.secondary).toBe('Fell & Sell');
  });

  it('首尾空白不影响后缀判定与回退', () => {
    const result = displayNameOf({
      nameCn: `  鼹鼠${TENTATIVE_SUFFIX}  `,
      gameName: 'MOLE',
      stableKey: 'feishu-block:abc',
    });
    expect(result.primary).toBe('鼹鼠');
    expect(result.tentative).toBe(true);
  });
});
