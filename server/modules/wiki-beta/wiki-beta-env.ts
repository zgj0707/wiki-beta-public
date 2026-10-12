export class WikiBetaConfigError extends Error {
  readonly errorCode = 'WIKI_BETA_CONFIG_MISSING';

  constructor(message: string) {
    super(message);
    this.name = 'WikiBetaConfigError';
  }
}

export function requireWikiEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new WikiBetaConfigError(`${name} is not configured`);
  }
  return value;
}

/** Resolve Base app token from explicit token or base URL. */
export function resolveWikiBetaBaseToken(
  extractBaseToken: (url: string) => string | null,
): string {
  const direct =
    process.env.WIKI_BETA_BASE_TOKEN?.trim() ||
    process.env.WIKI_BETA_SYNC_BASE_TOKEN?.trim();
  if (direct) return direct;
  const fromUrl = process.env.WIKI_BETA_BASE_URL?.trim();
  if (fromUrl) {
    const token = extractBaseToken(fromUrl);
    if (token) return token;
  }
  throw new WikiBetaConfigError(
    'WIKI_BETA_BASE_TOKEN or WIKI_BETA_BASE_URL must be configured',
  );
}

export const wikiBetaTableIds = {
  article: () => requireWikiEnv('WIKI_BETA_ARTICLE_TABLE_ID'),
  ranking: () => requireWikiEnv('WIKI_BETA_RANKING_TABLE_ID'),
  mechanism: () => requireWikiEnv('WIKI_BETA_MECHANISM_TABLE_ID'),
  quickTools: () => requireWikiEnv('WIKI_BETA_QUICK_TOOLS_TABLE_ID'),
  aiConfig: () => requireWikiEnv('WIKI_BETA_AI_CONFIG_TABLE_ID'),
};

export const wikiBetaFieldIds = {
  cover: () => requireWikiEnv('WIKI_BETA_COVER_FIELD_ID'),
  articleAttachment: () =>
    requireWikiEnv('WIKI_BETA_ARTICLE_ATTACHMENT_FIELD_ID'),
  mechanismFigure: () => requireWikiEnv('WIKI_BETA_MECHANISM_FIGURE_FIELD_ID'),
  mechanismIcon: () => requireWikiEnv('WIKI_BETA_MECHANISM_ICON_FIELD_ID'),
  quickToolsGameFile: () =>
    requireWikiEnv('WIKI_BETA_QUICK_TOOLS_GAME_FILE_FIELD_ID'),
  quickToolsIcon: () => requireWikiEnv('WIKI_BETA_QUICK_TOOLS_ICON_FIELD_ID'),
  rankingHtml: () => requireWikiEnv('WIKI_BETA_RANKING_HTML_FIELD_ID'),
};
