import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import type { ChatFeedbackAttribution } from './chat-feedback-attribution';

// 问答反馈表映射（迁移：scripts/migrations/033_chat_feedback.sql）。
//
// 与同目录其它 *schema.ts 一致：只映射业务列，`_created_*` 不进入映射（数据库默认值
// 维护）；`_updated_at` 例外 —— upsert 改单时必须显式推进，否则默认值只在 INSERT 生效。
// 列长度与 CHECK 约束在数据库侧定义，这里用 text / varchar 承接以免与 DDL 漂移。

/** 单条引用快照。`url` 必须保留 —— 「引用打不开」的归因证据就在它上面。 */
export interface ChatFeedbackCitation {
  docId: string;
  title: string;
  source: string;
  sourceDate: string | null;
  url: string;
}

/**
 * 信号快照。`snippetLens` 是片段长度数组而非片段正文：判断是否顶格
 * SNIPPET_TOTAL(1800) 只需长度；要修片段层时凭 citations[].docId 事后重取即可。
 */
export interface ChatFeedbackContext {
  external: boolean;
  truncated: boolean;
  stopped: boolean;
  deep: boolean;
  historyTurns: number;
  snippetLens: number[];
  model: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export const chatFeedback = pgTable(
  'chat_feedback',
  {
    id: uuid('id').notNull().primaryKey(),
    /** 前端为每轮问答生成的 uuid：唯一键 + upsert = 幂等 + 可改单。 */
    turnId: varchar('turn_id', { length: 64 }).notNull(),
    rating: varchar('rating', { length: 10 }).notNull(),
    reason: varchar('reason', { length: 30 }),
    /** 用户原始输入（非改写后的检索词）。 */
    question: text('question'),
    /** 改写后的检索词；与 question 语义漂移即可定位「查询改写带偏」。 */
    searchQuery: text('search_query'),
    answer: text('answer'),
    citations: jsonb('citations').$type<ChatFeedbackCitation[]>(),
    context: jsonb('context').$type<ChatFeedbackContext>(),
    attribution: varchar('attribution', { length: 20 }).$type<ChatFeedbackAttribution>(),
    /** boundary = 已知边界，不计入缺陷池。 */
    status: varchar('status', { length: 20 }).notNull(),
    resolutionNote: text('resolution_note'),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('chat_feedback_turn_uidx').on(table.turnId),
    index('chat_feedback_triage_idx').on(
      table.status,
      table.attribution,
      table.updatedAt,
    ),
  ],
);

export type ChatFeedbackRow = typeof chatFeedback.$inferSelect;
export type ChatFeedbackInsert = typeof chatFeedback.$inferInsert;

export const CHAT_FEEDBACK_RATING_UP = 'up';
export const CHAT_FEEDBACK_RATING_DOWN = 'down';
export const CHAT_FEEDBACK_STATUS_NEW = 'new';
/** 已知边界：不计入缺陷池（如机制条目本身不含完整正文）。 */
export const CHAT_FEEDBACK_STATUS_BOUNDARY = 'boundary';
