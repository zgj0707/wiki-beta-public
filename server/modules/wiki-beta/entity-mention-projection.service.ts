import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { APPROVAL_STATUS_PUBLISHED } from './publication-policy';
import { findEntityTextMatches, type EntityMatchTerm } from '../../common/entity/entity-matcher';
import { FeishuDocumentReader } from './document-reader.service';
import {
  FeishuBaseReader,
  type WikiBetaArticleRow,
  type WikiBetaEntityRow,
  type WikiBetaRelationRow,
} from './feishu-base-reader.service';
import {
  entityDocCache,
  entityMention,
  entityRelationCache,
  entityRowCache,
  MENTION_SOURCE_DICTIONARY,
  MENTION_STATUS_ACTIVE,
  MENTION_STATUS_DISABLED,
  MENTION_STATUS_INACTIVE,
  PARSE_STATUS_EMPTY,
  PARSE_STATUS_READY,
  PARSE_STATUS_UNAVAILABLE,
} from './entity-mention.schema';

export type ParseStatus =
  | typeof PARSE_STATUS_READY
  | typeof PARSE_STATUS_EMPTY
  | typeof PARSE_STATUS_UNAVAILABLE;

export interface SweepResult {
  status: 'success' | 'skipped';
  /** 通过门禁（审批状态 = 已批准）的文章数。 */
  scanned: number;
  /** 实际读取了正文的篇数。 */
  parsed: number;
  /** 重写了匹配结果的篇数。 */
  matched: number;
  /** L1 命中（Base updateTime 未变）而跳过的篇数。 */
  skippedL1: number;
  /** L2 命中（正文 sha256 未变）而跳过的篇数。 */
  skippedL2: number;
  /** 正文为空的篇数（其历史提及已置 inactive）。 */
  empty: number;
  /** 正文读不到的篇数（历史提及保留不动）。 */
  unavailable: number;
  /** 写出的 active 提及行数。 */
  mentions: number;
  durationMs: number;
}

export type DocumentRematchOutcome =
  | 'matched'
  | 'skipped'
  | 'empty'
  | 'unavailable'
  | 'not-approved'
  | 'unknown-doc';

export interface DocumentRematchResult {
  docId: string;
  outcome: DocumentRematchOutcome;
  /** outcome === 'skipped' 时说明是哪一级跳过的。 */
  skipped?: 'l1' | 'l2';
  mentions?: number;
}

/** 单篇的关联文章（已去重，一篇一行）。 */
export interface EntityArticleLink {
  docId: string;
  title: string;
  sourceDate?: string;
  sourceUrl?: string;
  evidenceText?: string;
  occurrenceIndex?: number;
}

/** 投影里的一行提及（供渲染路径判断"该篇有哪些实体"）。 */
export interface ProjectedMention {
  entityId: string;
  term: string;
  occurrenceIndex: number;
  evidenceText: string | null;
  /** raw markdown 命中区间（P4b 批2）；历史行/兜底分支为 null，客户端回退词扫描。 */
  matchStart: number | null;
  matchEnd: number | null;
}

/** entity_doc_cache 的文章元数据快照（P2a，迁移 027 的 4 个 nullable 列）。 */
interface DocCacheMeta {
  title: string | null;
  sourceDate: string | null;
  docLink: string | null;
  approvalStatus: string | null;
}

const COUNTS_CACHE_TTL_MS = 60_000;
const EVIDENCE_HEAD = 60;
const EVIDENCE_TAIL = 100;

function emptySweep(scanned: number): SweepResult {
  return {
    status: 'success',
    scanned,
    parsed: 0,
    matched: 0,
    skippedL1: 0,
    skippedL2: 0,
    empty: 0,
    unavailable: 0,
    mentions: 0,
    durationMs: 0,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isApprovedArticle(article: WikiBetaArticleRow): boolean {
  return article.approvalStatus === APPROVAL_STATUS_PUBLISHED;
}

/** 把一次正文读取结果落到 parse_status 三值上（映射理由见 §3.3）。 */
export function toParseStatus(result: {
  status: string;
  body: string | null;
}): { parseStatus: ParseStatus; body: string; parseError: string | null } {
  if (result.status === 'ready' && result.body) {
    return { parseStatus: PARSE_STATUS_READY, body: result.body, parseError: null };
  }
  // invalid_response 表示飞书应答了但内容不可用（链接失效/docx 无内容/节点不是 docx），
  // 该篇确实没有可匹配正文 → empty，其历史提及应被置 inactive。
  if (result.status === 'invalid_response' || result.status === 'ready') {
    return {
      parseStatus: PARSE_STATUS_EMPTY,
      body: '',
      parseError: result.status,
    };
  }
  // not_configured / unavailable：凭证或网络问题，属临时态 →
  // 不能把历史提及打掉，否则一次抖动就会清空全网投影（抖动反而被固化）。
  return {
    parseStatus: PARSE_STATUS_UNAVAILABLE,
    body: '',
    parseError: result.status,
  };
}

/** 取命中处上下文：前 60 / 后 100 字，折行折叠为空格。 */
export function evidenceAround(body: string, index: number, end: number): string {
  return body
    .slice(
      Math.max(0, index - EVIDENCE_HEAD),
      Math.min(body.length, end + EVIDENCE_TAIL),
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

/** 启用实体的匹配词表：名称 / 规范化名称 / 别名，trim 后长度 ≥ 2 去重。 */
export function buildTerms(entities: WikiBetaEntityRow[]): EntityMatchTerm[] {
  const seen = new Set<string>();
  const terms: EntityMatchTerm[] = [];
  for (const entity of entities) {
    if (entity.status !== '启用') continue;
    for (const raw of [entity.name, entity.normalizedName, ...entity.aliases]) {
      const term = raw.trim();
      if (term.length < 2) continue;
      const key = `${entity.baseRecordId}\u0000${term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({ entityId: entity.baseRecordId, term });
    }
  }
  return terms;
}

interface MentionDraft {
  entityId: string;
  term: string;
  occurrenceIndex: number;
  /** 正文（raw markdown）命中区间；P4b 批1 起随投影落库，供渲染侧零匹配消费。 */
  matchStart: number;
  matchEnd: number;
  evidenceText: string;
}

/** 对一段正文做匹配，并按 (entityId, term) 累计 1-based 出现序号。 */
export function draftMentions(
  body: string,
  terms: EntityMatchTerm[],
): MentionDraft[] {
  const counters = new Map<string, number>();
  return findEntityTextMatches(body, terms).map((match) => {
    const key = `${match.entityId}\u0000${match.term}`;
    const occurrenceIndex = (counters.get(key) ?? 0) + 1;
    counters.set(key, occurrenceIndex);
    return {
      entityId: match.entityId,
      term: match.term,
      occurrenceIndex,
      matchStart: match.index,
      matchEnd: match.end,
      evidenceText: evidenceAround(body, match.index, match.end),
    };
  });
}

/**
 * 实体提及投影：把"实体 ↔ 文章"从每次请求实时解析正文，改为算一次落 PG。
 *
 * 三级跳过（越靠前越便宜，见 docs/p1-entity-mention-execution.md §4）：
 *   L0 门禁  —— 非「已批准」不参与
 *   L1 预筛  —— Base updateTime 与缓存一致且 ready → 零正文读取
 *   L2 指纹  —— 正文 sha256 未变 → 只刷新时间戳，不重算匹配
 *
 * 写入顺序不变量：先按"本次批次时间戳"upsert 命中行，再把 computedAt 早于本批次的
 * 历史 active 行置 inactive。由此既保证幂等（同一份输入重跑结果一致），也保证
 * 并发安全（后启动的批次时间戳更大，不会被先启动批次的收尾误伤），且崩溃后
 * 下一轮会自动收敛 —— 因此无需显式事务。
 */
@Injectable()
export class EntityMentionProjectionService {
  private readonly logger = new Logger(EntityMentionProjectionService.name);
  private countsCache: { at: number; value: Map<string, number> } | null = null;
  private sweepInFlight: Promise<SweepResult> | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly baseReader: FeishuBaseReader,
    @Optional() private readonly documentReader?: FeishuDocumentReader,
  ) {}

  /**
   * 全量增量扫描（cron 用）。并发调用共享同一次飞行，避免定时兜底与词典重算叠加。
   */
  async sweepAll(options: { limit?: number } = {}): Promise<SweepResult> {
    if (this.sweepInFlight) return this.sweepInFlight;
    const flight = this.runSweep(options).finally(() => {
      this.sweepInFlight = null;
    });
    this.sweepInFlight = flight;
    return flight;
  }

  private async runSweep(options: { limit?: number }): Promise<SweepResult> {
    const startedAt = Date.now();
    const [articles, entities, caches] = await Promise.all([
      this.baseReader.listArticleRows(),
      this.loadEntities(),
      this.loadCaches(),
    ]);
    const approved = articles.filter(isApprovedArticle);
    const targets = options.limit ? approved.slice(0, options.limit) : approved;
    const terms = buildTerms(entities);
    const result = emptySweep(approved.length);
    // P4b 批1：逐篇串行 → 4 并发批处理（首算 75 篇 23-75s 的主放大源）。
    // accumulate 是纯同步聚合，结果按批归并，语义与串行一致。
    const SWEEP_CONCURRENCY = 4;
    for (let start = 0; start < targets.length; start += SWEEP_CONCURRENCY) {
      const batch = targets.slice(start, start + SWEEP_CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map(async (article) => {
          const cache = caches.get(article.baseRecordId) ?? null;
          await this.syncMeta(article, cache);
          return this.rematchWithCache(article, terms, cache);
        }),
      );
      for (const outcome of outcomes) this.accumulate(result, outcome);
    }
    result.durationMs = Date.now() - startedAt;
    this.countsCache = null;
    this.logger.log(
      `[entity-mention] sweep scanned=${result.scanned} parsed=${result.parsed} matched=${result.matched} l1=${result.skippedL1} l2=${result.skippedL2} empty=${result.empty} unavailable=${result.unavailable} mentions=${result.mentions} ${result.durationMs}ms`,
    );
    return result;
  }

  /**
   * 定向重算单篇（事件触发用）。目标 < 2s：L1 命中时零正文读取。
   * `force`（G6）：绕过 L1/L2，直接用缓存正文重写投影 —— 停用确认
   * 发生在正文未变时，跳过层会让重算空转。
   */
  async rematchDocument(
    docId: string,
    reason: string,
    options?: { force?: boolean },
  ): Promise<DocumentRematchResult> {
    // P4b 批1：Base 行拉取从"每次重算都全表"收敛到入口一次（60s TTL 内的
    // 连续单篇重算不再重复整表读，1.8-2.9s/次的成本消除）。
    const [articles, entities, caches] = await Promise.all([
      this.baseReader.listArticleRows(),
      this.loadEntities(),
      this.loadCaches([docId]),
    ]);
    const article = articles.find((item) => item.baseRecordId === docId);
    if (!article) {
      this.logger.warn(`[entity-mention] rematch ${reason}: unknown doc ${docId}`);
      return { docId, outcome: 'unknown-doc' };
    }
    return this.rematchArticleRow(docId, article, entities, caches, options);
  }

  /** rematchDocument 的共享内核：门禁 → 清投影 / 元数据同步 → 缓存重算。 */
  private async rematchArticleRow(
    docId: string,
    article: WikiBetaArticleRow,
    entities: WikiBetaEntityRow[],
    caches: Awaited<ReturnType<EntityMentionProjectionService['loadCaches']>>,
    options?: { force?: boolean },
  ): Promise<DocumentRematchResult> {
    if (!isApprovedArticle(article)) {
      // 掉出门禁：清掉其仍 active 的投影，否则公开面会继续展示已撤下的文章。
      await this.deactivate(docId, new Date());
      this.countsCache = null;
      return { docId, outcome: 'not-approved' };
    }
    const cache = caches.get(docId) ?? null;
    await this.syncMeta(article, cache);
    const outcome = await this.rematchWithCache(
      article,
      buildTerms(entities),
      cache,
      options,
    );
    this.countsCache = null;
    return outcome;
  }

  /**
   * 实体行读取（Phase 4 语料冻结后的唯一来源）：从 PG `entity_row_cache`
   * 快照读（snapshotCached，jsonb 完整镜像）。Base「实体词典」表已删除，
   * 不存在 Base 直读路径——快照缺失（空表/读取失败）只 warn 并返回空集，
   * 语义 = 零实体（所有文章 L1 免匹配），绝不抛错阻塞 sweep。
   */
  private async loadEntities(): Promise<WikiBetaEntityRow[]> {
    const snap = await this.snapshotCached();
    if (snap) return snap.entities;
    this.logger.warn(
      '[entity-mention] loadEntities: entity_row_cache 空/读取失败（语料冻结后无 Base 兜底），按零实体处理',
    );
    return [];
  }

  /** 实体/关系快照读取。返回 null = 快照未构建或读取失败（调用方按空集兜底）。 */
  async snapshotCached(): Promise<{
    entities: WikiBetaEntityRow[];
    relations: WikiBetaRelationRow[];
  } | null> {
    try {
      const cachedEntities = await this.db.select().from(entityRowCache);
      // 空表 = 快照从未构建（迁移后首轮 sweep 之前），不能当成"零实体"返回。
      if (!cachedEntities.length) return null;
      const cachedRelations = await this.db
        .select()
        .from(entityRelationCache);
      // row 从 jsonb 读出是 unknown：updateTime 存的是 ISO 字符串，须重建对象
      // revive 为 Date，不能整对象 as 断言了事。
      const entities: WikiBetaEntityRow[] = cachedEntities.map((cached) => {
        const raw = cached.row as Omit<WikiBetaEntityRow, 'updateTime'> & {
          updateTime: string | null;
        };
        return {
          ...raw,
          updateTime: raw.updateTime ? new Date(raw.updateTime) : null,
        };
      });
      const relations: WikiBetaRelationRow[] = cachedRelations.map(
        (cached) => {
          const raw = cached.row as Omit<WikiBetaRelationRow, 'updateTime'> & {
            updateTime: string | null;
          };
          return {
            ...raw,
            updateTime: raw.updateTime ? new Date(raw.updateTime) : null,
          };
        },
      );
      return { entities, relations };
    } catch (error) {
      this.logger.warn(
        `[entity-mention] snapshotCached: PG 读取失败，调用方按零实体兜底: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** 已批准文章 doc_id 集合（来自 meta 快照列）。失败返回 null（调用方回退）。 */
  async approvedDocIds(): Promise<string[] | null> {
    try {
      // '已批准' 字面量与 publication-policy.ts 的 isApprovedArticle /
      // PUBLISHED_PREDICATE 同源（本文件 isApprovedArticle 亦同一字面量）。
      const rows = await this.db
        .select({ docId: entityDocCache.docId })
        .from(entityDocCache)
        .where(eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED));
      return rows.map((row) => row.docId);
    } catch (error) {
      this.logger.warn(
        `[entity-mention] approvedDocIds: PG 读取失败，调用方回退: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * 每个实体的 knowledgeCount：**去重后的文章篇数**（不是提及次数）。
   * 只统计当前仍「已批准」的文章，避免门禁变更后计数虚高。
   */
  async countsByEntity(): Promise<Map<string, number>> {
    const cached = this.countsCache;
    if (cached && Date.now() - cached.at < COUNTS_CACHE_TTL_MS) {
      return cached.value;
    }
    const articles = await this.baseReader.listArticleRows();
    const approvedIds = articles
      .filter(isApprovedArticle)
      .map((item) => item.baseRecordId);
    const value = new Map<string, number>();
    if (approvedIds.length) {
      const rows = await this.db
        .select({
          entityId: entityMention.entityId,
          value: sql<number>`count(distinct ${entityMention.docId})`,
        })
        .from(entityMention)
        .where(
          and(
            eq(entityMention.status, MENTION_STATUS_ACTIVE),
            inArray(entityMention.docId, approvedIds),
          ),
        )
        .groupBy(entityMention.entityId);
      for (const row of rows) value.set(row.entityId, Number(row.value));
    }
    this.countsCache = { at: Date.now(), value };
    return value;
  }

  /**
   * 渲染路径的投影读取。
   *
   * 返回 `null` = 该篇尚无投影（调用方保留实时解析兜底）；返回数组（可为空）= 有投影，
   * 一律以投影为准 —— 包括 parse_status 非 ready 的篇目，否则每个请求都会为坏链接
   * 白付一次冷读。
   */
  async mentionsForDocument(docId: string): Promise<ProjectedMention[] | null> {
    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        parseStatus: entityDocCache.parseStatus,
      })
      .from(entityDocCache)
      .where(eq(entityDocCache.docId, docId))
      .limit(1);
    const cache = rows[0];
    if (!cache) return null;
    if (cache.parseStatus !== PARSE_STATUS_READY) return [];
    // 读取全集 = active + disabled：降级检查需要「该词本篇完整出现集合」。
    // 只取 active 会让集合随停用缩水 —— 被精确停用的出现一消失，读取侧就
    // 把同词其余出现误判为「漂移」而词级误杀（2026-09-14 验收实锤）。
    const mentionRows = await this.db
      .select({
        entityId: entityMention.entityId,
        term: entityMention.entityTerm,
        occurrenceIndex: entityMention.occurrenceIndex,
        matchStart: entityMention.matchStart,
        matchEnd: entityMention.matchEnd,
        evidenceText: entityMention.evidenceText,
        status: entityMention.status,
      })
      .from(entityMention)
      .where(
        and(
          eq(entityMention.docId, docId),
          inArray(entityMention.status, [
            MENTION_STATUS_ACTIVE,
            MENTION_STATUS_DISABLED,
          ]),
        ),
      )
      .orderBy(asc(entityMention.occurrenceIndex));
    if (!mentionRows.length) return [];
    // v2 实体链路退场（2026-10-09）：错误上报闭环下线后停用清单恒空，
    // 停用过滤分支整体移除；MENTION_STATUS_DISABLED 仅作为历史行状态保留。
    return mentionRows.flatMap((row) =>
      row.status === MENTION_STATUS_ACTIVE
        ? [
            {
              entityId: row.entityId,
              term: row.term,
              occurrenceIndex: row.occurrenceIndex,
              matchStart: row.matchStart,
              matchEnd: row.matchEnd,
              evidenceText: row.evidenceText,
            },
          ]
        : [],
    );
  }

  /** 某实体的关联文章（投影 ∩ 当前仍「已批准」的文章），按日期倒序、一篇一行。 */
  async articlesForEntity(entityId: string): Promise<EntityArticleLink[]> {
    // P2a：读取改纯 PG（mention 联 doc_cache，meta 快照随行带出），不再拉 Base 全表。
    // 门禁以 approval_status='已批准' 同源过滤（与 isApprovedArticle 字面量一致，
    // 门禁本体在投影计算，这里属读取侧防御）。
    try {
      const rows = await this.db
        .select({
          docId: entityMention.docId,
          occurrenceIndex: entityMention.occurrenceIndex,
          entityTerm: entityMention.entityTerm,
          evidenceText: entityMention.evidenceText,
          title: entityDocCache.title,
          sourceDate: entityDocCache.sourceDate,
          docLink: entityDocCache.docLink,
        })
        .from(entityMention)
        .innerJoin(entityDocCache, eq(entityDocCache.docId, entityMention.docId))
        .where(
          and(
            eq(entityMention.entityId, entityId),
            eq(entityMention.status, MENTION_STATUS_ACTIVE),
            eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
          ),
        )
        .orderBy(asc(entityMention.docId), asc(entityMention.occurrenceIndex));

      // v2 实体链路退场（2026-10-09）：停用清单恒空，读取侧过滤分支整体移除，
      // 直接按门禁行取每 doc 首个出现。

      // 每 doc 取 occurrence 最小的一行（SQL 已按 doc_id, occurrence_index 升序）。
      const firstByDoc = new Map<
        string,
        {
          occurrenceIndex: number;
          evidenceText: string | null;
          title: string | null;
          sourceDate: string | null;
          docLink: string | null;
        }
      >();
      for (const row of rows) {
        if (firstByDoc.has(row.docId)) continue;
        firstByDoc.set(row.docId, row);
      }
      if (!firstByDoc.size) return [];

      return [...firstByDoc.entries()]
        .map(([docId, hit]) => ({
          docId,
          title: hit.title ?? docId,
          ...(hit.sourceDate ? { sourceDate: hit.sourceDate } : {}),
          ...(hit.docLink ? { sourceUrl: hit.docLink } : {}),
          ...(hit.evidenceText ? { evidenceText: hit.evidenceText } : {}),
          occurrenceIndex: hit.occurrenceIndex,
        }))
        .sort((left, right) =>
          (right.sourceDate ?? '').localeCompare(left.sourceDate ?? ''),
        );
    } catch (error) {
      // PG 读取异常时降级回 Base 全表路径（行为与 P2a 之前一致）。
      this.logger.warn(
        `[entity-mention] articlesForEntity PG 读取失败，降级 Base 路径: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.articlesForEntityFromBase(entityId);
    }
  }

  /**
   * A 版（2026-09-15）：批量版 articlesForEntity。
   * 悬停载荷要对一篇文档的全部实体（10~20 个）补「关联文章 top2」，
   * 逐实体调 articlesForEntity 会放大成 N 次 PG 查询
   * （P4a 预览弹窗加载变长的直接原因）。这里一次 IN 查询取全集，
   * 按实体分组后沿用同一套门禁/过滤语义。
   */
  async articleBriefsByEntity(
    entityIds: string[],
  ): Promise<Map<string, EntityArticleLink[]>> {
    const result = new Map<string, EntityArticleLink[]>();
    if (!entityIds.length) return result;
    try {
      const rows = await this.db
        .select({
          entityId: entityMention.entityId,
          docId: entityMention.docId,
          occurrenceIndex: entityMention.occurrenceIndex,
          entityTerm: entityMention.entityTerm,
          evidenceText: entityMention.evidenceText,
          title: entityDocCache.title,
          sourceDate: entityDocCache.sourceDate,
          docLink: entityDocCache.docLink,
        })
        .from(entityMention)
        .innerJoin(entityDocCache, eq(entityDocCache.docId, entityMention.docId))
        .where(
          and(
            inArray(entityMention.entityId, entityIds),
            eq(entityMention.status, MENTION_STATUS_ACTIVE),
            eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
          ),
        )
        .orderBy(
          asc(entityMention.entityId),
          asc(entityMention.docId),
          asc(entityMention.occurrenceIndex),
        );

      const rowsByEntity = new Map<string, typeof rows>();
      for (const row of rows) {
        const bucket = rowsByEntity.get(row.entityId);
        if (bucket) bucket.push(row);
        else rowsByEntity.set(row.entityId, [row]);
      }

      for (const entityId of entityIds) {
        // v2 实体链路退场：停用清单恒空，按门禁行直接取每 doc 首个出现。
        const effectiveRows = rowsByEntity.get(entityId) ?? [];
        // 每 doc 取 occurrence 最小的一行，再按 sourceDate 倒序——语义与
        // articlesForEntity 一致。
        const firstByDoc = new Map<
          string,
          (typeof effectiveRows)[number]
        >();
        for (const row of effectiveRows) {
          if (firstByDoc.has(row.docId)) continue;
          firstByDoc.set(row.docId, row);
        }
        result.set(
          entityId,
          [...firstByDoc.entries()]
            .map(([docId, hit]) => ({
              docId,
              title: hit.title ?? docId,
              ...(hit.sourceDate ? { sourceDate: hit.sourceDate } : {}),
              ...(hit.docLink ? { sourceUrl: hit.docLink } : {}),
              ...(hit.evidenceText ? { evidenceText: hit.evidenceText } : {}),
              occurrenceIndex: hit.occurrenceIndex,
            }))
            .sort((left, right) =>
              (right.sourceDate ?? '').localeCompare(left.sourceDate ?? ''),
            ),
        );
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `[entity-mention] articleBriefsByEntity 读取失败，悬停卡降级无文章列表: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return result;
    }
  }

  /** P2a 前的 Base 全表实现，原样保留作降级路径。 */
  private async articlesForEntityFromBase(
    entityId: string,
  ): Promise<EntityArticleLink[]> {
    const rows = await this.db
      .select({
        docId: entityMention.docId,
        occurrenceIndex: entityMention.occurrenceIndex,
        entityTerm: entityMention.entityTerm,
        evidenceText: entityMention.evidenceText,
      })
      .from(entityMention)
      .where(
        and(
          eq(entityMention.entityId, entityId),
          eq(entityMention.status, MENTION_STATUS_ACTIVE),
        ),
      )
      .orderBy(asc(entityMention.docId), asc(entityMention.occurrenceIndex));

    // v2 实体链路退场：停用清单恒空，降级路径同样不再做停用过滤。
    const effectiveRows = rows;

    const firstByDoc = new Map<
      string,
      { occurrenceIndex: number; evidenceText: string | null }
    >();
    for (const row of effectiveRows) {
      if (firstByDoc.has(row.docId)) continue;
      firstByDoc.set(row.docId, {
        occurrenceIndex: row.occurrenceIndex,
        evidenceText: row.evidenceText,
      });
    }
    if (!firstByDoc.size) return [];

    const articles = await this.baseReader.listArticleRows();
    return articles
      .filter(
        (article) =>
          isApprovedArticle(article) && firstByDoc.has(article.baseRecordId),
      )
      .map((article) => {
        const hit = firstByDoc.get(article.baseRecordId)!;
        return {
          docId: article.baseRecordId,
          title: article.title,
          ...(article.sourceDateFeishu
            ? { sourceDate: article.sourceDateFeishu }
            : {}),
          ...(article.docLink ? { sourceUrl: article.docLink } : {}),
          ...(hit.evidenceText ? { evidenceText: hit.evidenceText } : {}),
          occurrenceIndex: hit.occurrenceIndex,
        };
      })
      .sort((left, right) =>
        (right.sourceDate ?? '').localeCompare(left.sourceDate ?? ''),
      );
  }

  private async rematchWithCache(
    article: WikiBetaArticleRow,
    terms: EntityMatchTerm[],
    cache: {
      bodyMarkdown: string;
      contentHash: string;
      parseStatus: string;
      baseUpdatedAt: Date | null;
    } | null,
    options?: { force?: boolean },
  ): Promise<DocumentRematchResult> {
    const docId = article.baseRecordId;
    const baseUpdatedAt = article.updateTime;
    // G6 force 路径：停用确认通常发生在正文未变时，L1/L2 跳过层会吞掉本次
    // 重算 → 有缓存正文时直接以缓存正文重写投影（不读飞书文档，单篇 <2s；
    // 缓存正文与投影同源，写回幂等）。无缓存正文则回落常规路径。
    if (options?.force) {
      if (
        cache &&
        cache.parseStatus === PARSE_STATUS_READY &&
        cache.bodyMarkdown
      ) {
        const forcedDrafts = draftMentions(cache.bodyMarkdown, terms);
        await this.writeProjection(
          { ...article, updateTime: baseUpdatedAt },
          cache.bodyMarkdown,
          forcedDrafts,
        );
        return {
          docId,
          outcome: 'matched',
          mentions: forcedDrafts.length,
        };
      }
    }
    // L1：Base 侧时间戳未变且上次解析成功 → 不读正文、不重算。
    if (
      cache &&
      cache.parseStatus === PARSE_STATUS_READY &&
      sameMoment(cache.baseUpdatedAt, baseUpdatedAt)
    ) {
      return { docId, outcome: 'skipped', skipped: 'l1' };
    }
    const document = this.documentReader
      ? await this.documentReader.readArticle(article.appDocId, article.docLink)
      : { status: 'unavailable' as const, body: null };
    const mapped = toParseStatus(document);

    if (mapped.parseStatus === PARSE_STATUS_UNAVAILABLE) {
      // 保留历史提及：一次凭证/网络抖动不应把全网投影清空。
      await this.upsertCache(docId, {
        parseStatus: PARSE_STATUS_UNAVAILABLE,
        body: cache?.bodyMarkdown ?? mapped.body,
        contentHash: cache?.contentHash ?? sha256(mapped.body),
        baseUpdatedAt,
        parseError: mapped.parseError,
        meta: {
          title: article.title,
          sourceDate: article.sourceDateFeishu,
          docLink: article.docLink,
          approvalStatus: article.approvalStatus,
        },
      });
      return { docId, outcome: 'unavailable' };
    }
    if (mapped.parseStatus === PARSE_STATUS_EMPTY) {
      await this.upsertCache(docId, {
        parseStatus: PARSE_STATUS_EMPTY,
        body: '',
        contentHash: sha256(''),
        baseUpdatedAt,
        parseError: mapped.parseError,
        meta: {
          title: article.title,
          sourceDate: article.sourceDateFeishu,
          docLink: article.docLink,
          approvalStatus: article.approvalStatus,
        },
      });
      await this.deactivate(docId, new Date());
      return { docId, outcome: 'empty' };
    }

    const hash = sha256(mapped.body);
    // L2：Base 记录被碰过但正文没变 → 只刷新时间戳，省掉一次匹配重算。
    if (cache && cache.contentHash === hash) {
      await this.upsertCache(docId, {
        parseStatus: PARSE_STATUS_READY,
        body: mapped.body,
        contentHash: hash,
        baseUpdatedAt,
        parseError: null,
        meta: {
          title: article.title,
          sourceDate: article.sourceDateFeishu,
          docLink: article.docLink,
          approvalStatus: article.approvalStatus,
        },
      });
      return { docId, outcome: 'skipped', skipped: 'l2' };
    }

    const drafts = draftMentions(mapped.body, terms);
    await this.writeProjection({ ...article, updateTime: baseUpdatedAt }, mapped.body, drafts);
    return { docId, outcome: 'matched', mentions: drafts.length };
  }

  /** 写投影：先落正文缓存，再 upsert 命中行，最后把本批次未命中的历史行置 inactive。 */
  private async writeProjection(
    article: WikiBetaArticleRow,
    body: string,
    drafts: MentionDraft[],
  ) {
    const docId = article.baseRecordId;
    const runAt = new Date();
    await this.upsertCache(docId, {
      parseStatus: PARSE_STATUS_READY,
      body,
      contentHash: sha256(body),
      baseUpdatedAt: article.updateTime,
      parseError: null,
      meta: {
        title: article.title,
        sourceDate: article.sourceDateFeishu,
        docLink: article.docLink,
        approvalStatus: article.approvalStatus,
      },
    });
    // G1/G5 投影侧：停用草稿**落 disabled 行**（不丢弃）。行在集合就在 ——
    // 读取侧的降级检查需要完整出现集合；若停用行不落库，读取侧会把
    // 「被精确停用」误判成「序号漂移」，词级兜底会误伤未停用的出现。
    // v2 实体链路退场（2026-10-09）：停用清单恒空 → 全部草稿按 ACTIVE 落库。
    const disabledIndexes = new Set<number>();
    const rows = drafts.map((draft, index) => ({
      id: randomUUID(),
      docId,
      entityId: draft.entityId,
      entityTerm: draft.term,
      occurrenceIndex: draft.occurrenceIndex,
      matchStart: draft.matchStart,
      matchEnd: draft.matchEnd,
      evidenceText: draft.evidenceText,
      status: disabledIndexes.has(index)
        ? MENTION_STATUS_DISABLED
        : MENTION_STATUS_ACTIVE,
      sourceField: MENTION_SOURCE_DICTIONARY,
      computedAt: runAt,
      updatedAt: runAt,
    }));
    if (rows.length) {
      await this.db
        .insert(entityMention)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            entityMention.docId,
            entityMention.entityId,
            entityMention.entityTerm,
            entityMention.occurrenceIndex,
          ],
          set: {
            status: sql`excluded.status`,
            matchStart: sql`excluded.match_start`,
            matchEnd: sql`excluded.match_end`,
            evidenceText: sql`excluded.evidence_text`,
            computedAt: runAt,
            updatedAt: runAt,
          },
        });
    }
    await this.deactivate(docId, runAt);
  }

  /**
   * 把本批次未命中的历史行置 inactive。
   *
   * 判据是 `computed_at < runAt` 而不是"不在命中集合里"：命中行刚被写成 runAt，
   * 因此任何 computedAt 更早且仍 active 的行必然是本次未命中的残留。
   * `source_field='dictionary_match'` 的过滤使人工行永不被自动任务触碰。
   */
  private async deactivate(docId: string, runAt: Date) {
    await this.db
      .update(entityMention)
      .set({ status: MENTION_STATUS_INACTIVE, updatedAt: runAt })
      .where(
        and(
          eq(entityMention.docId, docId),
          eq(entityMention.sourceField, MENTION_SOURCE_DICTIONARY),
          // active 与 disabled 都参与陈旧回收：正文修订后该出现已不存在，
          // 停用语义随之失效（重算会在草稿里以最新集合重新判定）。
          inArray(entityMention.status, [
            MENTION_STATUS_ACTIVE,
            MENTION_STATUS_DISABLED,
          ]),
          lt(entityMention.computedAt, runAt),
        ),
      );
  }

  /**
   * 文章元数据快照同步（P2a）：Base 行在手，四值比对变才写。
   *
   * - 缓存行不存在 → 直接 return：该 doc 随后会被 rematchWithCache 走完整
   *   upsert 路径写全，避免此处插入缺正文的残行。
   * - 全部一致 → return（零写放大，幂等）。
   * 必须在 rematchWithCache 之前调用，否则 L1 命中的行永远不会回填 meta。
   */
  private async syncMeta(
    article: WikiBetaArticleRow,
    cache: DocCacheMeta | null,
  ): Promise<void> {
    if (!cache) return;
    const meta: DocCacheMeta = {
      title: article.title,
      sourceDate: article.sourceDateFeishu,
      docLink: article.docLink,
      approvalStatus: article.approvalStatus,
    };
    if (
      cache.title === meta.title &&
      cache.sourceDate === meta.sourceDate &&
      cache.docLink === meta.docLink &&
      cache.approvalStatus === meta.approvalStatus
    ) {
      return;
    }
    await this.db
      .update(entityDocCache)
      .set({ ...meta, updatedAt: new Date() })
      .where(eq(entityDocCache.docId, article.baseRecordId));
  }

  private async upsertCache(
    docId: string,
    next: {
      parseStatus: ParseStatus;
      body: string;
      contentHash: string;
      baseUpdatedAt: Date | null;
      parseError: string | null;
      /** 文章元数据快照；未提供时不得写入这 4 列，否则会把存量值抹成 NULL。 */
      meta?: DocCacheMeta;
    },
  ) {
    const values = {
      docId,
      bodyMarkdown: next.body,
      contentHash: next.contentHash,
      bodyLength: next.body.length,
      baseUpdatedAt: next.baseUpdatedAt,
      parseStatus: next.parseStatus,
      parseError: next.parseError,
      parsedAt: new Date(),
      updatedAt: new Date(),
      ...(next.meta
        ? {
            title: next.meta.title,
            sourceDate: next.meta.sourceDate,
            docLink: next.meta.docLink,
            approvalStatus: next.meta.approvalStatus,
          }
        : {}),
    };
    await this.db
      .insert(entityDocCache)
      .values(values)
      .onConflictDoUpdate({
        target: entityDocCache.docId,
        set: {
          bodyMarkdown: values.bodyMarkdown,
          contentHash: values.contentHash,
          bodyLength: values.bodyLength,
          baseUpdatedAt: values.baseUpdatedAt,
          parseStatus: values.parseStatus,
          parseError: values.parseError,
          parsedAt: values.parsedAt,
          updatedAt: values.updatedAt,
          ...(next.meta
            ? {
                title: values.title,
                sourceDate: values.sourceDate,
                docLink: values.docLink,
                approvalStatus: values.approvalStatus,
              }
            : {}),
        },
      });
  }

  private async loadCaches(docIds?: string[]) {
    const query = this.db
      .select({
        docId: entityDocCache.docId,
        bodyMarkdown: entityDocCache.bodyMarkdown,
        contentHash: entityDocCache.contentHash,
        parseStatus: entityDocCache.parseStatus,
        baseUpdatedAt: entityDocCache.baseUpdatedAt,
        title: entityDocCache.title,
        sourceDate: entityDocCache.sourceDate,
        docLink: entityDocCache.docLink,
        approvalStatus: entityDocCache.approvalStatus,
      })
      .from(entityDocCache);
    const rows = docIds?.length
      ? await query.where(inArray(entityDocCache.docId, docIds))
      : await query;
    return new Map(rows.map((row) => [row.docId, row]));
  }

  private accumulate(result: SweepResult, outcome: DocumentRematchResult) {
    switch (outcome.outcome) {
      case 'matched':
        result.matched += 1;
        result.parsed += 1;
        result.mentions += outcome.mentions ?? 0;
        break;
      case 'skipped':
        if (outcome.skipped === 'l1') result.skippedL1 += 1;
        else result.skippedL2 += 1;
        if (outcome.skipped === 'l2') result.parsed += 1;
        break;
      case 'empty':
        result.parsed += 1;
        result.empty += 1;
        break;
      case 'unavailable':
        result.unavailable += 1;
        break;
      default:
        break;
    }
  }
}

/** 两个时间点是否表示同一时刻（Base 时间戳可能来自日期列或 last_modified_time）。 */
function sameMoment(left: Date | null, right: Date | null): boolean {
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}
