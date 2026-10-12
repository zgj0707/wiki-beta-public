import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// 按 IP 用量台账映射（迁移：scripts/migrations/034_chat_ip_usage.sql）。
//
// 与同目录其它 *schema.ts 一致：只映射业务列，`_created_*` 不进入映射；
// `_updated_at` 在 upsert 中显式推进（默认值只在 INSERT 生效）。

export const chatIpUsage = pgTable(
  'chat_ip_usage',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    /** 客户端 IP（ChatController.resolveIp 同源口径），唯一业务键。 */
    ip: varchar('ip', { length: 64 }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    /** 运营备注：内部同事 / 已知爬虫 / 已沟通用户等。 */
    note: text('note'),
    /** 日限额豁免（迁移 035）：监控台开关，true = 不参与按日限额。 */
    whitelisted: boolean('whitelisted').notNull().default(false),
    /** 单 IP 日限额覆盖（迁移 035）；NULL = 用全局默认（CHAT_DAILY_LIMIT）。 */
    dailyLimitOverride: integer('daily_limit_override'),
    firstSeenAt: timestamp('first_seen_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('chat_ip_usage_ip_uidx').on(table.ip),
    index('chat_ip_usage_last_seen_idx').on(table.lastSeenAt),
  ],
);

/**
 * 按 IP × 日的用量台账（迁移 035_chat_daily_limit）：日限额的判定数据源。
 * 与上面的累计表分工：累计表回答「这个 IP 一共花了多少」，本表回答「今天用了多少」。
 */
export const chatIpUsageDaily = pgTable(
  'chat_ip_usage_daily',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    ip: varchar('ip', { length: 64 }).notNull(),
    /** 归账日（Asia/Shanghai 日界，应用侧算好 YYYY-MM-DD）。 */
    usageDate: date('usage_date').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    firstSeenAt: timestamp('first_seen_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('chat_ip_usage_daily_ip_day_uidx').on(
      table.ip,
      table.usageDate,
    ),
    index('chat_ip_usage_daily_date_idx').on(table.usageDate),
  ],
);

export type ChatIpUsageRow = typeof chatIpUsage.$inferSelect;
export type ChatIpUsageInsert = typeof chatIpUsage.$inferInsert;
export type ChatIpUsageDailyRow = typeof chatIpUsageDaily.$inferSelect;
