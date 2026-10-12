import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, Loader2 } from 'lucide-react';
import { withClientBasePath } from '@client/src/lib/base-path';
import type { ChatCitation, ChatUsage } from '@client/src/api/chat';
import ChatFeedbackBar from './ChatFeedbackBar';
import type { ChatMessage } from './use-chat-session';

/**
 * 单条 AI 回答的渲染块（悬浮球 ChatWidget 与 /ask 全页问答共用）：
 * 外部信息横幅、Markdown 正文、错误框、token 消耗、来源引用。
 * 引用 SSOT 是检索结果（citations），站内路径必须过 withClientBasePath
 * （裸 <a href="/..."> 会绕过 router basename 落到域名根 404）。
 */
export default function ChatMessageView({
  message,
  phase,
  onContinue,
}: {
  message: ChatMessage;
  phase: 'streaming' | 'done';
  /** 截断续写回调：仅最后一条回答需要，由调用方按位置传入。 */
  onContinue?: () => void;
}) {
  // 引用防幻觉兜底：SSOT 是检索结果，但渲染前仍校验结构完整性，
  // 剔除缺 docId/url 的残缺条目（未来若引入模型产出引用也不会落到无效链接）。
  const citations = (message.citations ?? []).filter(
    (c) => !!c && typeof c.docId === 'string' && !!c.docId && !!c.url,
  );
  return (
    <div className="space-y-2">
      {message.external && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠ 外部信息：知识库未检索到相关内容，以下为 AI
          通用知识生成，可能过时，请自行核验
        </div>
      )}
      {message.retrievalNotice && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
          {message.retrievalNotice}
        </div>
      )}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        ) : phase === 'streaming' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : message.stopped ? (
          <span className="text-xs text-muted-foreground">已停止生成</span>
        ) : (
          !message.error && (
            <span className="text-xs text-muted-foreground">
              （网关未返回内容，请重试或检查 AI 设置中的模型名）
            </span>
          )
        )}
        {phase === 'streaming' && message.content && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" />
        )}
      </div>
      {message.stopped && message.content && phase === 'done' && (
        <div className="text-[11px] text-muted-foreground">已停止生成</div>
      )}
      {message.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message.error}
        </div>
      )}
      {message.truncated && phase === 'done' && onContinue && !message.error && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            继续回复
          </button>
          <span className="text-[11px] text-muted-foreground">
            回答达到输出上限被截断
          </span>
        </div>
      )}
      {message.usage && (
        <div className="text-[11px] text-muted-foreground">
          本次消耗：输入 {message.usage.promptTokens} + 输出{' '}
          {message.usage.completionTokens} tokens
        </div>
      )}
      {citations.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            来源（{citations.length}）
          </div>
          {citations.map((c) => (
            <a
              key={c.docId}
              href={withClientBasePath(c.url)}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-primary hover:underline"
            >
              {c.title || c.url}
              {c.sourceDate ? ` · ${c.sourceDate}` : ''}
            </a>
          ))}
        </div>
      )}
      {/*
        反馈栏挂在来源区之后：仅「已完成 + 有内容 + 无错误」的回答可评。
        id 是本轮 turnId（use-chat-session 生成），无 id 说明该消息不完整或来自
        旧会话，不提供反馈入口。悬浮球与 /ask 共用本组件 ⇒ 挂一次两处生效。
      */}
      {phase === 'done' && !!message.content && !message.error && !!message.id && (
        <ChatFeedbackBar message={message} />
      )}
    </div>
  );
}
