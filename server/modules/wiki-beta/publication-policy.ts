/**
 * 审批门禁唯一字面量（P4b 批4 收敛）：Base「审批状态」的公开值。
 * 历史 7 处散落字面量全部改引本常量，字段改名/翻译时只改这一处。
 *
 * 2026-09-21：原先导出的 `PUBLISHED_PREDICATE` / `isPublishable` 建立在
 * `wiki_beta_content` 表之上，该表零读取方已删除 ⇒ 两个导出同步移除。
 * 门禁实现在读侧（`FeishuBaseReader` 直读 Base 后按本常量过滤）。
 */
export const APPROVAL_STATUS_PUBLISHED = '已批准';

/**
 * 返回同步链接中第一个 http(s) 外链原文。
 * 只认 https 会把 Base 里人工粘贴的 http:// 微信文链接全滤空
 * （2026-09-16 线上 13 条外链文章 8 条 http），故放宽为 http+https。
 */
export function extractOriginalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s)\]}>"']+/iu);
  if (!match?.[0]) return null;

  const candidate = match[0].replace(/[.,;:!?,。；：！？]+$/u, '');
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}
