/**
 * 站内问答 LLM 配置（BYO-Key）：每人在浏览器本机配置自己的接入地址 / 模型 / Key。
 * 存储仅用 localStorage（不落库、不进本站数据库）。
 * Key 只在浏览器与 LLM 网关之间直连流转（B 路线），不经本站后端。
 */
export const CHAT_LLM_STORAGE_KEY = 'chat.llm.config.v1';

export interface ChatLlmConfig {
  /** OpenAI 兼容 base URL，如 https://llm.example.com/v1 */
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * 深度检索（默认关）：追问时多路改写（3 变体并发检索合并）+
   * 片段相关度过滤（低相关片段不进 prompt）。额外 2 次小调用，主链路不变。
   */
  deepRetrieval?: boolean;
}

export const CHAT_LLM_DEFAULTS: ChatLlmConfig = {
  baseUrl: 'https://llm.example.com/v1',
  model: 'example-model',
  apiKey: '',
};

export function isChatLlmConfigured(config: ChatLlmConfig | null): boolean {
  return !!config && !!config.baseUrl && !!config.model && !!config.apiKey;
}

export function loadChatLlmConfig(): ChatLlmConfig {
  if (typeof window === 'undefined') return { ...CHAT_LLM_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(CHAT_LLM_STORAGE_KEY);
    if (!raw) return { ...CHAT_LLM_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ChatLlmConfig>;
    return {
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim()
          : CHAT_LLM_DEFAULTS.baseUrl,
      model:
        typeof parsed.model === 'string' && parsed.model.trim()
          ? parsed.model.trim()
          : CHAT_LLM_DEFAULTS.model,
      apiKey:
        typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      deepRetrieval: parsed.deepRetrieval === true,
    };
  } catch {
    return { ...CHAT_LLM_DEFAULTS };
  }
}

export function saveChatLlmConfig(config: ChatLlmConfig): void {
  window.localStorage.setItem(
    CHAT_LLM_STORAGE_KEY,
    JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      apiKey: config.apiKey.trim(),
      deepRetrieval: config.deepRetrieval === true,
    }),
  );
}

export function clearChatLlmConfig(): void {
  window.localStorage.removeItem(CHAT_LLM_STORAGE_KEY);
}
