// 榜单周期选取工具（手写文件，与 AUTO-GENERATED 的 index.ts 区分开）。
//
// 口径来源：scripts/gen-ranking-pages.mjs 约定「periods 一律按时间倒序
// （索引 0 = 最新一期）」；同时约定「空榜不产出」，因此理论上 periods[0]
// 就有真实内容。
//
// 之所以把选取逻辑收敛到这里：该口径此前散落在调用点的注释里，一旦有人按
// 「正序」直觉从尾部往前遍历，就会静默取到最旧一期（首页 Steam 周报卡曾因此
// 把 7 周前的第 31 周当成最新一期）。实现与口径绑定在一处，并由单测固定。

import type { BoardKey, Period } from './index';
import { BOARDS_META, loadBoardContent } from './index';
import { fetchBoardsMeta } from './remote';
import { rankingPeriodSortKey } from '@shared/rankings';

/** 占位 HTML 仅百余字节；真实周报均 > 10KB。 */
export const MIN_REAL_HTML_LENGTH = 500;

/**
 * 多源周期合并（与榜单页同一口径）：
 * 按 slug 去重、同 slug 远端为准（Base 是 SSOT）、再按时间键倒序。
 * Base 只录新期、静态已停更，整体覆盖会丢期，必须按 slug 合并。
 */
export function mergeBoardPeriods(
  board: BoardKey,
  ...sources: Period[][]
): Period[] {
  const bySlug = new Map<string, Period>();
  for (const periods of sources) {
    for (const p of periods) bySlug.set(p.slug, p);
  }
  return [...bySlug.values()].sort(
    (a, b) =>
      rankingPeriodSortKey(board, b.slug, b.label) -
      rankingPeriodSortKey(board, a.slug, a.label),
  );
}

/**
 * 取榜单「最新一期且有真实内容」的周期，没有可用内容时返回 null。
 *
 * @param periods 生成器产出的周期列表，**必须按时间倒序**（索引 0 = 最新）
 * @param loadContent 按期次 slug 取正文 HTML
 */
export async function findFirstPeriodWithContent(
  periods: Period[],
  loadContent: (slug: string) => Promise<string | null>,
  minHtmlLength = MIN_REAL_HTML_LENGTH,
): Promise<Period | null> {
  // 倒序列表正序遍历 = 由最新一期往回找第一份非占位内容。
  for (const period of periods) {
    const html = await loadContent(period.slug);
    if (html && html.length > minHtmlLength) return period;
  }
  return null;
}

/**
 * 取指定榜单「最新一期且有真实内容」的周期（内部按依赖注入完成接线）。
 */
export function findLatestBoardPeriod(board: BoardKey): Promise<Period | null> {
  return findFirstPeriodWithContent(BOARDS_META[board].periods, (slug) =>
    loadBoardContent(board, slug),
  );
}

/**
 * 取指定榜单「最新一期」的周期，双源：服务端 /api/rankings/meta（Base 驱动，
 * 含新增周期）优先，静态产物兜底。远端失败或合并后为空时退回
 * findLatestBoardPeriod（含内容校验）。榜单首页入口卡等非榜单页使用——
 * 不能再只读静态 index.ts（gen-ranking-pages.mjs 已停更，会停留在旧期）。
 */
export async function findLatestBoardPeriodLive(
  board: BoardKey,
): Promise<Period | null> {
  const remote = await fetchBoardsMeta();
  const merged = mergeBoardPeriods(
    board,
    BOARDS_META[board].periods,
    remote?.[board]?.periods ?? [],
  );
  if (merged.length) return merged[0];
  return findLatestBoardPeriod(board);
}
