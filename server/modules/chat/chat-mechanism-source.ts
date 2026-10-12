import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';

import { displayNameOf } from '@shared/mechanism-display-name';

import {
  MECHANISM_REVIEW_STATUS_PUBLISHED,
  mechanismObservation,
  parseScoreColumn,
} from '../base-sync/base-sync-insight.schema';
import {
  extractKeywords,
  MECHANISM_SOURCE_PREFIX,
  MULTI_QUERY_BONUS,
  scoreByKeywords,
  type RetrievedDoc,
} from './chat-retrieval-common';
import { buildMechanismSnippet } from './chat-snippet';

/**
 * 机制来源配额：至多 3 条，独立于文章的 TOP_K=10。
 * 用户 2026-09-20 定：从 5 降到 3，压 prompt 成本（每条约 500 字）。
 */
export const MECHANISM_TOP_K = 3;

interface MechanismCandidate {
  stableKey: string;
  /** Base「中文名」（同步落在已下线的 `mechanism_title` 列，见 base-sync-insight.service.ts）。 */
  nameCn: string | null;
  entryType: string | null;
  gameName: string | null;
  coreHook: string | null;
  buyValue: string | null;
  reuseNote: string | null;
  marketScoreText: string | null;
  innovationScoreText: string | null;
  /**
   * PG `review_time`，2026-09-29 起承载 Base 系统「更新时间」（原「审核时间」列已删）。
   * 用途：引用条目的日期 + 同分并列时的稳定次序。
   */
  updatedAt: Date | null;
}

/**
 * chat 的「机制观察」来源（来源扩展 phase 1，见
 * `design/chat-mechanism-source-plan.md`）。
 *
 * 为什么独立成分、不与文章混排：两个来源的候选**分数不可比**——文章片段约
 * 1800 字、机制三段合计仅数百字，同一套「命中次数累加」打分下机制天然吃亏，
 * 混排会让机制条目几乎永远挤不进候选。故机制走**独立配额**，各自排序后再拼接。
 *
 * 语料只读 PG `mechanism_observation`（零 Base 读，与机制观察页的实时读 Base
 * 口径互补：这里要的是可检索文本，不是图标/展示态）。
 */
@Injectable()
export class ChatMechanismSource {
  private readonly logger = new Logger(ChatMechanismSource.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 取门禁内的机制条目（现网 37 行）后在内存打分。
   *
   * 不做 SQL ILIKE：表量极小，内存打分省掉一套 `AnyPgColumn` 条件拼接，
   * 也让门槛与「多路改写合并」逻辑与文章侧共用同一份实现（口径只能有一处）。
   */
  async retrieve(questions: string[]): Promise<RetrievedDoc[]> {
    const unique = [...new Set(questions.map((q) => q.trim()).filter(Boolean))];
    if (!unique.length) return [];
    const rows = await this.loadCandidates();
    if (!rows.length) return [];

    const merged = new Map<
      string,
      { doc: RetrievedDoc; best: number; hits: number }
    >();
    for (const question of unique) {
      const keywords = extractKeywords(question);
      if (!keywords.length) continue;
      for (const row of rows) {
        // 显示名派生走 shared 的唯一实现（与机制页主标题逐字同口径：
        // 剥「（试译）」后缀 + 解码 HTML 实体），此处不得就地拼 nameCn ?? gameName。
        const display = displayNameOf(row);
        const { score } = scoreByKeywords(
          // 检索要认**所有名称变体**（中文名 + 英文名），展示才只认主标题——
          // 否则有中文名时问英文名命中不了标题，只剩正文低分被门槛挡掉。
          [display.primary, display.secondary].filter(Boolean).join(' '),
          mechanismBodyOf(row),
          keywords,
        );
        // 门槛：至少一处关键词命中才入选。恒定占满配额会让每次提问都被
        // 无关机制条目污染并白烧 prompt token（「上限 + 门槛」，不是固定条数）。
        if (score <= 0) continue;
        const docId = `${MECHANISM_SOURCE_PREFIX}${row.stableKey}`;
        const entry = merged.get(docId);
        if (entry) {
          entry.hits += 1;
          entry.best = Math.max(entry.best, score);
          continue;
        }
        merged.set(docId, {
          doc: {
            docId,
            title: display.primary,
            sourceDate: formatDate(row.updatedAt),
            url: `/mechanism-observatory/${encodeURIComponent(row.stableKey)}`,
            snippet: buildMechanismContentSnippet(row),
            score,
            matchedEntities: [],
            source: 'mechanism',
          },
          best: score,
          hits: 1,
        });
      }
    }

    const picked = [...merged.values()]
      .map(({ doc, best, hits }) => ({
        ...doc,
        score: best + (hits - 1) * MULTI_QUERY_BONUS,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          // 同分并列按更新时间倒序——消除截断任意性，新条目优先。
          (b.sourceDate ?? '').localeCompare(a.sourceDate ?? ''),
      )
      .slice(0, MECHANISM_TOP_K);

    this.logger.log(
      `chat mechanism retrieve: rows=${rows.length} queries=${unique.length} picked=${picked.length}`,
    );
    return picked;
  }

  private async loadCandidates(): Promise<MechanismCandidate[]> {
    const rows = await this.db
      .select({
        stableKey: mechanismObservation.stableKey,
        nameCn: mechanismObservation.mechanismTitle,
        entryType: mechanismObservation.entryType,
        gameName: mechanismObservation.gameName,
        coreHook: mechanismObservation.coreHook,
        buyValue: mechanismObservation.buyValue,
        reuseNote: mechanismObservation.reuseNote,
        marketScoreText: mechanismObservation.genericFormula,
        innovationScoreText: mechanismObservation.operationThreshold,
        updatedAt: mechanismObservation.reviewTime,
      })
      .from(mechanismObservation)
      .where(
        and(
          eq(
            mechanismObservation.reviewStatus,
            MECHANISM_REVIEW_STATUS_PUBLISHED,
          ),
          eq(mechanismObservation.currentPublished, true),
        ),
      );
    // 三段皆空的条目没有可送进 prompt 的内容；标题命中也不该把它带进来。
    return rows.filter((row) => !!(row.coreHook || row.buyValue || row.reuseNote));
  }

  /**
   * 全部门禁内条目的显示名（意图识别用，nav-tasks-p3b）。
   * 派生与 retrieve() 逐字同口径（displayNameOf），供纯函数意图匹配做词表。
   */
  async listDisplayTitles(): Promise<
    Array<{ stableKey: string; primary: string; secondary: string }>
  > {
    const rows = await this.loadCandidates();
    return rows.map((row) => {
      const display = displayNameOf(row);
      return {
        stableKey: row.stableKey,
        primary: display.primary,
        secondary: display.secondary ?? '',
      };
    });
  }
}

/**
 * 展示名派生见 `shared/mechanism-display-name.ts`（唯一实现，客户端与服务端共用）。
 * 曾在此就地复刻 fallback 兜底：漏掉「（试译）后缀剥离」与「HTML 实体解码」，
 * 会让引用标题与机制页主标题不一致——故删除本地实现改为直接调用。
 */

/** 机制条目的「正文」= 三段拼接；打分与片段构建共用同一份文本，避免「命中了却看不见」。 */
function mechanismBodyOf(row: MechanismCandidate): string {
  const marketScore = parseScoreColumn(row.marketScoreText);
  const innovationScore = parseScoreColumn(row.innovationScoreText);
  return [
    row.nameCn ? `中文名：${row.nameCn}` : '',
    row.entryType ? `条目类型：${row.entryType}` : '',
    marketScore == null ? '' : `市场认可度指数：${marketScore.toFixed(2)}`,
    innovationScore == null ? '' : `核心创新指数：${innovationScore.toFixed(2)}`,
    row.coreHook,
    row.buyValue,
    row.reuseNote,
  ]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

function buildMechanismContentSnippet(row: MechanismCandidate): string {
  const marketScore = parseScoreColumn(row.marketScoreText);
  const innovationScore = parseScoreColumn(row.innovationScoreText);
  const pageFields = [
    row.entryType ? `【类型】${row.entryType}` : '',
    marketScore == null ? '' : `【市场认可度指数】${marketScore.toFixed(2)}`,
    innovationScore == null ? '' : `【核心创新指数】${innovationScore.toFixed(2)}`,
  ].filter(Boolean);
  return [pageFields.join('；'), buildMechanismSnippet(row)]
    .filter(Boolean)
    .join('\n');
}

/** 更新时间 → YYYY-MM-DD；无值返回 null（prompt 与引用列表显示「未知」）。 */
function formatDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
