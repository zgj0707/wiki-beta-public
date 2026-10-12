import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AiConfigService } from './ai-config.service';
import { ChatAdminService } from './chat-admin.service';
import { ChatFeedbackService } from './chat-feedback.service';
import { ChatIpUsageService } from './chat-ip-usage.service';
import { ChatService, type ChatTurn } from './chat.service';
import {
  isDailyLimitExceeded,
  resolveDailyLimitFromEnv,
} from './chat-daily-limit';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
/**
 * 反馈上限刻意远宽于问答（10/分）：用户改选理由、撤回、连点都是正常行为，
 * 用问答的桶会把这些操作误判成攻击而拦掉。
 */
const FEEDBACK_RATE_LIMIT_MAX = 60;
const MAX_HISTORY_MESSAGES = 8;

/** 日限额软提示文案（方案 §4.3：软提示非硬断，指路 BYO-Key）。 */
const DAILY_LIMIT_MESSAGE =
  '今日 AI 问答额度已用完，在「AI 设置」里配置自己的 API Key 可继续使用（不限次数）';

/** 日限额超限：429 + 结构化 code，前端据此给软提示而非当故障报错。 */
class DailyLimitException extends HttpException {
  constructor() {
    super({ code: 'daily_limit', message: DAILY_LIMIT_MESSAGE }, 429);
  }
}

/**
 * 判定 socket 对端是否为可信代理（私网/回环）。
 * 仅当直连方是自家网关时才采信 X-Forwarded-For，且只取最后一个条目
 * （由本方 LB 追加，客户端无法伪造）——防止伪造 xff 换桶绕过限流。
 */
function isTrustedProxyAddress(addr: string): boolean {
  const a = addr.replace(/^::ffff:/i, '').toLowerCase();
  return (
    a === 'unknown' ||
    a === '::1' ||
    a === '127.0.0.1' ||
    a.startsWith('10.') ||
    a.startsWith('192.168.') ||
    a.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    a.startsWith('fe80:') ||
    a.startsWith('fc') ||
    a.startsWith('fd')
  );
}

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
  /** BYO-Key：访客在「AI 设置」里配置的接入信息，透传给 Provider（内存中转，不落库不日志）。 */
  llmConfig?: unknown;
  /** 深度检索：多路改写查询（每路 ≤300 字，最多 4 路）。 */
  queries?: unknown;
  /** 深度检索：片段相关度过滤白名单（客户端打分回传，最多 20 个 docId）。 */
  docIds?: unknown;
}

/** 解析深度检索的多路查询；非法输入静默降级为 undefined（单路检索）。 */
function parseQueries(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const queries = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 4);
  return queries.length ? queries : undefined;
}

/** 解析片段过滤白名单；空数组 = 打分判定全不相关（外部模式），予以保留。 */
function parseDocIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * 公开问答接口。防护：消息长度上限 + 历史 ≤8 条 + 简易 IP 限流（内存计数）。
 */
@Controller('api/chat')
export class ChatController {
  /** ip -> 窗口起点内的请求时间戳列表。 */
  private readonly rateBuckets = new Map<string, number[]>();
  /** 反馈独立配额桶（与问答互不影响）。 */
  private readonly feedbackBuckets = new Map<string, number[]>();
  private readonly logger = new Logger(ChatController.name);
  /** 全局日限额（env CHAT_DAILY_LIMIT，默认 100；单 IP 可覆盖，见台账表）。 */
  private readonly dailyLimit = resolveDailyLimitFromEnv(
    process.env.CHAT_DAILY_LIMIT,
  );

  constructor(
    private readonly chatService: ChatService,
    private readonly chatFeedback: ChatFeedbackService,
    private readonly aiConfig: AiConfigService,
    private readonly ipUsage: ChatIpUsageService,
  ) {}

  /**
   * 站点默认 LLM 配置的**公开快照**（前端「默认档」开关用）。
   * 🔴 只暴露模型名与网关主机名，**绝不返回 apiKey**。
   */
  @Get('llm-default')
  async llmDefault(@Res() res: Response): Promise<void> {
    const config = await this.aiConfig.resolve();
    let host: string | null = null;
    try {
      host = config ? new URL(config.baseUrl).host : null;
    } catch {
      host = null;
    }
    res.json({
      available: config !== null,
      model: config?.model ?? null,
      baseUrlHost: host,
    });
  }

  /** 非流式（B1 验收 / 降级调用）。 */
  @Post()
  async answer(
    @Body() body: ChatRequestBody,
    @Res() res: Response,
  ): Promise<void> {
    const { question, history, ip } = this.parseRequest(body, res);
    this.enforceRateLimit(ip);
    await this.enforceDailyLimit(ip, body);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const result = await this.chatService.answer(
        question,
        history,
        body?.llmConfig,
        abort.signal,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof DailyLimitException) throw error;
      throw new BadGatewayException(this.describeError(error));
    }
  }

  /** SSE 流式：citations → delta* → done。 */
  @Post('stream')
  async stream(
    @Body() body: ChatRequestBody,
    @Res() res: Response,
  ): Promise<void> {
    const { question, history, ip } = this.parseRequest(body, res);
    this.enforceRateLimit(ip);
    // 日限额判定在 SSE 头之前抛 429 JSON（软提示，客户端按错误消息展示）。
    await this.enforceDailyLimit(ip, body);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    // 客户端断连（关页面/停止生成）即中止上游 LLM 请求，避免白烧 token。
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      for await (const event of this.chatService.answerStream(
        question,
        history,
        body?.llmConfig,
        abort.signal,
      )) {
        if (res.destroyed || res.writableEnded) return;
        // 网关 usage 事件到达：按 IP 补记真实 token 消耗（台账失败不影响流）。
        if (event.type === 'usage' && this.usesSiteKey(body)) {
          void this.ipUsage.addTokens(
            ip,
            event.usage.promptTokens,
            event.usage.completionTokens,
          );
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = this.describeError(error);
      this.logger.warn(`chat stream failed: ${message}`);
      if (!res.destroyed && !res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', message })}\n\n`,
        );
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** 检索 + prompt 组装（B 路线：LLM 由前端直连网关，Key 不过后端）。 */
  @Post('retrieve')
  async retrieve(
    @Body() body: ChatRequestBody,
    @Res() res: Response,
  ): Promise<void> {
    const { question, history, ip } = this.parseRequest(body, res);
    this.enforceRateLimit(ip);
    try {
      const result = await this.chatService.retrieveContext(
        question,
        history,
        {
          queries: parseQueries(body?.queries),
          docIds: parseDocIds(body?.docIds),
        },
      );
      res.json(result);
    } catch (error) {
      throw new BadGatewayException(this.describeError(error));
    }
  }

  /**
   * 问答反馈（bad case 采集）。见 design/chat-badcase-plan.md。
   *
   * 两种粒度：好评只写一行 {turnId, rating:'up'} 且**不落任何文本**（仅作差评率分母）；
   * 差评才写问题/检索词/回答/引用/上下文快照。归因层由后端纯函数算出，前端只给业务选项。
   *
   * 🔴 请求体**逐字段白名单**交给 ChatFeedbackService 解析 —— llmConfig（用户 BYO-Key）
   * 与问题同在一个请求体，整包透传或打 body 日志都会把 Key 写进库/日志。
   * 同一 turnId 重复提交为 upsert（支持改选理由），天然幂等。
   */
  @Post('feedback')
  async feedback(
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const ip = this.resolveIp(res);
    this.consumeQuota(
      this.feedbackBuckets,
      ip,
      FEEDBACK_RATE_LIMIT_MAX,
      '操作太频繁，请稍后再试',
    );
    try {
      const result = await this.chatFeedback.record(
        (body ?? {}) as Record<string, unknown>,
      );
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException(this.describeError(error));
    }
  }

  /**
   * 撤回评分（用户再点一次 👍/👎）。物理删除：撤回的评级不应留在差评率分母里。
   * 幂等 —— 重复撤回返回 `{ removed: false }` 而非报错。
   */
  @Delete('feedback/:turnId')
  async withdrawFeedback(
    @Param('turnId') turnId: string,
    @Res() res: Response,
  ): Promise<void> {
    const ip = this.resolveIp(res);
    this.consumeQuota(
      this.feedbackBuckets,
      ip,
      FEEDBACK_RATE_LIMIT_MAX,
      '操作太频繁，请稍后再试',
    );
    try {
      const result = await this.chatFeedback.remove(turnId);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException(this.describeError(error));
    }
  }

  /**
   * 日限额（迁移 035 / nav-tasks-p3a）：只对消耗站点 key 的请求生效。
   *
   * 口径：先落账再判定 —— `recordRequest` 同时推进累计表与当日表（被拒请求
   * 也计入 attempt，便于观察滥用形态），随后读当日计数与限额属性：
   * 白名单豁免；单 IP 覆盖优先于全局默认；`count > limit` 即本次为超额请求。
   * 与 10 次/分滑动窗叠加：瞬时防刷 + 日度防滥用双层。
   */
  private async enforceDailyLimit(
    ip: string,
    body: ChatRequestBody,
  ): Promise<void> {
    if (!this.usesSiteKey(body)) return;
    await this.ipUsage.recordRequest(ip);
    let state: {
      whitelisted: boolean;
      dailyLimitOverride: number | null;
      todayCount: number;
    };
    try {
      state = await this.ipUsage.getDailyState(ip);
    } catch (error) {
      // 判定数据读不到时**放行**（台账故障不应拖垮问答主链路），只告警。
      this.logger.warn(
        `daily limit state read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (state.whitelisted) return;
    const limit = state.dailyLimitOverride ?? this.dailyLimit;
    if (isDailyLimitExceeded(state.todayCount, limit)) {
      this.logger.warn(
        `daily limit exceeded: ip=${ip} today=${state.todayCount} limit=${limit}`,
      );
      throw new DailyLimitException();
    }
  }

  /** 请求是否会用站点默认 key：未带 llmConfig，或 llmConfig 里没有自己的 apiKey。 */
  private usesSiteKey(body: ChatRequestBody): boolean {
    const override = body?.llmConfig as { apiKey?: unknown } | undefined;
    if (!override || typeof override !== 'object') return true;
    return !(typeof override.apiKey === 'string' && override.apiKey.trim());
  }

  private parseRequest(
    body: ChatRequestBody,
    res: Response,
  ): { question: string; history: ChatTurn[]; ip: string } {    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) {
      throw new BadRequestException('message 不能为空');
    }
    if (message.length > 2000) {
      throw new BadRequestException('message 超过 2000 字上限');
    }
    const history: ChatTurn[] = Array.isArray(body?.history)
      ? (body.history as unknown[])
          .filter((item): item is ChatTurn => this.isValidTurn(item))
          .slice(-MAX_HISTORY_MESSAGES)
      : [];
    return { question: message, history, ip: this.resolveIp(res) };
  }

  /**
   * 取客户端 ip 用于限流。仅当直连方是自家网关时才采信 X-Forwarded-For，
   * 且只取最后一个条目（由本方 LB 追加，客户端无法伪造）。
   */
  private resolveIp(res: Response): string {
    const socketAddr = res.req?.socket?.remoteAddress || 'unknown';
    if (!isTrustedProxyAddress(socketAddr)) return socketAddr;
    const xff = res.req?.headers?.['x-forwarded-for'];
    const entries = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
    const parts = entries
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // 只信最后一个条目（本方网关追加的），客户端伪造的前置条目无效。
    return parts[parts.length - 1] || socketAddr;
  }

  private isValidTurn(value: unknown): value is ChatTurn {
    if (typeof value !== 'object' || value === null) return false;
    const turn = value as { role?: unknown; content?: unknown };
    return (
      (turn.role === 'user' || turn.role === 'assistant') &&
      typeof turn.content === 'string' &&
      turn.content.trim().length > 0
    );
  }

  private enforceRateLimit(ip: string): void {
    this.consumeQuota(
      this.rateBuckets,
      ip,
      RATE_LIMIT_MAX,
      '提问太频繁，请稍后再试',
    );
  }

  /** 滑动窗口限流：同一 key 在窗口内的请求数达到 max 即拒绝。 */
  private consumeQuota(
    buckets: Map<string, number[]>,
    key: string,
    max: number,
    message: string,
  ): void {
    const now = Date.now();
    const bucket = (buckets.get(key) ?? []).filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (bucket.length >= max) {
      throw new BadRequestException(message);
    }
    bucket.push(now);
    buckets.set(key, bucket);
    // 防内存膨胀：桶数超阈值时清空已过期的。
    if (buckets.size > 1000) {
      for (const [storedKey, stamps] of buckets) {
        if (!stamps.some((ts) => now - ts < RATE_LIMIT_WINDOW_MS)) {
          buckets.delete(storedKey);
        }
      }
    }
  }

  private describeError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    let message = error.message || String(error);
    // Node fetch 网络失败的根因在 cause 链（ENOTFOUND/ETIMEDOUT/ECONNRESET 等）。
    let cause: unknown = (error as { cause?: unknown }).cause;
    let depth = 0;
    while (cause && depth < 3) {
      if (cause instanceof Error) {
        message += ` <- ${cause.message}`;
        cause = (cause as { cause?: unknown }).cause;
      } else if (typeof cause === 'string') {
        message += ` <- ${cause}`;
        break;
      } else {
        break;
      }
      depth += 1;
    }
    return message;
  }
}
