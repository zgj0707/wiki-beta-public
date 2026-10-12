import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

import { aiRoutes } from './ai-routes';

type PageModule = { default: ComponentType };

function lazyPage(load: () => Promise<PageModule>) {
  return async () => ({ Component: (await load()).default });
}

const loadContent = () => import('./loaders/content-loaders');
const loadInsight = () => import('./loaders/insight-loaders');

/** Public route objects. Loaders warm the same query keys consumed by pages. */
export const publicRoutes: RouteObject[] = [
  {
    index: true,
    lazy: lazyPage(() => import('@client/src/pages/Home/HomePage')),
    loader: (args) => loadContent().then(({ loadHome }) => loadHome(args)),
  },
  {
    path: 'gameplay/:categorySlug',
    lazy: lazyPage(
      () => import('@client/src/pages/GameplayCategory/GameplayCategoryPage'),
    ),
    loader: (args) =>
      loadContent().then(({ loadLibrary }) =>
        loadLibrary({
          ...args,
          fixedGameplayCategory: args.params.categorySlug,
        }),
      ),
  },
  {
    path: 'library',
    lazy: lazyPage(() => import('@client/src/pages/Library/LibraryPage')),
    loader: (args) =>
      loadContent().then(({ loadLibrary }) => loadLibrary(args)),
  },
  {
    path: 'quick-tools',
    lazy: lazyPage(() => import('@client/src/pages/QuickTools/QuickToolsPage')),
  },
  // 附件打开 = 卡片点击 → openQuickTool（fetch→Blob 新窗渲染），无独立路由。
  // 🔴 不能注册成多段独立路由（/quick-tools/open/:id）：平台深链兜底只对
  // 单段路径生效，多段路径整体转交对象存储报 TOS NoSuchKey（2026-10-08 实测）。
  {
    path: 'ask',
    lazy: lazyPage(() => import('@client/src/pages/Ask/AskPage')),
  },
  // 任务化导航 P1：三个任务页骨架（方案 docs/nav-tasks-redesign-plan.md §7）。
  {
    path: 'insights',
    lazy: lazyPage(() => import('@client/src/pages/Insights/InsightsPage')),
    loader: () => loadContent().then(({ loadInsights }) => loadInsights()),
  },
  {
    path: 'explore',
    lazy: lazyPage(() => import('@client/src/pages/Explore/ExplorePage')),
    // 分类树与顶栏 Layout 预取同一份 facets 缓存（loadGameplayCategories）。
    loader: () =>
      loadContent().then(({ loadGameplayCategories }) =>
        loadGameplayCategories(),
      ),
  },
  {
    path: 'watch',
    lazy: lazyPage(() => import('@client/src/pages/Watch/WatchPage')),
    loader: () => loadContent().then(({ loadWatch }) => loadWatch()),
  },
  {
    path: 'search',
    lazy: lazyPage(() => import('@client/src/pages/Search/SearchPage')),
    loader: (args) => loadContent().then(({ loadSearch }) => loadSearch(args)),
  },
  {
    path: 'article/:docId',
    lazy: lazyPage(() => import('@client/src/pages/Article/ArticleDetailPage')),
    loader: (args) =>
      loadContent().then(({ loadArticle }) => loadArticle(args)),
  },
  {
    path: 'ranking',
    lazy: lazyPage(() => import('@client/src/pages/Ranking/RankingIndexPage')),
  },
  {
    path: 'ranking/:board/:period',
    lazy: lazyPage(() => import('@client/src/pages/Ranking/RankingPage')),
  },
  {
    path: 'ranking/:board',
    lazy: lazyPage(() => import('@client/src/pages/Ranking/RankingPage')),
  },
  { path: 'knowledge', element: <Navigate to="/library" replace /> },
  {
    path: 'favorites',
    lazy: lazyPage(() => import('@client/src/pages/Favorites/FavoritesPage')),
  },
  {
    path: 'mechanism-observatory',
    lazy: lazyPage(
      () =>
        import('@client/src/pages/MechanismObservatory/MechanismObservatoryPage'),
    ),
    loader: (args) =>
      loadInsight().then(({ loadMechanismObservatory }) =>
        loadMechanismObservatory(args),
      ),
  },
  {
    path: 'mechanism-observatory/:stableKey',
    lazy: lazyPage(
      () =>
        import('@client/src/pages/MechanismObservatory/MechanismDetailPage'),
    ),
    loader: (args) =>
      loadInsight().then(({ loadMechanismDetail }) =>
        loadMechanismDetail(args),
      ),
  },
  // v2 实体链路退场（2026-10-09，docs/nav-tasks-redesign-plan.md §3）：
  // 实体浏览/关联 UI 整体下线，旧路径重定向到「找结论」引导问 AI；实体数据
  // 仍在后台作为 chatbot 检索与召回底座（mention 投影保留）。
  { path: 'products-vendors', element: <Navigate to="/insights" replace /> },
  { path: 'products-vendors/:id', element: <Navigate to="/insights" replace /> },
  { path: 'entity/:slug', element: <Navigate to="/insights" replace /> },
  // 动态与发现：原生 React 页（v2，iframe 静态年报方案已废弃，见 LabsPage 头注释）。
  {
    path: 'labs',
    lazy: lazyPage(() => import('@client/src/pages/Labs/LabsPage')),
  },
  // AI 编译层：独立路由组，与上面既有路由零交叉。
  ...aiRoutes,
  // AI 用量监控台（管理员专用，Cookie 鉴权在服务端；页面本身公开可达但只见登录框）。
  {
    path: 'admin/ai-usage',
    lazy: lazyPage(() => import('@client/src/pages/Admin/AiUsagePage')),
  },
  {
    path: '*',
    lazy: lazyPage(() => import('@client/src/pages/NotFound/NotFound')),
  },
];
