import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Sparkles, Square } from 'lucide-react';
import {
  isChatLlmConfigured,
  loadChatLlmConfig,
} from '@client/src/lib/chat-llm-config';
import { chatLlmDefault } from '@client/src/api/chat';
import { useChatSession } from '@client/src/components/chat/use-chat-session';
import ChatMessageView from '@client/src/components/chat/ChatMessageView';
import AiSettingsDialog from '@client/src/components/chat/AiSettingsDialog';

/**
 * /ask 全页 AI 问答（顶栏搜索框入口落地页）：
 * 首问写在 URL（?q=...，可分享/刷新重放），进页自动执行一次；
 * 页内可继续追问（内存态多轮，不打断流式，URL 保持首问）。
 * 链路与悬浮球一致：后端检索/prompt 组装（B 路线）+ 浏览器直连网关流式。
 */
export default function AskPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const { messages, streaming, send, stop, continueAnswer } = useChatSession();
  const [input, setInput] = useState(q);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 站点默认配置可用性；null = 查询中（未定前不拦截，交由服务端最终兜底）。 */
  const [defaultAvailable, setDefaultAvailable] = useState<boolean | null>(
    null,
  );
  // URL 首问去重：同一 q 只自动执行一次（send 依赖 messages，effect 会多次跑）。
  const firedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    let cancelled = false;
    void chatLlmDefault().then((info) => {
      if (!cancelled) setDefaultAvailable(info.available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 配置校验 + 发送；BYO 与站点默认档均不可用时引导打开设置弹窗。 */
  const tryAsk = useCallback(
    (text: string): boolean => {
      const t = text.trim();
      if (!t) return false;
      if (
        !isChatLlmConfigured(loadChatLlmConfig()) &&
        defaultAvailable === false
      ) {
        setSettingsOpen(true);
        return false;
      }
      void sendRef.current(t);
      return true;
    },
    [defaultAvailable],
  );

  useEffect(() => {
    if (!q || firedRef.current === q) return;
    firedRef.current = q;
    if (tryAsk(q)) {
      setInput('');
    } else {
      firedRef.current = null;
    }
  }, [q, tryAsk]);

  // 流式期间跟随滚动到底部。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const submit = () => {
    const t = input.trim();
    if (!t || streaming) return;
    // 首问：写入 URL（可分享/刷新重放），由上方 effect 统一触发；
    // 若与当前 q 相同且已触发过（effect 去重会跳过），直接发送。
    if (messages.length === 0) {
      if (t === q && firedRef.current === q) {
        if (tryAsk(t)) setInput('');
        return;
      }
      setInput(t);
      setSearchParams({ q: t });
      return;
    }
    // 追问：内存态多轮，不改 URL。
    if (tryAsk(t)) setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const askInput = (
    <div className="relative w-full">
      <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={2000}
        placeholder="问点什么，如：近期 SLG 品类有哪些买量变化？"
        className="max-h-32 min-h-11 w-full resize-none rounded-xl border bg-card py-3 pl-10 pr-20 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      {streaming ? (
        <button
          type="button"
          aria-label="停止生成"
          onClick={stop}
          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border hover:bg-accent"
        >
          <Square className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="absolute right-3 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          提问
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-primary-foreground">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">问知识库</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              基于站内已发布文章回答，附来源引用；
              <br className="sm:hidden" />
              默认使用站点配置的模型作答，也可在「AI 设置」中改用自己的 Key
            </p>
          </div>
          <form onSubmit={handleSubmit} className="w-full max-w-xl">
            {askInput}
          </form>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4"
          >
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <ChatMessageView
                  key={i}
                  message={m}
                  phase={
                    streaming && i === messages.length - 1
                      ? 'streaming'
                      : 'done'
                  }
                  onContinue={i === messages.length - 1 ? continueAnswer : undefined}
                />
              ),
            )}
          </div>
          <form onSubmit={handleSubmit} className="shrink-0 border-t pt-3">
            {askInput}
          </form>
        </>
      )}
      <AiSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => {
          // 设置保存后自动补发挂起的首问。
          if (q && firedRef.current !== q && messages.length === 0) {
            firedRef.current = q;
            if (tryAsk(q)) {
              setInput('');
            } else {
              firedRef.current = null;
            }
          }
        }}
      />
    </div>
  );
}
