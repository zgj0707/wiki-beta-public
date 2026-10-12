import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// 实体提及投影与正文缓存（迁移：scripts/migrations/026_entity_mention_projection.sql）。
//
// 与同目录其它 *schema.ts 一致：只映射业务列，`_created_*` / `_updated_*` 由数据库
// 默认值维护，不进入 Drizzle 映射（因此无需 user_profile 自定义类型）。
// 列长度与 CHECK 约束在数据库侧定义，这里用 text 承接以免与 DDL 漂移。
//
// ⚠️ 本文件只服务读取与投影写入；公开面不直连这两张表（全部经 Nest 接口）。

/** 提及投影。唯一键 (doc_id, entity_id, entity_term, occurrence_index)。 */
export const entityMention = pgTable('entity_mention', {
  id: uuid('id').notNull().primaryKey(),
  /** 文章 Base record_id。 */
  docId: text('doc_id').notNull(),
  /** 实体 Base record_id（不是 uuid）。 */
  entityId: text('entity_id').notNull(),
  /** 命中的具体词（实体名称 / 规范化名称 / 某别名）。 */
  entityTerm: text('entity_term').notNull(),
  /** 该篇内该词的 1-based 出现序号。 */
  occurrenceIndex: integer('occurrence_index').notNull(),
  /** 正文（raw markdown）中的命中起点偏移（P4b 批1，历史行 NULL）。 */
  matchStart: integer('match_start'),
  /** 正文中的命中终点偏移（不含）。 */
  matchEnd: integer('match_end'),
  evidenceText: text('evidence_text'),
  /** 正文区块 ID；首版恒 NULL，保留为未来扩展位。 */
  blockId: text('block_id'),
  status: text('status').notNull(),
  sourceField: text('source_field').notNull(),
  /** 本次重算时间：用于"同一批次内未被 upsert 到的历史行 → inactive"的判定。 */
  computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/** 正文与指纹缓存。doc_id 即主键（一篇一行）。 */
export const entityDocCache = pgTable('entity_doc_cache', {
  docId: text('doc_id').notNull().primaryKey(),
  bodyMarkdown: text('body_markdown').notNull(),
  /** body_markdown 的 sha256(hex)，L2 指纹判据。 */
  contentHash: text('content_hash').notNull(),
  bodyLength: integer('body_length').notNull(),
  /** 写入时的 Base 记录 updateTime，L1 预筛判据。 */
  baseUpdatedAt: timestamp('base_updated_at', {
    withTimezone: true,
    mode: 'date',
  }),
  /** ready | empty | unavailable —— 三值语义见 p1-entity-mention-execution.md §3.3。 */
  parseStatus: text('parse_status').notNull(),
  parseError: text('parse_error'),
  // ── 文章元数据快照（P2a，迁移 027）────────────────────────────────
  // 写入时机：sweep meta 同步（Base 行在手，四值比对变才写）+ 三处重算 upsert。
  // 全部 nullable：历史行由首轮 sweep 自然回填，不依赖迁移脚本。
  /** Base「标题」。 */
  title: text('title'),
  /** Base「飞书来源日期」规范化后的日期字符串。 */
  sourceDate: text('source_date'),
  /** Base「文档链接」。 */
  docLink: text('doc_link'),
  /** Base「审批状态」；读取侧防御性过滤用（门禁本体在投影计算）。 */
  approvalStatus: text('approval_status'),
  parsedAt: timestamp('parsed_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('_updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type EntityMentionRow = typeof entityMention.$inferSelect;
export type EntityDocCacheRow = typeof entityDocCache.$inferSelect;

// ── 实体/关系快照（P2a2，迁移 028）────────────────────────────────────
// 目的：detail()/list() 热路径零 Base 读（60s TTL 过期后的冷请求曾秒级）。
// 写入：sweepAll / rematchAllFromCache（两个全量路径，词典行本就在手，边际成本≈0）；
// 词典变更 workflow → rematchAllFromCache → 快照秒级刷新，cron 30min 兜底。
// `row` 存完整 typed 行（jsonb，抗 Base 字段漂移）；updateTime 序列化为 ISO 字符串，
// 读取侧须 revive 为 Date。
/** 实体词典行镜像。entity_row_cache 为空 = 快照未构建（读取侧须回退 Base 直读）。 */
export const entityRowCache = pgTable('entity_row_cache', {
  baseRecordId: text('base_record_id').primaryKey(),
  name: text('name').notNull(),
  status: text('status'),
  row: jsonb('row').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
/** 实体关系行镜像（现网 0 行，结构先行；随快照整体替换）。 */
export const entityRelationCache = pgTable('entity_relation_cache', {
  baseRecordId: text('base_record_id').primaryKey(),
  row: jsonb('row').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type EntityRowCacheRow = typeof entityRowCache.$inferSelect;
export type EntityRelationCacheRow = typeof entityRelationCache.$inferSelect;

/** 参与匹配的解析状态（唯一否 = 该篇正文不可用于匹配）。 */
export const PARSE_STATUS_READY = 'ready';
export const PARSE_STATUS_EMPTY = 'empty';
export const PARSE_STATUS_UNAVAILABLE = 'unavailable';
export const MENTION_STATUS_ACTIVE = 'active';
export const MENTION_STATUS_INACTIVE = 'inactive';
/**
 * 报告停用（P2d/G1）：确认错误的提及仍落行，但渲染/计数/关联文章一律排除。
 * 与 inactive（正文修订淘汰的陈旧行）区分的意义：读取侧 G5 降级检查需要
 * 「该词本篇完整出现集合」（active + disabled），若停用行被写成 inactive，
 * 集合会因缺行而振荡，词级兜底会误伤未停用的出现。
 */
export const MENTION_STATUS_DISABLED = 'disabled';
export const MENTION_SOURCE_DICTIONARY = 'dictionary_match';
export const MENTION_SOURCE_MANUAL = 'manual';
