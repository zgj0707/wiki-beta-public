import { withClientBasePath } from '@client/src/lib/base-path';

type BackendRequestConfig = {
  url: string;
  method?: string;
  data?: unknown;
  headers?: HeadersInit;
  params?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
};

export interface BackendResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: BackendRequestConfig;
}

interface BackendHttpError extends Error {
  response: BackendResponse<unknown>;
  config: BackendRequestConfig;
}

/**
 * Public list responses carry a short browser cache window for normal
 * navigation. Mutations invalidate the React Query entry, so the follow-up
 * read must revalidate that browser entry instead of reusing the old snapshot.
 * The server can still answer with 304 when its ETag is unchanged.
 */
export const PUBLIC_READ_REVALIDATION_CONFIG = {
  headers: { 'Cache-Control': 'no-cache' },
} as const;

/**
 * Public reads use the same-origin fetch boundary. The management runtime keeps
 * the platform toolkit for its own container and error surface, while public
 * pages only need the app base path, CSRF header, and JSON response contract.
 */
export async function backendRequest<T>(
  config: BackendRequestConfig,
): Promise<BackendResponse<T>> {
  const headers = new Headers(config.headers);
  headers.set('Accept', 'application/json');
  const csrfToken = readCsrfToken();
  if (csrfToken) headers.set('X-Suda-Csrf-Token', csrfToken);
  if (typeof window !== 'undefined' && window.location?.pathname) {
    headers.set('X-Page-Route', window.location.pathname);
  }

  const url = appendParams(resolveUrl(config.url), config.params);
  const body = serializeBody(config.data, headers);
  let response: Response;
  try {
    response = await fetch(url, {
      method: config.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body,
      signal: config.signal,
    });
  } catch (cause) {
    const error = new Error('Network request failed') as BackendHttpError & {
      cause?: unknown;
    };
    error.cause = cause;
    error.config = config;
    throw error;
  }

  const result: BackendResponse<T> = {
    data: await readResponseData<T>(response),
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config,
  };
  if (!response.ok) {
    const error = new Error(
      `Request failed with status code ${response.status}`,
    ) as BackendHttpError;
    error.response = result as BackendResponse<unknown>;
    error.config = config;
    throw error;
  }
  return result;
}

export async function backendGet<T>(
  url: string,
  config?: Omit<BackendRequestConfig, 'url' | 'method'>,
): Promise<T> {
  const request = () =>
    backendRequest<T>({
      ...config,
      url,
      method: 'GET',
    });
  const response = await request();
  // A cold Miaoda runtime can briefly answer a list endpoint with `{}` while
  // its backend container is waking. Retry that known-invalid shape once;
  // empty arrays and null remain legal responses and are never retried.
  if (
    response.data !== null &&
    typeof response.data === 'object' &&
    !Array.isArray(response.data) &&
    Object.keys(response.data as object).length === 0
  ) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
    return (await request()).data;
  }
  return response.data;
}

function readCsrfToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = (window as Window & { csrfToken?: unknown }).csrfToken;
  return typeof token === 'string' && token ? token : null;
}

function resolveUrl(url: string): string {
  return /^https?:\/\//iu.test(url) ? url : withClientBasePath(url);
}

function appendParams(
  url: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params) return url;
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const queryString = query.toString();
  if (!queryString) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

function serializeBody(data: unknown, headers: Headers): BodyInit | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return data;
  if (typeof FormData !== 'undefined' && data instanceof FormData) return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams)
    return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
    return data as BodyInit;
  headers.set('Content-Type', 'application/json');
  return JSON.stringify(data);
}

async function readResponseData<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
