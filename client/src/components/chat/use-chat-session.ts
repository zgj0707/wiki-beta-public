import { useCallback, useRef, useState } from 'react';

import {
  chatLlmDefault,
  deriveLlmSeed,
  retrieveContext,
  rewriteQuery,
  rewriteQueryMulti,
  scoreRelevantDocs,
  streamChat,
  streamLlmDirect,
  type ChatCitation,
  type ChatLlmMessage,
  type ChatUsage,
} from '@client/src/api/chat';
import {
  isChatLlmConfigured,
  loadChatLlmConfig,
} from '@client/src/lib/chat-llm-config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  usage?: ChatUsage;
  /** 知识库零命中：回答来自模型通用知识，界面挂「外部信息」横幅。 */
  external?: boolean;
  /** 检索受限说明，例如榜单来源不支持所请求期次。 */
  retrievalNotice?: string | null;
  /** 输出达到 max_tokens 上限被截断（finish_reason=length），可点「继续回复」续写。 */
  truncated?: boolean;
  /** 用户点了「停止生成」：无内容时界面显示已停止提示，而不是空气泡。 */
  stopped?: boolean;
  error?: string;
  /** 本轮 turnId（仅回答消息）：反馈写入的主键；「继续回复」属同一轮，id 不变。 */
  id?: string;
  /**
   * 本轮用户**原始输入**（仅回答消息）。
   * 🔴 必须是原文而非改写后的检索词：改写是检索内部行为，拿它当「用户问了什么」
   * 会让所有归因失真（见 docs/chat-badcase-plan.md）。
   */
  question?: string;
  /** 本轮实际送检索的查询（深度模式为多变体合并）。与 question 语义漂移即可定位「改写把问题带偏」。 */
  searchQuery?: string;
  /**
   * 各检索片段的字符长度（仅回答消息）。
   * 只存长度不存全文（10 条 × 1800 字 ≈ 18KB/轮）；判是否顶格 1800 只需长度，
   * 要查片段内容时凭 citations[].docId 事后重取。
   */
  snippetLens?: number[];
  /** 检索路径快照（反馈归因用）。 */
  trace?: { deep: boolean; historyTurns: number; model: string };
}

/**
 * 单轮问答 id：反馈写入的主键（后端唯一索引 + upsert ⇒ 幂等，可改单选）。
 * 优先 crypto.randomUUID（需安全上下文）；不可用时退回时间戳 + 随机串，
 * 同样满足后端 `^[A-Za-z0-9_-]{8,64}$` 的校验。
 */
function createTurnId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Chatbot 会话主流程（悬浮球 ChatWidget 与 /ask 全页问答共用），双模式：
 * - 自定义档（BYO-Key）：后端只做检索/prompt 组装（B 路线），LLM 由浏览器直连网关。
 * - 默认档（站点配置）：LLM Key 不出服务端，走后端全托管流（/api/chat/stream）。
 * 「是否可发」的拦截由调用方负责（各自决定引导方式；见 chatLlmDefault）。
 */
export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // 最近一次检索组装出的完整 prompt（system + 历史 + 问句），供「继续回复」
  // 续写时复用——续写不重新检索，避免对「继续」二字做无意义的召回。
  const lastPromptRef = useRef<ChatLlmMessage[] | null>(null);

  const applyToLastAssistant = useCallback(
    (patch: (m: ChatMessage) => ChatMessage) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        if (last >= 0 && next[last].role === 'assistant') {
          next[last] = patch(next[last]);
        }
        return next;
      });
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;
      const history = messages
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));
      // 反馈按轮定位：turnId 在此生成，同一轮的「继续回复」沿用不换。
      const turnId = createTurnId();
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: '', id: turnId, question: trimmed },
      ]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const config = loadChatLlmConfig();
      // ── 默认档（站点配置，Key 不出服务端）────────────────────────
      // 无 BYO-Key 时走后端全托管流（/api/chat/stream：检索+LLM 同源完成）。
      // 深度检索的改写/打分小调用需要浏览器侧 Key，默认档不支持（设置框已注明）。
      if (!isChatLlmConfigured(config)) {
        try {
          const defaultModel = (await chatLlmDefault()).model ?? 'default';
          for await (const event of streamChat(
            trimmed,
            history,
            controller.signal,
          )) {
            if (event.type === 'citations') {
              applyToLastAssistant((m) => ({
                ...m,
                citations: event.citations,
                external: event.external,
                retrievalNotice: event.retrievalNotice,
                searchQuery: trimmed,
                snippetLens: [],
                trace: {
                  deep: false,
                  historyTurns: history.length,
                  model: defaultModel,
                },
              }));
            } else if (event.type === 'delta') {
              applyToLastAssistant((m) => ({
                ...m,
                content: m.content + event.text,
              }));
            } else if (event.type === 'usage') {
              applyToLastAssistant((m) => ({ ...m, usage: event.usage }));
            } else if (event.type === 'error') {
              applyToLastAssistant((m) => ({ ...m, error: event.message }));
            }
          }
        } catch (error) {
          if (controller.signal.aborted) {
            applyToLastAssistant((m) => ({ ...m, stopped: true }));
          } else {
            applyToLastAssistant((m) => ({
              ...m,
              error:
                error instanceof Error
                  ? error.message
                  : '请求失败，请稍后再试',
            }));
          }
        } finally {
          abortRef.current = null;
          setStreaming(false);
        }
        return;
      }
      try {
        const deep = config.deepRetrieval === true;
        // 追问检索改写：检索只看查询文本，指代型追问（「它呢？」）会漏召回。
        // 深度模式一次生成 3 个变体多路检索合并；普通模式单路改写。
        // 改写是一次额外小调用（不计入主回答的 usage 徽标），失败静默退回原问句。
        let searchQuery = trimmed;
        let queries: string[] | undefined;
        if (history.length > 0) {
          try {
            if (deep) {
              const variants = await rewriteQueryMulti(
                config,
                history,
                trimmed,
                controller.signal,
              );
              if (variants.length) queries = variants;
            } else {
              const rewritten = await rewriteQuery(
                config,
                history,
                trimmed,
                controller.signal,
              );
              if (rewritten) searchQuery = rewritten;
            }
          } catch {
            // 改写失败不影响问答：退回原问句检索。
          }
        }
        // 检索改写只影响候选召回；意图与期次规划始终使用用户原问句，
        // 避免改写删掉“2025年第37周”等约束后误取最新榜单。
        const retrievalQueries =
          queries ?? (searchQuery !== trimmed ? [searchQuery] : undefined);
        let result = await retrieveContext(
          trimmed,
          history,
          controller.signal,
          { queries: retrievalQueries },
        );
        // 深度模式 B2：片段相关度过滤（CRAG 简化版）——小调用打分后剔除低相关
        // 片段并重建 prompt（打分失败跳过；判全不相关则转外部知识模式）。
        if (deep && result.docs && result.docs.length > 3) {
          try {
            const keptDocIds = await scoreRelevantDocs(
              config,
              retrievalQueries?.[0] ?? searchQuery,
              result.docs,
              controller.signal,
            );
            if (keptDocIds !== null) {
              result = await retrieveContext(
                trimmed,
                history,
                controller.signal,
                { queries: retrievalQueries, docIds: keptDocIds },
              );
            }
          } catch {
            // 打分/二次检索失败保留原结果，不阻塞主链路。
          }
        }
        const {
          citations,
          messages: llmMessages,
          docs,
          external,
          retrievalNotice,
        } = result;
        lastPromptRef.current = llmMessages;
        // 反馈归因证据：片段**长度**数组（不存全文，见 ChatMessage.snippetLens 注释）。
        const snippetLens = Array.isArray(docs)
          ? docs.map((doc) =>
              typeof doc?.snippet === 'string' ? doc.snippet.length : 0,
            )
          : [];
        // 零命中 = 外部知识模式：后端 prompt 已切换，界面标示外部信息。
        applyToLastAssistant((m) => ({
          ...m,
          citations,
          external,
          retrievalNotice,
          // 深度模式把三路变体合并留存：单看改写结果才能定位「改写把问题带偏」。
          searchQuery: queries?.length ? queries.join(' | ') : searchQuery,
          snippetLens,
          trace: { deep, historyTurns: history.length, model: config.model },
        }));
        const { finishReason } = await streamLlmDirect(
          {
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey: config.apiKey,
          },
          llmMessages,
          {
            onDelta: (t) =>
              applyToLastAssistant((m) => ({ ...m, content: m.content + t })),
            onUsage: (usage) =>
              applyToLastAssistant((m) => ({ ...m, usage })),
          },
          controller.signal,
        );
        applyToLastAssistant((m) => ({
          ...m,
          truncated: finishReason === 'length',
        }));
      } catch (error) {
        if (controller.signal.aborted) {
          // 手动停止：标记而非报错，空内容时由界面显示「已停止生成」。
          applyToLastAssistant((m) => ({ ...m, stopped: true }));
        } else {
          applyToLastAssistant((m) => ({
            ...m,
            error:
              error instanceof Error ? error.message : '请求失败，请稍后再试',
          }));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [messages, applyToLastAssistant],
  );

  /**
   * 继续回复：上一条回答因输出上限被截断（finish_reason=length）时，
   * 复用上次 prompt + 已有部分回答，追加一条「继续」指令让模型接着输出，
   * 流式拼接到同一条回答上。不重新检索（沿用上次的参考资料）。
   */
  const continueAnswer = useCallback(async () => {
    const base = lastPromptRef.current;
    const last = messages[messages.length - 1];
    if (!base || abortRef.current) return;
    if (!last || last.role !== 'assistant' || !last.truncated || !last.content) {
      return;
    }
    const config = loadChatLlmConfig();
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { finishReason } = await streamLlmDirect(
        {
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
        },
        [
          ...base,
          { role: 'assistant', content: last.content },
          {
            role: 'user',
            content:
              '继续。从上次中断处接着输出剩余内容，不要重复已有内容，不要寒暄或确认。',
          },
        ],
        {
          onDelta: (t) =>
            applyToLastAssistant((m) => ({ ...m, content: m.content + t })),
          onUsage: (usage) =>
            applyToLastAssistant((m) => ({
              ...m,
              // 累加续写消耗，徽标展示本轮问答总消耗。
              usage: m.usage
                ? {
                    promptTokens: m.usage.promptTokens + usage.promptTokens,
                    completionTokens:
                      m.usage.completionTokens + usage.completionTokens,
                  }
                : usage,
            })),
        },
        controller.signal,
        // 续写沿用原问句派生的 seed（与首答一致，保持采样口径稳定）。
        { seed: deriveLlmSeed(base) },
      );
      applyToLastAssistant((m) => ({
        ...m,
        truncated: finishReason === 'length',
      }));
    } catch (error) {
      if (controller.signal.aborted) {
        applyToLastAssistant((m) => ({ ...m, stopped: true }));
      } else {
        applyToLastAssistant((m) => ({
          ...m,
          error:
            error instanceof Error ? error.message : '请求失败，请稍后再试',
        }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, [messages, applyToLastAssistant]);

  return { messages, streaming, send, stop, continueAnswer };
}
