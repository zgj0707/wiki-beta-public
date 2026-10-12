/**
 * 检索来源前缀与来源判定（client / server 共用）。
 *
 * 为什么放 shared：检索侧（`server/modules/chat/chat-retrieval-common.ts`）构造
 * docId、后端归因函数（`chat-feedback-attribution.ts`）与前端反馈栏（机制类
 * 「答不深」的已知边界提示）三处都要判来源。各写一份必然漂移——漂移症状是
 * 「前端提示是已知边界、后端却算成缺陷」，而这类不一致没有报错、只能靠人肉发现。
 * 同「同一缺陷只能有一处实现」的既有约定。
 */

/**
 * 候选 docId 的来源前缀。
 *
 * 文章 docId 原是 Base `record_id`，机制条目使用 `stable_key`，榜单按板块+期次，
 * 站内内容按来源+业务键；候选 Map、多路改写合并 Map、前端 CRAG 白名单 Set 全部以 docId 为键，裸 id 混用一旦撞键
 * 就**静默丢文档**（不报错、只少一条资料）。故所有来源一律带显式前缀。
 * ⚠️ 前缀只在构造检索候选时加，DB 查询仍用裸 id。
 */
export const ARTICLE_SOURCE_PREFIX = 'article:';
export const MECHANISM_SOURCE_PREFIX = 'mechanism:';
/** 榜单来源：docId = `ranking:<boardKey>:<periodSlug>`。 */
export const RANKING_SOURCE_PREFIX = 'ranking:';
/** 网站公开文本来源（更新日志/静态页面/已启用发现内容）。 */
export const SITE_SOURCE_PREFIX = 'site:';

/**
 * citations 是否全部来自机制观察。
 *
 * 机制条目本身只有三段式摘要、**不含完整正文**（`原始正文` 被同步明确不请求，
 * 见 `base-sync.constants.ts`），所以「机制类回答答不深」是已知边界而非缺陷。
 * 空数组返回 false —— 零命中是另一回事（走外部知识模式），不要混为一谈。
 */
export function isMechanismOnlyDocIds(docIds: readonly string[]): boolean {
  return (
    docIds.length > 0 &&
    docIds.every((docId) => docId.startsWith(MECHANISM_SOURCE_PREFIX))
  );
}
