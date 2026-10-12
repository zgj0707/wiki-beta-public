import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// AI 编译层派生表映射（迁移：scripts/migrations/031_ai_compile_layer.sql）。
//
// 与同目录其它 *schema.ts 一致：只映射业务列，`_created_*` / `_updated_*` 由数据库
// 默认值维护，不进入 Drizzle 映射。列长度与 CHECK 约束在数据库侧定义，这里用
// text / varchar 承接以免与 DDL 漂移。
//
// ⚠️ 本层是**派生层**：Base 仍是人工 SSOT，本层产物带 status='draft'。
// 与同步链路的 knowledge_* 表彻底隔离，禁止互相读写。

/** 编译产物主体。(subject_type, subject_id, model_fingerprint) 唯一。 */
export const aiCompileUnit = pgTable(
  'ai_compile_unit',
  {
    id: uuid('id').notNull().primaryKey(),
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    subjectId: varchar('subject_id', { length: 255 }).notNull(),
    subjectSlug: varchar('subject_slug', { length: 255 }).notNull(),
    subjectName: varchar('subject_name', { length: 255 }).notNull(),
    inputHash: varchar('input_hash', { length: 120 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 20 }).notNull(),
    modelFingerprint: varchar('model_fingerprint', { length: 120 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    headline: text('headline').notNull(),
    summaryMd: text('summary_md'),
    confidence: varchar('confidence', { length: 10 }).notNull(),
    sourceCount: integer('source_count').notNull(),
    sourceSpanStart: varchar('source_span_start', { length: 40 }),
    sourceSpanEnd: varchar('source_span_end', { length: 40 }),
    gapsJson: jsonb('gaps_json').notNull(),
    conflictJson: jsonb('conflict_json').notNull(),
    estTokensLow: integer('est_tokens_low'),
    estTokensHigh: integer('est_tokens_high'),
    actualPromptTokens: integer('actual_prompt_tokens'),
    actualCompletionTokens: integer('actual_completion_tokens'),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    generatedBy: varchar('generated_by', { length: 120 }),
    adoptedAt: timestamp('adopted_at', { withTimezone: true, mode: 'date' }),
    adoptedBy: varchar('adopted_by', { length: 120 }),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_compile_unit_identity_uidx').on(
      table.subjectType,
      table.subjectId,
      table.modelFingerprint,
    ),
    index('ai_compile_unit_slug_idx').on(
      table.subjectSlug,
      table.modelFingerprint,
    ),
    index('ai_compile_unit_recent_idx').on(table.generatedAt),
  ],
);

/** 结论条目。dropped=true 的行是引用越界被代码丢弃的留痕。 */
export const aiCompileClaim = pgTable(
  'ai_compile_claim',
  {
    id: uuid('id').notNull().primaryKey(),
    unitId: uuid('unit_id').notNull(),
    claimText: text('claim_text').notNull(),
    claimType: varchar('claim_type', { length: 20 }).notNull(),
    sourceDocIds: jsonb('source_doc_ids').notNull(),
    sourceQuote: text('source_quote'),
    sortOrder: integer('sort_order').notNull(),
    dropped: boolean('dropped').notNull().default(false),
    dropReason: varchar('drop_reason', { length: 80 }),
    createdAt: timestamp('_created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('ai_compile_claim_unit_idx').on(table.unitId, table.sortOrder)],
);

/** 证据来源（字段取自 entity_doc_cache 快照，零额外读 Base）。 */
export const aiCompileEvidence = pgTable(
  'ai_compile_evidence',
  {
    id: uuid('id').notNull().primaryKey(),
    unitId: uuid('unit_id').notNull(),
    docId: varchar('doc_id', { length: 255 }).notNull(),
    title: text('title'),
    sourceDate: varchar('source_date', { length: 40 }),
    url: varchar('url', { length: 500 }).notNull(),
    externalUrl: varchar('external_url', { length: 1000 }),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_compile_evidence_identity_uidx').on(table.unitId, table.docId),
  ],
);

/** 结论变更史（append-only）。周报直接读本表，0 次 LLM 调用。 */
export const aiCompileRevision = pgTable(
  'ai_compile_revision',
  {
    id: uuid('id').notNull().primaryKey(),
    unitId: uuid('unit_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    changeType: varchar('change_type', { length: 30 }).notNull(),
    changeNote: text('change_note'),
    diffJson: jsonb('diff_json'),
    headline: text('headline'),
    confidence: varchar('confidence', { length: 10 }),
    sourceCount: integer('source_count'),
    createdAt: timestamp('_created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_compile_revision_identity_uidx').on(
      table.unitId,
      table.revisionNo,
    ),
    index('ai_compile_revision_recent_idx').on(table.createdAt),
  ],
);

/** 编译任务状态机。(subject_type, subject_id) 唯一 —— 天然去重，杜绝重复产物。 */
export const aiCompileJob = pgTable(
  'ai_compile_job',
  {
    id: uuid('id').notNull().primaryKey(),
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    subjectId: varchar('subject_id', { length: 255 }).notNull(),
    subjectSlug: varchar('subject_slug', { length: 255 }).notNull(),
    subjectName: varchar('subject_name', { length: 255 }),
    inputHash: varchar('input_hash', { length: 120 }),
    state: varchar('state', { length: 20 }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    retryCount: integer('retry_count').notNull(),
    error: text('error'),
    batchId: varchar('batch_id', { length: 64 }),
    requestedBy: varchar('requested_by', { length: 120 }),
    estTokensLow: integer('est_tokens_low'),
    estTokensHigh: integer('est_tokens_high'),
    updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('ai_compile_job_identity_uidx').on(
      table.subjectType,
      table.subjectId,
    ),
    index('ai_compile_job_state_idx').on(table.state, table.updatedAt),
    index('ai_compile_job_batch_idx').on(table.batchId),
  ],
);

/** 预算校准。scope = `model:<fingerprint>`，按模型分区（tokenizer 不同不可混算）。 */
export const aiCompileCalibration = pgTable('ai_compile_calibration', {
  scope: varchar('scope', { length: 120 }).notNull().primaryKey(),
  sampleCount: integer('sample_count').notNull(),
  totalChars: bigint('total_chars', { mode: 'number' }).notNull(),
  totalPromptTokens: bigint('total_prompt_tokens', { mode: 'number' }).notNull(),
  totalCompletionTokens: bigint('total_completion_tokens', { mode: 'number' })
    .notNull(),
  /** numeric 在 pg 驱动下返回 string，读取侧统一 Number() 转换。 */
  charFactor: numeric('char_factor', { precision: 12, scale: 6 }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type AiCompileUnitRow = typeof aiCompileUnit.$inferSelect;
export type AiCompileClaimRow = typeof aiCompileClaim.$inferSelect;
export type AiCompileEvidenceRow = typeof aiCompileEvidence.$inferSelect;
export type AiCompileRevisionRow = typeof aiCompileRevision.$inferSelect;
export type AiCompileJobRow = typeof aiCompileJob.$inferSelect;
export type AiCompileCalibrationRow = typeof aiCompileCalibration.$inferSelect;

export const COMPILE_STATUS_DRAFT = 'draft';
export const COMPILE_STATUS_PUBLISHED = 'published';
export const COMPILE_STATUS_REJECTED = 'rejected';
export const COMPILE_STATUS_STALE = 'stale';
export const COMPILE_JOB_PENDING = 'pending';
export const COMPILE_JOB_RUNNING = 'running';
export const COMPILE_JOB_DONE = 'done';
export const COMPILE_JOB_FAILED = 'failed';
