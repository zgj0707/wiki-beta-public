/**
 * chat 检索侧共用纯逻辑（关键词抽取 + 候选打分），无 Nest/DB 依赖。
 *
 * 为什么单独成文件：机制观察来源（`chat-mechanism-source.ts`）与文章来源
 * （`chat-retriever.service.ts`）必须共用同一套关键词与打分口径——两处各写一份
 * 必然漂移，而漂移症状是「同一问句在两个来源上相关度判断不一致」，极难排查。
 * 同「同一缺陷只能有一处实现」的既有约定。
 */

/** 关键词上限；日期短语优先保留（见 extractKeywords）。 */
export const MAX_KEYWORDS = 16;

/**
 * 检索来源。跨来源拼接后，prompt 需按来源给出不同说明（片段格式不同）。
 * `ranking`：榜单板块匹配期次的表格文本，仅由榜单意图路径产出。
 * `site`：更新日志、静态页面、指数口径和已启用发现内容的可见文本。
 */
export type DocSource = 'article' | 'mechanism' | 'ranking' | 'site';

/**
 * 检索命中的单条候选。文章与机制条目共用同一形状，靠 `source` 与 docId 前缀
 * 区分——prompt 组装、CRAG 打分回传都按这个统一形状处理，新增来源不改下游。
 */
export interface RetrievedDoc {
  docId: string;
  title: string;
  sourceDate: string | null;
  /** 站内路由：文章 `/article/:docId`，机制 `/mechanism-observatory/:stableKey`。 */
  url: string;
  /** 送入 prompt 的片段。文章为「大纲 + 节选」（约 1800 字），机制为三段式全文。 */
  snippet: string;
  score: number;
  /** 命中的实体词（诊断用；机制来源恒为空——机制语料未做实体抽取）。 */
  matchedEntities: string[];
  source: DocSource;
}

/**
 * 候选 docId 的来源前缀 —— 定义已上移 `@shared/chat-source`（前端反馈栏判
 * 「仅机制来源」要用同一份口径），此处 re-export 保持既有引用站点不变。
 */
export {
  ARTICLE_SOURCE_PREFIX,
  MECHANISM_SOURCE_PREFIX,
} from '@shared/chat-source';

/** 实体命中每篇计 3 分；关键词标题命中 2 分/词、正文命中 1 分/词。 */
export const SCORE_ENTITY_HIT = 3;
export const SCORE_TITLE_HIT = 2;
export const SCORE_BODY_HIT = 1;

/** 多路改写合并时，每多命中一路追加的分数（同一篇被多路召回 = 强信号）。 */
export const MULTI_QUERY_BONUS = 2;

export interface KeywordScore {
  score: number;
  /** 正文中首个关键词命中的下标；无命中为 -1（片段构建据此锚定窗口）。 */
  firstHitIndex: number;
}

/**
 * 按关键词给单条候选打分。`baseScore` 供调用方预置分（如文章的实体命中分）。
 * 机制观察与文章共用本函数，保证「标题 2 分 / 正文 1 分」口径唯一。
 */
export function scoreByKeywords(
  title: string,
  body: string,
  keywords: string[],
  baseScore = 0,
): KeywordScore {
  const lowerTitle = title.toLocaleLowerCase();
  const lowerBody = body.toLocaleLowerCase();
  let score = baseScore;
  let firstHitIndex = -1;
  for (const keyword of keywords) {
    const k = keyword.toLocaleLowerCase();
    if (!k) continue;
    if (lowerTitle.includes(k)) score += SCORE_TITLE_HIT;
    const bodyIndex = lowerBody.indexOf(k);
    if (bodyIndex >= 0) {
      score += SCORE_BODY_HIT;
      if (firstHitIndex < 0) firstHitIndex = bodyIndex;
    }
  }
  return { score, firstHitIndex };
}

/**
 * 关键词抽取：CJK 连续段取 bigram（去重、过滤单字），拉丁/数字连续段整词小写。
 * 另做两层增强：
 * ① 中文数字归一——库内标题用阿拉伯数字（「9月第2周」），用户口语用汉字
 *   （「9月第二周」），bigram「第二/二周」永远打不中标题，必须归一；
 * ② 日期短语整词提取——归一后按 /N月第N周/ 等模式取完整短语作为关键词，
 *   让「第2周」这类强信号直击标题（bigram 只能给出弱信号「月第」）。
 * 上限 MAX_KEYWORDS，日期短语优先保留。
 */
export function extractKeywords(question: string): string[] {
  const keywords = new Set<string>();
  // ① 中文数字 → 阿拉伯数字（仅作用于 第X周/月/期 与 X月 结构，避免误伤正文）。
  const normalized = question
    .replace(
      /第([零一两二三四五六七八九十]{1,3})([周月期日])/g,
      (match, num: string, unit: string) => {
        const n = cnNumeralToNumber(num);
        return n == null ? match : `第${n}${unit}`;
      },
    )
    .replace(/([零一两二三四五六七八九十]{1,3})月/g, (match, num: string) => {
      const n = cnNumeralToNumber(num);
      return n == null ? match : `${n}月`;
    });
  // ② 归一后的日期短语整词入列（最高优先）。
  for (const phrase of normalized.match(
    /\d{1,2}月第\d{1,2}周|\d{1,2}月第\d{1,2}期|第\d{1,2}[周月期]|\d{1,2}月/g,
  ) ?? []) {
    keywords.add(phrase);
    if (keywords.size >= MAX_KEYWORDS) return [...keywords];
  }
  const runs = [
    ...(question.match(/[\u4e00-\u9fff]+|[A-Za-z0-9][A-Za-z0-9_.-]*/g) ?? []),
    ...(normalized.match(/[\u4e00-\u9fff]+|[A-Za-z0-9][A-Za-z0-9_.-]*/g) ?? []),
  ];
  for (const run of runs) {
    if (keywords.size >= MAX_KEYWORDS) break;
    if (/^[\u4e00-\u9fff]+$/.test(run)) {
      if (run.length === 1) continue;
      for (let i = 0; i + 2 <= run.length; i += 1) {
        keywords.add(run.slice(i, i + 2));
        if (keywords.size >= MAX_KEYWORDS) break;
      }
    } else if (run.length >= 3) {
      keywords.add(run.toLocaleLowerCase());
    }
  }
  return [...keywords];
}

/** 中文数字串（≤3 字，含「十」的组合）→ 数值；无法解析返回 null。 */
function cnNumeralToNumber(cn: string): number | null {
  if (!cn) return null;
  if (cn === '十') return 10;
  const CN_DIGITS: Record<string, number> = {
    零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const tenIdx = cn.indexOf('十');
  if (tenIdx < 0) {
    // 非单字组合（如「二三」）不做猜测，避免误转换。
    return cn.length === 1 ? (CN_DIGITS[cn] ?? null) : null;
  }
  const tens = tenIdx === 0 ? 1 : (CN_DIGITS[cn[tenIdx - 1]] ?? null);
  const ones =
    tenIdx === cn.length - 1 ? 0 : (CN_DIGITS[cn[cn.length - 1]] ?? null);
  if (tens == null || ones == null) return null;
  return tens * 10 + ones;
}
