import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';

type PageModule = { default: ComponentType };

function lazyPage(load: () => Promise<PageModule>) {
  return async () => ({ Component: (await load()).default });
}

/**
 * AI 编译层路由组（`/ai/**`）。
 *
 * 独立成组的原因（硬约束）：编译层的前端改动必须完全收敛在 `/ai` 下，
 * 不影响其它界面。因此这里全部 `lazy()` 懒加载（不进首页 bundle），
 * 组件放 `client/src/components/ai/**`，**不修改任何既有组件**。
 *
 * 注册点在 `routes/public-routes.tsx`，只需一行 `...aiRoutes`。
 */
export const aiRoutes: RouteObject[] = [
  {
    path: 'ai',
    lazy: lazyPage(() => import('@client/src/pages/AI/AIWorkbenchPage')),
  },
  {
    path: 'ai/compile',
    lazy: lazyPage(() => import('@client/src/pages/AI/AICompilePage')),
  },
  {
    path: 'ai/e/:slug',
    lazy: lazyPage(() => import('@client/src/pages/AI/AIUnitPage')),
  },
];
