/**
 * Static metadata used when the website falls back to its local ranking archive.
 */
import type { RankingBoardKey } from './rankings';

export interface RankingFallbackPeriod {
  slug: string;
  label: string;
  sortKey: number;
}

export interface RankingFallbackBoard {
  title: string;
  type: 'periods' | 'single';
  periods: RankingFallbackPeriod[];
}

export const RANKING_FALLBACK_META: Record<RankingBoardKey, RankingFallbackBoard> = {
  appstore: {
    title: 'AppStore SLG 周下载榜（示例）',
    type: 'periods',
    periods: [{ slug: 'demo', label: '示例周榜', sortKey: 100 }],
  },
  weixin: {
    title: '微信小游戏畅销榜（示例）',
    type: 'single',
    periods: [],
  },
  steam: {
    title: 'Steam 榜单（示例）',
    type: 'periods',
    periods: [
      { slug: 'w2', label: '2026年第2周', sortKey: 202602 },
      { slug: 'w1', label: '2026年第1周', sortKey: 202601 },
    ],
  },
};
