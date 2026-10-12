/** 文章结构化结论（新 /api/articles 契约）。 */
export interface ArticleStructured {
  keyFindings: string;
}

/** 文章列表条目（GET /api/articles）；sourceDate 形如 '2026-05-09'，直接展示。 */
export interface ArticleListItem {
  docId: string;
  title: string;
  summary: string;
  sourceDate: string;
  sourceAuthor: string;
  sourcePublisher: string;
  /** 内容类型原文（Base「内容类型」列的值：深度报告 / 快讯转载 / 竞品周报 / 互动内容 / 工具）。 */
  contentType: string;
  /** 玩法分类父项名；空串 = 未分类。 */
  gameplayParent?: string;
  /** 玩法分类子项名；空串 = 该篇未细分。 */
  gameplayChild?: string;
  /** 单值展示口径：有子项取子项，否则取父项。 */
  gameplayCategory: string;
  sourceUrl: string;
  structured: ArticleStructured | null;
  /** 站内封面代理地址；null 时卡片回退品类占位封面。 */
  coverUrl: string | null;
  /** 「附件」站内预览地址（/media 代理）；未上传附件为 null（工具箱互动内容用）。 */
  attachmentPreviewUrl?: string | null;
  /** 附件原文件名；未上传为 null。 */
  attachmentFileName?: string | null;
}

/** 文章详情（GET /api/articles/:docId）。 */
export interface ArticleDetailData extends ArticleListItem {
  bodyMarkdown?: string | null;
  documentStatus: string;
  attachmentPreviewUrl?: string | null;
  attachmentFileName?: string | null;
  errorCode?: string;
}
