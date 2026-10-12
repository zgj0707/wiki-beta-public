import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeGameplayName } from '@shared/gameplay-category';
import {
  FeishuCredentialService,
  isAccessTokenFailure,
} from '../../common/feishu/feishu-credential.service';
import {
  FeishuBaseReader,
  type WikiBetaArticleRow,
} from '../wiki-beta/feishu-base-reader.service';
import { wikiBetaFieldIds } from '../wiki-beta/wiki-beta-env';
import { FeishuDocumentReader } from '../wiki-beta/document-reader.service';
import {
  extractOriginalUrl,
  APPROVAL_STATUS_PUBLISHED,
} from '../wiki-beta/publication-policy';

const FILE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,255}$/u;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
type AnyRecord = Record<string, unknown>;

const ARTICLE_ATTACHMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  doc: 'application/msword',
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroenabled.12',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  rtf: 'application/rtf',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export interface ArticleListParams {
  search?: string;
  /** 玩法分类名（父项名或子项名）；传父项名会命中其全部子项。 */
  gameplayCategory?: string;
  /** 内容类型原文（研究报告 / 外链文章 / 竞品周报…）。 */
  contentType?: string;
  /** 来源发布方（Base「发布方」列原文）。 */
  sourcePublisher?: string;
  /** 时间窗天数，按「飞书来源日期」过滤；该字段为空的记录被排除。 */
  days?: number;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export interface ArticleStructuredSummary {
  keyFindings: string;
}
export interface ArticleListItem {
  docId: string;
  title: string;
  summary: string;
  sourceDate: string;
  sourceAuthor: string;
  sourcePublisher: string;
  contentType: string;
  /** 玩法分类父项名；空串 = 未分类。 */
  gameplayParent: string;
  /** 玩法分类子项名；空串 = 该篇未细分。 */
  gameplayChild: string;
  /** 兼容既有卡片/弹窗的单值展示口径：有子项取子项，否则取父项。 */
  gameplayCategory: string;
  sourceUrl: string;
  structured: ArticleStructuredSummary | null;
  /** 站内封面代理地址；Base 未上传封面图时为 null，前端回退品类占位封面。 */
  coverUrl: string | null;
  /** 「附件」站内预览地址（/media 代理）；未上传附件为 null（nav-tasks-p3c）。 */
  attachmentPreviewUrl: string | null;
  /** 附件原文件名；未上传为 null。 */
  attachmentFileName: string | null;
}
export interface ArticleDetail extends ArticleListItem {
  bodyMarkdown: string | null;
  documentStatus: string;
  attachmentPreviewUrl: string | null;
  attachmentFileName: string | null;
  errorCode?: string;
}

const SAFE_ARTICLE_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/rtf',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/tiff',
  'image/webp',
]);
export interface ArticleFacetsParams {
  search?: string;
  gameplayCategory?: string;
  contentType?: string;
  sourcePublisher?: string;
}
export interface ArticleFacetOption {
  value: string;
  label: string;
  count: number;
}
export interface GameplayFacetNode extends ArticleFacetOption {
  /** 仅命中父项自身的条数（不含子项）。 */
  selfCount: number;
  children: ArticleFacetOption[];
}
export interface ArticleFacets {
  /** @deprecated 旧前端字段（P2 筛选栏改造后移除）。 */
  types: Array<{ kind: string; count: number }>;
  /** @deprecated 旧前端字段（P2 筛选栏改造后移除）。 */
  categories: Array<{ type: string; count: number }>;
  contentTypes: ArticleFacetOption[];
  gameplay: GameplayFacetNode[];
  /** 来源发布方计数（首页「最新发布」胶囊筛选的数据源）。 */
  publishers: ArticleFacetOption[];
  tags: never[];
}

@Injectable()
export class ArticlesService {
  constructor(
    private readonly baseReader: FeishuBaseReader,
    private readonly documentReader: FeishuDocumentReader,
    private readonly credentials: FeishuCredentialService,
  ) {}
  async list(params: ArticleListParams) {
    const rows = this.filterRows(await this.publicRows(), params);
    const offset = Math.max(Math.floor(params.offset ?? 0), 0);
    const limit = clampLimit(params.limit);
    const page = rows.slice(offset, offset + limit);
    return {
      items: page.map((row) => this.toListItem(row)),
      total: rows.length,
      nextCursor: offset + page.length < rows.length ? offset + limit : null,
    };
  }
  /**
   * 筛选计数。每个维度的计数都在「已应用其他维度筛选」的集合上统计，
   * 这样选中某项后，其余项的计数仍反映真实可选数量。
   */
  async facets(params: ArticleFacetsParams = {}): Promise<ArticleFacets> {
    const scoped = (await this.publicRows()).filter((row) =>
      this.matches(row, { search: params.search }),
    );
    const withinGameplay = scoped.filter((row) =>
      this.matches(row, { gameplayCategory: params.gameplayCategory }),
    );
    const withinContentType = scoped.filter((row) =>
      this.matches(row, { contentType: params.contentType }),
    );
    // 发布方计数排除自身维度：同时应用玩法分类与内容类型筛选后统计。
    const withinOtherDims = scoped.filter(
      (row) =>
        this.matches(row, { gameplayCategory: params.gameplayCategory }) &&
        this.matches(row, { contentType: params.contentType }),
    );
    const contentTypes = [...countBy(withinGameplay, (row) => row.contentType)]
      .filter(([value]) => Boolean(value))
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => ({ value, label: value, count }));
    const publishers = [
      ...countBy(withinOtherDims, (row) => row.sourcePublisher),
    ]
      .filter(([value]) => Boolean(value))
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => ({ value, label: value, count }));
    const gameplay = buildGameplayTree(withinContentType);
    return {
      // 旧字段：保持 P1 发布后旧筛选栏仍有计数可显示。
      types: contentTypes.map(({ value, count }) => ({ kind: value, count })),
      categories: gameplay.flatMap((node) => [
        { type: node.value, count: node.count },
        ...node.children.map((child) => ({
          type: child.value,
          count: child.count,
        })),
      ]),
      contentTypes,
      gameplay,
      publishers,
      tags: [],
    };
  }
  async detail(docId: string): Promise<ArticleDetail> {
    const row = (await this.publicRows()).find(
      (candidate) => candidate.baseRecordId === docId,
    );
    if (!row) throw new NotFoundException('Content is not publicly available');
    const document = row.articleAttachment
      ? { body: null, status: 'ready', errorCode: undefined }
      : await this.documentReader.readArticle(row.appDocId, row.docLink);
    return {
      ...this.toListItem(row),
      bodyMarkdown: document.body,
      documentStatus: document.status,
      attachmentPreviewUrl: row.articleAttachment
        ? `/media/articles/${encodeURIComponent(row.baseRecordId)}/attachment`
        : null,
      attachmentFileName: row.articleAttachment?.fileName ?? null,
      ...(document.errorCode ? { errorCode: document.errorCode } : {}),
    };
  }
  async getImageRedirect(docId: string, fileToken: string): Promise<string> {
    const row = (await this.publicRows()).find(
      (candidate) => candidate.baseRecordId === docId,
    );
    if (!row || !FILE_TOKEN_PATTERN.test(fileToken))
      throw new NotFoundException('Image is not available');
    const accessToken = await this.credentials.getAccessToken();
    if (isAccessTokenFailure(accessToken))
      throw new NotFoundException('Image is not available');
    const baseUrl = FeishuCredentialService.feishuBaseUrl();
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${encodeURIComponent(fileToken)}`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken.token}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new NotFoundException('Image is not available');
    }
    if (!response.ok) throw new NotFoundException('Image is not available');
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NotFoundException('Image is not available');
    }
    const url = this.extractTmpDownloadUrl(payload, fileToken);
    if (!url) throw new NotFoundException('Image is not available');
    return url;
  }
  /**
   * 封面图：服务端流式取回后透传，前端 URL 恒定可长缓存。
   * 只读取本记录「封面图」字段里的 token，不接受客户端传入 file_token，
   * 因此不存在拿任意 token 代理任意文件的问题。
   */
  async getCoverImage(
    docId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const row = (await this.publicRows()).find(
      (candidate) => candidate.baseRecordId === docId,
    );
    if (
      !row ||
      !row.coverFileToken ||
      !FILE_TOKEN_PATTERN.test(row.coverFileToken)
    )
      throw new NotFoundException('Cover is not available');
    const cover = await this.baseReader.downloadAttachment(
      row.baseRecordId,
      row.coverFileToken,
    );
    if (!cover) throw new NotFoundException('Cover is not available');
    return cover;
  }
  async getArticleAttachment(
    docId: string,
  ): Promise<{ data: Buffer; fileName: string; contentType: string }> {
    const row = (await this.publicRows()).find(
      (candidate) => candidate.baseRecordId === docId,
    );
    if (
      !row ||
      !row.articleAttachment ||
      !FILE_TOKEN_PATTERN.test(row.articleAttachment.fileToken)
    )
      throw new NotFoundException('Attachment is not available');
    const attachment = await this.baseReader.downloadAttachment(
      row.baseRecordId,
      row.articleAttachment.fileToken,
      wikiBetaFieldIds.articleAttachment(),
      undefined,
      'application/octet-stream',
    );
    if (!attachment)
      throw new NotFoundException('Attachment is not available');
    const contentType = resolveArticleAttachmentContentType(
      row.articleAttachment.fileName,
      attachment.contentType,
    );
    if (
      contentType === 'application/pdf' &&
      !hasPdfSignature(attachment.data)
    )
      throw new NotFoundException('Attachment is not available');
    return {
      data: attachment.data,
      fileName: safeArticleAttachmentName(
        row.articleAttachment.fileName,
        row.title,
        contentType,
      ),
      contentType,
    };
  }
  private async publicRows() {
    return (await this.baseReader.listArticleRows()).filter(
      (row) => row.approvalStatus === APPROVAL_STATUS_PUBLISHED,
    );
  }
  private filterRows(
    rows: WikiBetaArticleRow[],
    params: ArticleListParams | ArticleFacetsParams,
  ) {
    const order = 'order' in params && params.order === 'asc' ? 'asc' : 'desc';
    return rows
      .filter((row) => this.matches(row, params))
      .sort(compareRows(order));
  }
  /** 单条记录是否命中筛选；列表与 facets 共用同一口径，避免计数与结果不一致。 */
  private matches(
    row: WikiBetaArticleRow,
    params: ArticleListParams | ArticleFacetsParams,
  ): boolean {
    const search = params.search?.trim().toLocaleLowerCase('zh-CN');
    if (
      search &&
      ![row.title, row.abstract, row.keyFindings]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase('zh-CN')
        .includes(search)
    )
      return false;
    // 分类名即筛选值：传父项名命中自身 + 全部子项，传子项名只命中该子项。
    const gameplayName = normalizeGameplayName(params.gameplayCategory);
    if (
      gameplayName &&
      row.gameplayParent !== gameplayName &&
      row.gameplayChild !== gameplayName
    )
      return false;
    const contentType = params.contentType?.trim() ?? '';
    if (contentType && row.contentType !== contentType) return false;
    const sourcePublisher = params.sourcePublisher?.trim() ?? '';
    if (sourcePublisher && row.sourcePublisher !== sourcePublisher)
      return false;
    const days = 'days' in params ? params.days : undefined;
    if (days && days > 0) {
      const at = parseSourceDate(row.sourceDateFeishu);
      // 无「飞书来源日期」的记录无法判定是否落在窗口内，选择时间窗后排除。
      if (at === null || at < Date.now() - days * DAY_MS) return false;
    }
    return true;
  }
  private toListItem(row: WikiBetaArticleRow): ArticleListItem {
    const keyFindings = row.keyFindings?.trim() ?? '';
    return {
      docId: row.baseRecordId,
      title: row.title,
      summary: row.abstract ?? row.keyFindings ?? '',
      sourceDate: row.sourceDateFeishu,
      sourceAuthor: row.sourceAuthor,
      sourcePublisher: row.sourcePublisher,
      contentType: row.contentType,
      gameplayParent: row.gameplayParent,
      gameplayChild: row.gameplayChild,
      gameplayCategory: row.gameplayChild || row.gameplayParent,
      sourceUrl: row.articleAttachment
        ? ''
        : (extractOriginalUrl(row.docLink) ?? ''),
      structured: keyFindings ? { keyFindings } : null,
      // 附件打开地址：与详情页同一 /media 代理（预览弹窗「原件」入口用）；
      // 前端经 fetch→Blob 新窗渲染（/media 直链在平台不可达，见 shared/quick-tools.ts）。
      attachmentPreviewUrl: row.articleAttachment
        ? `/media/articles/${encodeURIComponent(row.baseRecordId)}/attachment`
        : null,
      attachmentFileName: row.articleAttachment?.fileName ?? null,
      // 走 /media 而不是 /api：平台 CSRF 只作用于 /api/*，而 <img> 无法带
      // x-suda-csrf-token 头，挂在 /api 下会被 403 打回占位图。
      coverUrl: row.coverFileToken
        ? `/media/articles/${encodeURIComponent(row.baseRecordId)}/cover?v=${encodeURIComponent(row.coverFileToken.slice(0, 8))}`
        : null,
    };
  }
  private extractTmpDownloadUrl(
    payload: unknown,
    fileToken: string,
  ): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return null;
    let candidate: unknown =
      (data as AnyRecord).tmp_download_url ??
      (data as AnyRecord).tmp_download_urls;
    if (candidate && typeof candidate === 'object')
      candidate = Array.isArray(candidate)
        ? candidate[0]
        : ((candidate as AnyRecord)[fileToken] ??
          Object.values(candidate as AnyRecord)[0]);
    return typeof candidate === 'string' && candidate ? candidate : null;
  }
}
function clampLimit(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(value), 1), MAX_PAGE_SIZE);
}

function resolveArticleAttachmentContentType(
  fileName: string | null,
  declaredContentType: string,
): string {
  const extension = fileName?.split('.').pop()?.toLowerCase() ?? '';
  const extensionType = Object.prototype.hasOwnProperty.call(
    ARTICLE_ATTACHMENT_MIME_BY_EXTENSION,
    extension,
  )
    ? ARTICLE_ATTACHMENT_MIME_BY_EXTENSION[extension]
    : undefined;
  if (extensionType) return extensionType;
  const declaredType = declaredContentType
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (!declaredType) return 'application/octet-stream';
  if (
    SAFE_ARTICLE_ATTACHMENT_MIME_TYPES.has(declaredType) ||
    declaredType.startsWith('audio/') ||
    declaredType.startsWith('video/') ||
    declaredType.startsWith('application/vnd.openxmlformats-officedocument.') ||
    declaredType.startsWith('application/vnd.oasis.opendocument.') ||
    declaredType.startsWith('application/vnd.ms-')
  )
    return declaredType.startsWith('text/')
      ? `${declaredType}; charset=utf-8`
      : declaredType;
  return 'application/octet-stream';
}

function hasPdfSignature(data: Buffer): boolean {
  const signatureOffset = data.indexOf(Buffer.from('%PDF-'));
  return signatureOffset >= 0 && signatureOffset <= 1024;
}

function safeArticleAttachmentName(
  fileName: string | null,
  title: string,
  contentType: string,
): string {
  const sanitizedFileName = fileName
    ?.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, '_')
    .trim()
    .slice(0, 180);
  if (sanitizedFileName) return sanitizedFileName;
  const safeTitle =
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, '_')
      .trim()
      .slice(0, 120) || 'article';
  const extension = Object.entries(ARTICLE_ATTACHMENT_MIME_BY_EXTENSION).find(
    ([, type]) => type.split(';')[0] === contentType.split(';')[0],
  )?.[0];
  return `${safeTitle}.${extension ?? 'bin'}`;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}
function compareRows(order: 'asc' | 'desc') {
  const direction = order === 'asc' ? 1 : -1;
  return (left: WikiBetaArticleRow, right: WikiBetaArticleRow) => {
    const leftDate = left.sourceDateFeishu.trim();
    const rightDate = right.sourceDateFeishu.trim();
    if (leftDate || rightDate) {
      // 无日期的记录恒定排在最后，不随排序方向翻转。
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      const dateOrder = leftDate.localeCompare(rightDate) * direction;
      if (dateOrder !== 0) return dateOrder;
    }
    return (
      ((left.updateTime?.getTime() ?? 0) -
        (right.updateTime?.getTime() ?? 0)) *
      direction
    );
  };
}

/** 解析「飞书来源日期」的日期部分为 UTC 毫秒；只取到日，忽略时分秒。 */
function parseSourceDate(value: string): number | null {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/u.exec(value.trim());
  if (!matched) return null;
  const at = Date.UTC(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
  );
  return Number.isNaN(at) ? null : at;
}

/**
 * 玩法分类树由「父项 / 子项」两列的实际组合派生 —— Base 里新增一个分类选项并
 * 给文章打标，此处自动出现，无需改代码。父项 count 含其全部子项，与筛选口径一致。
 * 排序按条数降序（与内容类型 facets 一致），并列时按名称；计数 0 的分类不列出。
 */
function buildGameplayTree(rows: WikiBetaArticleRow[]): GameplayFacetNode[] {
  const parents = new Map<
    string,
    { self: number; children: Map<string, number> }
  >();
  for (const row of rows) {
    if (!row.gameplayParent) continue;
    let entry = parents.get(row.gameplayParent);
    if (!entry) {
      entry = { self: 0, children: new Map() };
      parents.set(row.gameplayParent, entry);
    }
    if (row.gameplayChild) {
      entry.children.set(
        row.gameplayChild,
        (entry.children.get(row.gameplayChild) ?? 0) + 1,
      );
    } else {
      entry.self += 1;
    }
  }
  return [...parents.entries()]
    .map(([value, entry]) => {
      const children: ArticleFacetOption[] = [...entry.children.entries()]
        .map(([childValue, count]) => ({
          value: childValue,
          label: childValue,
          count,
        }))
        .sort(compareFacetOptions);
      return {
        value,
        label: value,
        selfCount: entry.self,
        count: entry.self + children.reduce((sum, item) => sum + item.count, 0),
        children,
      };
    })
    .sort(compareFacetOptions);
}

function compareFacetOptions(
  left: ArticleFacetOption,
  right: ArticleFacetOption,
) {
  if (left.count !== right.count) return right.count - left.count;
  return left.value.localeCompare(right.value, 'zh-Hans-CN');
}
