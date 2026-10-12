function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/u, '') || '/';
}

function readConfiguredBasePath(): string | undefined {
  const viteEnv = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;
  if (viteEnv?.CLIENT_BASE_PATH) return viteEnv.CLIENT_BASE_PATH;
  if (typeof process !== 'undefined' && process.env?.CLIENT_BASE_PATH) {
    return process.env.CLIENT_BASE_PATH;
  }
  return undefined;
}

function deriveBasePath(): string {
  if (typeof window === 'undefined') return '/';
  return normalizeBasePath(
    window.location.pathname.match(/^\/app\/[^/]+/u)?.[0],
  );
}

const configuredBasePath = normalizeBasePath(readConfiguredBasePath());

/** Use the explicit build setting, with a safe /app/:appId deep-link fallback. */
export const CLIENT_BASE_PATH =
  configuredBasePath === '/' ? deriveBasePath() : configuredBasePath;

export function withClientBasePath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (CLIENT_BASE_PATH === '/') return normalizedPath;
  return normalizedPath === '/'
    ? `${CLIENT_BASE_PATH}/`
    : `${CLIENT_BASE_PATH}${normalizedPath}`;
}
