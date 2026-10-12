import {
  GAMEPLAY_CATEGORY_COLORS,
  UNCLASSIFIED_GAMEPLAY,
  gameplayCategoryColor,
  gameplayCategoryFromPath,
  gameplayCategoryLabel,
  gameplayCategoryPath,
  isSafeGameplayName,
  normalizeGameplayName,
} from '@shared/gameplay-category';
import { gameplayCategoryStyle } from '@client/src/lib/tag-color';

describe('gameplay category name-based contract', () => {
  it('把旧英文 slug 归一为分类名，其余原样透传', () => {
    expect(normalizeGameplayName('mmo')).toBe('MMO');
    expect(normalizeGameplayName('idle-mmo')).toBe('挂机嗨游');
    expect(normalizeGameplayName('light-client')).toBe('轻端游');
    expect(normalizeGameplayName('idle-rpg')).toBe('放置 RPG');
    expect(normalizeGameplayName('simulation-breeding')).toBe(
      '模拟经营、育成',
    );
    expect(normalizeGameplayName('X+SLG')).toBe('x-slg');
    // 分类名本身即筛选值，不再是「已知清单以外就丢弃」。
    expect(normalizeGameplayName('挂机嗨游')).toBe('挂机嗨游');
    expect(normalizeGameplayName('  二次元放置  ')).toBe('二次元放置');
    expect(normalizeGameplayName('')).toBe('');
    expect(normalizeGameplayName(null)).toBe('');
    expect(normalizeGameplayName(42)).toBe('');
  });

  it('拒绝会破坏 URL / query 的分类名', () => {
    expect(isSafeGameplayName('挂机嗨游')).toBe(true);
    expect(isSafeGameplayName('x-slg')).toBe(true);
    expect(isSafeGameplayName('X+SLG')).toBe(false);
    expect(isSafeGameplayName('a/b')).toBe(false);
    expect(isSafeGameplayName('a?b')).toBe(false);
    expect(isSafeGameplayName('a#b')).toBe(false);
    expect(isSafeGameplayName('a&b')).toBe(false);
    expect(isSafeGameplayName('   ')).toBe(false);
    expect(isSafeGameplayName(42)).toBe(false);
  });

  it('分类路径可与解析往返，旧 slug 在解析时归一', () => {
    expect(gameplayCategoryPath('挂机嗨游')).toBe(
      `/gameplay/${encodeURIComponent('挂机嗨游')}`,
    );
    expect(gameplayCategoryFromPath(gameplayCategoryPath('挂机嗨游'))).toBe(
      '挂机嗨游',
    );
    expect(gameplayCategoryFromPath(gameplayCategoryPath('x-slg'))).toBe(
      'x-slg',
    );
    expect(gameplayCategoryFromPath('/gameplay/mmo')).toBe('MMO');
    expect(gameplayCategoryFromPath('/gameplay/idle-mmo')).toBe('挂机嗨游');
    expect(gameplayCategoryFromPath('/gameplay/light-client')).toBe('轻端游');
    // 解码后含保留字符 → 非法
    expect(gameplayCategoryFromPath('/gameplay/a%2Fb')).toBeUndefined();
    expect(gameplayCategoryFromPath('/gameplay/')).toBeUndefined();
    expect(gameplayCategoryFromPath('/gameplay/mmo/extra')).toBeUndefined();
    expect(gameplayCategoryFromPath('/library')).toBeUndefined();
  });

  it('配色按分类名稳定取色，空值为未分类灰', () => {
    expect(gameplayCategoryColor('')).toBe('gray');
    expect(gameplayCategoryColor(null)).toBe('gray');
    expect(gameplayCategoryColor('   ')).toBe('gray');
    const names = [
      'MMO',
      '挂机嗨游',
      '轻端游',
      '放置 RPG',
      '模拟经营、育成',
      'x-slg',
      '开放世界',
    ];
    for (const name of names) {
      expect(GAMEPLAY_CATEGORY_COLORS).toContain(gameplayCategoryColor(name));
      // 同名恒同色（不随文章数、排序变化）
      expect(gameplayCategoryColor(name)).toBe(gameplayCategoryColor(name));
    }
    // 哈希未退化：多个分类应分到不同颜色
    expect(new Set(names.map(gameplayCategoryColor)).size).toBeGreaterThan(1);
  });

  it('标签口径：父 › 子；缺一侧取有值的一侧；都空为未分类', () => {
    expect(gameplayCategoryLabel('MMO', '挂机嗨游')).toBe('MMO › 挂机嗨游');
    expect(gameplayCategoryLabel('MMO', '')).toBe('MMO');
    expect(gameplayCategoryLabel('MMO', null)).toBe('MMO');
    expect(gameplayCategoryLabel('', '挂机嗨游')).toBe('挂机嗨游');
    expect(gameplayCategoryLabel('', '')).toBe(UNCLASSIFIED_GAMEPLAY.label);
    expect(gameplayCategoryLabel(null, undefined)).toBe('未分类');
    expect(gameplayCategoryLabel('  MMO  ', ' 挂机嗨游 ')).toBe(
      'MMO › 挂机嗨游',
    );
  });

  it('样式函数与标签 / 配色同口径', () => {
    const styled = gameplayCategoryStyle('MMO', '挂机嗨游');
    expect(styled.label).toBe('MMO › 挂机嗨游');
    expect(styled.badge).toBe(
      `bg-${gameplayCategoryColor('MMO')}-500/15 text-${gameplayCategoryColor('MMO')}-700 dark:text-${gameplayCategoryColor('MMO')}-300`,
    );
    expect(styled.bar).toBe(`bg-${gameplayCategoryColor('MMO')}-500`);

    const single = gameplayCategoryStyle('x-slg');
    expect(single.label).toBe('x-slg');
    expect(single.bar).toBe(`bg-${gameplayCategoryColor('x-slg')}-500`);

    const unclassified = gameplayCategoryStyle(null, null);
    expect(unclassified.label).toBe('未分类');
    expect(unclassified.bar).toContain('slate');
  });
});
