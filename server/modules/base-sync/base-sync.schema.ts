import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// sync_run_log：同步执行日志
//
// 注：`structure_count` 列保留（历史数据可查），但「文章结构化」表已于
// 2026-09-10 随 Base 精简下线，该列不再写入新值。
export const syncRunLog = pgTable('sync_run_log', {
  id: uuid('id').notNull().primaryKey(),
  trigger: text('trigger').notNull(), // 'scheduled' | 'manual'
  status: text('status').notNull(), // 'running' | 'success' | 'failed'
  directoryCount: integer('directory_count'),
  structureCount: integer('structure_count'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
    .notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
});

export type SyncRunLogRow = typeof syncRunLog.$inferSelect;
