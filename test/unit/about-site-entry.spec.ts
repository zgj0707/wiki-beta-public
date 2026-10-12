import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CHANGELOG } from '@client/src/data/changelog';

/**
 * 「关于网站」更新公告入口的守护测试。
 *
 * 存在意义（两次真实事故）：
 * 1. 该入口原本挂在 `Sidebar.tsx` 上，`a3b2e6c` 整体删除该组件时**没有迁移入口**，
 *    导致 `changelog.ts` 变成无人引用的孤儿文件（数据在、无人渲染、文件头注释还在说
 *    「侧边栏弹窗读取本文件」，属失效描述）。本测试锁住入口的存在。
 * 2. 弹窗数据源 `changelog.ts` 单文件约 25KB raw。若被 TopNav **静态**引入，
 *    整份更新日志会进入 client 入口 chunk，实测把入口 JS gzip 从 17.5KB 推到 28.2KB，
 *    撑破 `budget:check` 的 25600 字节预算。本测试锁住「必须懒加载」。
 */
const ROOT = resolve(__dirname, '../..');
const TOP_NAV_PATH = resolve(ROOT, 'client/src/components/TopNav.tsx');
const DIALOG_PATH = resolve(ROOT, 'client/src/components/AboutSiteDialog.tsx');

const topNavSource = readFileSync(TOP_NAV_PATH, 'utf8');
const dialogSource = readFileSync(DIALOG_PATH, 'utf8');

describe('关于网站入口（更新公告）', () => {
  it('顶栏提供入口：桌面端图标按钮 + 移动端抽屉条目', () => {
    expect(topNavSource).toContain('aria-label="关于网站"');
    expect(topNavSource).toContain('<span>关于网站</span>');
  });

  it('弹窗必须懒加载 —— 静态引入会撑破入口体积预算', () => {
    expect(topNavSource).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\('@client\/src\/components\/AboutSiteDialog'\)/,
    );
    // 反向断言：不得退回静态 import
    expect(topNavSource).not.toMatch(
      /^import AboutSiteDialog from '@client\/src\/components\/AboutSiteDialog';/m,
    );
  });

  it('弹窗仅在打开时挂载，并由 Suspense 兜底', () => {
    expect(topNavSource).toMatch(/\{aboutOpen && \(/);
    expect(topNavSource).toContain('<Suspense');
  });

  it('弹窗消费 changelog 数据源', () => {
    expect(dialogSource).toContain("from '@client/src/data/changelog'");
    expect(dialogSource).toContain('CHANGELOG');
  });

  it('changelog 数据源非空、按日期倒序、条目类型合法', () => {
    expect(CHANGELOG.length).toBeGreaterThan(10);

    const dates = CHANGELOG.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());

    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.label.trim()).not.toBe('');
      expect(entry.items.length).toBeGreaterThan(0);
      for (const item of entry.items) {
        expect(['feat', 'fix', 'other']).toContain(item.type);
        expect(item.text.trim()).not.toBe('');
      }
    }
  });

  it('「今天」这类相对标签只在最新一条出现，避免陈旧条目长期挂着「今天」', () => {
    const relativeLabels = CHANGELOG.filter((entry) => entry.label === '今天');
    expect(relativeLabels.length).toBeLessThanOrEqual(1);
    if (relativeLabels.length === 1) {
      expect(relativeLabels[0].date).toBe(CHANGELOG[0].date);
    }
  });
});
