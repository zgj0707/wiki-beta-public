jest.mock('../../client/src/data/rankings/remote', () => ({
  fetchBoardsMeta: jest.fn().mockResolvedValue(null),
}));

import { BOARDS_META } from '../../client/src/data/rankings';
import {
  findFirstPeriodWithContent,
  MIN_REAL_HTML_LENGTH,
} from '../../client/src/data/rankings/latest-period';

/**
 * 回归背景：首页 Steam 周报卡曾把「最新一期」显示成 2026 年第 31 周。
 * 根因是卡片按正序直觉从 periods 尾部往前遍历，而生成器
 * （scripts/gen-ranking-pages.mjs）约定 periods 按时间倒序、索引 0 为最新一期。
 */
describe('榜单最新一期选取（periods 倒序口径）', () => {
  const periods = [
    { slug: 'w6', label: '2026年第37周' },
    { slug: 'w5', label: '2026年第36周' },
    { slug: 'w0', label: '2026年第31周' },
  ];
  const real = 'x'.repeat(MIN_REAL_HTML_LENGTH + 100);
  const content: Record<string, string> = { w6: real, w5: real, w0: real };
  const load = async (slug: string) => content[slug] ?? null;

  it('返回索引 0 的最新一期，而不是末尾的最旧一期', async () => {
    await expect(findFirstPeriodWithContent(periods, load)).resolves.toEqual({
      slug: 'w6',
      label: '2026年第37周',
    });
  });

  it('最新一期只有占位内容时顺延到下一期', async () => {
    const gapped = { ...content, w6: '<html></html>' };
    await expect(
      findFirstPeriodWithContent(periods, async (slug) => gapped[slug] ?? null),
    ).resolves.toMatchObject({ slug: 'w5' });
  });

  it('全部无内容时返回 null', async () => {
    await expect(findFirstPeriodWithContent(periods, async () => null)).resolves.toBeNull();
  });

  it('周期列表为空时返回 null', async () => {
    await expect(findFirstPeriodWithContent([], load)).resolves.toBeNull();
  });
});

describe('Steam 榜单元数据的倒序口径', () => {
  it('周数严格降序且无重复（生成器与前端消费方的共同前提）', () => {
    const weeks = BOARDS_META.steam.periods.map((period) =>
      Number(period.label.match(/(\d+)周/)?.[1]),
    );

    expect(weeks.every((week) => Number.isFinite(week))).toBe(true);
    expect(weeks).toEqual([...weeks].sort((a, b) => b - a));
    expect(new Set(weeks).size).toBe(weeks.length);
  });
});
