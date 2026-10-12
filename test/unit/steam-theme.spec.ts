import {
  STEAM_THEME_STYLE_MARKER,
  themeSteamHtml,
} from '../../client/src/lib/steam-theme';

describe('Steam srcDoc theme conversion', () => {
  const source = '<!doctype html><html><head><style>:root { --bg: #fff; }</style></head><body><main>榜单</main></body></html>';

  it('appends the dark override after the original styles', () => {
    const themed = themeSteamHtml(source, 'dark');
    const originalStyleEnd = themed.indexOf('</style>');
    const injectedStyleStart = themed.indexOf(`${STEAM_THEME_STYLE_MARKER}="dark"`);

    expect(injectedStyleStart).toBeGreaterThan(originalStyleEnd);
    expect(themed).toContain('--bg: #172236');
  });

  it('removes generated overrides when returning to light mode', () => {
    const dark = themeSteamHtml(source, 'dark');
    const light = themeSteamHtml(dark, 'light');

    expect(light).toBe(source);
    expect(light).not.toContain(STEAM_THEME_STYLE_MARKER);
  });

  it('does not duplicate the generated override', () => {
    const themed = themeSteamHtml(themeSteamHtml(source, 'dark'), 'dark');

    expect(themed.match(new RegExp(STEAM_THEME_STYLE_MARKER, 'g'))).toHaveLength(1);
  });
});
