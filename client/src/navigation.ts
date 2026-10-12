import {
  Compass,
  Heart,
  Home,
  Radar,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const V2_ROUTE_PATHS = {
  home: '/',
  /** 找结论：AI 问答 hero + 深度研究报告流（任务化导航 P1 新增）。 */
  insights: '/insights',
  /** 玩法/数据：玩法分类树 + 分类内容流（P1 骨架，P2 升级二维筛选）。 */
  explore: '/explore',
  /** 盯竞品：竞品信息周报列表 + 问 AI 盯厂商（P1 骨架）。 */
  watch: '/watch',
  /** 旧内容类型页（任务化后降级为任务页内的筛选维度，路由保留）。 */
  library: '/library',
  mechanismObservatory: '/mechanism-observatory',
  favorites: '/favorites',
  /** 榜单入口页：三份榜单资料的总入口，原「数据中心」页已下线。 */
  ranking: '/ranking',
  /** AI 编译层（结论卡）路由组：入口收进 /labs。 */
  ai: '/ai',
  /** 动态与发现：AI 成果聚合页（AI 介入现状 / 模型能力评测 / 游戏 Demo 聚合）。 */
  labs: '/labs',
  /** 便捷工具：链接 / 文档 / 互动内容 / 机制周报四分类入口（分类四值收敛 2026-10-10）。 */
  quickTools: '/quick-tools',
} as const;

export type MainNavLink = {
  kind: 'link';
  label: string;
  path: string;
  icon: LucideIcon;
  /** 醒目特效（渐变流动 + 光晕呼吸，见 styles/nav-labs.css）。 */
  glow?: boolean;
};

/**
 * 顶栏任务页签（任务化信息架构 P1，方案见 docs/nav-tasks-redesign-plan.md §2）：
 * 按「用户的研究任务」组织而非内容类型——找结论 / 玩法/数据 / 盯竞品 / 工具箱。
 * 旧内容类型页不删：文章库入口在「找结论」，机制观察入口在「玩法/数据」，/labs 入口在「工具箱」。
 * 「看数据」页签已移除（/ranking 路由保留，榜单入口在首页任务卡）；玩法分类页签已并入「玩法/数据」（/gameplay/:categorySlug 路由保留）。
 */
export const MAIN_NAV_ITEMS = [
  { kind: 'link', label: '首页', path: V2_ROUTE_PATHS.home, icon: Home },
  {
    kind: 'link',
    label: '找结论',
    path: V2_ROUTE_PATHS.insights,
    icon: Sparkles,
  },
  {
    kind: 'link',
    label: '玩法/数据',
    path: V2_ROUTE_PATHS.explore,
    icon: Compass,
  },
  {
    kind: 'link',
    label: '盯竞品',
    path: V2_ROUTE_PATHS.watch,
    icon: Radar,
  },
  {
    kind: 'link',
    label: '发现',
    path: V2_ROUTE_PATHS.quickTools,
    icon: Wrench,
    glow: true,
  },
  {
    kind: 'link',
    label: '我的收藏',
    path: V2_ROUTE_PATHS.favorites,
    icon: Heart,
  },
] as const satisfies readonly MainNavLink[];
