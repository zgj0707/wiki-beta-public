/**
 * chatbot 预置问答路径的**纯规则意图识别**（nav-tasks-p3b，方案 §4.1）。
 *
 * 设计约束（与现有单轮检索+生成架构对齐，不做 agent/工具循环）：
 *  - 意图识别零 LLM 前置调用、零新增延迟——纯词表匹配；
 *  - 明确的榜单目标优先于实体/机制/品类命中，避免路由到不含榜单数据的来源；
 *  - 非榜单问句再按 实体 > 机制 > 品类 > fallback 优先级取一；
 *  - 全不中 = fallback（现行跨来源检索行为不变）。
 *
 * 单独成文件（无 Nest/DB 依赖）与 `chat-daily-limit.ts` 同理：词表匹配的
 * 优先级与包含关系必须可单测，且 ChatIntentService 与单测共用同一实现。
 */

import { findEntityTextMatches, type EntityMatchTerm } from '../../common/entity/entity-matcher';

/** 意图路径。fallback = 兜底的现行跨来源检索。 */
export type ChatIntentKind =
  | 'vendor'
  | 'product'
  | 'mechanism'
  | 'category'
  | 'ranking'
  | 'fallback';

export interface ChatIntent {
  kind: ChatIntentKind;
  /** 命中的实体名 / 分类名 / 机制名（诊断与 prompt 用；fallback 为 null）。 */
  matchedTerm: string | null;
  /** vendor/product：命中的实体 Base record_id。 */
  entityId: string | null;
  /** ranking：命中的板块 key（空数组 = 问句未指明板块，取全部板块）。 */
  boardKeys: string[];
  /** category：命中的分类名（父项或子项原文）。 */
  categoryName: string | null;
  /** ranking：用户请求的期次约束；exact/previous 会在本站已发布周期中查找。 */
  periodRequest?: RankingPeriodRequest;
}

export interface RankingPeriodRequest {
  kind: 'latest' | 'exact' | 'previous' | 'range' | 'unspecified';
  /** 从问句中识别出的期次短语，仅供提示与诊断。 */
  label: string | null;
}

/** 意图识别输入快照（由 ChatIntentService 组装，纯数据）。 */
export interface ChatIntentContext {
  /** 启用实体的匹配词（词 → 实体），terms 与 entities 对齐。 */
  entityTerms: EntityMatchTerm[];
  entityById: Map<string, { name: string; type: string }>;
  /** 玩法分类枚举（父项与子项中文名原文）。 */
  categoryNames: string[];
  /** 机制观察条目显示名（主标题 + 次标题，已剥「（试译）」并解码实体）。 */
  mechanismTitles: Array<{ stableKey: string; primary: string; secondary: string }>;
}

/** 榜单板块 key → 问句可指名的叫法（小写匹配）。 */
export const RANKING_BOARD_ALIASES: Record<string, string[]> = {
  steam: ['steam'],
  appstore: ['appstore', 'app store', 'ios', '苹果', 'slg下载'],
  weixin: ['微信', '小游戏畅销', '畅销榜'],
};

/** 明确的榜单目标词。出现时优先进入榜单路径，避免被实体/机制词表遮蔽。 */
export const RANKING_QUESTION_PATTERN =
  /(榜单|排行|排行榜|排名|名次|排第几|第几名|第\s*\d+\s*名|销量榜|畅销榜|小游戏畅销|销量|下载榜|收费榜|免费榜|卖得好|什么火|top\s*\d+)/i;

const PREVIOUS_PERIOD_PATTERN =
  /(上一期|上期|前一期|上周|上一周|上月|上个月|上季度|上一季度|去年|前年|上一年)/i;
const PERIOD_RANGE_PATTERN =
  /(?:最近|近|过去)\s*(?:([2-9]|[1-9]\d)|([两三四五六七八九十]))\s*(周|星期|月|个月|季度)/i;
const EXACT_PERIOD_PATTERN =
  /(20\d{2}\s*年?\s*(?:第?\s*[一二三四1-4]\s*季度|Q[1-4]|[上下]半年)|20\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日?)?|20\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|20\d{2}\s*年?\s*第\s*[一二三四五六七八九十\d]{1,3}\s*周|[一二三四1-4]\s*季度|第\s*[一二三四五六七八九十\d]{1,3}\s*周|\d{1,2}\s*月第\s*[一二三四五六七八九十\d]{1,3}\s*周)/i;
const LATEST_PERIOD_PATTERN =
  /(最近一周|过去一周|近一周|最近一个月|过去一个月|近一个月|最新一期|最近一期|当前最新|目前最新|本周|这周|本月|这个月|本期|最新|最近)/i;

/**
 * 意图判定主入口。
 *
 * 实体匹配复用 Aho-Corasick 词典匹配（与提及投影同一实现，含边界谓词与
 * 最长词优先），机制/品类用「词包含于问句」的子串匹配（枚举名都是专有名词，
 * 误命中风险低）。
 */
export function resolveChatIntent(
  question: string,
  ctx: ChatIntentContext,
): ChatIntent {
  const fallback: ChatIntent = {
    kind: 'fallback',
    matchedTerm: null,
    entityId: null,
    boardKeys: [],
    categoryName: null,
  };
  const q = question.trim();
  if (!q) return fallback;

  // 榜单是明确的数据目标；一旦命中，不让同句中的产品、厂商或机制名称
  // 把请求导向不含专用榜单来源的路径。
  const rankingIntent = resolveRankingIntent(q);
  if (rankingIntent) return rankingIntent;

  // ① 实体（厂商/产品）：词典匹配天然处理别名与大小写。
  const matches = findEntityTextMatches(q, ctx.entityTerms);
  for (const match of matches) {
    const entity = ctx.entityById.get(match.entityId);
    if (!entity) continue;
    if (entity.type === '厂商') {
      return {
        kind: 'vendor',
        matchedTerm: match.term,
        entityId: match.entityId,
        boardKeys: [],
        categoryName: null,
      };
    }
    if (entity.type === '产品') {
      return {
        kind: 'product',
        matchedTerm: match.term,
        entityId: match.entityId,
        boardKeys: [],
        categoryName: null,
      };
    }
    // 其他类型（词典若有新增类型）不命中路径，继续看后续命中。
  }

  // ② 机制：显示名（主/次标题）被问句包含即命中——机制名是专有名词，
  //    问句包含它是强信号；反向（问句是标题子串）会误命中单词标题，不做。
  //    比较 双方折叠空白：Base 枚举里「放置 RPG」带空格，用户问句常写「放置RPG」。
  const qCompact = q.replace(/\s+/g, '');
  for (const item of ctx.mechanismTitles) {
    for (const title of [item.primary, item.secondary]) {
      const t = title?.trim();
      if (t && t.length >= 2 && qCompact.includes(t.replace(/\s+/g, ''))) {
        return {
          kind: 'mechanism',
          matchedTerm: t,
          entityId: null,
          boardKeys: [],
          categoryName: null,
        };
      }
    }
  }

  // ③ 品类：分类枚举名（父项/子项）被问句包含；多个命中取最长名（更具体）。
  //    同样折叠空白比较（「放置 RPG」vs「放置RPG」）。
  let bestCategory: string | null = null;
  for (const name of ctx.categoryNames) {
    const n = name?.trim();
    if (!n || n.length < 2) continue;
    if (!qCompact.includes(n.replace(/\s+/g, ''))) continue;
    if (!bestCategory || n.length > bestCategory.length) bestCategory = n;
  }
  if (bestCategory) {
    return {
      kind: 'category',
      matchedTerm: bestCategory,
      entityId: null,
      boardKeys: [],
      categoryName: bestCategory,
    };
  }

  return fallback;
}

export function resolveRankingIntent(question: string): ChatIntent | null {
  const q = question.trim();
  if (!RANKING_QUESTION_PATTERN.test(q)) return null;

  const lowered = q.toLocaleLowerCase();
  const boardKeys = Object.entries(RANKING_BOARD_ALIASES)
    .filter(([, aliases]) =>
      aliases.some((alias) => lowered.includes(alias.toLocaleLowerCase())),
    )
    .map(([key]) => key);

  return {
    kind: 'ranking',
    matchedTerm: boardKeys.join(',') || null,
    entityId: null,
    boardKeys,
    categoryName: null,
    periodRequest: parseRankingPeriodRequest(q),
  };
}

export function parseRankingPeriodRequest(
  question: string,
): RankingPeriodRequest {
  const previous = question.match(PREVIOUS_PERIOD_PATTERN);
  if (previous) return { kind: 'previous', label: previous[0] };

  const range = question.match(PERIOD_RANGE_PATTERN);
  if (range) return { kind: 'range', label: range[0] };

  const exact = question.match(EXACT_PERIOD_PATTERN);
  if (exact) return { kind: 'exact', label: exact[0] };

  const latest = question.match(LATEST_PERIOD_PATTERN);
  if (latest) return { kind: 'latest', label: latest[0] };

  return { kind: 'unspecified', label: null };
}
