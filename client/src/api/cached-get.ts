import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

/**
 * GET 请求统一入口：内存 TTL 缓存 + 并发去重 + 冷启动空响应重试。
 *
 * 适用范围：公开页高频读接口（列表/统计/聚合）。需要强实时的接口
 * （详情、审核队列、管理端读取）继续直调 axiosForBackend，不经过本模块。
 */

const DEFAULT_TTL = 60_000;
const EMPTY_RETRY_DELAY_MS = 800;

/** 按 URL 前缀覆盖默认 TTL；最长前缀优先匹配（D4 保守方案：facets 聚合 120s，详情类 300s，其余走默认 60s）。 */
const TTL_OVERRIDES: Array<{ prefix: string; ttl: number }> = [
  { prefix: '/api/articles/facets', ttl: 120_000 },
  { prefix: '/detail', ttl: 300_000 },
];

function resolveTtl(key: string): number {
  let best: { prefix: string; ttl: number } | undefined;
  for (const rule of TTL_OVERRIDES) {
    if (key.startsWith(rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) {
      best = rule;
    }
  }
  return best ? best.ttl : DEFAULT_TTL;
}

// 项目未引入 vite/client 类型声明，这里用局部断言读取环境标识，避免污染全局 ImportMeta
const isDev =
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;
let hitCount = 0;
let missCount = 0;

type Entry = { at: number; data: unknown };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function isEmptyPayload(data: unknown): boolean {
  if (data == null) return true;
  if (typeof data === 'string') return data.trim() === '';
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.keys(data as object).length === 0;
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce(url: string): Promise<unknown> {
  const { data } = await axiosForBackend({ url, method: 'GET' });
  return data;
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < resolveTtl(url)) {
    hitCount++;
    if (isDev) {
      logger.debug(`[cached-get] hit: ${hitCount}/${hitCount + missCount} ${url}`);
    }
    return hit.data as T;
  }

  missCount++;
  if (isDev) {
    logger.debug(`[cached-get] miss(${hitCount}/${hitCount + missCount}): ${url}`);
  }

  // 并发去重：同一 URL 的在途请求直接复用
  const running = inflight.get(url);
  if (running) return running as Promise<T>;

  const task = (async () => {
    try {
      let data = await requestOnce(url);
      if (isEmptyPayload(data)) {
        // 妙搭冷启动首包可能为空：延迟后重试一次（此前各页面散落 refreshKey hack 的统一替代）
        await sleep(EMPTY_RETRY_DELAY_MS);
        data = await requestOnce(url);
      }
      cache.set(url, { at: Date.now(), data });
      return data as T;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, task);
  return task;
}

/** 手动失效：删除缓存中所有以 prefix 开头的 key（收藏/审核等变更后刷新用）。 */
export function invalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** 变更类操作后按 URL 前缀失效缓存；不传前缀则全清。 */
export function invalidateApiGetCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  invalidate(prefix);
}
