const tseslint = require('typescript-eslint');
const { eslintPresetsOfSimple } = require('@lark-apaas/fullstack-presets');

module.exports = tseslint.config(
  {
    ignores: [
      'dist',
      'dist-server',
      'node_modules',
      'source_package',
      'client/src/api/gen',
      '**/*.d.ts',
      '**/*.js.map',
      // 两个 tsconfig 都把 **/*.spec.ts 排除在 TS project 之外，ESLint 必须保持一致：
      // 否则带类型信息的规则（@darraghor/nestjs-typed 的 injectable-should-be-provided）
      // 会因「文件不在任何 provided project 中」直接抛错，导致整个 lint 跑不完。
      '**/*.spec.ts',
      '**/*.e2e-spec.ts',
    ],
  },
  // Client configuration
  {
    files: ['client/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    extends: [
      ...eslintPresetsOfSimple.client,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.app.json',
      },
    },
    settings: {
      'import/resolver': {
        alias: {
          map: [
            ['@', './client/src'],
            ['@client', './client'],
            ['@shared', './shared'],
          ],
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
  },
  // Server configuration
  {
    files: ['server/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    extends: [
      ...eslintPresetsOfSimple.server,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
      }
    },
    settings: {
      'import/resolver': {
        alias: {
          map: [['@server', './server'], ['@shared', './shared']],
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      }
    },
    rules: {
      // 上游 preset（@lark-apaas/fullstack-presets → eslint-server.js）只给这条规则传了 src，
      // 漏传 filterFromPaths。插件源码里「用户传了 options 就不用默认值」，
      // 于是 filterFromPaths=undefined ⇒ .spec. 过滤失效 ⇒ 插件把 server/**/*.spec.ts 也
      // fs.readFileSync + parse，而这些文件被 tsconfig.node.json 排除在 project 之外，
      // 解析直接抛错，导致整个 eslint 跑不完。此处补回插件默认的过滤项。
      '@darraghor/nestjs-typed/injectable-should-be-provided': [
        'error',
        {
          src: ['./server/**/*.ts'],
          filterFromPaths: ['dist', 'node_modules', '.test.', '.spec.'],
        },
      ],
    },
  },
);
