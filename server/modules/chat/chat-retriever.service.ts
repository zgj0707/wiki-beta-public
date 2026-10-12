import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  findEntityTextMatches,
  type EntityMatchTerm,
} from '../../common/entity/entity-matcher';
import { APPROVAL_STATUS_PUBLISHED } from '../wiki-beta/publication-policy';
import {
  entityDocCache,
  entityMention,
  MENTION_STATUS_ACTIVE,
  PARSE_STATUS_READY,
} from '../wiki-beta/entity-mention.schema';
import { buildStructuredSnippet } from './chat-snippet';
import { ChatMechanismSource } from './chat-mechanism-source';
import {
  ARTICLE_SOURCE_PREFIX,
  extractKeywords,
  MULTI_QUERY_BONUS,
  SCORE_ENTITY_HIT,
  scoreByKeywords,
  type RetrievedDoc,
} from './chat-retrieval-common';

/** 文章配额。机制来源另有独立配额（`MECHANISM_TOP_K`），两者相加为进 prompt 的总条数。 */
const TOP_K = 10;

/**
 * Chatbot 检索器（**文章来源通道**）：语料 = entity_doc_cache（正文快照），
 * 门禁 = parse_status='ready' 且 approval_status='已批准'（与 publication-policy SSOT 对齐）。
 * 召回两级：①问句命中实体词典 → entity_mention 反查关联文章（权重高）；
 * ②中文 bigram / 英文原词 ILIKE 兜底。零 Base 读，纯 PG。
 *
 * 每篇送入 prompt 的片段预算 1800 字（大纲 + 命中窗口 + 节首/末节选，见
 * chat-snippet.ts）：10 篇 × 1800 字与早期 15 篇 × 1200 字的输入 token 持平。
 *
 * ⚠️ `retrieve()` / `retrieveQueries()` **只返回文章来源**（回归脚本
 * `scripts/eval-chat-retrieval.mjs` 依赖该语义）；跨来源结果用
 * `retrieveAll()` / `retrieveAllQueries()`，机制观察走独立配额通道。
 */
@Injectable()
export class ChatRetrieverService {
  private readonly logger = new Logger(ChatRetrieverService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mechanismSource: ChatMechanismSource,
  ) {}

  async retrieve(question: string): Promise<RetrievedDoc[]> {
    // 关键词抽取已抽到 chat-retrieval-common（机制来源共用同一口径）。
    const keywords = extractKeywords(question);
    const [entityResult, keywordDocIds] = await Promise.all([
      this.findEntityHitDocs(question),
      this.findKeywordDocIds(keywords),
    ]);
    const entityHits = entityResult.counts;

    // 候选合并：实体命中优先，关键词补充，最多取 40 篇进入打分。
    const candidates = new Map<string, number>(); // docId -> entityHitCount
    for (const [docId, count] of entityHits) candidates.set(docId, count);
    for (const docId of keywordDocIds) {
      if (!candidates.has(docId)) candidates.set(docId, 0);
    }
    if (!candidates.size) return [];
    const docIds = [...candidates.keys()].slice(0, 40);

    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        title: entityDocCache.title,
        sourceDate: entityDocCache.sourceDate,
        body: entityDocCache.bodyMarkdown,
      })
      .from(entityDocCache)
      .where(
        and(
          inArray(entityDocCache.docId, docIds),
          eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
          eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
        ),
      );

    const scored = rows
      .map((row) => {
        const body = row.body ?? '';
        const title = row.title ?? '';
        const { score, firstHitIndex } = scoreByKeywords(
          title,
          body,
          keywords,
          (candidates.get(row.docId) ?? 0) * SCORE_ENTITY_HIT,
        );
        return {
          // ⚠️ docId 必须带来源前缀：机制条目的键与文章 record_id 共处同一候选池，
          // 裸 id 撞键会**静默丢文档**（见 chat-retrieval-common.ts）。查库仍用裸 id。
          docId: `${ARTICLE_SOURCE_PREFIX}${row.docId}`,
          title,
          sourceDate: row.sourceDate,
          url: `/article/${row.docId}`,
          snippet: buildStructuredSnippet(body, keywords, firstHitIndex),
          score,
          // 实体词按**裸 id** 回填：docId 已加前缀，用前缀键查表会静默查空。
          matchedEntities: entityResult.termsByDoc.get(row.docId) ?? [],
          source: 'article' as const,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          // 同分并列按来源日期倒序——消除截断任意性，新资料优先。
          (b.sourceDate ?? '').localeCompare(a.sourceDate ?? ''),
      )
      .slice(0, TOP_K);

    this.logger.log(
      `chat retrieve: qLen=${question.length} keywords=${keywords.length} entityDocs=${entityHits.size} keywordDocs=${keywordDocIds.length} picked=${scored.length} topScore=${scored[0]?.score ?? 0}`,
    );
    return scored;
  }

  /**
   * 多查询召回（深度检索 B1）：每路独立跑完整检索，按 docId 合并——
   * 分数取各路最高分，并叠加「多路同时命中」加成（每多一路 +2，多路改写
   * 都召回的文章是强信号），合并实体命中词后重排取 TOP_K。
   */
  async retrieveQueries(queries: string[]): Promise<RetrievedDoc[]> {
    const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
    if (unique.length <= 1) return this.retrieve(unique[0] ?? '');
    const results = await Promise.all(unique.map((q) => this.retrieve(q)));
    const merged = new Map<
      string,
      { doc: RetrievedDoc; best: number; hits: number }
    >();
    for (const docs of results) {
      for (const doc of docs) {
        const entry = merged.get(doc.docId);
        if (!entry) {
          merged.set(doc.docId, { doc, best: doc.score, hits: 1 });
        } else {
          entry.hits += 1;
          entry.best = Math.max(entry.best, doc.score);
          entry.doc.matchedEntities = [
            ...new Set([...entry.doc.matchedEntities, ...doc.matchedEntities]),
          ];
        }
      }
    }
    return [...merged.values()]
      .map(({ doc, best, hits }) => ({
        ...doc,
        score: best + (hits - 1) * MULTI_QUERY_BONUS,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
  }

  /**
   * 跨来源检索（单问句）：文章 top 10 + 机制观察 top ≤5。
   *
   * 两路**并行**、各自排序、各自配额，最后拼接——不做跨来源分数归一化：
   * 两边片段体量差 4 倍（1800 字 vs 数百字），「命中次数累加」的分数本就不可比，
   * 强行归一化只会引入不可解释的权重。文章在前（用户 2026-09-20 定：文章为
   * 主要依据、机制观察作补充），顺序顺带给模型一个偏好信号。
   */
  async retrieveAll(question: string): Promise<RetrievedDoc[]> {
    const [articles, mechanisms] = await Promise.all([
      this.retrieve(question),
      this.mechanismSource.retrieve([question]),
    ]);
    return this.mergeSources(articles, mechanisms);
  }

  /** 跨来源检索（多路改写，深度检索用）：两来源各自多路合并后拼接。 */
  async retrieveAllQueries(queries: string[]): Promise<RetrievedDoc[]> {
    const [articles, mechanisms] = await Promise.all([
      this.retrieveQueries(queries),
      this.mechanismSource.retrieve(queries),
    ]);
    return this.mergeSources(articles, mechanisms);
  }

  private mergeSources(
    articles: RetrievedDoc[],
    mechanisms: RetrievedDoc[],
  ): RetrievedDoc[] {
    // 机制为空时不留日志噪声——绝大多数问句不命中机制语料属正常。
    if (!mechanisms.length) return articles;
    this.logger.log(
      `chat retrieve sources: article=${articles.length} mechanism=${mechanisms.length}`,
    );
    return [...articles, ...mechanisms];
  }

  /** 问句 → 命中实体 → 关联文章（active 提及）。返回每篇命中实体数与实体词。 */
  private async findEntityHitDocs(question: string): Promise<{
    counts: Map<string, number>;
    termsByDoc: Map<string, string[]>;
  }> {
    const termsByDoc = new Map<string, string[]>();
    const termRows = await this.db
      .selectDistinct({
        entityId: entityMention.entityId,
        term: entityMention.entityTerm,
      })
      .from(entityMention)
      .where(eq(entityMention.status, MENTION_STATUS_ACTIVE));
    const terms: EntityMatchTerm[] = termRows.map((row) => ({
      entityId: row.entityId,
      term: row.term,
    }));
    if (!terms.length) return { counts: new Map(), termsByDoc };
    const matches = findEntityTextMatches(question, terms);
    if (!matches.length) return { counts: new Map(), termsByDoc };
    const entityIds = [...new Set(matches.map((m) => m.entityId))];

    const mentionRows = await this.db
      .select({
        docId: entityMention.docId,
        entityId: entityMention.entityId,
        entityTerm: entityMention.entityTerm,
      })
      .from(entityMention)
      .where(
        and(
          inArray(entityMention.entityId, entityIds),
          eq(entityMention.status, MENTION_STATUS_ACTIVE),
        ),
      );

    const docCounts = new Map<string, number>();
    for (const row of mentionRows) {
      docCounts.set(row.docId, (docCounts.get(row.docId) ?? 0) + 1);
      const termsOfDoc = termsByDoc.get(row.docId) ?? [];
      if (!termsOfDoc.includes(row.entityTerm)) termsOfDoc.push(row.entityTerm);
      termsByDoc.set(row.docId, termsOfDoc);
    }
    return { counts: docCounts, termsByDoc };
  }

  /**
   * 实体聚焦检索（nav-tasks-p3b 厂商/产品路径）：语料限定为「该实体的 active
   * 提及文章」，跳过通用关键词召回。vendor 路径另传产品名册，提取与该厂商
   * 同篇共现的产品实体名（产品清单提示的数据源——实体关系表已废弃，共现投影
   * 是当前唯一可用的厂商→产品信号）。
   */
  async retrieveForEntity(
    question: string,
    entityId: string,
    productEntities: Array<{ id: string; name: string }> = [],
  ): Promise<{ docs: RetrievedDoc[]; coMentionedProductNames: string[] }> {
    const keywords = extractKeywords(question);
    const mentionRows = await this.db
      .select({ docId: entityMention.docId, entityId: entityMention.entityId })
      .from(entityMention)
      .where(
        and(
          eq(entityMention.entityId, entityId),
          eq(entityMention.status, MENTION_STATUS_ACTIVE),
        ),
      );
    // 同篇多词命中只计一篇；docId 顺序稳定（按提及行自然序）。
    const docIds = [...new Set(mentionRows.map((row) => row.docId))];
    if (!docIds.length) return { docs: [], coMentionedProductNames: [] };

    // 产品共现：限定在该厂商的文章集合内查产品实体的提及。
    let coMentionedProductNames: string[] = [];
    if (productEntities.length) {
      const productIdByName = new Map(
        productEntities.map((product) => [product.id, product.name]),
      );
      const productIds = [...productIdByName.keys()];
      const productRows = await this.db
        .select({
          docId: entityMention.docId,
          entityId: entityMention.entityId,
        })
        .from(entityMention)
        .where(
          and(
            inArray(entityMention.entityId, productIds),
            eq(entityMention.status, MENTION_STATUS_ACTIVE),
          ),
        );
      const coSet = new Set<string>();
      for (const row of productRows) {
        if (!docIds.includes(row.docId)) continue;
        const name = productIdByName.get(row.entityId);
        if (name) coSet.add(name);
      }
      coMentionedProductNames = [...coSet];
    }

    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        title: entityDocCache.title,
        sourceDate: entityDocCache.sourceDate,
        body: entityDocCache.bodyMarkdown,
      })
      .from(entityDocCache)
      .where(
        and(
          inArray(entityDocCache.docId, docIds),
          eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
          eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
        ),
      );

    const docs = rows
      .map((row) => {
        const body = row.body ?? '';
        const title = row.title ?? '';
        const { score, firstHitIndex } = scoreByKeywords(title, body, keywords);
        return {
          docId: `${ARTICLE_SOURCE_PREFIX}${row.docId}`,
          title,
          sourceDate: row.sourceDate,
          url: `/article/${row.docId}`,
          snippet: buildStructuredSnippet(body, keywords, firstHitIndex),
          score,
          matchedEntities: [],
          source: 'article' as const,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.sourceDate ?? '').localeCompare(a.sourceDate ?? ''),
      )
      .slice(0, TOP_K);

    this.logger.log(
      `chat retrieveForEntity: entity=${entityId} mentionDocs=${docIds.length} picked=${docs.length} products=${coMentionedProductNames.length}`,
    );
    return { docs, coMentionedProductNames };
  }

  /**
   * 扩展词检索（品类路径）：在通用召回之上，把分类枚举名整词并入 ILIKE 候选——
   * 「开箱like」这类中英混排词的 bigram 拆分打不中标题，必须整词匹配。
   */
  async retrieveWithExtraTerms(
    question: string,
    extraTerms: string[],
  ): Promise<RetrievedDoc[]> {
    const keywords = extractKeywords(question);
    const merged = [...new Set([...extraTerms, ...keywords])].filter(Boolean);
    const [entityResult, keywordDocIds] = await Promise.all([
      this.findEntityHitDocs(question),
      this.findKeywordDocIds(merged),
    ]);
    const entityHits = entityResult.counts;
    const candidates = new Map<string, number>();
    for (const [docId, count] of entityHits) candidates.set(docId, count);
    for (const docId of keywordDocIds) {
      if (!candidates.has(docId)) candidates.set(docId, 0);
    }
    if (!candidates.size) return [];
    const docIds = [...candidates.keys()].slice(0, 40);

    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        title: entityDocCache.title,
        sourceDate: entityDocCache.sourceDate,
        body: entityDocCache.bodyMarkdown,
      })
      .from(entityDocCache)
      .where(
        and(
          inArray(entityDocCache.docId, docIds),
          eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
          eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
        ),
      );

    return rows
      .map((row) => {
        const body = row.body ?? '';
        const title = row.title ?? '';
        const { score, firstHitIndex } = scoreByKeywords(
          title,
          body,
          merged,
          (candidates.get(row.docId) ?? 0) * SCORE_ENTITY_HIT,
        );
        return {
          docId: `${ARTICLE_SOURCE_PREFIX}${row.docId}`,
          title,
          sourceDate: row.sourceDate,
          url: `/article/${row.docId}`,
          snippet: buildStructuredSnippet(body, keywords, firstHitIndex),
          score,
          matchedEntities: entityResult.termsByDoc.get(row.docId) ?? [],
          source: 'article' as const,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.sourceDate ?? '').localeCompare(a.sourceDate ?? ''),
      )
      .slice(0, TOP_K);
  }

  /**
   * 关键词 ILIKE 兜底（最多 40 篇候选）：标题命中优先全收——标题是强信号，
   * 通用词（如「上周」）的正文命中动辄数百篇，若与正文混在一个 limit 40 里
   * 无序截断，会把真正要找的文档（如某期周报）挤出候选池；正文命中只补足
   * 剩余名额。
   */
  private async findKeywordDocIds(keywords: string[]): Promise<string[]> {
    if (!keywords.length) return [];
    const likeConditions = (column: AnyPgColumn) =>
      sql`(${sql.join(
        keywords.flatMap((keyword) => [sql`${column} ILIKE ${`%${keyword}%`}`]),
        sql` OR `,
      )})`;
    const gate = and(
      eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
      eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
    );
    const titleRows = await this.db
      .select({ docId: entityDocCache.docId })
      .from(entityDocCache)
      .where(and(gate, likeConditions(entityDocCache.title)))
      .limit(40);
    const titleDocIds = titleRows.map((row) => row.docId);
    const remaining = 40 - titleDocIds.length;
    if (remaining <= 0) return titleDocIds;
    const bodyRows = await this.db
      .select({ docId: entityDocCache.docId })
      .from(entityDocCache)
      .where(
        and(
          gate,
          likeConditions(entityDocCache.bodyMarkdown),
          notInArray(entityDocCache.docId, titleDocIds),
        ),
      )
      .limit(remaining);
    return [...titleDocIds, ...bodyRows.map((row) => row.docId)];
  }
}
