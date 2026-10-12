import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  chatIpUsage,
  chatIpUsageDaily,
  type ChatIpUsageRow,
} from './chat-ip-usage.schema';
import { shanghaiDateString } from './chat-daily-limit';

const MAX_NOTE_LENGTH = 500;
const LIST_LIMIT = 500;

/** 监控台列表行（时间序列化为 ISO 字符串）。 */
export interface ChatIpUsageItem {
  ip: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  note: string | null;
  /** 日限额豁免（迁移 035）。 */
  whitelisted: boolean;
  /** 单 IP 日限额覆盖；null = 用全局默认。 */
  dailyLimitOverride: number | null;
  /** 当日（Asia/Shanghai）请求次数；列表接口联查 daily 表回填。 */
  todayCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** 监控台「日榜」行：某归账日的按 IP 用量。 */
export interface ChatIpUsageDailyItem {
  ip: string;
  usageDate: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  lastSeenAt: string;
}

/**
 * 站点默认 key 的按 IP 用量台账（迁移 034）+ 按日台账与日限额判定（迁移 035）。
 *
 * 记账规则（与控制器约定）：
 *  - 只有**消耗站点 key** 的请求才入账（BYO-Key 不记）；
 *  - 请求进入时 `recordRequest` 计数 +1（累计表与当日表同时落，含被限额
 *    拒绝的 attempt）；usage 事件到达时 `addTokens` 补加真实 token ——
 *    断连请求保留计数、token 不虚增；
 *  - 台账写入失败只告警，绝不影响问答主链路。
 */
@Injectable()
export class ChatIpUsageService {
  private readonly logger = new Logger(ChatIpUsageService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 请求进入时调用：累计表与当日表各计数 +1 并推进 last_seen。 */
  async recordRequest(ip: string): Promise<void> {
    const now = new Date();
    try {
      await this.db
        .insert(chatIpUsage)
        .values({ ip, requestCount: 1, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: chatIpUsage.ip,
          set: {
            requestCount: sql`${chatIpUsage.requestCount} + 1`,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
    } catch (error) {
      this.logger.warn(
        `ip usage recordRequest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.recordDailyRequest(ip, now);
  }

  /** 当日表计数 +1；失败只告警（限额判定随后读取，少记一次属可接受误差）。 */
  private async recordDailyRequest(ip: string, now: Date): Promise<void> {
    const usageDate = shanghaiDateString(now);
    try {
      await this.db
        .insert(chatIpUsageDaily)
        .values({
          ip,
          usageDate,
          requestCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [chatIpUsageDaily.ip, chatIpUsageDaily.usageDate],
          set: {
            requestCount: sql`${chatIpUsageDaily.requestCount} + 1`,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
    } catch (error) {
      this.logger.warn(
        `ip usage recordDailyRequest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 读取某 IP 的日限额判定输入：白名单 / 单 IP 覆盖 / 当日计数。
   * 累计表行可能不存在（首个请求并发间隙），全部给中性默认值。
   */
  async getDailyState(ip: string): Promise<{
    whitelisted: boolean;
    dailyLimitOverride: number | null;
    todayCount: number;
  }> {
    const usageDate = shanghaiDateString(new Date());
    const [usageRows, dailyRows] = await Promise.all([
      this.db
        .select({
          whitelisted: chatIpUsage.whitelisted,
          dailyLimitOverride: chatIpUsage.dailyLimitOverride,
        })
        .from(chatIpUsage)
        .where(eq(chatIpUsage.ip, ip))
        .limit(1),
      this.db
        .select({ requestCount: chatIpUsageDaily.requestCount })
        .from(chatIpUsageDaily)
        .where(
          and(
            eq(chatIpUsageDaily.ip, ip),
            eq(chatIpUsageDaily.usageDate, usageDate),
          ),
        )
        .limit(1),
    ]);
    return {
      whitelisted: usageRows[0]?.whitelisted ?? false,
      dailyLimitOverride: usageRows[0]?.dailyLimitOverride ?? null,
      todayCount: dailyRows[0]?.requestCount ?? 0,
    };
  }

  /** usage 事件到达时调用：累加真实 token 消耗（累计表 + 当日表）。 */
  async addTokens(
    ip: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
      return;
    }
    const now = new Date();
    const prompt = Math.max(0, Math.floor(promptTokens));
    const completion = Math.max(0, Math.floor(completionTokens));
    try {
      await this.db
        .insert(chatIpUsage)
        .values({
          ip,
          requestCount: 0,
          promptTokens: prompt,
          completionTokens: completion,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: chatIpUsage.ip,
          set: {
            promptTokens: sql`${chatIpUsage.promptTokens} + ${prompt}`,
            completionTokens: sql`${chatIpUsage.completionTokens} + ${completion}`,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
    } catch (error) {
      this.logger.warn(
        `ip usage addTokens failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const usageDate = shanghaiDateString(now);
    try {
      await this.db
        .insert(chatIpUsageDaily)
        .values({
          ip,
          usageDate,
          requestCount: 0,
          promptTokens: prompt,
          completionTokens: completion,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [chatIpUsageDaily.ip, chatIpUsageDaily.usageDate],
          set: {
            promptTokens: sql`${chatIpUsageDaily.promptTokens} + ${prompt}`,
            completionTokens: sql`${chatIpUsageDaily.completionTokens} + ${completion}`,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
    } catch (error) {
      this.logger.warn(
        `ip usage addTokensDaily failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 监控台列表：最近活跃在前，并联查当日计数与限额属性。 */
  async list(): Promise<ChatIpUsageItem[]> {
    const usageDate = shanghaiDateString(new Date());
    const dailyRows = await this.db
      .select({
        ip: chatIpUsageDaily.ip,
        requestCount: chatIpUsageDaily.requestCount,
      })
      .from(chatIpUsageDaily)
      .where(eq(chatIpUsageDaily.usageDate, usageDate));
    const todayByIp = new Map(dailyRows.map((row) => [row.ip, row.requestCount]));
    const rows = await this.db
      .select()
      .from(chatIpUsage)
      .orderBy(desc(chatIpUsage.lastSeenAt))
      .limit(LIST_LIMIT);
    return rows.map((row) => ({
      ...toItem(row),
      whitelisted: row.whitelisted,
      dailyLimitOverride: row.dailyLimitOverride,
      todayCount: todayByIp.get(row.ip) ?? 0,
    }));
  }

  /** 监控台「日榜」：某归账日的按 IP 用量，请求次数降序。 */
  async listDaily(date?: string): Promise<ChatIpUsageDailyItem[]> {
    const usageDate = date ?? shanghaiDateString(new Date());
    const rows = await this.db
      .select()
      .from(chatIpUsageDaily)
      .where(eq(chatIpUsageDaily.usageDate, usageDate))
      .orderBy(desc(chatIpUsageDaily.requestCount))
      .limit(LIST_LIMIT);
    return rows.map((row) => ({
      ip: row.ip,
      usageDate: row.usageDate,
      requestCount: row.requestCount,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      lastSeenAt: row.lastSeenAt.toISOString(),
    }));
  }

  /**
   * 白名单开关。行不存在时先补一行零用量记录（监控台可对尚未提问的 IP 预设豁免）。
   * 返回 false = 更新 0 行（理论上仅发生在补行也失败，调用方提示重试）。
   */
  async setWhitelisted(ip: string, whitelisted: boolean): Promise<boolean> {
    const now = new Date();
    try {
      const updated = await this.db
        .update(chatIpUsage)
        .set({ whitelisted, updatedAt: now })
        .where(eq(chatIpUsage.ip, ip))
        .returning({ id: chatIpUsage.id });
      if (updated.length > 0) return true;
      await this.db
        .insert(chatIpUsage)
        .values({ ip, whitelisted, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: chatIpUsage.ip,
          set: { whitelisted, updatedAt: now },
        });
      return true;
    } catch (error) {
      this.logger.warn(
        `ip usage setWhitelisted failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** 行内备注编辑；行不存在返回 false（监控台提示刷新）。 */
  async updateNote(ip: string, note: string | null): Promise<boolean> {
    const trimmed = note?.slice(0, MAX_NOTE_LENGTH).trim() || null;
    const now = new Date();
    const updated = await this.db
      .update(chatIpUsage)
      .set({ note: trimmed, updatedAt: now })
      .where(eq(chatIpUsage.ip, ip))
      .returning({ id: chatIpUsage.id });
    return updated.length > 0;
  }

  /**
   * 单 IP 日限额覆盖（迁移 035 `daily_limit_override` 列，零 DDL 复用）。
   * limit=null 恢复跟随全局默认；行不存在时补零用量行（可对未提问 IP 预设）。
   */
  async setDailyLimitOverride(
    ip: string,
    limit: number | null,
  ): Promise<boolean> {
    const now = new Date();
    try {
      const updated = await this.db
        .update(chatIpUsage)
        .set({ dailyLimitOverride: limit, updatedAt: now })
        .where(eq(chatIpUsage.ip, ip))
        .returning({ id: chatIpUsage.id });
      if (updated.length > 0) return true;
      await this.db
        .insert(chatIpUsage)
        .values({
          ip,
          dailyLimitOverride: limit,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: chatIpUsage.ip,
          set: { dailyLimitOverride: limit, updatedAt: now },
        });
      return true;
    } catch (error) {
      this.logger.warn(
        `ip usage setDailyLimitOverride failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

function toItem(row: ChatIpUsageRow): ChatIpUsageItem {
  return {
    ip: row.ip,
    requestCount: row.requestCount,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    note: row.note,
    whitelisted: false,
    dailyLimitOverride: null,
    todayCount: 0,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
