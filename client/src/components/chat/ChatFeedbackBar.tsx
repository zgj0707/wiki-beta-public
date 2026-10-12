import { useState } from 'react';
import { Check, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { isMechanismOnlyDocIds } from '@shared/chat-source';
import {
  submitChatFeedback,
  withdrawChatFeedback,
  type ChatFeedbackContext,
  type ChatFeedbackReason,
} from '@client/src/api/chat';
import { cn } from '@client/src/lib/utils';
import type { ChatMessage } from './use-chat-session';

/**
 * 单条回答的反馈栏（悬浮球 ChatWidget 与 /ask 共用，挂在 ChatMessageView 底部）。
 *
 * 为什么要有：chat 此前零采集（后端日志不记问题与回答文本，且 B 路线下回答根本
 * 不经后端），坏例「留不下来」——09-17 那两个问题靠人工反馈才发现，修完没沉淀成
 * 用例。本栏是坏例集的唯一输入端，产物每周回填 `scripts/eval-chat-retrieval.mjs`。
 *
 * 两条设计约束：
 * 1. 🔴 **好评只回 `{turnId, rating}`**，不带任何文本 —— 好评只当差评率的分母，
 *    分母不需要内容。差评才回问题/回答/引用/上下文（见 ChatFeedbackPayload）。
 * 2. 🔴 **只问业务语言**（答非所问/答错了/答得太浅/引用打不开），技术归因层
 *    由后端纯函数用信号细分 —— 用户不懂「检索层」「生成层」。
 */
const CHIPS: Array<{ reason: ChatFeedbackReason; label: string }> = [
  { reason: 'off_target', label: '答非所问' },
  { reason: 'wrong', label: '答错了' },
  { reason: 'shallow', label: '答得太浅' },
  { reason: 'citation_broken', label: '引用打不开' },
];

/** 已评状态本地留存：刷新/切页后仍显示已评态（后端数据才是真正 SSOT）。 */
const STORAGE_PREFIX = 'wiki-beta:chat-feedback:';

interface Recorded {
  rating: 'up' | 'down';
  reason?: ChatFeedbackReason;
}

const REASON_LABELS: Record<ChatFeedbackReason, string> = {
  off_target: '答非所问',
  wrong: '答错了',
  shallow: '答得太浅',
  citation_broken: '引用打不开',
};

function storageKey(turnId: string): string {
  return `${STORAGE_PREFIX}${turnId}`;
}

function readRecorded(turnId: string): Recorded | null {
  if (!turnId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(turnId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rating?: unknown; reason?: unknown };
    if (parsed?.rating !== 'up' && parsed?.rating !== 'down') return null;
    const reason =
      typeof parsed.reason === 'string' &&
      CHIPS.some((chip) => chip.reason === parsed.reason)
        ? (parsed.reason as ChatFeedbackReason)
        : undefined;
    return { rating: parsed.rating, reason };
  } catch {
    return null;
  }
}

function writeRecorded(turnId: string, value: Recorded | null): void {
  if (!turnId || typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(storageKey(turnId), JSON.stringify(value));
    } else {
      window.localStorage.removeItem(storageKey(turnId));
    }
  } catch {
    // 存储不可用（隐私模式/超限）时静默失败：已评态退化为「本次会话内可见」。
  }
}

export default function ChatFeedbackBar({ message }: { message: ChatMessage }) {
  const turnId = message.id ?? '';
  const [recorded, setRecorded] = useState<Recorded | null>(() =>
    readRecorded(turnId),
  );
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 后端判定为已知边界（机制条目无正文）时给出说明，避免用户以为反馈丢了。
  const [boundary, setBoundary] = useState(false);

  // 机制条目本身只有三段式摘要（`原始正文` 被同步明确不请求）⇒「答不深」是
  // 已知边界而非缺陷。命中同一份 shared 判定，前后端口径不允许分叉。
  const mechanismOnly = isMechanismOnlyDocIds(
    (message.citations ?? []).map((c) => c.docId),
  );

  const submit = async (rating: 'up' | 'down', reason?: ChatFeedbackReason) => {
    if (pending || !turnId) return;
    setPending(true);
    setError(null);
    try {
      const ack = await submitChatFeedback(
        rating === 'up'
          ? // 🔴 好评只发这两个字段。多传一个字节的文本都可能把用户 Key 带进库
            // （llmConfig 与问题同处一个请求体，后端另有 CHECK 兜底）。
            { turnId, rating }
          : {
              turnId,
              rating,
              reason,
              question: message.question ?? '',
              searchQuery: message.searchQuery,
              answer: message.content,
              citations: message.citations ?? [],
              context: buildContext(message),
            },
      );
      const value: Recorded = { rating, reason };
      writeRecorded(turnId, value);
      setRecorded(value);
      setExpanded(false);
      setBoundary(ack.status === 'boundary');
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  const withdraw = async () => {
    if (pending || !turnId) return;
    setPending(true);
    setError(null);
    try {
      await withdrawChatFeedback(turnId);
      writeRecorded(turnId, null);
      setRecorded(null);
      setExpanded(false);
      setBoundary(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤回失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  const onThumbUp = () => {
    if (recorded?.rating === 'up') {
      void withdraw();
      return;
    }
    void submit('up');
  };

  const onThumbDown = () => {
    if (recorded?.rating === 'down') {
      void withdraw();
      return;
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {recorded ? (
          <>
            <span className="inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5 text-primary" />
              已记录
              {recorded.rating === 'down' && recorded.reason
                ? `：${REASON_LABELS[recorded.reason]}`
                : '：这条有帮助'}
              {boundary ? '（不计入缺陷统计）' : ''}
            </span>
            <button
              type="button"
              onClick={() => void withdraw()}
              disabled={pending}
              className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              撤回
            </button>
          </>
        ) : (
          <>
            <span>这条回答对你有帮助吗？</span>
            <button
              type="button"
              aria-label="有帮助"
              aria-pressed={false}
              onClick={onThumbUp}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ThumbsUp className="h-3.5 w-3.5" />
              )}
              有帮助
            </button>
            <button
              type="button"
              aria-label="没帮助"
              aria-expanded={expanded}
              onClick={onThumbDown}
              disabled={pending}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent disabled:opacity-50',
                expanded && 'border-primary text-primary',
              )}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              没帮助
            </button>
          </>
        )}
      </div>

      {expanded && !recorded && (
        <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => {
              // 机制类「答太浅」在 UI 直接标为已知边界：选了会被后端记 boundary，
              // 不进缺陷池 —— 否则这类反馈会长期污染归因统计。
              const isBoundaryChip = chip.reason === 'shallow' && mechanismOnly;
              return (
                <button
                  key={chip.reason}
                  type="button"
                  disabled={pending}
                  onClick={() => void submit('down', chip.reason)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50',
                    isBoundaryChip && 'border-dashed text-muted-foreground',
                  )}
                >
                  {isBoundaryChip ? '答得太浅（机制条目无正文）' : chip.label}
                </button>
              );
            })}
          </div>
          {mechanismOnly && (
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              本条回答只引用了机制观察条目，这类条目本身没有完整正文（只有三段式摘要），
              回答偏浅属已知边界 —— 选「答得太浅」会记为边界，不计入缺陷统计。
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            提交后会记录本轮的问题与回答原文，仅用于改进问答质量，不会公开。
          </div>
        </div>
      )}

      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/** 归因上下文快照：只取信号，绝不带 llmConfig（用户 BYO-Key）。 */
function buildContext(message: ChatMessage): ChatFeedbackContext {
  return {
    external: message.external === true,
    truncated: message.truncated === true,
    stopped: message.stopped === true,
    deep: message.trace?.deep === true,
    historyTurns: message.trace?.historyTurns ?? 0,
    snippetLens: message.snippetLens ?? [],
    model: message.trace?.model ?? '',
    usage: message.usage ?? null,
  };
}
