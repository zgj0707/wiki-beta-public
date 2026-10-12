import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import type { EntityMatchTerm } from '../../common/entity/entity-matcher';

import { ArticlesService } from '../articles/articles.service';
import { entityRowCache } from '../wiki-beta/entity-mention.schema';
import { ChatMechanismSource } from './chat-mechanism-source';
import {
  resolveRankingIntent,
  resolveChatIntent,
  type ChatIntent,
  type ChatIntentContext,
} from './chat-intent';

/** 意图上下文缓存：实体/分类/机制词表变化都是分钟级，30s 足够新鲜。 */
const CTX_CACHE_TTL_MS = 30_000;

/** 实体词典「状态」门禁原文（与实体系统口径一致：仅「启用」进语料）。 */
const ENTITY_STATUS_ENABLED = '启用';

/**
 * 预置问答路径的意图识别服务（nav-tasks-p3b）：组装词表快照 → 调纯函数判定。
 *
 * 词表三来源：
 *  - 实体：PG entity_row_cache（投影快照，零 Base 读）；
 *  - 玩法分类：ArticlesService.facets()（Base 父项/子项枚举，60s TTL 直读）；
 *  - 机制：ChatMechanismSource.listDisplayTitles()（PG mechanism_observation）。
 * 任何一路失败都降级为空词表（对应路径退化为 fallback），绝不阻塞问答主链路。
 */
@Injectable()
export class ChatIntentService {
  private readonly logger = new Logger(ChatIntentService.name);
  private ctxCache: { at: number; ctx: ChatIntentContext } | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly articles: ArticlesService,
    private readonly mechanismSource: ChatMechanismSource,
  ) {}

  /** 判定问句意图；任何异常都回落 fallback（问答主链路不可被意图层拖垮）。 */
  async resolve(question: string): Promise<ChatIntent> {
    const rankingIntent = resolveRankingIntent(question);
    if (rankingIntent) return rankingIntent;

    try {
      const ctx = await this.loadContext();
      return resolveChatIntent(question, ctx);
    } catch (error) {
      this.logger.warn(
        `intent resolve failed (fallback): ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        kind: 'fallback',
        matchedTerm: null,
        entityId: null,
        boardKeys: [],
        categoryName: null,
      };
    }
  }

  /** 词典内某类型的实体名册（vendor 路径提取「旗下产品清单」用）。 */
  async entitiesByType(
    type: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const ctx = await this.loadContext();
    return [...ctx.entityById.entries()]
      .filter(([, entity]) => entity.type === type)
      .map(([id, entity]) => ({ id, name: entity.name }));
  }

  private async loadContext(): Promise<ChatIntentContext> {
    if (this.ctxCache && Date.now() - this.ctxCache.at < CTX_CACHE_TTL_MS) {
      return this.ctxCache.ctx;
    }
    const [entityPart, categoryNames, mechanismTitles] = await Promise.all([
      this.loadEntityPart(),
      this.loadCategoryNames(),
      this.mechanismSource.listDisplayTitles().catch(() => []),
    ]);
    const ctx: ChatIntentContext = {
      entityTerms: entityPart.terms,
      entityById: entityPart.byId,
      categoryNames,
      mechanismTitles,
    };
    this.ctxCache = { at: Date.now(), ctx };
    return ctx;
  }

  /** 实体词表：启用实体的 名称/规范化名称/别名（≥2 字），与提及投影 buildTerms 同口径。 */
  private async loadEntityPart(): Promise<{
    terms: EntityMatchTerm[];
    byId: Map<string, { name: string; type: string }>;
  }> {
    const rows = await this.db.select().from(entityRowCache);
    const terms: EntityMatchTerm[] = [];
    const byId = new Map<string, { name: string; type: string }>();
    for (const row of rows) {
      // row jsonb = WikiBetaEntityRow 序列化（updateTime 为 ISO 字符串，此处不关心）。
      const entity = row.row as {
        name?: string;
        normalizedName?: string;
        aliases?: string[];
        type?: string;
        status?: string;
      };
      if (!entity || entity.status !== ENTITY_STATUS_ENABLED) continue;
      const seen = new Set<string>();
      for (const raw of [
        entity.name,
        entity.normalizedName,
        ...(entity.aliases ?? []),
      ]) {
        const term = typeof raw === 'string' ? raw.trim() : '';
        if (term.length < 2 || seen.has(term)) continue;
        seen.add(term);
        terms.push({ entityId: row.baseRecordId, term });
      }
      byId.set(row.baseRecordId, {
        name: entity.name ?? row.baseRecordId,
        type: entity.type ?? '',
      });
    }
    return { terms, byId };
  }

  /** 玩法分类枚举：facets 的父项名 + 各父项下子项名（去重）。 */
  private async loadCategoryNames(): Promise<string[]> {
    const facets = await this.articles.facets();
    const names = new Set<string>();
    for (const node of facets.gameplay) {
      if (node.value) names.add(node.value);
      for (const child of node.children) {
        if (child.value) names.add(child.value);
      }
    }
    return [...names];
  }
}
