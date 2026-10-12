import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, Square, X } from 'lucide-react';
import { cn } from '@client/src/lib/utils';
import {
  isChatLlmConfigured,
  loadChatLlmConfig,
} from '@client/src/lib/chat-llm-config';
import { chatLlmDefault } from '@client/src/api/chat';
import { useChatSession } from './use-chat-session';
import ChatMessageView from './ChatMessageView';
import AiSettingsDialog from './AiSettingsDialog';

/**
 * 全站问答悬浮球：右下角展开对话窗，SSE 流式渲染，强制引用知识库来源。
 * 发送门槛：BYO-Key 已配置 或 站点默认配置可用（二选一即放行）；
 * 两者皆无时引导打开设置弹窗。
 * 会话主流程与消息渲染抽在 use-chat-session / ChatMessageView（/ask 页共用）。
 */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { messages, streaming, send, stop, continueAnswer } = useChatSession();
  const [input, setInput] = useState('');
  /** 站点默认配置可用性；null = 查询中（未定前不拦截，交由服务端最终兜底）。 */
  const [defaultAvailable, setDefaultAvailable] = useState<boolean | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void chatLlmDefault().then((info) => {
      if (!cancelled) setDefaultAvailable(info.available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 流式期间跟随滚动到底部。
  useEffect(() => {
    if (!streaming && !open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, open]);

  const sendChecked = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || streaming) return;
      if (
        !isChatLlmConfigured(loadChatLlmConfig()) &&
        defaultAvailable === false
      ) {
        setSettingsOpen(true);
        return;
      }
      void send(t);
    },
    [send, streaming, defaultAvailable],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendChecked(input);
      setInput('');
    }
  };

  return (
    <>
      {/* 悬浮球 */}
      <button
        type="button"
        aria-label={open ? '关闭 AI 问答' : '打开 AI 问答'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105',
        )}
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {/* 对话窗 */}
      {open && (
        <div
          className={cn(
            'fixed bottom-20 right-4 z-50 flex h-[560px] max-h-[calc(100vh-7rem)] flex-col',
            'w-[calc(100vw-2rem)] sm:w-[380px] rounded-xl border bg-background shadow-xl',
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4 text-primary" />
              知识库问答
            </div>
            <button
              type="button"
              aria-label="AI 设置"
              onClick={() => setSettingsOpen(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              设置
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="mt-10 text-center text-sm text-muted-foreground">
                基于站内已发布文章回答，附来源引用。
                <br />
                有什么想了解的？
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
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

          <div className="border-t p-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                maxLength={2000}
                className="max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
              {streaming ? (
                <button
                  type="button"
                  aria-label="停止生成"
                  onClick={stop}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border hover:bg-accent"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="发送"
                  onClick={() => {
                    sendChecked(input);
                    setInput('');
                  }}
                  disabled={!input.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <AiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
