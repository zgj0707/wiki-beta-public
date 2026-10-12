import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  FeishuCredentialService,
  isAccessTokenFailure,
} from '../../common/feishu/feishu-credential.service';
import { syncRunLog } from './base-sync.schema';
import { baseSyncBaseToken } from './base-sync.constants';
import { BaseSyncInsightService } from './base-sync-insight.service';

const REQUEST_TIMEOUT_MS = 10_000;

export type SyncTrigger = 'scheduled' | 'manual';

export interface SyncRunResult {
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
  /**
   * Base 系统字段「修改时间」（epoch 毫秒）。**仅当请求体带
   * `automatic_fields: true` 时才会返回**（官方文档「查询记录」页），
   * 且不能通过 `field_names` 请求（系统字段名报 1254045）。
   */
  last_modified_time?: number;
}

/**
 * 把 Base 返回的记录压成本项目的轻量结构（**唯一转换点**）。
 *
 * 🔴 两条链路（GET records-list 与 POST records/search）都必须走这个函数。
 * 2026-09-29 实测教训：`automatic_fields: true` 明明已发出、接口也确实返回了
 * `last_modified_time`（探针：带该参数 → `1790667321000`，不带 → `undefined`），
 * 但两处手写的 `records.push({ record_id, fields })` 把它丢掉 ⇒
 * **全表 110 条的 `review_time` 被写成 null**，机制页月份筛选与「更新时间」
 * 一起消失。新增系统字段时只要改这一处即可覆盖两条链路。
 */
export function toBitableRecord(item: BitableRecord): BitableRecord | null {
  if (!item || typeof item.record_id !== 'string' || !item.fields) return null;
  const record: BitableRecord = {
    record_id: item.record_id,
    fields: item.fields,
  };
  if (typeof item.last_modified_time === 'number') {
    record.last_modified_time = item.last_modified_time;
  }
  return record;
}

/** 把多维表格字段值统一成可入库的文本，未知结构返回 null。 */
/** Coerce one segment (plain text, url object, or mention) into display text. */
function normalizeTextSegment(segment: unknown): string | null {
  if (typeof segment === 'string') return segment;
  if (segment && typeof segment === 'object') {
    const obj = segment as { text?: unknown; link?: unknown; name?: unknown };
    // URL-typed cells and rich-text url segments: prefer the raw link.
    if (typeof obj.link === 'string' && obj.link) return obj.link;
    if (typeof obj.text === 'string' && obj.text) return obj.text;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
  }
  return null;
}

export function normalizeFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // String arrays (single/multi select) join with a separator; rich-text
    // segment arrays (url cells, styled text) concatenate their text.
    if (value.every((item) => typeof item === 'string')) {
      return value.length ? value.join('、') : null;
    }
    const parts = value
      .map(normalizeTextSegment)
      .filter((item): item is string => item !== null);
    return parts.length ? parts.join('') : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return normalizeTextSegment(value);
}

@Injectable()
export class BaseSyncService {
  private readonly logger = new Logger(BaseSyncService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly credentials: FeishuCredentialService,
    @Inject(forwardRef(() => BaseSyncInsightService))
    private readonly insightSync: BaseSyncInsightService,
  ) {}

  async getStatus(): Promise<{
    lastRun: typeof syncRunLog.$inferSelect | null;
    auth: ReturnType<FeishuCredentialService['getAuthDiagnostics']>;
  }> {
    const rows = await this.db
      .select()
      .from(syncRunLog)
      .orderBy(desc(syncRunLog.startedAt))
      .limit(1);
    return {
      lastRun: rows[0] ?? null,
      auth: this.credentials.getAuthDiagnostics(),
    };
  }

  async run(trigger: SyncTrigger): Promise<SyncRunResult> {
    // Concurrency guard: overlapping cron/webhook triggers would double-fetch
    // and contend on upserts. Skip if another run started recently.
    const recent = await this.db
      .select({ id: syncRunLog.id })
      .from(syncRunLog)
      .where(
        and(
          eq(syncRunLog.status, 'running'),
          gt(
            syncRunLog.startedAt,
            new Date(Date.now() - 10 * 60 * 1000),
          ),
        ),
      )
      .limit(1);
    if (recent.length > 0) {
      this.logger.warn('Skipping sync: another run is still in progress');
      return { status: 'skipped' };
    }
    const startedAt = new Date();
    const [logRow] = await this.db
      .insert(syncRunLog)
      .values({
        id: crypto.randomUUID(),
        trigger,
        status: 'running',
        startedAt,
      })
      .returning({ id: syncRunLog.id });

    try {
      // 文章工作台不再落 PG 镜像：站内阅读全程直读 Base（FeishuBaseReader，60s TTL），
      // 原先写的 `wiki_beta_content` 零读取方 ⇒ 2026-09-21 连同该表一起删除。
      // 本任务只产出「请求时无法现算」的投影：机制观察 + 实体词典。
      //（「文章结构化」「文章主张」已随 Base 精简下线，见 docs/base-slimming-impact.md；
      //  「文章实体提及」已于 2026-09-11 下线，见 snapshots/2026-09-11-mention-table/）。
      const insightCounts = await this.insightSync.syncInsightTables();
      this.logger.log(
        `Insight sync counts: mechanisms=${insightCounts.mechanisms}, entities=${insightCounts.entities}`,
      );
      const finishedAt = new Date();
      if (logRow) {
        await this.db
          .update(syncRunLog)
          .set({ status: 'success', finishedAt })
          .where(eq(syncRunLog.id, logRow.id));
      }
      return { status: 'success' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (logRow) {
        await this.db
          .update(syncRunLog)
          .set({ status: 'failed', error: message, finishedAt: new Date() })
          .where(eq(syncRunLog.id, logRow.id))
          .catch(() => undefined);
      }
      this.logger.error(`Base sync failed: ${message}`);
      throw error;
    }
  }

  /**
   * Fallback reader using the GET records-list API. Some tables (e.g. large
   * relation tables) intermittently fail on records/search with 1255002; the
   * list endpoint returns all fields and is stable for the same scope.
   */
  async listAllRecords(
    tableId: string,
    pageSize = 100,
  ): Promise<BitableRecord[]> {
    const accessToken = await this.credentials.getAccessToken();
    if (isAccessTokenFailure(accessToken)) {
      throw new Error(`FEISHU_AUTH_FAILED:${accessToken.errorCode}`);
    }
    const token = accessToken.token;
    const url = `${FeishuCredentialService.feishuBaseUrl()}/open-apis/bitable/v1/apps/${encodeURIComponent(baseSyncBaseToken())}/tables/${encodeURIComponent(tableId)}/records`;

    const records: BitableRecord[] = [];
    let pageToken: string | undefined;
    do {
      const requestUrl = new URL(url);
      requestUrl.searchParams.set('page_size', String(pageSize));
      if (pageToken) requestUrl.searchParams.set('page_token', pageToken);
      let response: Response | undefined;
      // 单次网络抖动或超时会中断整条同步（实测约 1/3 的触发因此失败），
      // 故按 0s / 2s / 5s 退避重试；4xx 与业务错误码不在此重试范围。
      for (const delayMs of [0, 2_000, 5_000]) {
        if (delayMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        try {
          const attemptResponse = await fetch(requestUrl, {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          // 5xx 视为瞬时故障，退避后重试；其余状态码交由下方统一处理。
          if (attemptResponse.status >= 500) continue;
          response = attemptResponse;
          break;
        } catch {
          // 网络错误/超时：退避重试，三次仍失败则放弃。
        }
      }
      if (!response) {
        throw new Error('FEISHU_RECORDS_LIST_NETWORK_ERROR');
      }
      if (!response.ok) {
        throw new Error(`FEISHU_RECORDS_LIST_HTTP_${response.status}`);
      }
      let payload: {
        code?: number;
        msg?: string;
        data?: {
          items?: BitableRecord[];
          has_more?: boolean;
          page_token?: string;
        };
      };
      try {
        payload = await response.json();
      } catch {
        throw new Error('FEISHU_RECORDS_LIST_INVALID_RESPONSE');
      }
      if (typeof payload.code === 'number' && payload.code !== 0) {
        throw new Error(
          `FEISHU_RECORDS_LIST_API_${payload.code}:${String(
            payload.msg ?? '',
          ).slice(0, 200)}`,
        );
      }
      for (const item of payload.data?.items ?? []) {
        const record = toBitableRecord(item);
        if (record) records.push(record);
      }
      pageToken =
        payload.data?.has_more && typeof payload.data.page_token === 'string'
          ? payload.data.page_token
          : undefined;
    } while (pageToken);
    return records;
  }

  async fetchAllRecords(
    tableId: string,
    fieldNames: string[],
    options: { pageSize?: number } = {},
  ): Promise<BitableRecord[]> {
    const pageSize = options.pageSize ?? 500;
    const attempt = (names: string[] = fieldNames): Promise<BitableRecord[]> =>
      this.searchRecords(tableId, names, pageSize);
    try {
      return await attempt();
    } catch (err) {
      const message = String((err as Error).message ?? '');
      if (message.includes('1254045') && fieldNames.length > 1) {
        // FieldNameNotFound: probe each field (single-field request) so the
        // offending names are logged and excluded, keeping the sync alive.
        const bad: string[] = [];
        for (const field of fieldNames) {
          try {
            await this.searchRecords(tableId, [field], 1);
          } catch (probeErr) {
            if (String((probeErr as Error).message).includes('1254045')) {
              bad.push(field);
            } else {
              throw probeErr;
            }
          }
        }
        const usable = fieldNames.filter((field) => !bad.includes(field));
        this.logger.warn(
          `Bitable ${tableId} has unknown field names ${JSON.stringify(
            bad,
          )}; retrying with ${usable.length} fields`,
        );
        if (!usable.length) throw err;
        // 重试必须用剔除后的字段列表：沿用原始 fieldNames 会原样再报一次
        // 1254045，使降级逻辑完全失效（曾导致整条同步因单个字段漂移而中断）。
        return await attempt(usable);
      }
      // Transient Feishu-side errors (1255002 internal, 1254290 throttling):
      // retry the whole paged fetch twice with backoff.
      if (message.includes('1255002') || message.includes('1254290')) {
        let lastError: unknown = err;
        for (const delayMs of [2_000, 5_000]) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try {
            return await attempt();
          } catch (retryErr) {
            lastError = retryErr;
          }
        }
        throw lastError;
      }
      throw err;
    }
  }

  private async searchRecords(
    tableId: string,
    fieldNames: string[],
    pageSize: number,
  ): Promise<BitableRecord[]> {
    const accessToken = await this.credentials.getAccessToken();
    if (isAccessTokenFailure(accessToken)) {
      throw new Error(`FEISHU_AUTH_FAILED:${accessToken.errorCode}`);
    }
    const token = accessToken.token;
    const url = `${FeishuCredentialService.feishuBaseUrl()}/open-apis/bitable/v1/apps/${encodeURIComponent(baseSyncBaseToken())}/tables/${encodeURIComponent(tableId)}/records/search`;

    const records: BitableRecord[] = [];
    let pageToken: string | undefined;
    do {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            field_names: fieldNames,
            // 让记录级带上 `last_modified_time`（Base 系统「更新时间」）。
            // 系统字段不能出现在 field_names 里（1254045），只能靠这个开关取回。
            automatic_fields: true,
            page_size: pageSize,
            ...(pageToken ? { page_token: pageToken } : {}),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new Error('FEISHU_RECORDS_SEARCH_NETWORK_ERROR');
      }
      if (!response.ok) {
        let detail = '';
        try {
          const errPayload = (await response.json()) as {
            code?: unknown;
            msg?: unknown;
          };
          detail = `:${String(errPayload.code ?? '')}:${String(
            errPayload.msg ?? '',
          ).slice(0, 120)}`;
        } catch {
          detail = ':body_unreadable';
        }
        throw new Error(
          `FEISHU_RECORDS_SEARCH_HTTP_${response.status}${detail}`,
        );
      }
      let payload: {
        code?: number;
        msg?: string;
        data?: {
          items?: BitableRecord[];
          has_more?: boolean;
          page_token?: string;
        };
      };
      try {
        payload = await response.json();
      } catch {
        throw new Error('FEISHU_RECORDS_SEARCH_INVALID_RESPONSE');
      }
      if (typeof payload.code === 'number' && payload.code !== 0) {
        throw new Error(
          `FEISHU_RECORDS_SEARCH_API_${payload.code}:${String(
            payload.msg ?? '',
          ).slice(0, 200)}`,
        );
      }
      const items = payload.data?.items ?? [];
      for (const item of items) {
        const record = toBitableRecord(item);
        if (record) records.push(record);
      }
      if (payload.data?.has_more && typeof payload.data.page_token === 'string') {
        pageToken = payload.data.page_token;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);
    return records;
  }
}
