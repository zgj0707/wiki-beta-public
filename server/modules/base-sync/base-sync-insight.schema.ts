import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// 机制观察投影：stable_key 为业务唯一键（同步 upsert target）。
export const mechanismObservation = pgTable('mechanism_observation', {
  id: uuid('id').notNull().primaryKey(),
  stableKey: text('stable_key').notNull(),
  entryType: text('entry_type'),
  mechanismTitle: text('mechanism_title'),
  gameName: text('game_name'),
  coreHook: text('core_hook'),
  /**
   * ⚠️ **语义已变更（2026-09-29）：承载 Base「市场认可指数」**（0.70–0.97，两位小数）。
   * 该列原为「可复用公式」，自 2026-09-20 Base 精简起零引用（全仓 grep 无消费方）
   * ⇒ 直接复用承载指数，**免掉一次加列迁移**（同 `mechanism_title` 承载「中文名」的做法）。
   * 列类型仍是 `text`，值为 `'0.93'` 形态；读写口径见本文件 `scoreColumnValue()` /
   * `parseScoreColumn()`（**唯一实现**，两侧都不许再各写一份）。
   */
  genericFormula: text('generic_formula'),
  /**
   * ⚠️ **语义已变更（2026-09-29）：承载 Base「核心创新指数」**（0.09–2.24，两位小数）。
   * 原为「运营阈值」，同样自 2026-09-20 起零引用。其余说明同 `generic_formula`。
   */
  operationThreshold: text('operation_threshold'),
  growthDrive: text('growth_drive'),
  dramaSource: text('drama_source'),
  multiplayerValue: text('multiplayer_value'),
  adMoment: text('ad_moment'),
  buyValue: text('buy_value'),
  visualDegree: text('visual_degree'),
  visualEvidence: text('visual_evidence'),
  reuseNote: text('reuse_note'),
  migrationNote: text('migration_note'),
  trialLoop: text('trial_loop'),
  diffSummary: text('diff_summary'),
  openQuestions: text('open_questions'),
  reviewStatus: text('review_status'),
  sourceStatus: text('source_status'),
  currentPublished: boolean('current_published'),
  sourceVersion: integer('source_version'),
  sourceTitle: text('source_title'),
  sourceLink: text('source_link'),
  sourceDocId: text('source_doc_id'),
  sourceBlockId: text('source_block_id'),
  /**
   * ⚠️ **语义已变更（2026-09-29）**：Base 的「审核时间」列已被删除，本列改承载
   * Base 系统字段「更新时间」（`record.last_modified_time`）⇒ 时间轴从「审核时间」
   * 变为「最后修改时间」（任何字段改动都会刷新）。
   * 列名与列类型保持不变（零 DDL）；对外 DTO 字段已改名为 `updatedAt`，避免
   * 名字与内容不符引发下一次误用。
   */
  reviewTime: timestamp('review_time', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
});

/**
 * 机制观察公开门禁值：审核状态 = 已发布，且 当前发布 = true（见 `MechanismGate`）。
 * 唯一值来源——机制观察页（`InsightService`）与 chat 机制来源
 * （`ChatMechanismSource`）必须同口径，否则会出现「页面上看得见、问答里检索不到」
 * 这类无从排查的问题。
 */
export const MECHANISM_REVIEW_STATUS_PUBLISHED = '已发布';

/**
 * 指数列的**写入**口径：Base 数字列（小数）→ 两位小数文本，非法/空返回 null。
 *
 * 为什么是文本：两个指数复用**已下线的 text 列**（`generic_formula` /
 * `operation_threshold`）承载，零 DDL。排序在**前端**做（列表不接分页参数，
 * 一次取全量），因此不需要 SQL 侧数值排序，文本存储没有排序语义代价。
 *
 * 🔴 与 `parseScoreColumn()` 是同一件事的两端，必须在同一个文件里成对维护。
 */
export function scoreColumnValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  // toFixed 同时完成"归一化"：0.9 与 0.90 入库形态一致，前端排序不会因字符串差异抖动。
  return numeric.toFixed(2);
}

/**
 * 指数列的**读取**口径：两位小数文本 → number，非法/空返回 null。
 * 调用方（`InsightService`）据此下发 number，前端只做数值比较。
 */
export function parseScoreColumn(
  value: string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  // ⚠️ 必须显式挡掉空串：`Number('')` 是 0（有限数），不挡就会把「无分值」
  // 渲染成「0.00 分」并参与排序（0 分是合法值，两者不可混淆）。
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// 实体词典投影：base_record_id 为业务唯一键。
export const entityDictionary = pgTable('entity_dictionary', {
  id: uuid('id').notNull().primaryKey(),
  baseRecordId: text('base_record_id').notNull(),
  entityName: text('entity_name'),
  normalizedName: text('normalized_name'),
  entityType: text('entity_type'),
  aliases: text('aliases'),
  matchRules: text('match_rules'),
  description: text('description'),
  status: text('status'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
});

// 2026-09-21：`content_entity_rel`（文章实体关系投影，Base「文章实体提及」2026-09-11
// 已下线）与 `knowledge_claim`（文章主张投影，Base「文章主张」2026-09-10 已下线）
// 两张表在 server 侧零引用、零读取方，连同线上表一并删除（dev DROP → db-env-migrate）。

export type MechanismObservationRow = typeof mechanismObservation.$inferSelect;
export type EntityDictionaryRow = typeof entityDictionary.$inferSelect;
