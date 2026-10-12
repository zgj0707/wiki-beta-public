import { withClientBasePath } from '@client/src/lib/base-path';
import {
  COMPILE_MAX_OUTPUT_TOKENS,
  COMPILE_MAX_OUTPUT_TOKENS_FALLBACK,
} from '@shared/ai-compile';
import type {
  CompileCalibrationView,
  CompilePrepareResult,
  CompileQueueItem,
  CompileSaveRequest,
  CompileSaveResult,
  CompileUnitDetail,
  CompileWorkbenchView,
} from '@shared/ai-compile';

/**
 * AI 编译层前端 API（/ai 页签专用）。
 *
 * 链路形态与 chat 一致（B 路线）：后端出网被沙箱拦，**LLM 调用在浏览器**，
 * 后端只负责组装输入（prepare）与校验落库（save）。Key 不过后端。
 */

function csrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (typeof window !== 'undefined') {
    const token = (window as Window & { csrfToken?: unknown }).csrfToken;
    if (typeof token === 'string' && token) headers['X-Suda-Csrf-Token'] = token;
  }
  return headers;
}

async function readDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return typeof data?.message === 'string' ? `：${data.message}` : '';
  } catch {
    return '';
  }
}

/**
 * 读 JSON 响应体，**空 body 归一为 `null`（合法结果，不是错误）**。
 *
 * ⚠️ 为什么必须单独处理：Nest 的 ExpressAdapter 对 handler 返回 `null` / `undefined`
 * 走 `response.send()`（见 `@nestjs/platform-express` 的 express-adapter `isNil` 分支），
 * 于是一个语义明确的「查不到 → null」会变成「HTTP 200 + 空 body」。此时直接调
 * `response.json()` 抛 `Unexpected end of JSON input`——这句话对使用者零信息量，
 * 还会被误当成后端挂了。传输层必须把它翻译回来。
 */
async function getJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T | null> {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(withClientBasePath(`${path}${suffix}`), {
    headers: csrfHeaders(),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）${await readDetail(response)}`);
  }
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('响应不是合法 JSON，请刷新重试');
  }
}

/** 空 body 会让整页失能，给一句能定位的话，而不是让 JSON 解析器抛原始错误。 */
async function requireJson<T>(
  path: string,
  label: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const data = await getJson<T>(path, params);
  if (data === null) {
    throw new Error(`${label}返回空响应，请刷新重试`);
  }
  return data;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(withClientBasePath(path), {
    method: 'POST',
    headers: csrfHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）${await readDetail(response)}`);
  }
  const text = await response.text();
  if (!text.trim()) {
    throw new Error('服务端返回空响应，请刷新重试');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('响应不是合法 JSON，请刷新重试');
  }
}

/**
 * 模型指纹归一（与后端 `fingerprintOf` 同算法）。
 * 用途：校准系数按模型分区、产物按模型隔离——同一模型名必须得到同一指纹，
 * 否则 WorkBuddy 批跑与浏览器直连的产物会互相覆盖或系数混算。
 */
export function modelFingerprintOf(model: string): string {
  return model.trim().toLowerCase().replace(/[\s_]+/g, '-').slice(0, 120);
}

export function fetchWorkbench(model?: string): Promise<CompileWorkbenchView> {
  return requireJson<CompileWorkbenchView>('/api/compile/workbench', '工作台数据', {
    model,
  });
}

/** 队列是数组契约：空 body 当作「无待办」，不打断页面。 */
export function fetchQueue(limit?: number): Promise<CompileQueueItem[]> {
  return getJson<CompileQueueItem[]>('/api/compile/queue', {
    limit: limit ? String(limit) : undefined,
  }).then((data) => data ?? []);
}

export function fetchCalibration(
  model?: string,
): Promise<CompileCalibrationView> {
  return requireJson<CompileCalibrationView>(
    '/api/compile/calibration',
    '校准数据',
    { model },
  );
}

/**
 * 契约允许「无产物」，因此 `null`（含空 body）是正常返回：语义 = 尚未编译。
 * 刻意**不传模型**：产品物按 slug 取最新一份，不随浏览器配置的模型名变化。
 */
export function fetchUnit(slug: string): Promise<CompileUnitDetail | null> {
  return getJson<CompileUnitDetail | null>(
    `/api/compile/unit/${encodeURIComponent(slug)}`,
  ).then((data) => data ?? null);
}

/** 组装输入：拿回 prompt messages + 编号表（编号表须原样回传 save）。 */
export function prepareCompile(
  subjectId: string,
  modelFingerprint?: string,
): Promise<CompilePrepareResult> {
  return postJson<CompilePrepareResult>('/api/compile/prepare', {
    subjectId,
    modelFingerprint,
  });
}

/** 回填产物：只传模型原始输出 + 实测 usage，其余由服务端重算校验。 */
export function saveCompile(
  payload: CompileSaveRequest,
): Promise<CompileSaveResult> {
  return postJson<CompileSaveResult>('/api/compile/save', payload);
}

export interface CompileLlmResult {
  raw: string;
  usage: { promptTokens: number; completionTokens: number };
  /** 'length' = 输出被 max_tokens 截断（JSON 大概率不完整）。 */
  finishReason: string | null;
}

interface LlmAttempt {
  raw: string;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string | null;
  /** 这次尝试没拿到正文时的可读原因（网关原话优先）。 */
  failure: string | null;
  /** 网关明确拒绝本次的 max_tokens 取值（≠ 输入超长）。触发回退重试。 */
  rejectedMaxTokens?: boolean;
}

/**
 * 判定"网关不接受这个 max_tokens"，与"输入超长"严格分开 —— 两者处理方式相反：
 * 前者要降低输出上限重试，后者要裁短输入。
 */
function isMaxTokensRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const text = body.toLowerCase();
  if (text.includes('context length') || text.includes('context_length')) {
    return false;
  }
  return (
    text.includes('max_tokens') ||
    text.includes('max_completion_tokens') ||
    text.includes('max output')
  );
}

/**
 * 从网关响应体里抠出**它自己说的话**。
 *
 * New API 系网关在认证/上游出错时回 `{"error":{"message":...}}`，且**部分错误
 * 以 HTTP 200 回传**。若只看 `choices`，这些信息会被整段丢弃，最后变成一句
 * 无信息量的「请检查模型名」——排查方向被代码自己带偏。
 */
function gatewayErrorFrom(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
      msg?: string;
    };
    const err = parsed.error;
    if (typeof err === 'string' && err) return err;
    const message =
      (typeof err === 'object' && err ? err.message : undefined) ??
      parsed.message ??
      parsed.msg;
    return typeof message === 'string' && message ? message : null;
  } catch {
    return null;
  }
}

/**
 * 尝试一（主路径）：**流式**。
 *
 * 同一条网关、同一个模型、同一把 Key，站内问答（`streamLlmDirect`）长期正常，
 * 而此前的非流式版本返回空 choices —— 差异只有 `stream:false` 这一项。流式还
 * 顺带解决两件事：长输入在非流式下更易被网关/中间层超时截断成空响应；
 * `stream_options.include_usage` 能拿到实测 usage（非流式拿不到），token 校准
 * 才可能积累到样本。
 */
async function attemptStream(
  url: string,
  config: { model: string; apiKey: string },
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<LlmAttempt> {
  const response = await fetch(url, {
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
      max_tokens: maxTokens,
    }),
    signal,
  });
  const usage = { promptTokens: 0, completionTokens: 0 };
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    return {
      raw: '',
      usage,
      finishReason: null,
      failure: `HTTP ${response.status} ${gatewayErrorFrom(text) ?? (text.slice(0, 300) || '(空响应体)')}`,
      rejectedMaxTokens: isMaxTokensRejection(response.status, text),
    };
  }

  let buffer = '';
  let raw = '';
  let frameCount = 0;
  let firstFramePreview = '';
  let nonSseBody = '';
  let finishReason: string | null = null;
  let reasoningChars = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // 非 SSE 的裸 JSON：网关把错误体直接吐出来（200 + 错误体）。
        if (!trimmed.startsWith('data:')) {
          nonSseBody += trimmed;
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        frameCount += 1;
        if (!firstFramePreview) firstFramePreview = payload.slice(0, 200);
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
              message?: { content?: string; reasoning_content?: string };
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
            } | null;
          };
          const frameReason = parsed.choices?.[0]?.finish_reason;
          if (frameReason) finishReason = frameReason;
          if (parsed.usage) {
            usage.promptTokens = parsed.usage.prompt_tokens ?? 0;
            usage.completionTokens = parsed.usage.completion_tokens ?? 0;
          }
          const choice = parsed.choices?.[0];
          const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
          if (delta) raw += delta;
          // 思考型模型：正文为空而思考内容有值 → 预算被思考吃光。留作诊断，
          // 否则用户只会看到一句无信息量的「未返回内容」。
          reasoningChars +=
            (choice?.delta?.reasoning_content ?? '').length +
            (choice?.message?.reasoning_content ?? '').length;
        } catch {
          // 单行解析失败不中断流（网关可能夹杂心跳/注释行）。
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (raw.trim()) return { raw, usage, finishReason, failure: null };
  const gatewayError = gatewayErrorFrom(nonSseBody);
  return {
    raw: '',
    usage,
    finishReason,
    failure: gatewayError
      ? `网关错误：${gatewayError}`
      : reasoningChars > 0
        ? `只收到思考内容（${reasoningChars} 字）、无正文${finishReason ? `（finish_reason=${finishReason}）` : ''}——预算多半被思考吃光`
        : `收到 ${frameCount} 帧但无正文内容。首帧样例：${firstFramePreview || '无'}`,
  };
}

/** 尝试二（兜底）：非流式。只在流式拿不到正文时走，用于区分「模式问题」还是「网关问题」。 */
async function attemptOnce(
  url: string,
  config: { model: string; apiKey: string },
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<LlmAttempt> {
  const empty = { promptTokens: 0, completionTokens: 0 };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
    signal,
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      raw: '',
      usage: empty,
      finishReason: null,
      failure: `HTTP ${response.status} ${gatewayErrorFrom(text) ?? (text.slice(0, 300) || '(空响应体)')}`,
      rejectedMaxTokens: isMaxTokensRejection(response.status, text),
    };
  }
  let data: {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return {
      raw: '',
      usage: empty,
      finishReason: null,
      failure: `HTTP 200 但不是 JSON：${text.slice(0, 300)}`,
    };
  }
  const usage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
  const finishReason = data.choices?.[0]?.finish_reason ?? null;
  const message = data.choices?.[0]?.message;
  const raw = message?.content ?? '';
  if (raw.trim()) return { raw, usage, finishReason, failure: null };
  const gatewayError = gatewayErrorFrom(text);
  return {
    raw: '',
    usage,
    finishReason,
    failure: gatewayError
      ? `网关错误：${gatewayError}`
      : (message?.reasoning_content ?? '').length > 0
        ? '只有思考内容、无正文'
        : `HTTP 200 但 choices 为空或 content 为空（finish_reason=${finishReason ?? 'null'}，响应键：${Object.keys(data).join('/') || '无'}）`,
  };
}

/**
 * 浏览器直连网关执行一次编译调用。
 *
 * 两路都试：流式为主（与站内问答同路径，已验证可用且能拿 usage），非流式为兜底。
 * 两路都拿不到正文时，把**两路的原始诊断**一并抛出——宁可长，也不要再出现
 * 「请检查模型名」这种把排查方向带偏的文案。
 *
 * 刻意**不传 response_format**：各网关对 json_object 的支持不一，一旦不支持
 * 会直接 400；prompt 已强约束"只输出 JSON"，服务端 parse 也做了容错（剥围栏 /
 * 定位首尾花括号 / 去尾随逗号），鲁棒性更好且零网关兼容风险。
 */
export async function callCompileLlm(
  config: { baseUrl: string; model: string; apiKey: string },
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  signal?: AbortSignal,
): Promise<CompileLlmResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  /** 在给定输出预算下跑完两路（流式为主、非流式为兜底）。 */
  const attemptWithBudget = async (
    maxTokens: number,
  ): Promise<{
    result: CompileLlmResult | null;
    failures: string[];
    budgetRejected: boolean;
  }> => {
    const streamed = await attemptStream(url, config, messages, maxTokens, signal);
    if (streamed.raw.trim()) {
      return {
        result: {
          raw: streamed.raw,
          usage: streamed.usage,
          finishReason: streamed.finishReason,
        },
        failures: [],
        budgetRejected: false,
      };
    }
    // 预算本身被拒：同一个值再走非流式没有意义，直接交给上层降档。
    if (streamed.rejectedMaxTokens) {
      return {
        result: null,
        failures: [`max_tokens=${maxTokens} 被网关拒绝（${streamed.failure ?? '未知'}）`],
        budgetRejected: true,
      };
    }
    const once = await attemptOnce(url, config, messages, maxTokens, signal);
    if (once.raw.trim()) {
      return {
        result: {
          raw: once.raw,
          usage: once.usage,
          finishReason: once.finishReason,
        },
        failures: [],
        budgetRejected: false,
      };
    }
    return {
      result: null,
      failures: [streamed.failure ?? '未知', once.failure ?? '未知'],
      budgetRejected: Boolean(once.rejectedMaxTokens),
    };
  };

  const primary = await attemptWithBudget(COMPILE_MAX_OUTPUT_TOKENS);
  if (primary.result) return primary.result;

  // 网关不接受高上限 → 自动降到改动前的值重试一次，行为等价于降级前，
  // 不因为"想给足余量"反而把原本能成的编译弄失败。
  if (
    primary.budgetRejected &&
    COMPILE_MAX_OUTPUT_TOKENS_FALLBACK < COMPILE_MAX_OUTPUT_TOKENS
  ) {
    const fallback = await attemptWithBudget(COMPILE_MAX_OUTPUT_TOKENS_FALLBACK);
    if (fallback.result) return fallback.result;
    throw new Error(
      `LLM 未返回正文。max_tokens=${COMPILE_MAX_OUTPUT_TOKENS}：${primary.failures.join('；')}。` +
        `已自动降至 ${COMPILE_MAX_OUTPUT_TOKENS_FALLBACK} 重试：${fallback.failures.join('；')}。模型「${config.model}」`,
    );
  }

  throw new Error(
    `LLM 未返回正文。流式：${primary.failures[0] ?? '未知'}；非流式：${primary.failures[1] ?? '未知'}。模型「${config.model}」`,
  );
}
