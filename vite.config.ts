import path from 'path';
import { defineConfig } from '@lark-apaas/fullstack-vite-preset';

function deferAdminPlatformCss() {
  return {
    name: 'defer-admin-platform-css',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; source?: string | Uint8Array }>,
    ) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || typeof asset.source !== 'string')
          continue;
        if (!asset.source.includes('admin-platform-')) continue;
        asset.source = asset.source
          .replace(
            /<link\b[^>]*href="\/assets\/admin-platform-[^"]+\.css"[^>]*>\s*/gu,
            '',
          )
          .replace(/"\/assets\/admin-platform-[^"]+\.css",?/gu, '');
      }
    },
  };
}

export default defineConfig({
  plugins: [deferAdminPlatformCss()],
  build: {
    modulePreload: {
      resolveDependencies(filename, deps, context) {
        if (context.hostType === 'html') {
          return deps.filter(
            (dependency) => !dependency.includes('admin-platform'),
          );
        }
        return deps;
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (normalizedId.includes('vite/preload-helper')) {
            return 'preload-runtime';
          }

          const firstNodeModules = normalizedId.indexOf('/node_modules/');
          const isTopLevelDependency =
            firstNodeModules !== -1 &&
            firstNodeModules === normalizedId.lastIndexOf('/node_modules/');

          if (
            isTopLevelDependency &&
            (normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/react-router'))
          ) {
            return 'react';
          }

          if (
            isTopLevelDependency &&
            (normalizedId.includes('/node_modules/@tanstack/react-query/') ||
              normalizedId.includes('/node_modules/@tanstack/query-core/') ||
              normalizedId.includes(
                '/node_modules/@tanstack/query-persist-client-core/',
              ) ||
              normalizedId.includes(
                '/node_modules/@tanstack/react-query-persist-client/',
              ))
          ) {
            return 'query-runtime';
          }

          if (
            isTopLevelDependency &&
            (normalizedId.includes('/node_modules/next-themes/') ||
              normalizedId.includes('/node_modules/sonner/') ||
              normalizedId.includes('/node_modules/react-error-boundary/') ||
              normalizedId.includes('/node_modules/lucide-react/') ||
              normalizedId.includes('/node_modules/tailwind-merge/') ||
              normalizedId.includes('/node_modules/clsx/') ||
              normalizedId.includes(
                '/node_modules/class-variance-authority/',
              ) ||
              normalizedId.includes('/node_modules/tailwind-variants/') ||
              normalizedId.includes('/node_modules/@radix-ui/'))
          ) {
            return 'public-runtime';
          }

          if (
            normalizedId.includes('/node_modules/react-markdown/') ||
            normalizedId.includes('/node_modules/remark-gfm/')
          ) {
            return 'markdown';
          }

          if (normalizedId.includes('/node_modules/@lark-apaas/')) {
            return 'admin-platform';
          }

          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      clsx: path.resolve(__dirname, 'node_modules/clsx/dist/clsx.mjs'),
      'tailwind-merge': path.resolve(
        __dirname,
        'node_modules/tailwind-merge/dist/bundle-mjs.mjs',
      ),
      'crypto-js/sha1': path.resolve(
        __dirname,
        'node_modules/crypto-js/sha1.js',
      ),
      'crypto-js/hmac-sha1': path.resolve(
        __dirname,
        'node_modules/crypto-js/hmac-sha1.js',
      ),
      'crypto-js/enc-base64': path.resolve(
        __dirname,
        'node_modules/crypto-js/enc-base64.js',
      ),
    },
  },
});
