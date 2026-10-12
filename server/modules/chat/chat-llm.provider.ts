import { Injectable, Logger } from '@nestjs/common';
import { ProxyAgent, type Dispatcher } from 'undici';

import { AiConfigService } from './ai-config.service';

export interface ChatLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 每人自带的接入配置（BYO-Key）：前端 AI 设置存 localStorage，随请求带来。
 * 后端只做内存中转，不落库、不打日志。
 */
export interface ChatLlmOverride {
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
}

export interface ResolvedLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** 网关上报的真实 token 消耗（stream_options.include_usage）。 */
export interface ChatLlmUsage {
  promptTokens: number;
  completionTokens: number;
}

const DEFAULT_MODEL = 'deepseek-flash';
const TIMEOUT_MS = 120_000;

/**
 * 妙搭运行时通过本地代理（HTTPS_PROXY=http://127.0.0.1:12388）出网，
 * Node 原生 fetch 不读代理环境变量 → 必须显式挂 ProxyAgent，否则直连被防火墙丢弃。
 * 无代理环境变量时返回 undefined（本地开发直连）。
 */
let cachedProxyAgent: ProxyAgent | null | undefined;
function resolveProxyDispatcher(): Dispatcher | undefined {
  if (cachedProxyAgent === undefined) {
    const proxyUrl =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      '';
    cachedProxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  }
  return cachedProxyAgent ?? undefined;
}

/** 私网/本机地址拒绝（防 SSRF：baseUrl 来自公开访客输入）。 */
const BLOCKED_HOST_PATTERN =
  /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local)$/i;

/**
 * 采样 seed：由最后一条 user 消息派生（FNV-1a）。
 * 同一问题得到同一 seed，同输入下输出趋稳（OpenAI 兼容语义；上游不支持时忽略，零风险）。
 */
export function deriveSeed(messages: ChatLlmMessage[]): number {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = lastUser?.content ?? '';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveLlmConfig(
  override: ChatLlmOverride | undefined,
  baseDefault?: ResolvedLlmConfig | null,
): ResolvedLlmConfig | null {
  const baseUrl =
    firstString(override?.baseUrl) ||
    baseDefault?.baseUrl ||
    process.env.CHAT_LLM_BASE_URL ||
    '';
  const model =
    firstString(override?.model) ||
    baseDefault?.model ||
    process.env.CHAT_LLM_MODEL ||
    DEFAULT_MODEL;
  const apiKey =
    firstString(override?.apiKey) ||
    baseDefault?.apiKey ||
    process.env.CHAT_LLM_API_KEY ||
    '';
  if (!baseUrl && !model && !apiKey) return null;
  return { baseUrl, model, apiKey };
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 校验并规范化 resolve 出的配置；非法直接抛错（含来源是访客输入的场景）。 */
export function assertSafeConfig(config: ResolvedLlmConfig): void {
  if (!config.apiKey) throw new Error('缺少 API Key（请在顶栏「AI 设置」中配置）');
  if (config.baseUrl.length > 300 || config.model.length > 100) {
    throw new Error('AI 配置项长度非法');
  }
  let parsed: URL;
  try {
    parsed = new URL(config.baseUrl);
  } catch {
    throw new Error('API 接入地址格式非法');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('API 接入地址仅支持 http(s)');
  }
  if (BLOCKED_HOST_PATTERN.test(parsed.hostname)) {
    throw new Error('API 接入地址不允许指向内网地址');
  }
}

/**
 * OpenAI 兼容 LLM 网关客户端。
 * 默认配置优先级：访客自定义（BYO）> Base「AI 配置」表启用行（管理端改，~10s 生效）
 * > 环境变量（CHAT_LLM_BASE_URL / CHAT_LLM_API_KEY / CHAT_LLM_MODEL）> 内置常量兜底。
 */
@Injectable()
export class ChatLlmProvider {
  private readonly logger = new Logger(ChatLlmProvider.name);

  constructor(private readonly aiConfig: AiConfigService) {}

  private get baseUrl(): string {
    return (process.env.CHAT_LLM_BASE_URL || '').replace(
      /\/+$/,
      '',
    );
  }

  private get apiKey(): string {
    return process.env.CHAT_LLM_API_KEY || '';
  }

  private get model(): string {
    return process.env.CHAT_LLM_MODEL || DEFAULT_MODEL;
  }

  /** 非流式补全：内部复用流式并聚合（单一代码路径）。 */
  async complete(
    messages: ChatLlmMessage[],
    override?: ChatLlmOverride,
    signal?: AbortSignal,
  ): Promise<string> {
    let answer = '';
    for await (const delta of this.stream(messages, override, signal)) {
      answer += delta;
    }
    return answer;
  }

  /**
   * 流式补全：逐段 yield 文本增量。失败抛 Error（含网关状态与响应摘要）。
   * signal：调用方（controller 在客户端断连时触发）可中止上游请求，避免白烧 token。
   * onUsage：网关返回 usage（stream_options.include_usage）时回调真实 token 消耗；
   * 网关不支持时静默不回调。
   */
  async *stream(
    messages: ChatLlmMessage[],
    override?: ChatLlmOverride,
    signal?: AbortSignal,
    onUsage?: (usage: ChatLlmUsage) => void,
  ): AsyncGenerator<string> {
    // 配置优先级：访客自定义（BYO）> Base「AI 配置」启用行 > 环境变量 > 内置常量。
    const config =
      resolveLlmConfig(override, await this.aiConfig.resolve()) ?? {
        baseUrl: this.baseUrl,
        model: this.model,
        apiKey: this.apiKey,
      };
    assertSafeConfig(config);
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // 网络诊断：出网是否走代理、目标主机是什么。失败时配合 cause 链定位。
      this.logger.log(
        `llm fetch: host=${new URL(config.baseUrl).host} proxy=${process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || 'none'}`,
      );
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.2,
          seed: deriveSeed(messages),
          max_tokens: 8192,
        }),
        signal: controller.signal,
        // 平台出网代理（undefined = 本地直连）。
        dispatcher: resolveProxyDispatcher(),
      } as RequestInit & { dispatcher?: Dispatcher });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        // 记录响应头特征：区分平台代理拒绝（无 server/via 异常）与网关自身错误。
        const headerSample = [...response.headers.entries()]
          .filter(([k]) => ['server', 'via', 'content-type', 'date', 'x-request-id', 'cf-ray'].includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        this.logger.warn(
          `llm http ${response.status}: body=${text.slice(0, 200) || '(empty)'} headers=[${headerSample || '(none)'}]`,
        );
        throw new Error(
          `LLM 网关 ${response.status}: ${text.slice(0, 300) || '(空响应体)'} [${headerSample || '无特征响应头'}]`,
        );
      }
      yield* this.parseSseStream(response.body, onUsage);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** 解析 OpenAI 兼容 SSE：`data: {...}` 行，choices[0].delta.content，`[DONE]` 结束。 */
  private async *parseSseStream(
    body: ReadableStream<Uint8Array>,
    onUsage?: (usage: ChatLlmUsage) => void,
  ): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let frameCount = 0;
    let deltaCount = 0;
    let firstFramePreview = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          frameCount += 1;
          if (!firstFramePreview) {
            firstFramePreview = payload.slice(0, 200);
          }
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string };
                message?: { content?: string };
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              } | null;
            };
            if (parsed.usage && onUsage) {
              onUsage({
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
              });
            }
            // 兼容两种形态：标准流式 delta.content 与部分网关的 message.content。
            const delta =
              parsed.choices?.[0]?.delta?.content ??
              parsed.choices?.[0]?.message?.content;
            if (delta) {
              deltaCount += 1;
              yield delta;
            }
          } catch {
            // 单行解析失败不中断流（网关可能夹杂心跳/注释行）。
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    // 放在 finally 之外：generator 被提前关闭（用户中止 / abort）时同样会走 finally，
    // 在 finally 内 throw 会把「主动中止」误报成「网关未返回内容」。
    if (deltaCount === 0) {
      this.logger.warn(
        `llm stream empty: frames=${frameCount} firstFrame=${firstFramePreview || '(none)'}`,
      );
      throw new Error(
        `LLM 网关未返回内容（收到 ${frameCount} 帧数据）。首帧样例：${firstFramePreview || '无'}——请检查模型名是否正确，或把该样例反馈给开发者`,
      );
    }
  }

  logModelConfig(): void {
    this.logger.log(`chat llm config: model=${this.model} base=${this.baseUrl}`);
  }
}
