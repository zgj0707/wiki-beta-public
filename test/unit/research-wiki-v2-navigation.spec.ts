import { MAIN_NAV_ITEMS, V2_ROUTE_PATHS } from '@client/src/navigation';
import {
  gameplayCategoryFromPath,
  gameplayCategoryPath,
} from '@shared/gameplay-category';

describe('Research Wiki V2 information architecture', () => {
  it('顶栏任务页签：找结论/玩法·数据/盯竞品/发现 + 首页与收藏（任务化 P1；工具箱已改名发现）', () => {
    expect(
      MAIN_NAV_ITEMS.map(({ kind, label, path }) => ({ kind, label, path })),
    ).toEqual([
      { kind: 'link', label: '首页', path: '/' },
      { kind: 'link', label: '找结论', path: '/insights' },
      { kind: 'link', label: '玩法/数据', path: '/explore' },
      { kind: 'link', label: '盯竞品', path: '/watch' },
      { kind: 'link', label: '发现', path: '/quick-tools' },
      { kind: 'link', label: '我的收藏', path: '/favorites' },
    ]);
    // 金色特效归属（2026-10-10 起）：glow 只挂「发现」。
    expect(
      MAIN_NAV_ITEMS.filter(
        (item) => 'glow' in item && item.glow,
      ).map((item) => item.label),
    ).toEqual(['发现']);
  });

  it('路由表反映任务化 IA：实体浏览页已退场（v2 P2），任务页齐备', () => {
    const paths = Object.values(V2_ROUTE_PATHS);
    // 任务页三件套
    expect(paths).toContain('/insights');
    expect(paths).toContain('/explore');
    expect(paths).toContain('/watch');
    // 旧内容类型页路由保留（降级为任务页内的筛选维度）
    expect(paths).toContain('/library');
    expect(paths).toContain('/mechanism-observatory');
    // v2 决策：产品/厂商实体浏览页退场，路由不再注册
    expect(paths).not.toContain('/products-vendors');
  });

  it('玩法分类路径用中文分类名，旧英文 slug 解析时归一', () => {
    expect(gameplayCategoryPath('MMO')).toBe('/gameplay/MMO');
    expect(gameplayCategoryFromPath(gameplayCategoryPath('MMO'))).toBe('MMO');
    expect(gameplayCategoryFromPath('/gameplay/mmo')).toBe('MMO');
    expect(gameplayCategoryFromPath('/gameplay/idle-mmo')).toBe('挂机嗨游');
    expect(gameplayCategoryFromPath('/gameplay/light-client')).toBe('轻端游');
    expect(gameplayCategoryFromPath('/gameplay/idle-rpg')).toBe('放置 RPG');
    expect(gameplayCategoryFromPath('/gameplay/simulation-breeding')).toBe(
      '模拟经营、育成',
    );
    // 分类存在性判定已下沉到页面（查 Base 派生的分类树），解析层只负责合法性。
    expect(gameplayCategoryFromPath('/gameplay/开放世界')).toBe('开放世界');
    expect(gameplayCategoryFromPath('/gameplay/mmo/extra')).toBeUndefined();
  });
});
