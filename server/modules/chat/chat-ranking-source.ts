import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  RANKING_BOARD_TITLES,
  RANKING_BOARD_KEYS,
  type RankingBoardKey,
  type RankingBoardsMeta,
  rankingPeriodSortKey,
} from '@shared/rankings';
import { RANKING_SOURCE_PREFIX } from '@shared/chat-source';
import { RANKING_FALLBACK_META } from '@shared/ranking-fallback-meta';

import { RankingBoardService } from '../wiki-beta/ranking-board.service';
import type { RetrievedDoc } from './chat-retrieval-common';
import type { RankingPeriodRequest } from './chat-intent';

/** 榜单片段预算：表格文本超过此长度截断（榜单摘要不需要整榜）。 */
const SNIPPET_BUDGET = 1500;
/** 榜单总片段上限；区间检索最多可取同板块三期，控制上下文体积。 */
const RANKING_TOP_K = 3;

/**
 * chat 的「榜单」来源（nav-tasks-p3b，方案 §4.1 唯一新增检索通道）。
 *
 * 语料 = RankingBoardService 当前返回的全部板块/期次（附件 HTML 或 sheet
 * 渲染，均带 60s 缓存）；按最新、上一期、指定期次或最近数期选择，剥标签成表格文本。
 * 只在榜单意图路径被调用——通用检索不查榜单，避免「每周」这类词误召回榜单。
 */
@Injectable()
export class ChatRankingSource {
  private readonly logger = new Logger(ChatRankingSource.name);
  private readonly staticContentCache = new Map<string, string>();

  constructor(private readonly rankingBoard: RankingBoardService) {}

  /**
   * `boardKeys` 为空 = 全部板块；非空只取指名板块。
   * exact/previous/range 按请求期次读取；无对应记录时不把最新一期冒充成结果。
   */
  async retrieve(
    boardKeys: string[],
    periodRequest?: RankingPeriodRequest,
  ): Promise<RetrievedDoc[]> {
    const wanted = boardKeys.length
      ? RANKING_BOARD_KEYS.filter((key) => boardKeys.includes(key))
      : RANKING_BOARD_KEYS;
    if (!wanted.length) return [];

    const boards = await this.safeListBoardsMeta();
    const docs: RetrievedDoc[] = [];
    for (const key of wanted) {
      const meta = boards[key];
      if (!meta) continue;
      const periods = selectPeriods(meta.periods, periodRequest);
      const requiresPeriod =
        periodRequest?.kind === 'exact' ||
        periodRequest?.kind === 'previous' ||
        periodRequest?.kind === 'range';
      const selected =
        periods.length || requiresPeriod
          ? periods
          : [{ slug: 'index', label: meta.title }];
      for (const period of selected) {
        const doc = await this.docForBoard(key, meta.title, period.slug, period.label);
        if (doc) docs.push(doc);
      }
    }
    const picked = docs.slice(0, RANKING_TOP_K);
    this.logger.log(
      `chat ranking retrieve: boards=${wanted.join(',')} period=${periodRequest?.label ?? periodRequest?.kind ?? 'latest'} picked=${picked.length}`,
    );
    return picked;
  }

  private async safeListBoardsMeta() {
    let liveBoards: RankingBoardsMeta = {};
    try {
      liveBoards = await this.rankingBoard.listBoardsMeta();
    } catch (error) {
      this.logger.warn(
        `ranking meta load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return mergeRankingBoards(liveBoards);
  }

  private async docForBoard(
    key: RankingBoardKey,
    boardTitle: string,
    slug: string,
    label: string,
  ): Promise<RetrievedDoc | null> {
    let html: string | null = null;
    try {
      html = await this.rankingBoard.loadContent(key, slug);
    } catch (error) {
      this.logger.warn(
        `ranking content load failed: board=${key} slug=${slug} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!html) html = await this.loadStaticContent(key, slug);
    if (!html) return null;

    const text = htmlToTableText(html, SNIPPET_BUDGET);
    if (!text) return null;
    return {
      docId: `${RANKING_SOURCE_PREFIX}${key}:${slug}`,
      title: `${boardTitle} · ${label}`,
      sourceDate: null,
      url: slug === 'index' ? `/ranking/${key}` : `/ranking/${key}/${slug}`,
      snippet: text,
      score: 0,
      matchedEntities: [],
      source: 'ranking',
    };
  }

  private async loadStaticContent(
    key: RankingBoardKey,
    slug: string,
  ): Promise<string | null> {
    const cacheKey = `${key}:${slug}`;
    const cached = this.staticContentCache.get(cacheKey);
    if (cached) return cached;

    const fileName = `${key}-${slug}.html`;
    const staticPaths = [
      join(
        process.cwd(),
        'ranking-fallback',
        'src',
        'data',
        'rankings',
        'contents',
        fileName,
      ),
      join(process.cwd(), 'client', 'src', 'data', 'rankings', 'contents', fileName),
    ];
    for (const path of staticPaths) {
      try {
        const html = await readFile(path, 'utf8');
        this.staticContentCache.set(cacheKey, html);
        return html;
      } catch {
        // Try the next supported location (repository source or packaged build asset).
      }
    }
    return null;
  }
}

function mergeRankingBoards(liveBoards: RankingBoardsMeta): RankingBoardsMeta {
  const merged: RankingBoardsMeta = {};
  for (const key of RANKING_BOARD_KEYS) {
    const fallback = RANKING_FALLBACK_META[key];
    const live = liveBoards[key];
    const liveLabels = new Set(
      (live?.periods ?? []).map((period) => normalizePeriodText(period.label)),
    );
    const fallbackBySlug = new Map(
      fallback.periods.map((period, index) => [period.slug, { period, index }]),
    );
    const bySlug = new Map<
      string,
      { slug: string; label: string; sortKey: number; fallbackIndex: number }
    >();

    fallback.periods.forEach((period, index) => {
      if (liveLabels.has(normalizePeriodText(period.label))) return;
      bySlug.set(period.slug, {
        slug: period.slug,
        label: period.label,
        sortKey: period.sortKey,
        fallbackIndex: index,
      });
    });
    for (const period of live?.periods ?? []) {
      const fallbackPeriod = fallbackBySlug.get(period.slug);
      bySlug.set(period.slug, {
        slug: period.slug,
        label: period.label,
        sortKey:
          rankingPeriodSortKey(key, period.slug, period.label) ||
          fallbackPeriod?.period.sortKey ||
          0,
        fallbackIndex: fallbackPeriod?.index ?? Number.MAX_SAFE_INTEGER,
      });
    }

    const periods = [...bySlug.values()]
      .sort((a, b) => b.sortKey - a.sortKey || a.fallbackIndex - b.fallbackIndex)
      .map(({ slug, label }) => ({ slug, label }));
    merged[key] = {
      title: live?.title ?? fallback.title ?? RANKING_BOARD_TITLES[key],
      type: live?.type ?? fallback.type,
      periods,
    };
  }
  return merged;
}

function selectPeriods(
  periods: Array<{ slug: string; label: string }> | undefined,
  request?: RankingPeriodRequest,
): Array<{ slug: string; label: string }> {
  if (!periods?.length) return [];
  if (request?.kind === 'exact') {
    const requested = normalizePeriodText(request.label ?? '');
    if (!requested) return [];
    const matches = periods.filter((period) => {
      const label = normalizePeriodText(period.label);
      const slug = normalizePeriodText(period.slug);
      if (label === requested || slug === requested) return true;
      // 只写“第 37 周”时允许匹配带年份的完整周标签，但若跨年有多个第 37 周，
      // 保持未命中，避免静默选中某一年的数据。
      return /^第\d+周$/.test(requested) && label.endsWith(requested);
    });
    return matches.length === 1 ? [matches[0]] : [];
  }
  if (request?.kind === 'previous') {
    // 「去年/前年/上一年」不是“上一期”；不要误拿相邻周榜冒充全年数据。
    if (/(去年|前年|上一年)/.test(request.label ?? '')) return [];
    return periods[1] ? [periods[1]] : [];
  }
  if (request?.kind === 'range') {
    const range = requestedPeriodRange(request.label ?? '');
    if (!range) return [];
    const matchingPeriods = periods.filter((period) =>
      periodMatchesRangeUnit(period, range.unit),
    );
    // 超过上下文预算时仍返回最新可用的几期，让助手明确报告覆盖范围，
    // 不要因为请求五期却最多装入三期而误报成“没有榜单数据”。
    return matchingPeriods.slice(0, Math.min(range.count, RANKING_TOP_K));
  }
  return periods[0] ? [periods[0]] : [];
}

function requestedPeriodRange(
  label: string,
): { count: number; unit: 'week' | 'month' | 'quarter' } | null {
  const match = label.match(/(?:最近|近|过去)\s*([0-9]+|[两三四五六七八九十])\s*(周|星期|月|个月|季度)/i);
  if (!match) return null;
  const count = /^\d+$/.test(match[1])
    ? Number(match[1])
    : parseChineseNumeral(match[1]);
  if (count == null || count < 2) return null;
  const unit = match[2].startsWith('周') || match[2] === '星期'
    ? 'week'
    : match[2] === '月' || match[2] === '个月'
      ? 'month'
      : 'quarter';
  return { count, unit };
}

function periodMatchesRangeUnit(
  period: { slug: string; label: string },
  unit: 'week' | 'month' | 'quarter',
): boolean {
  const label = `${period.label} ${period.slug}`.toLocaleLowerCase();
  if (unit === 'week') return /周|星期|\bw\d/i.test(label);
  if (unit === 'month') return /月|month|\bm\d/i.test(label);
  return /季度|quarter|\bq[1-4]\b/i.test(label);
}

function normalizePeriodText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/第([零一两二三四五六七八九十]{1,3})周/g, (_, numeral: string) => {
      const number = parseChineseNumeral(numeral);
      return number == null ? `第${numeral}周` : `第${number}周`;
    })
    .replace(/\s+/g, '')
    .replace(/[年月日\s\-/.，,：:()（）]/g, '');
}

function parseChineseNumeral(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const ten = value.indexOf('十');
  if (ten < 0) return value.length === 1 ? (digits[value] ?? null) : null;
  const tens = ten === 0 ? 1 : (digits[value[ten - 1]] ?? null);
  const ones = ten === value.length - 1 ? 0 : (digits[value[value.length - 1]] ?? null);
  return tens == null || ones == null ? null : tens * 10 + ones;
}

/**
 * HTML → 表格文本：剥 script/style/标签、还原常见实体、压缩空白与表格分隔噪声。
 * 保留 | 与制表类分隔的行结构，让模型能读出「名次-产品-数值」的对应关系。
 */
export function htmlToTableText(html: string, budget: number): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(tr|p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\|\s*/g, '|')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.slice(0, budget);
}
