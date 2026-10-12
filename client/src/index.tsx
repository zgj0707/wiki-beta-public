import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import PublicRoot from '@client/src/shells/PublicRoot';
import { RootErrorBoundary } from '@client/src/components/RootErrorFallback';
import { router } from '@client/src/router';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

createRoot(rootElement).render(
  <RootErrorBoundary>
    <PublicRoot>
      <RouterProvider router={router} />
    </PublicRoot>
  </RootErrorBoundary>,
);
