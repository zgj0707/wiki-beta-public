import { withClientBasePath } from '@client/src/lib/base-path';

// ── AI 监控台（/admin/ai-usage，管理员专用）────────────────────────
// 后端：server/modules/chat/chat-admin.controller.ts。Cookie 鉴权
// （HttpOnly 签名），fetch 同源默认带 Cookie，无需额外凭据处理。

/** 监控面状态：enabled=false 表示服务端未配置管理密码。 */
export interface ChatAdminStatus {
  enabled: boolean;
}

export interface ChatIpUsageItem {
  ip: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  note: string | null;
  /** 日限额豁免（迁移 035）。 */
  whitelisted: boolean;
  /** 单 IP 日限额覆盖；null = 全局默认。 */
  dailyLimitOverride: number | null;
  /** 当日（Asia/Shanghai）请求次数。 */
  todayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export class ChatAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 🔴 所有请求（GET 也算）必须带妙搭网关 CSRF 头，否则被网关 403（2026-10-09 教训，
    // 与 chat.ts llm-default 同坑）；同源 fetch 默认带 Cookie。
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const csrf = readCsrfToken();
  if (csrf) headers.set('X-Suda-Csrf-Token', csrf);
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(withClientBasePath(path), {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // 保留 HTTP 状态码文案
    }
    throw new ChatAdminError(message, response.status);
  }
  return (await response.json()) as T;
}

function readCsrfToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = (window as Window & { csrfToken?: unknown }).csrfToken;
  return typeof token === 'string' && token ? token : null;
}

/** 管理面是否已启用（服务端配置了密码哈希）。 */
export function chatAdminStatus(): Promise<ChatAdminStatus> {
  return request<ChatAdminStatus>('/api/chat-admin/status');
}

/** 登录；密码错误抛 401。 */
export function chatAdminLogin(password: string): Promise<{ ok: true }> {
  return request('/api/chat-admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

/** 注销（清 Cookie）。 */
export function chatAdminLogout(): Promise<{ ok: true }> {
  return request('/api/chat-admin/logout', { method: 'POST' });
}

/** 按 IP 用量列表（最近活跃在前）。401 = 未登录/会话过期。 */
export function chatAdminUsage(): Promise<{ items: ChatIpUsageItem[] }> {
  return request('/api/chat-admin/usage');
}

/** 更新某 IP 的运营备注。 */
export function chatAdminUpdateNote(
  ip: string,
  note: string | null,
): Promise<{ ok: true }> {
  return request('/api/chat-admin/usage/note', {
    method: 'PUT',
    body: JSON.stringify({ ip, note }),
  });
}

/** 日限额白名单开关（行不存在时服务端补零用量行）。 */
export function chatAdminSetWhitelisted(
  ip: string,
  whitelisted: boolean,
): Promise<{ ok: true }> {
  return request('/api/chat-admin/usage/whitelist', {
    method: 'PUT',
    body: JSON.stringify({ ip, whitelisted }),
  });
}

/** 单 IP 日限额覆盖；limit=null 恢复跟随全局默认。 */
export function chatAdminSetDailyLimit(
  ip: string,
  limit: number | null,
): Promise<{ ok: true }> {
  return request('/api/chat-admin/usage/limit', {
    method: 'PUT',
    body: JSON.stringify({ ip, limit }),
  });
}

/** 日榜行：某归账日的按 IP 用量。 */
export interface ChatIpUsageDailyItem {
  ip: string;
  usageDate: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  lastSeenAt: string;
}

/** 日榜：某归账日（默认今天）的按 IP 用量，次数降序。 */
export function chatAdminUsageDaily(
  date?: string,
): Promise<{ items: ChatIpUsageDailyItem[] }> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return request(`/api/chat-admin/usage/daily${qs}`);
}
