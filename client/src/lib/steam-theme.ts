export type SteamTheme = 'light' | 'dark';

export const STEAM_THEME_STYLE_MARKER = 'data-product-kb-theme';

const STEAM_DARK_OVERRIDES = `<style ${STEAM_THEME_STYLE_MARKER}="dark">
:root {
  color-scheme: dark;
  --bg: #172236;
  --card: #202d43;
  --ink: #e8eef7;
  --muted: #aab8cc;
  --accent: #66c0f4;
  --accent-dark: #9bd8ff;
  --valve: #34516b;
  --up: #55d98a;
  --down: #ff8585;
  --new: #c7a0ff;
  --free: #66c9ff;
  --border: #3b4c65;
  --gold: #e7bf61;
}

html, body { background: var(--bg); color: var(--ink); }
body { color-scheme: dark; }
header { box-shadow: 0 8px 24px rgba(5, 12, 24, .38); }
.stat, .card, .podium, .an-card {
  background: var(--card);
  border-color: var(--border);
  box-shadow: 0 4px 14px rgba(5, 12, 24, .22);
}
.b-new, .an-tag.tag-new { background: color-mix(in srgb, var(--new) 20%, var(--card)); }
.b-up, .an-tag.tag-up { background: color-mix(in srgb, var(--up) 18%, var(--card)); }
.b-free, .an-tag.tag-free { background: color-mix(in srgb, var(--free) 18%, var(--card)); }
.b-flat { background: color-mix(in srgb, var(--muted) 16%, var(--card)); }
.b-down { background: color-mix(in srgb, var(--down) 18%, var(--card)); }
thead th { background: var(--accent-dark); }
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--ink) 4%, var(--bg)); }
tbody tr:hover { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
.note { background: color-mix(in srgb, var(--gold) 16%, var(--card)); border-color: color-mix(in srgb, var(--gold) 42%, var(--border)); color: #f5d99a; }
.an-card .an-rank { background: color-mix(in srgb, var(--accent) 12%, var(--card)); }
.an-card .an-body, .an-evidence .ev-reason { color: var(--ink); }
.an-genre .g-type { background: color-mix(in srgb, var(--accent) 10%, var(--card)); border-color: var(--border); }
.an-meta .m-box { background: color-mix(in srgb, var(--muted) 10%, var(--card)); border-color: var(--border); }
.an-meta .m-box.m-up { background: color-mix(in srgb, var(--down) 16%, var(--card)); border-color: color-mix(in srgb, var(--down) 38%, var(--border)); }
.an-meta .m-box.m-peak { background: color-mix(in srgb, var(--up) 16%, var(--card)); border-color: color-mix(in srgb, var(--up) 38%, var(--border)); }
.an-meta .m-box.m-update { background: color-mix(in srgb, var(--accent) 16%, var(--card)); border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); }
.an-tag.tag-trend { background: color-mix(in srgb, var(--gold) 18%, var(--card)); color: #f5d99a; }
.an-tag.tag-main { background: color-mix(in srgb, var(--accent) 18%, var(--card)); color: #b8e4ff; }
.an-tag.tag-upsale { background: color-mix(in srgb, var(--new) 18%, var(--card)); color: #d7bdff; }
.an-toggle { background: color-mix(in srgb, var(--accent) 12%, var(--card)); border-color: var(--border); color: var(--accent-dark); }
.an-toggle:hover { background: var(--accent); color: #102038; border-color: var(--accent); }
.xlsx-link { background: var(--accent); color: #102038; box-shadow: 0 2px 8px rgba(5, 12, 24, .3); }
.xlsx-link:hover { background: #8ad2fa; }
.an-evidence { background: color-mix(in srgb, var(--muted) 10%, var(--card)); border-color: var(--border); }
.an-evidence .ev-link { background: var(--card); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); color: var(--accent-dark); }
.an-evidence .ev-link:hover { background: color-mix(in srgb, var(--accent) 18%, var(--card)); border-color: var(--accent); }
</style>`;

function removeInjectedTheme(html: string) {
  return html.replace(
    /<style\b[^>]*data-product-kb-theme=["']dark["'][^>]*>[\s\S]*?<\/style>/gi,
    '',
  );
}

function insertAfterLastStyle(html: string, style: string) {
  const closingStyle = /<\/style\s*>/gi;
  let match: RegExpExecArray | null;
  let insertAt = -1;
  let insertLength = 0;

  while ((match = closingStyle.exec(html)) !== null) {
    insertAt = match.index;
    insertLength = match[0].length;
  }

  if (insertAt >= 0) {
    const end = insertAt + insertLength;
    return `${html.slice(0, end)}${style}${html.slice(end)}`;
  }

  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd >= 0) return `${html.slice(0, headEnd)}${style}${html.slice(headEnd)}`;

  const bodyEnd = html.search(/<\/body\s*>/i);
  if (bodyEnd >= 0) return `${html.slice(0, bodyEnd)}${style}${html.slice(bodyEnd)}`;

  return `${html}${style}`;
}

/**
 * Adds or removes the theme override for the self-contained Steam srcDoc.
 * The original HTML is left untouched apart from the generated override style.
 */
export function themeSteamHtml(html: string, theme: SteamTheme) {
  const cleanHtml = removeInjectedTheme(html);
  return theme === 'dark' ? insertAfterLastStyle(cleanHtml, STEAM_DARK_OVERRIDES) : cleanHtml;
}
