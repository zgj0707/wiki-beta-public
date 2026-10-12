import { withClientBasePath } from '@client/src/lib/base-path';
import {
  loadChatLlmConfig,
  isChatLlmConfigured,
  type ChatLlmConfig,
} from '@client/src/lib/chat-llm-config';

export interface ChatCitation {
  docId: string;
  title: string;
  sourceDate: string | null;
  url: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export type ChatStreamEvent =
  | {
      type: 'citations';
      citations: ChatCitation[];
      external: boolean;
      retrievalNotice: string | null;
    }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ChatLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 检索结果中的单篇资料（供深度检索做客户端相关度打分）。 */
export interface RetrievedDocLite {
  docId: string;
  title: string;
  sourceDate: string | null;
  url: string;
  snippet: string;
}

export interface ChatRetrieveResult {
  citations: ChatCitation[];
  messages: ChatLlmMessage[];
  external: boolean;
  retrievalNotice: string | null;
  docs?: RetrievedDocLite[];
}

/**
 * B 路线第一步：后端只做检索与 prompt 组装（复用召回/门禁/限流），
 * 返回 citations + messages，LLM 调用随后由前端直连网关完成。
 * opts.queries：多路改写查询（深度检索）；opts.docIds：片段过滤白名单（可传空数组=全部不相关）。
 */
export async function retrieveContext(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
  opts?: { queries?: string[]; docIds?: string[] },
): Promise<ChatRetrieveResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const csrf = readCsrfToken();
  if (csrf) headers['X-Suda-Csrf-Token'] = csrf;

  const response = await fetch(withClientBasePath('/api/chat/retrieve'), {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      message,
      history,
      ...(opts?.queries ? { queries: opts.queries } : {}),
      ...(opts?.docIds ? { docIds: opts.docIds } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const data = (await response.json()) as { message?: string };
      detail = typeof data?.message === 'string' ? `：${data.message}` : '';
    } catch {
      // 忽略非 JSON 错误体。
    }
    throw new Error(`请求失败（${response.status}）${detail}`);
  }
  return (await response.json()) as ChatRetrieveResult;
}

/**
 * 追问检索改写（query rewrite）：把依赖上下文的追问（如「它呢？」）改写成
 * 独立完整的检索查询，只用于 /api/chat/retrieve 的召回，不进入最终回答消息。
 * 非流式小调用：输入为压缩历史 + 最新问，max_tokens 128 封顶，消耗可忽略。
 * 失败由调用方兜底（退回原问句检索），不阻塞问答主链路。
 */
export async function rewriteQuery(
  config: { baseUrl: string; model: string; apiKey: string },
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '你是检索查询改写器。根据对话历史，把用户的最新问题改写成一个不依赖上下文、独立完整的中文检索查询。要求：补全指代并保留具体实体名（产品/厂商/品类/机制名）；若最新问题本身已独立完整，原样输出；只输出改写后的问题本身，不要任何解释、前缀或引号。',
        },
        ...history.map((h) => ({
          role: h.role,
          content: h.content.slice(0, 800),
        })),
        { role: 'user', content: question },
      ],
      temperature: 0,
      max_tokens: 128,
      stream: false,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`查询改写失败（${response.status}）`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * 多路改写（深度检索 B1）：一次小调用生成 3 个改写变体（每行一个），
 * 服务端并发检索后合并去重。失败/解析为空返回 []，由调用方退回单路原问句。
 */
export async function rewriteQueryMulti(
  config: { baseUrl: string; model: string; apiKey: string },
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  question: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '你是检索查询改写器。根据对话历史，把用户的最新问题改写成 3 个互相补充、不依赖上下文、独立完整的中文检索查询（不同侧重点：核心实体、品类/机制词、对比或场景视角）。要求：补全指代并保留具体实体名；每行输出一个查询，不要编号、不要解释；若最新问题本身已独立完整，则输出它的 3 个不同关键词侧重变体。',
        },
        ...history.map((h) => ({
          role: h.role,
          content: h.content.slice(0, 800),
        })),
        { role: 'user', content: question },
      ],
      temperature: 0,
      max_tokens: 256,
      stream: false,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`查询改写失败（${response.status}）`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  return text
    .split('\n')
    .map((line) => line.replace(/^[\d.、)．-\s]+/, '').trim())
    .filter((line) => line.length >= 2)
    .slice(0, 3);
}

/**
 * 片段相关度打分（深度检索 B2，CRAG 简化版）：一次小调用判断每个检索
 * 片段是否与问题相关，返回相关片段的 docId 列表。解析失败返回 null
 * （调用方跳过过滤）；返回空数组 = 全部不相关（走外部知识模式）。
 */
export async function scoreRelevantDocs(
  config: { baseUrl: string; model: string; apiKey: string },
  question: string,
  docs: RetrievedDocLite[],
  signal?: AbortSignal,
): Promise<string[] | null> {
  const listing = docs
    .map(
      (doc, i) =>
        `[${i + 1}] ${doc.title || '（无标题）'}\n${doc.snippet.slice(0, 400)}`,
    )
    .join('\n---\n');
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '你是检索结果相关度评判器。判断每个编号资料片段是否与用户问题相关（有助于回答）。只输出相关片段的编号，用逗号分隔（如：1,3,7）；若没有任何相关片段，只输出 NONE。不要输出其他任何内容。',
        },
        { role: 'user', content: `问题：${question}\n\n资料片段：\n${listing}` },
      ],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`片段打分失败（${response.status}）`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (/^none$/i.test(text)) return [];
  const indices = new Set(
    (text.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)),
  );
  if (!indices.size) return null;
  const kept = docs
    .filter((_, i) => indices.has(i + 1))
    .map((doc) => doc.docId);
  return kept.length ? kept : null;
}

export interface ChatLlmStreamResult {
  /**
   * 网关最终帧的 finish_reason（'length' = 输出被 max_tokens 截断，
   * 调用方可据此展示「继续回复」）。
   */
  finishReason: string | null;
}

/**
 * 采样 seed：由最后一条 user 消息派生（FNV-1a，与服务端同算法）。
 * 同一问题同 seed → 输出趋稳；「继续回复」沿用原 seed 保持口径一致。
 * 上游不支持 seed 时会忽略该参数，零风险。
 */
export function deriveLlmSeed(messages: ChatLlmMessage[]): number {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = lastUser?.content ?? '';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * B 路线第二步：浏览器直连 OpenAI 兼容网关流式对话。
 * Key 只在浏览器与网关之间流转，不经本站后端（平台出网沙箱限制与平台日志均绕开）。
 * 网关已验证 CORS 全开（Allow-Origin: * / Allow-Headers: * / POST）。
 */
export async function streamLlmDirect(
  config: { baseUrl: string; model: string; apiKey: string },
  messages: ChatLlmMessage[],
  handlers: {
    onDelta: (text: string) => void;
    onUsage?: (usage: ChatUsage) => void;
  },
  signal?: AbortSignal,
  opts?: { seed?: number },
): Promise<ChatLlmStreamResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
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
      seed: opts?.seed ?? deriveLlmSeed(messages),
      max_tokens: 8192,
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `LLM 网关 ${response.status}：${text.slice(0, 200) || '(空响应体)'}`,
    );
  }

  let buffer = '';
  let frameCount = 0;
  let deltaCount = 0;
  let firstFramePreview = '';
  let finishReason: string | null = null;
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
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        frameCount += 1;
        if (!firstFramePreview) firstFramePreview = payload.slice(0, 200);
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              message?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          const frameReason = parsed.choices?.[0]?.finish_reason;
          if (frameReason) finishReason = frameReason;
          if (parsed.usage && handlers.onUsage) {
            handlers.onUsage({
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
            });
          }
          // 兼容标准 delta.content 与部分网关的 message.content。
          const delta =
            parsed.choices?.[0]?.delta?.content ??
            parsed.choices?.[0]?.message?.content;
          if (delta) {
            deltaCount += 1;
            handlers.onDelta(delta);
          }
        } catch {
          // 单行解析失败不中断流（网关可能夹杂心跳/注释行）。
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  // 放在 finally 之外：finally 内 throw 会吞掉 try 块里的原始异常，
  // 使网络故障被误报成「网关未返回内容」，掩盖真实原因。
  if (deltaCount === 0) {
    throw new Error(
      `LLM 网关未返回内容（收到 ${frameCount} 帧数据）。首帧样例：${firstFramePreview || '无'}——请检查 AI 设置中的模型名是否正确`,
    );
  }
  return { finishReason };
}

// ── 站点默认 LLM 配置（公开快照，不含 Key）────────

export interface ChatLlmDefaultInfo {
  /** 服务端存在已启用的默认配置（Base「AI 配置」表 enabled 行）。 */
  available: boolean;
  model: string | null;
  baseUrlHost: string | null;
}

let llmDefaultCache: Promise<ChatLlmDefaultInfo> | null = null;

/**
 * 查询站点默认配置可用性（会话级缓存一次）。
 * 默认档发问不走 BYO-Key：llmConfig 缺省时由服务端用默认配置完成问答。
 * 查询失败按「不可用」处理（回退引导用户自定义配置）。
 */
export function chatLlmDefault(): Promise<ChatLlmDefaultInfo> {
  if (!llmDefaultCache) {
    llmDefaultCache = (async () => {
      // 🔴 必须带妙搭网关 CSRF 头（同文件 retrieve/stream/feedback 一致）：
      // 缺失会被网关拒掉/重定向，fetch 静默降级成 available:false（2026-10-09 教训）。
      const headers: Record<string, string> = { Accept: 'application/json' };
      const csrf = readCsrfToken();
      if (csrf) headers['X-Suda-Csrf-Token'] = csrf;
      const response = await fetch(
        withClientBasePath('/api/chat/llm-default'),
        { headers, credentials: 'same-origin' },
      );
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as ChatLlmDefaultInfo;
    })().catch(() => ({ available: false, model: null, baseUrlHost: null }));
  }
  return llmDefaultCache;
}

// ── 问答反馈（bad case 采集，见 docs/chat-badcase-plan.md）────────

/** 反馈业务选项 —— 用户能理解的语言；技术归因层由后端纯函数映射。 */
export type ChatFeedbackReason =
  | 'off_target'
  | 'wrong'
  | 'shallow'
  | 'citation_broken';

/**
 * 归因上下文快照。只放归因判断需要的信号。
 *
 * 🔴 **绝不放 `llmConfig`**：用户 BYO-Key 与这些问题同处一个请求体，后端
 * access log 历史上明文记过含 Key 的 body。`snippetLens` 只存各片段**长度**
 * （判断是否顶格 1800 只需长度）；片段全文不存——要修片段层时凭
 * `citations[].docId` 事后重取（文章走直读、机制走 PG）。
 */
export interface ChatFeedbackContext {
  external: boolean;
  truncated: boolean;
  stopped: boolean;
  deep: boolean;
  historyTurns: number;
  snippetLens: number[];
  model: string;
  usage: { promptTokens: number; completionTokens: number } | null;
}

/**
 * 反馈载荷。
 *
 * 🔴 **好评只发 `turnId` + `rating` 两个字段**：分母不需要内容。差评才带
 * `question` / `searchQuery` / `answer` / `citations` / `context`。
 * 服务端还会把好评行带文本的请求在数据库层拒掉（`chat_feedback_privacy_ck`）。
 */
export interface ChatFeedbackPayload {
  turnId: string;
  rating: 'up' | 'down';
  reason?: ChatFeedbackReason;
  question?: string;
  searchQuery?: string;
  answer?: string;
  citations?: ChatCitation[];
  context?: ChatFeedbackContext;
}

export interface ChatFeedbackAck {
  /** 后端算出的归因层；`boundary` = 已知边界（不计入缺陷池）。 */
  attribution: string | null;
  status: string;
}

/**
 * 提交一轮反馈。同一 `turnId` 重复提交为 upsert（支持用户改选理由），天然幂等。
 * 非流式小请求：失败由调用方决定是否提示（不阻塞问答本身）。
 */
export async function submitChatFeedback(
  payload: ChatFeedbackPayload,
): Promise<ChatFeedbackAck> {
  const response = await fetch(withClientBasePath('/api/chat/feedback'), {
    method: 'POST',
    headers: feedbackHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`反馈提交失败（${response.status}）${await readErrorDetail(response)}`);
  }
  return (await response.json()) as ChatFeedbackAck;
}

/**
 * 撤回评分（用户再点一次 👍/👎）。后端物理删除 —— 撤回的评级不应留在差评率
 * 分母里。幂等：重复撤回返回 `removed:false` 而非报错。
 */
export async function withdrawChatFeedback(
  turnId: string,
): Promise<{ removed: boolean }> {
  const response = await fetch(
    withClientBasePath(`/api/chat/feedback/${encodeURIComponent(turnId)}`),
    {
      method: 'DELETE',
      headers: feedbackHeaders(),
      credentials: 'same-origin',
    },
  );
  if (!response.ok) {
    throw new Error(`撤回失败（${response.status}）${await readErrorDetail(response)}`);
  }
  return (await response.json()) as { removed: boolean };
}

function feedbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = readCsrfToken();
  if (csrf) headers['X-Suda-Csrf-Token'] = csrf;
  return headers;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return typeof data?.message === 'string' ? `：${data.message}` : '';
  } catch {
    return '';
  }
}

function readCsrfToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = (window as Window & { csrfToken?: unknown }).csrfToken;
  return typeof token === 'string' && token ? token : null;
}

/**
 * 流式问答客户端：POST /api/chat/stream，手写 SSE 解析（EventSource 不支持 POST）。
 * abort 由调用方通过 signal 控制——浏览器断开连接后，后端会同步中止上游 LLM 请求。
 */
export async function* streamChat(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const csrf = readCsrfToken();
  if (csrf) headers['X-Suda-Csrf-Token'] = csrf;

  const config: ChatLlmConfig | null = isChatLlmConfigured(
    loadChatLlmConfig(),
  )
    ? loadChatLlmConfig()
    : null;

  const response = await fetch(withClientBasePath('/api/chat/stream'), {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      message,
      history,
      ...(config ? { llmConfig: config } : {}),
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    let detail = '';
    try {
      const data = (await response.json()) as { message?: string };
      detail = typeof data?.message === 'string' ? `：${data.message}` : '';
    } catch {
      // 忽略非 JSON 错误体。
    }
    throw new Error(`请求失败（${response.status}）${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload) as ChatStreamEvent;
        } catch {
          // 跳过无法解析的分帧。
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
