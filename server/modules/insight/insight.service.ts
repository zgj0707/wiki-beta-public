import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import {
  MECHANISM_REVIEW_STATUS_PUBLISHED,
  mechanismObservation,
  parseScoreColumn,
} from '../base-sync/base-sync-insight.schema';
import {
  MECHANISM_INNOVATION_SCORE_FIELD,
  MECHANISM_MARKET_SCORE_FIELD,
} from '../base-sync/base-sync.constants';
import { FeishuBaseReader } from '../wiki-beta/feishu-base-reader.service';
import { wikiBetaFieldIds, wikiBetaTableIds } from '../wiki-beta/wiki-beta-env';
import { APPROVAL_STATUS_PUBLISHED } from '../wiki-beta/publication-policy';

export interface MechanismGate {
  reviewStatus: typeof MECHANISM_REVIEW_STATUS_PUBLISHED;
  currentPublished: true;
}

/** Base「机制观察」行里用于补充列表/详情的附加字段（不含 PG 权威内容）。 */
interface MechanismBaseHit {
  recordId: string;
  figureToken: string | null;
  iconToken: string | null;
  cnName: string | null;
}

export interface MechanismListItem {
  stableKey: string;
  entryType: string | null;
  gameName: string | null;
  /** Base「机制」列：这条机制怎么转。 */
  coreHook: string | null;
  sourceLink: string | null;
  /**
   * 条目最后修改时间（Base 系统「更新时间」→ PG `review_time`）。
   * ⚠️ 2026-09-29 前该字段是「审核时间」，Base 侧该列已删除 ⇒ 语义已变；
   * 字段名同步改为 `updatedAt`，避免名字与内容不符再被误用。
   */
  updatedAt: Date | null;
  /**
   * 市场认可指数（Base「市场认可指数」，0.70–0.97 两位小数）。未填为 null。
   * PG 侧复用已下线的 text 列承载，此处已解析成 number 供前端排序/展示。
   */
  marketScore: number | null;
  /** 核心创新指数（Base「核心创新指数」，0.09–2.24 两位小数）。 */
  innovationScore: number | null;
  /**
   * 机制流程图站内代理地址（/media/mechanisms/:stableKey/flowchart?v=…）。
   * 来源是 Base「机制流程图」附件字段；未上传或 Base 读取失败时为 null，
   * 前端按「无图」渲染，不出现破图。
   */
  figureUrl: string | null;
  /**
   * 中文显示名，来源 Base「中文名」列（2026-09-20 新增）。官方中文名与
   * 试译混排，试译值以 `（试译）` 结尾，由前端拆成标签；未填为 null，
   * 前端回退到 `gameName`。
   */
  nameCn: string | null;
  /** 方形图标站内代理地址（/media/mechanisms/:stableKey/icon?v=…）；未上传为 null。 */
  iconUrl: string | null;
}

/** 机制观察详情（GET /api/mechanisms/:stableKey）。 */
export interface MechanismDetailData extends MechanismListItem {
  /** Base「优点」列。 */
  buyValue: string | null;
  /** Base「利用方法」列。 */
  reuseNote: string | null;
  reviewStatus: string | null;
  documentStatus: 'ready';
}

@Injectable()
export class InsightService {
  private readonly logger = new Logger(InsightService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly baseReader: FeishuBaseReader,
  ) {}

  /** 公开门禁：review_status='已发布' AND current_published=true（与 chat 机制来源同源常量）。 */
  private mechanismGate() {
    return and(
      eq(
        mechanismObservation.reviewStatus,
        MECHANISM_REVIEW_STATUS_PUBLISHED,
      ),
      eq(mechanismObservation.currentPublished, true),
    );
  }

  async listMechanisms(params: {
    search?: string;
    type?: string;
  }): Promise<{ items: MechanismListItem[]; total: number }> {
    const conditions = [this.mechanismGate()];
    if (params.search) {
      const pattern = `%${params.search}%`;
      conditions.push(
        or(
          ilike(mechanismObservation.gameName, pattern),
          ilike(mechanismObservation.coreHook, pattern),
          ilike(mechanismObservation.buyValue, pattern),
          ilike(mechanismObservation.reuseNote, pattern),
        )!,
      );
    }
    if (params.type) {
      conditions.push(eq(mechanismObservation.entryType, params.type));
    }
    const where = and(...conditions);

    const rows = await this.db
      .select({
        stableKey: mechanismObservation.stableKey,
        entryType: mechanismObservation.entryType,
        gameName: mechanismObservation.gameName,
        coreHook: mechanismObservation.coreHook,
        sourceLink: mechanismObservation.sourceLink,
        updatedAt: mechanismObservation.reviewTime,
        // 指数复用已下线的 text 列（零 DDL），出参前用同一处 parse 口径转 number。
        marketScoreText: mechanismObservation.genericFormula,
        innovationScoreText: mechanismObservation.operationThreshold,
      })
      .from(mechanismObservation)
      .where(where)
      .orderBy(sql`${mechanismObservation.reviewTime} DESC NULLS LAST`);

    const totalRows = await this.db
      .select({ value: count() })
      .from(mechanismObservation)
      .where(where);
    const total = Number(totalRows[0]?.value ?? 0);

    const index = await this.mechanismBaseIndex();
    return {
      items: rows.map(
        ({ marketScoreText, innovationScoreText, ...row }) => ({
          ...row,
          marketScore: parseScoreColumn(marketScoreText),
          innovationScore: parseScoreColumn(innovationScoreText),
          figureUrl: this.figureUrlFor(row.stableKey, index),
          iconUrl: this.iconUrlFor(row.stableKey, index),
          nameCn: this.nameCnFor(row.stableKey, index),
        }),
      ),
      total,
    };
  }

  async mechanismTrends(): Promise<{
    trends: Array<{ type: string; count: number }>;
  }> {
    const rows = await this.db
      .select({ type: mechanismObservation.entryType, value: count() })
      .from(mechanismObservation)
      .where(
        and(this.mechanismGate(), isNotNull(mechanismObservation.entryType)),
      )
      .groupBy(mechanismObservation.entryType)
      .orderBy(desc(count()));

    return {
      trends: rows.map((row) => ({
        type: row.type ?? '',
        count: Number(row.value),
      })),
    };
  }

  /**
   * 两个指数列的**字段描述**（Base 侧的方法论说明：分档含义、量纲），
   * 供前端悬停提示使用（机制列表的排序按钮 + 分值徽标）。
   *
   * 为什么直读 Base 而不是抄一份到前端常量：这段话属于「改了不该发版」的
   * 内容 ⇒ 走 `FeishuBaseReader` 的 60s TTL 直读链路，与 Base 始终同口径。
   *
   * 读不到时**降级为 null，不抛错**：悬停提示是锦上添花，不该因为它拿不到
   * 就让接口 500；前端拿到 null 直接不渲染提示，按钮功能不受影响。
   */
  async mechanismScoreHints(): Promise<{
    market: string | null;
    innovation: string | null;
  }> {
    try {
      const descriptions =
        await this.baseReader.listMechanismFieldDescriptions();
      return {
        market: descriptions[MECHANISM_MARKET_SCORE_FIELD] ?? null,
        innovation: descriptions[MECHANISM_INNOVATION_SCORE_FIELD] ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `[insight] mechanism score hints unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { market: null, innovation: null };
    }
  }

  async mechanismDetail(stableKey: string): Promise<MechanismDetailData> {
    const rows = await this.db
      .select({
        stableKey: mechanismObservation.stableKey,
        entryType: mechanismObservation.entryType,
        gameName: mechanismObservation.gameName,
        coreHook: mechanismObservation.coreHook,
        buyValue: mechanismObservation.buyValue,
        reuseNote: mechanismObservation.reuseNote,
        reviewStatus: mechanismObservation.reviewStatus,
        sourceLink: mechanismObservation.sourceLink,
        updatedAt: mechanismObservation.reviewTime,
        marketScoreText: mechanismObservation.genericFormula,
        innovationScoreText: mechanismObservation.operationThreshold,
      })
      .from(mechanismObservation)
      .where(
        and(
          eq(mechanismObservation.stableKey, stableKey),
          this.mechanismGate(),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row)
      throw new NotFoundException('Mechanism is not publicly available');

    // 无正文概念，documentStatus 恒为 ready。
    const index = await this.mechanismBaseIndex();
    const { marketScoreText, innovationScoreText, ...rest } = row;
    return {
      ...rest,
      marketScore: parseScoreColumn(marketScoreText),
      innovationScore: parseScoreColumn(innovationScoreText),
      documentStatus: 'ready',
      figureUrl: this.figureUrlFor(row.stableKey, index),
      iconUrl: this.iconUrlFor(row.stableKey, index),
      nameCn: this.nameCnFor(row.stableKey, index),
    };
  }

  /**
   * 流程图字节：服务端实时读 Base 取 token 后透传，与首页封面图同一条链路。
   *
   * 安全不变量：file_token 只能来自「按 stableKey 查到的 Base 行」，
   * 不接受客户端传入的 file_token / record_id，因此不存在拿任意 token
   * 代理任意文件的问题（同 `ArticlesService.getCoverImage`）。
   */
  async getMechanismFigure(
    stableKey: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const index = await this.mechanismBaseIndex();
    const hit = index.get(stableKey);
    if (!hit?.figureToken) throw new NotFoundException('Figure is not available');
    const figure = await this.baseReader.downloadAttachment(
      hit.recordId,
      hit.figureToken,
      wikiBetaFieldIds.mechanismFigure(),
      wikiBetaTableIds.mechanism(),
    );
    if (!figure) throw new NotFoundException('Figure is not available');
    return figure;
  }

  /** 方形图标字节；与流程图同一条「实时读 Base 取 token → 服务端透传」链路。 */
  async getMechanismIcon(
    stableKey: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const index = await this.mechanismBaseIndex();
    const hit = index.get(stableKey);
    if (!hit?.iconToken) throw new NotFoundException('Icon is not available');
    const icon = await this.baseReader.downloadAttachment(
      hit.recordId,
      hit.iconToken,
      wikiBetaFieldIds.mechanismIcon(),
      wikiBetaTableIds.mechanism(),
    );
    if (!icon) throw new NotFoundException('Icon is not available');
    return icon;
  }

  /**
   * 「稳定键 → Base 行附加信息」索引：流程图 token、图标 token、中文名。
   * PG 是内容权威，Base 只做补充；因此 Base 读取异常（网络/鉴权/超时）
   * 一律吞掉并降级为空索引，绝不让 /api/mechanisms 与
   * /api/mechanisms/:stableKey 变成 500。
   *
   * 三列取自**同一次** `listMechanismRows()`（reader 侧 60s 表缓存），
   * 因此补充中文名与图标不增加任何 Base 请求。
   */
  private async mechanismBaseIndex(): Promise<Map<string, MechanismBaseHit>> {
    try {
      const rows = await this.baseReader.listMechanismRows();
      const index = new Map<string, MechanismBaseHit>();
      for (const row of rows) {
        // 三列全空的行不入索引：避免用空记录覆盖「无图无中文名」的默认语义。
        if (
          !row.stableKey ||
          (!row.figureFileToken && !row.iconFileToken && !row.nameCn)
        )
          continue;
        index.set(row.stableKey, {
          recordId: row.baseRecordId,
          figureToken: row.figureFileToken ?? null,
          iconToken: row.iconFileToken ?? null,
          cnName: row.nameCn ?? null,
        });
      }
      return index;
    } catch (error) {
      this.logger.warn(
        `[insight] mechanism base index unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  /**
   * 站内代理 URL。`v=` 取 token 前 8 位：响应是 `immutable` 长缓存，
   * 换图后 token 变 → URL 变，换图立刻生效（同首页 coverUrl）。
   */
  private figureUrlFor(
    stableKey: string,
    index: Map<string, MechanismBaseHit>,
  ): string | null {
    const token = index.get(stableKey)?.figureToken;
    if (!token) return null;
    return `/media/mechanisms/${encodeURIComponent(stableKey)}/flowchart?v=${encodeURIComponent(token.slice(0, 8))}`;
  }

  private iconUrlFor(
    stableKey: string,
    index: Map<string, MechanismBaseHit>,
  ): string | null {
    const token = index.get(stableKey)?.iconToken;
    if (!token) return null;
    return `/media/mechanisms/${encodeURIComponent(stableKey)}/icon?v=${encodeURIComponent(token.slice(0, 8))}`;
  }

  private nameCnFor(
    stableKey: string,
    index: Map<string, MechanismBaseHit>,
  ): string | null {
    return index.get(stableKey)?.cnName ?? null;
  }
}
