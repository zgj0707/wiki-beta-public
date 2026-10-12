// Static fallback metadata for ranking boards (fictional demo data).
// Production content is loaded from Feishu Base when configured.

export type BoardKey = 'appstore' | 'weixin' | 'steam';
export type Period = { slug: string; label: string };
export type BoardData = {
  title: string;
  sourceUrl: string;
  type: 'periods' | 'single';
  periods: Period[];
};

export const BOARDS_META: Record<BoardKey, BoardData> = {
  appstore: {
    title: 'AppStore SLG 周下载榜（示例）',
    sourceUrl: 'https://example.feishu.cn/wiki/wikEXAMPLEAPPSTORE',
    type: 'periods',
    periods: [{ slug: 'demo', label: '示例周榜' }],
  },
  weixin: {
    title: '微信小游戏畅销榜（示例）',
    sourceUrl: 'https://example.feishu.cn/wiki/wikEXAMPLEWEIXIN',
    type: 'single',
    periods: [],
  },
  steam: {
    title: 'Steam 榜单（示例）',
    sourceUrl: 'https://example.feishu.cn/wiki/wikEXAMPLESTEAM',
    type: 'periods',
    periods: [
      { slug: 'w2', label: '2026年第2周' },
      { slug: 'w1', label: '2026年第1周' },
    ],
  },
};

export const BOARD_CONTENT_LOADERS: Record<
  BoardKey,
  Record<string, () => Promise<string>>
> = {
  appstore: {
    demo: () =>
      import('./contents/appstore-demo.html?raw').then((m) => m.default),
  },
  weixin: {},
  steam: {
    w1: () => import('./contents/steam-w1.html?raw').then((m) => m.default),
    w2: () => import('./contents/steam-w2.html?raw').then((m) => m.default),
  },
};

export async function loadBoardContent(
  board: BoardKey,
  slug: string,
): Promise<string | null> {
  const load = BOARD_CONTENT_LOADERS[board]?.[slug];
  if (!load) return null;
  return load();
}
