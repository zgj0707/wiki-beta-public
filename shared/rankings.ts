/**
 * Ranking board conventions (Bitable table schema and sort/render helpers).
 * Resource tokens and table IDs are supplied via environment variables on the server.
 */

/** 「榜单」表的专用列名。 */
export const RANKING_FIELD_NAMES = {
  board: '榜单板块',
  slug: '榜单周期',
  label: '周期标签',
  html: '榜单HTML',
  dataSource: '数据源',
} as const;

export type RankingBoardKey = 'appstore' | 'weixin' | 'steam';

export const RANKING_BOARD_KEYS: RankingBoardKey[] = [
  'appstore',
  'weixin',
  'steam',
];

export const RANKING_BOARD_TITLES: Record<RankingBoardKey, string> = {
  appstore: 'AppStore SLG 周下载榜',
  weixin: '微信小游戏畅销榜',
  steam: 'Steam 榜单',
};

export function rankingSheetDefaults(): {
  appstoreSpreadsheetToken: string;
  weixinNodeToken: string;
  weixinSheetName: string;
} {
  return {
    appstoreSpreadsheetToken:
      process.env.WIKI_BETA_RANKING_APPSTORE_SPREADSHEET_TOKEN?.trim() ||
      'shtEXAMPLEAPPSTORE01',
    weixinNodeToken:
      process.env.WIKI_BETA_RANKING_WEIXIN_WIKI_NODE_TOKEN?.trim() ||
      'wikEXAMPLEWEIXIN001',
    weixinSheetName: 'Sheet1',
  };
}

/** 「榜单板块」单选原文 → 站内板块 key；无法识别的值返回 null（忽略该行）。 */
export function rankingBoardKey(value: string): RankingBoardKey | null {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'appstore') return 'appstore';
  if (v === '微信' || v === 'weixin') return 'weixin';
  if (v === 'steam') return 'steam';
  return null;
}

export function normalizeRankingSlug(
  board: RankingBoardKey,
  slug: string,
): string {
  const prefix = `${board}-`;
  return slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
}

export type RankingPeriod = { slug: string; label: string };
export type RankingBoardMeta = {
  title: string;
  type: 'periods' | 'single';
  periods: RankingPeriod[];
};
export type RankingBoardsMeta = Partial<
  Record<RankingBoardKey, RankingBoardMeta>
>;

export type RankingDataSource = {
  sourceToken: string;
  isWikiNode: boolean;
  sheetName: string;
};

export function parseRankingDataSource(
  raw: string,
  board: RankingBoardKey,
): RankingDataSource | null {
  const defaults = rankingSheetDefaults();
  const value = String(raw ?? '').trim();
  const m = value.match(/^(wiki|sheet):([A-Za-z0-9]+)#(.+)$/);
  if (m) {
    return { sourceToken: m[2], isWikiNode: m[1] === 'wiki', sheetName: m[3].trim() };
  }
  if (board === 'weixin') {
    return {
      sourceToken: defaults.weixinNodeToken,
      isWikiNode: true,
      sheetName: value || defaults.weixinSheetName,
    };
  }
  if (board === 'appstore') {
    return {
      sourceToken: defaults.appstoreSpreadsheetToken,
      isWikiNode: false,
      sheetName: value,
    };
  }
  return null;
}

export function deriveAppstoreSheetName(slug: string): string | null {
  const normalized = normalizeRankingSlug('appstore', String(slug ?? '').trim());
  const m = normalized.match(/^w(\d{4})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function rankingPeriodSortKey(
  board: RankingBoardKey,
  slug: string,
  label: string,
): number {
  if (board === 'appstore') {
    const month = String(label).match(/(\d{1,2})\s*月/);
    if (month && /^monthly/.test(slug)) {
      return Number(month[1]) * 100 + 31;
    }
    const m = slug.match(/w(\d{4})(\d{4})$/);
    if (!m) return 0;
    const start = Number(m[1]);
    const end = Number(m[2]);
    return end >= start ? end : end + 10000;
  }
  if (board === 'steam') {
    const m = String(label).match(/(\d{4})\D*?(\d{1,2})\s*周/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
  }
  return 0;
}
