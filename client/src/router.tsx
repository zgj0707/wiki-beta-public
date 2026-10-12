import { createBrowserRouter } from 'react-router-dom';
import Layout from '@client/src/components/Layout';
import { publicRoutes } from '@client/src/routes/public-routes';
import { CLIENT_BASE_PATH } from '@client/src/lib/base-path';

const loadContent = () => import('./routes/loaders/content-loaders');

export const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      // 顶栏分类菜单的数据预取；失败静默放行，不阻断导航。
      loader: () =>
        loadContent().then(({ loadGameplayCategories }) =>
          loadGameplayCategories(),
        ),
      children: [...publicRoutes],
    },
  ],
  { basename: CLIENT_BASE_PATH },
);
