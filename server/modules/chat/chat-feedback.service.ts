import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  attributeFeedback,
  CHAT_FEEDBACK_REASONS,
  type ChatFeedbackAttribution,
  type ChatFeedbackReason,
} from './chat-feedback-attribution';
import {
  chatFeedback,
  CHAT_FEEDBACK_RATING_DOWN,
  CHAT_FEEDBACK_RATING_UP,
  CHAT_FEEDBACK_STATUS_BOUNDARY,
  CHAT_FEEDBACK_STATUS_NEW,
  type ChatFeedbackCitation,
  type ChatFeedbackContext,
} from './chat-feedback.schema';

/** 单轮问答 id 由前端 crypto.randomUUID() 生成（36 字符，含连字符）。 */
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_QUESTION = 2_000;
const MAX_SEARCH_QUERY = 1_200;
const MAX_ANSWER = 8_000;
const MAX_CITATIONS = 20;
const MAX_SNIPPET_LENS = 40;

/** 上报的原始请求体（控制器不做结构解析，白名单收敛只在本服务一处）。 */
export interface ChatFeedbackRawInput {
  turnId?: unknown;
  rating?: unknown;
  reason?: unknown;
  question?: unknown;
  searchQuery?: unknown;
  answer?: unknown;
  citations?: unknown;
  context?: unknown;
}

export interface ChatFeedbackResult {
  attribution: ChatFeedbackAttribution | null;
  /** 已落库的状态：boundary = 已知边界，不计入缺陷池。 */
  status: string;
}

/**
 * 问答反馈落库。
 *
 * 两条硬约束（见 scripts/migrations/033_chat_feedback.sql）：
 *  1. **好评不落文本**：差评率需要分母，但分母不需要内容。好评行只写 rating='up'，
 *     其余字段强制 NULL。LLM 配置（用户 BYO-Key）与问题同在一个请求体，
 *     故本服务**逐字段白名单读取**，绝不整包透传、绝不打 request body 日志。
 *  2. **归因由后台算**：前端只提供业务选项，技术归因由纯函数用信号细分。
 */
@Injectable()
export class ChatFeedbackService {
  private readonly logger = new Logger(ChatFeedbackService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 写入一轮反馈。同一 turnId 重复提交为 upsert（支持用户改选差评理由），
   * 天然幂等 —— 网络重试不产生重复行。
   */
  async record(raw: ChatFeedbackRawInput): Promise<ChatFeedbackResult> {
    const turnId = this.parseTurnId(raw.turnId);
    const rating = this.parseRating(raw.rating);

    if (rating === CHAT_FEEDBACK_RATING_UP) {
      return this.recordUp(turnId, raw);
    }

    const reason = this.parseReason(raw.reason);
    const question = this.pickString(raw.question, MAX_QUESTION);
    if (!question) {
      // 没有原始问题就无法归因，属调用方 bug（数据库侧也有同样的 CHECK）。
      throw new BadRequestException('差评必须携带 question');
    }
    const context = this.parseContext(raw.context);
    const citationList = this.parseCitations(raw.citations);
    const attribution = attributeFeedback({
      reason,
      citationDocIds: citationList.map((c) => c.docId),
      snippetLens: context?.snippetLens ?? [],
      external: context?.external ?? citationList.length === 0,
      truncated: context?.truncated ?? false,
      stopped: context?.stopped ?? false,
    });
    const status =
      attribution === 'boundary'
        ? CHAT_FEEDBACK_STATUS_BOUNDARY
        : CHAT_FEEDBACK_STATUS_NEW;

    await this.upsert({
      turnId,
      rating,
      reason,
      question,
      searchQuery: this.pickString(raw.searchQuery, MAX_SEARCH_QUERY),
      answer: this.pickString(raw.answer, MAX_ANSWER),
      citations: citationList,
      context,
      attribution,
      status,
    });
    this.logger.log(
      `chat feedback down: turn=${turnId} reason=${reason} attribution=${attribution ?? 'none'} status=${status} citations=${citationList.length}`,
    );
    return { attribution, status };
  }

  /**
   * 取消评分（用户再点一次 👍/👎 撤回）。物理删除 —— 撤回的评级不应留在分母里。
   * 返回是否确有一行被删（幂等：重复取消不报错）。
   */
  async remove(rawTurnId: unknown): Promise<{ removed: boolean }> {
    const turnId = this.parseTurnId(rawTurnId);
    const deleted = await this.db
      .delete(chatFeedback)
      .where(eq(chatFeedback.turnId, turnId))
      .returning({ turnId: chatFeedback.turnId });
    const removed = deleted.length > 0;
    if (removed) {
      this.logger.log(`chat feedback removed: turn=${turnId}`);
    }
    return { removed };
  }

  // ── 好评：只写分母 ──────────────────────────────────────────

  private async recordUp(
    turnId: string,
    raw: ChatFeedbackRawInput,
  ): Promise<ChatFeedbackResult> {
    // 好评若被塞了文本字段，说明前端有 bug。丢弃而非拒绝（不因前端 bug 让用户点不动），
    // 同时只记**字段名**告警以便定位 —— 绝不记录字段内容。
    const leaked = (
      ['question', 'searchQuery', 'answer', 'citations', 'context'] as const
    ).filter((key) => raw[key] !== undefined && raw[key] !== null);
    if (leaked.length) {
      this.logger.warn(
        `chat feedback up ignored text fields: turn=${turnId} fields=${leaked.join(',')}`,
      );
    }
    await this.upsert({
      turnId,
      rating: CHAT_FEEDBACK_RATING_UP,
      reason: null,
      question: null,
      searchQuery: null,
      answer: null,
      citations: null,
      context: null,
      attribution: null,
      status: CHAT_FEEDBACK_STATUS_NEW,
    });
    this.logger.log(`chat feedback up: turn=${turnId}`);
    return { attribution: null, status: CHAT_FEEDBACK_STATUS_NEW };
  }

  /**
   * upsert：先算全集再一条语句写入。**不用 db.transaction** ——
   * 平台运行时下事务异常会被吞成静默 no-op（历史踩坑）。
   */
  private async upsert(row: {
    turnId: string;
    rating: string;
    reason: ChatFeedbackReason | null;
    question: string | null;
    searchQuery: string | null;
    answer: string | null;
    citations: ChatFeedbackCitation[] | null;
    context: ChatFeedbackContext | null;
    attribution: ChatFeedbackAttribution | null;
    status: string;
  }): Promise<void> {
    const updatedAt = new Date();
    await this.db
      .insert(chatFeedback)
      .values({ id: randomUUID(), ...row, updatedAt })
      .onConflictDoUpdate({
        target: chatFeedback.turnId,
        set: { ...row, updatedAt },
      });
  }

  // ── 解析与白名单 ────────────────────────────────────────────

  private parseTurnId(value: unknown): string {
    const turnId = typeof value === 'string' ? value.trim() : '';
    if (!TURN_ID_PATTERN.test(turnId)) {
      throw new BadRequestException('turnId 非法');
    }
    return turnId;
  }

  private parseRating(value: unknown): string {
    if (value === CHAT_FEEDBACK_RATING_UP) return CHAT_FEEDBACK_RATING_UP;
    if (value === CHAT_FEEDBACK_RATING_DOWN) return CHAT_FEEDBACK_RATING_DOWN;
    throw new BadRequestException('rating 必须为 up 或 down');
  }

  private parseReason(value: unknown): ChatFeedbackReason {
    if (
      typeof value === 'string' &&
      (CHAT_FEEDBACK_REASONS as readonly string[]).includes(value)
    ) {
      return value as ChatFeedbackReason;
    }
    throw new BadRequestException(
      `reason 必须为 ${CHAT_FEEDBACK_REASONS.join(' / ')}`,
    );
  }

  /** 截断到上限；空串归一为 null（避免把空字段写成语义不明的空字符串）。 */
  private pickString(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  }

  private pickBoolean(value: unknown): boolean {
    return value === true;
  }

  private pickCount(value: unknown, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(max, Math.floor(value)));
  }

  /**
   * 上下文快照：**白名单键**逐个取，未知键一律丢弃。
   * 这是防「整包透传把 llmConfig 写进库」的关键一步。
   */
  private parseContext(value: unknown): ChatFeedbackContext | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const usageRaw = source.usage;
    const usage =
      typeof usageRaw === 'object' && usageRaw !== null && !Array.isArray(usageRaw)
        ? {
            promptTokens: this.pickCount(
              (usageRaw as Record<string, unknown>).promptTokens,
              100_000_000,
            ),
            completionTokens: this.pickCount(
              (usageRaw as Record<string, unknown>).completionTokens,
              100_000_000,
            ),
          }
        : null;
    const lensRaw = Array.isArray(source.snippetLens) ? source.snippetLens : [];
    return {
      external: this.pickBoolean(source.external),
      truncated: this.pickBoolean(source.truncated),
      stopped: this.pickBoolean(source.stopped),
      deep: this.pickBoolean(source.deep),
      historyTurns: this.pickCount(source.historyTurns, 100),
      snippetLens: lensRaw
        .slice(0, MAX_SNIPPET_LENS)
        .map((len) => this.pickCount(len, 100_000)),
      model: this.pickString(source.model, 120),
      usage,
    };
  }

  private parseCitations(value: unknown): ChatFeedbackCitation[] {
    if (!Array.isArray(value)) return [];
    const result: ChatFeedbackCitation[] = [];
    for (const item of value.slice(0, MAX_CITATIONS)) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const source = item as Record<string, unknown>;
      const docId = this.pickString(source.docId, 300);
      if (!docId) continue;
      result.push({
        docId,
        title: this.pickString(source.title, 500) ?? '',
        source: this.pickString(source.source, 20) ?? '',
        sourceDate: this.pickString(source.sourceDate, 40),
        // url 保留：呈现层「引用打不开」的归因证据就在它上面。
        url: this.pickString(source.url, 1_000) ?? '',
      });
    }
    return result;
  }
}
