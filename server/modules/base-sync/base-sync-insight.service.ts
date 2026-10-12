import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { notInArray } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  MECHANISM_FIELD_NAMES,
  MECHANISM_INNOVATION_SCORE_FIELD,
  MECHANISM_MARKET_SCORE_FIELD,
  insightMechanismTable,
} from './base-sync.constants';
import {
  mechanismObservation,
  scoreColumnValue,
} from './base-sync-insight.schema';
import { normalizeFieldValue } from './base-sync.service';
import { BaseSyncService } from './base-sync.service';

/** 毫秒时间戳（number 或纯数字字符串）或 ISO 字符串转 Date，非法值返回 null。 */
export function normalizeInsightDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** 多维表格「当前发布」字段转 boolean：接受 true / 'true'（大小写不敏感）。 */
export function normalizeInsightBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

/** 多维表格整数字段转 integer：接受 number 或纯数字字符串，非法值返回 null。 */
export function normalizeInsightInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export interface MechanismObservationProjection {
  stableKey: string;
  entryType: string | null;
  gameName: string | null;
  /**
   * Base「中文名」列 → PG **已下线的** `mechanism_title` 列（2026-09-20 追加）。
   * 该列自 09-20 精简起无任何下游读取，正好承载显示名，从而免掉一次加列迁移。
   * 用途：chat 引用的标题必须与机制页主标题（`displayNameOf()`）同口径，
   * 否则引用显示英文名、点进去显示中文名，读者会以为是两条内容。
   */
  displayName: string | null;
  /** Base「机制」列 → PG `core_hook`。 */
  coreHook: string | null;
  /** Base「优点」列 → PG `buy_value`。 */
  buyValue: string | null;
  /** Base「利用方法」列 → PG `reuse_note`。 */
  reuseNote: string | null;
  reviewStatus: string | null;
  currentPublished: boolean | null;
  sourceLink: string | null;
  /**
   * Base 系统字段「更新时间」（`record.last_modified_time`，2026-09-29 起）。
   * 落在 PG `review_time`（零 DDL）；Base「审核时间」列已删除，故本值不再是审核时间。
   */
  reviewTime: Date | null;
  /**
   * Base「市场认可指数」→ PG **已下线的** `generic_formula` 列（text，两位小数字符串）。
   * 零 DDL，见 base-sync-insight.schema.ts 的列注释与 `scoreColumnValue()`。
   */
  marketScore: string | null;
  /** Base「核心创新指数」→ PG **已下线的** `operation_threshold` 列（同上）。 */
  innovationScore: string | null;
}

/**
 * 机制观察表字段映射（中文表头 → 投影列）。
 *
 * 2026-09-20 起 Base 侧只保留三段式内容列；「机制 / 优点 / 利用方法」分别落到
 * 原有的 `core_hook` / `buy_value` / `reuse_note`，PG 侧零 DDL。
 * 同日追加「中文名」→ 已下线的 `mechanism_title`（同样零 DDL），供 chat 引用标题。
 *
 * 2026-09-29：Base 删除「审核时间」、新增两个数字列「市场认可指数」「核心创新指数」。
 * → 时间维度改取记录级 `lastModifiedTime`（Base 系统「更新时间」）；
 * → 两个指数复用已下线的 `generic_formula` / `operation_threshold`（零 DDL）。
 *
 * @param lastModifiedTime `record.last_modified_time`（epoch 毫秒）。**必须显式传入**：
 *   它只在请求体 `automatic_fields: true` 时返回，不在 `fields` 里，无法从字段名取。
 */
export function mapMechanismRecord(
  fields: Record<string, unknown>,
  lastModifiedTime?: number | null,
): MechanismObservationProjection {
  return {
    stableKey: normalizeFieldValue(fields['稳定键']) ?? '',
    entryType: normalizeFieldValue(fields['条目类型']),
    gameName: normalizeFieldValue(fields['游戏名']),
    displayName: normalizeFieldValue(fields['中文名']),
    coreHook: normalizeFieldValue(fields['机制']),
    buyValue: normalizeFieldValue(fields['优点']),
    reuseNote: normalizeFieldValue(fields['利用方法']),
    reviewStatus: normalizeFieldValue(fields['审核状态']),
    currentPublished: normalizeInsightBoolean(fields['当前发布']),
    sourceLink: normalizeFieldValue(fields['来源链接']),
    reviewTime: normalizeInsightDate(lastModifiedTime),
    marketScore: scoreColumnValue(fields[MECHANISM_MARKET_SCORE_FIELD]),
    innovationScore: scoreColumnValue(fields[MECHANISM_INNOVATION_SCORE_FIELD]),
  };
}

/** 文章实体关系表字段映射：已于 2026-09-11 随「文章实体提及」表下线一并移除。 */

export interface InsightSyncCounts {
  mechanisms: number;
  entities: number;
}

@Injectable()
export class BaseSyncInsightService {
  private readonly logger = new Logger(BaseSyncInsightService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(forwardRef(() => BaseSyncService))
    private readonly baseSync: BaseSyncService,
  ) {}

  /**
   * 依次同步 insight 表，返回各表 upsert 计数。
   * 「文章主张」→ knowledge_claim 已于 2026-09-10 随 Base 精简下线
   *（见 docs/base-slimming-impact.md）：投影表与历史数据保留，但不再写入。
   * 「文章实体提及」→ content_entity_rel 已于 2026-09-11 下线
   *（快照见 snapshots/2026-09-11-mention-table/）：实体标注改由站内算法匹配词典。
   * 「实体词典」→ entity_dictionary 已于 2026-10-09 随 Base 实体三表删除下线
   *（语料冻结，唯一来源 = entity_row_cache）：投影表保留、不再写入。
   */
  async syncInsightTables(): Promise<InsightSyncCounts> {
    const mechanisms = await this.syncMechanismObservation();
    this.logger.log(`Insight sync mechanism_observation: ${mechanisms} rows`);

    return { mechanisms, entities: 0 };
  }

  /**
   * 同步「机制观察」表 → PG `mechanism_observation`（全表 upsert，幂等）。
   *
   * 2026-09-29 起由 `BaseSyncAutomation` 直接调用（原先只被 `syncInsightTables`
   * 内部调用），让 Base 变更能实时反映到机制页与 chat 检索：
   *   · `entity-resync` webhook 的机制观察分支 —— 实时（秒级）
   *   · 每 30 分钟的那个 cron（`cron1`，表达式见 automation 文件）—— 兜底
   * 调用方必须 fire-and-forget（全表 110+ 次 upsert 会超平台 10s HTTP 超时）。
   *
   * 幂等性：以 `stable_key` 为冲突键 upsert 全集，天然覆盖「改值 / 新增」；
   * 注意它**不删** Base 侧已删除的行（删行需另行收敛，与 `syncInsightTables` 同）。
   */
  async syncMechanismObservation(): Promise<number> {
    const records = await this.baseSync.fetchAllRecords(
      insightMechanismTable(),
      [...MECHANISM_FIELD_NAMES],
    );
    let count = 0;
    // 本次 Base 侧「活着的」稳定键全量，循环结束后据此清理陈旧行（见方法尾）。
    const liveKeys: string[] = [];
    for (const record of records) {
      const mapped = mapMechanismRecord(
        record.fields,
        record.last_modified_time,
      );
      if (!mapped.stableKey) continue; // 无稳定键的记录跳过，不参与 upsert
      liveKeys.push(mapped.stableKey);
      // 已下线的 PG 列（growth_drive / drama_source / multiplayer_value / ad_moment /
      // visual_degree / visual_evidence / migration_note / trial_loop / diff_summary /
      // open_questions / source_status / source_version / source_title / source_doc_id /
      // source_block_id）自 2026-09-20 起不再写入；线上列保留（零 DDL），下游已不再读取。
      // 例外（复用已下线列承载新内容，均零 DDL）：
      //  · `mechanism_title` → Base「中文名」（2026-09-20），供 chat 引用标题与机制页同口径；
      //  · `generic_formula` → Base「市场认可指数」（2026-09-29，text 存两位小数）；
      //  · `operation_threshold` → Base「核心创新指数」（2026-09-29，同上）。
      await this.db
        .insert(mechanismObservation)
        .values({
          id: crypto.randomUUID(),
          stableKey: mapped.stableKey,
          entryType: mapped.entryType,
          gameName: mapped.gameName,
          mechanismTitle: mapped.displayName,
          coreHook: mapped.coreHook,
          buyValue: mapped.buyValue,
          reuseNote: mapped.reuseNote,
          reviewStatus: mapped.reviewStatus,
          currentPublished: mapped.currentPublished,
          sourceLink: mapped.sourceLink,
          reviewTime: mapped.reviewTime,
          genericFormula: mapped.marketScore,
          operationThreshold: mapped.innovationScore,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: mechanismObservation.stableKey,
          set: {
            entryType: mapped.entryType,
            gameName: mapped.gameName,
            mechanismTitle: mapped.displayName,
            coreHook: mapped.coreHook,
            buyValue: mapped.buyValue,
            reuseNote: mapped.reuseNote,
            reviewStatus: mapped.reviewStatus,
            currentPublished: mapped.currentPublished,
            sourceLink: mapped.sourceLink,
            reviewTime: mapped.reviewTime,
            genericFormula: mapped.marketScore,
            operationThreshold: mapped.innovationScore,
            updatedAt: new Date(),
          },
        });
      count += 1;
    }

    // 「先 upsert 全集 → 再删陈旧」（本项目禁 db.transaction 的标准替代写法）。
    // 🔴 为什么必须删：投影以 `stable_key` 为键，而 Base 的「稳定键」可以被改
    // （改一次就换一个键）⇒ 旧键那行会永远留在 PG，且仍带着
    // `current_published=true` 通过机制页门禁 ⇒ **页面多出已不存在的条目**。
    // 2026-09-29 实测：Base 110 条 vs PG 117 行，多出 7 条幽灵。
    // 守卫：本次一条都没取到时不删（避免「读失败/空表」被当成「Base 全删了」
    // 而清空全表）；fetchAllRecords 出错会抛异常，本来就走不到这里。
    if (liveKeys.length > 0) {
      const deleted = await this.db
        .delete(mechanismObservation)
        .where(notInArray(mechanismObservation.stableKey, liveKeys))
        .returning({ stableKey: mechanismObservation.stableKey });
      if (deleted.length > 0) {
        this.logger.log(
          `Mechanism projection pruned ${deleted.length} stale rows (no longer in Base)`,
        );
      }
    }
    // 返回「本次 upsert 的条数」（不含被清理的陈旧行；清理量单独打日志），
    // 使 `Insight sync mechanism_observation: N rows` 的含义保持单一。
    return count;
  }
}
