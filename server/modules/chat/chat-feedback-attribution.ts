import { isMechanismOnlyDocIds } from '@shared/chat-source';

import { SNIPPET_TOTAL } from './chat-snippet';

/**
 * 问答反馈的归因判定（纯函数，零 IO —— 便于单测与复用）。
 *
 * 为什么要归因：RAG 问答的「答得不对」可能是五层中任一层的失败，而五层的修法
 * 完全不同（补语料 / 改召回 / 改切片 / 改 prompt / 改前端）。同一句差评不归因，
 * 就只能反复"感觉不对"，无法定位也无法验收。
 *
 * 为什么归因放后台而不是问用户：用户不懂「检索层」「生成层」。前端只问业务语言
 * 的 4 个选项，技术归因由本函数用信号自动细分。
 */

/** 前端提供的业务选项（用户可理解的语言）。 */
export type ChatFeedbackReason =
  | 'off_target'
  | 'wrong'
  | 'shallow'
  | 'citation_broken';

export const CHAT_FEEDBACK_REASONS: readonly ChatFeedbackReason[] = [
  'off_target',
  'wrong',
  'shallow',
  'citation_broken',
];

/**
 * 归因层。`zero_recall` 与 `corpus` 刻意分开：
 * 零召回在关键词检索下既可能是「内容没入库」（语料层）也可能是「内容在但没召回」
 * （检索层），仅凭反馈数据无法区分 —— 猜一个当真值会误导后续工作。
 * 故先落中立值 `zero_recall`，人工/eval 定性后再改为 `corpus` 或 `retrieval`。
 */
export type ChatFeedbackAttribution =
  | 'zero_recall'
  | 'corpus'
  | 'retrieval'
  | 'snippet'
  | 'generation'
  | 'presentation'
  | 'boundary';

/** 归因所需的信号快照（全部来自前端已有状态，无额外采集）。 */
export interface FeedbackSignals {
  reason: ChatFeedbackReason;
  /** citations 的 docId 数组（含文章/机制/榜单/站内内容来源前缀）。 */
  citationDocIds: string[];
  /** 各条片段的字符长度；判断是否顶格 SNIPPET_TOTAL。 */
  snippetLens: number[];
  /** 零命中 → 走了外部知识模式（citations 为空）。 */
  external: boolean;
  /** 输出被 max_tokens 截断（finish_reason=length）。 */
  truncated: boolean;
  /** 用户主动点了停止生成。 */
  stopped: boolean;
}

/**
 * citations 是否全部来自机制观察（机制条目本身不含完整正文 ⇒ 有已知边界）。
 * 实现已上移 `@shared/chat-source`（前端反馈栏也要判同一件事），此处保留名字
 * 供既有调用与单测使用，避免两处口径漂移。
 */
export const isMechanismOnly = isMechanismOnlyDocIds;

/**
 * 判定归因层。
 *
 * 分支顺序即优先级，改动前先看注释里的理由：
 *  1. citation_broken  → presentation（与检索/生成无关，只看链接本身）
 *  2. stopped          → null（用户自己中断，不构成对本次回答质量的证据；
 *                        落 null 而非猜一个层，避免自伤型坏例污染归因统计）
 *  3. truncated+shallow→ generation（回答短是输出上限截断所致，不是资料不够）
 *  4. wrong            → generation（有资料仍答错 = 幻觉/误读）
 *  5. off_target+空召回→ zero_recall（见类型注释：两因不可区分，落中立值）
 *  6. off_target       → retrieval（召回了不相关内容）
 *  7. shallow+仅机制   → boundary（机制无正文，已知边界，不计入缺陷池）
 *  8. shallow+片段顶格 → snippet（硬切片把后文截掉了）
 *  9. shallow          → retrieval（召回不足，资料没找全）
 */
export function attributeFeedback(
  signals: FeedbackSignals,
): ChatFeedbackAttribution | null {
  const {
    reason,
    citationDocIds,
    snippetLens,
    external,
    truncated,
    stopped,
  } = signals;

  if (reason === 'citation_broken') return 'presentation';
  if (stopped) return null;
  if (reason === 'wrong') return 'generation';

  if (reason === 'off_target') {
    return citationDocIds.length === 0 || external ? 'zero_recall' : 'retrieval';
  }

  // reason === 'shallow'
  if (truncated) return 'generation';
  if (isMechanismOnly(citationDocIds)) return 'boundary';
  const maxSnippet = snippetLens.length ? Math.max(...snippetLens) : 0;
  return maxSnippet >= SNIPPET_TOTAL ? 'snippet' : 'retrieval';
}
