import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  FeishuCredentialService,
  isAccessTokenFailure,
  type AccessTokenResult,
} from '../../common/feishu/feishu-credential.service';
import { blocksToMarkdown } from './block-to-markdown';

export type DocumentReadStatus =
  'ready' | 'not_configured' | 'unavailable' | 'invalid_response';

export interface DocumentReadResult {
  status: DocumentReadStatus;
  body: string | null;
  errorCode?: string;
}

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,255}$/u;

export function isSafeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value);
}

export function normalizeDocumentBody(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

export function extractDocumentReference(
  value: string | null | undefined,
): { type: 'wiki' | 'docx'; token: string } | null {
  if (!value) return null;
  const match = value.match(
    /https:\/\/[^/\s)]+\/(wiki|docx)\/([A-Za-z0-9_-]{8,255})(?=[/?#)\s]|$)/u,
  );
  if (!match) return null;
  return { type: match[1] as 'wiki' | 'docx', token: match[2] };
}

const BLOCKS_PAGE_SIZE = 500;
const BLOCKS_MAX_PAGES = 50;

/** Server-only reader. It never accepts a document id from the public request. */
@Injectable()
export class FeishuDocumentReader {
  private readonly logger = new Logger(FeishuDocumentReader.name);

  private static readonly DOC_CACHE_TTL_MS = 10 * 60_000;
  private static readonly DOC_CACHE_MAX = 50;
  private readonly docCache = new Map<
    string,
    { at: number; result: DocumentReadResult }
  >();
  private readonly docInflight = new Map<
    string,
    Promise<DocumentReadResult>
  >();
  private readonly credentials: FeishuCredentialService;

  // The shared credential provider is optional at construction so the reader
  // also works in modules/tests that do not wire it; a local instance is used
  // as a fallback when injection is unavailable.
  constructor(@Optional() credentials?: FeishuCredentialService) {
    this.credentials = credentials ?? new FeishuCredentialService();
  }

  getAuthDiagnostics(): {
    status: 'configured' | 'not_configured';
    mode: 'tenant_access_token' | 'app_credentials' | 'missing';
  } {
    return this.credentials.getAuthDiagnostics();
  }

  /** Shared server-side credential boundary for read-only Base consumers. */
  async getTenantAccessToken(): Promise<AccessTokenResult> {
    return this.credentials.getAccessToken();
  }

  async read(documentId: string): Promise<DocumentReadResult> {
    if (!isSafeDocumentId(documentId)) {
      return {
        status: 'unavailable',
        body: null,
        errorCode: 'INVALID_DOCUMENT_ID',
      };
    }
    return this.readCached(documentId, () => this.readUncached(documentId));
  }

  /**
   * 按文档 TTL 缓存 + 并发去重：详情页每次冷读约 0.3-1s（blocks 失败回退
   * raw_content 时更久），弹窗预取与全文面板/详情页可共享一次飞行。
   * 仅缓存成功结果，失败不落缓存避免错误长驻。
   */
  private async readCached(
    documentId: string,
    loader: () => Promise<DocumentReadResult>,
  ): Promise<DocumentReadResult> {
    const cached = this.docCache.get(documentId);
    if (cached && Date.now() - cached.at < FeishuDocumentReader.DOC_CACHE_TTL_MS) {
      return cached.result;
    }
    const inflight = this.docInflight.get(documentId);
    if (inflight) return inflight;
    const flight = loader()
      .then((result) => {
        if (result.status === 'ready') {
          if (this.docCache.size >= FeishuDocumentReader.DOC_CACHE_MAX) {
            const oldest = [...this.docCache.entries()].sort(
              ([, a], [, b]) => a.at - b.at,
            )[0];
            if (oldest) this.docCache.delete(oldest[0]);
          }
          this.docCache.set(documentId, { at: Date.now(), result });
        }
        return result;
      })
      .finally(() => {
        this.docInflight.delete(documentId);
      });
    this.docInflight.set(documentId, flight);
    return flight;
  }

  private async readUncached(documentId: string): Promise<DocumentReadResult> {
    const accessToken = await this.credentials.getAccessToken();
    if (isAccessTokenFailure(accessToken)) return this.authFailure(accessToken);
    const token = accessToken.token;

    try {
      const blocks = await this.fetchBlocks(token, documentId);
      const body = blocksToMarkdown(blocks, documentId);
      if (body.length > 0) return { status: 'ready', body };
      this.logger.warn(
        'Feishu blocks read returned no renderable content; falling back to raw_content',
      );
    } catch (error) {
      this.logger.warn(
        `Feishu blocks read failed (${
          error instanceof Error ? error.message : 'unknown error'
        }); falling back to raw_content`,
      );
    }
    return this.readRawContent(token, documentId);
  }

  /**
   * 文章正文的统一入口。Base 的「文档链接」是录入时的人工权威来源，
   * 且 wiki 链接的 token 必须先用 get_node 换成 obj_token —— 它不能当
   * docx document_id 用（会 404）。因此链接可解析时一律以链接为准，
   * 链接读不出来再退回「文档ID」列兜底；两者都不可用时优先回传链接路径
   * 的错误码（它的诊断信息更贴近用户看到的那条链接）。
   */
  async readArticle(
    appDocId: string | null | undefined,
    docLink: string | null | undefined,
  ): Promise<DocumentReadResult> {
    const fromLink = extractDocumentReference(docLink)
      ? await this.readFromLink(docLink)
      : null;
    if (fromLink?.status === 'ready') return fromLink;

    if (!isSafeDocumentId(appDocId)) {
      return (
        fromLink ?? {
          status: 'unavailable',
          body: null,
          errorCode: 'INVALID_DOCUMENT_LINK',
        }
      );
    }
    const byId = await this.read(appDocId);
    if (byId.status === 'ready') return byId;
    return fromLink ?? byId;
  }

  async readFromLink(
    docLink: string | null | undefined,
  ): Promise<DocumentReadResult> {
    const reference = extractDocumentReference(docLink);
    if (!reference) {
      return {
        status: 'unavailable',
        body: null,
        errorCode: 'INVALID_DOCUMENT_LINK',
      };
    }
    if (reference.type === 'docx') return this.read(reference.token);

    // Wiki 节点解析同样按节点 token 走缓存与并发去重（`wiki:` 前缀
    // 与 read() 的 document_id key 不会撞车）。
    return this.readCached(`wiki:${reference.token}`, () =>
      this.readWikiNode(reference.token),
    );
  }

  private async readWikiNode(nodeToken: string): Promise<DocumentReadResult> {
    const accessToken = await this.credentials.getAccessToken();
    if (isAccessTokenFailure(accessToken)) return this.authFailure(accessToken);
    const token = accessToken.token;

    const baseUrl = FeishuCredentialService.feishuBaseUrl();
    let response: Response;
    try {
      const url = new URL(`${baseUrl}/open-apis/wiki/v2/spaces/get_node`);
      url.searchParams.set('token', nodeToken);
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return {
        status: 'unavailable',
        body: null,
        errorCode: 'FEISHU_NETWORK_ERROR',
      };
    }

    if (!response.ok) {
      this.logger.warn(
        `Feishu Wiki node lookup failed with HTTP ${response.status}`,
      );
      return {
        status: 'unavailable',
        body: null,
        errorCode: `FEISHU_WIKI_HTTP_${response.status}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        status: 'invalid_response',
        body: null,
        errorCode: 'FEISHU_WIKI_JSON_INVALID',
      };
    }

    const node = this.extractWikiNode(payload);
    if (!node || node.objType !== 'docx' || !isSafeDocumentId(node.objToken)) {
      return {
        status: 'invalid_response',
        body: null,
        errorCode: 'FEISHU_WIKI_DOCUMENT_MISSING',
      };
    }
    return this.read(node.objToken);
  }

  /**
   * Reads a document through the docx blocks API and converts it to Markdown.
   * Aggregates every page of blocks; throws on network/HTTP/response errors so
   * callers can decide on a fallback path.
   */
  private async fetchBlocks(
    token: string,
    documentId: string,
  ): Promise<unknown[]> {
    const baseUrl = FeishuCredentialService.feishuBaseUrl();
    const items: unknown[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < BLOCKS_MAX_PAGES; page += 1) {
      const url = new URL(
        `${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
      );
      url.searchParams.set('page_size', String(BLOCKS_PAGE_SIZE));
      if (pageToken) url.searchParams.set('page_token', pageToken);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error('FEISHU_NETWORK_ERROR');
      }
      if (!response.ok) {
        throw new Error(`FEISHU_HTTP_${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('FEISHU_JSON_INVALID');
      }

      const data = this.extractBlocksData(payload);
      if (!data || !Array.isArray(data.items)) {
        throw new Error('FEISHU_BLOCKS_INVALID_RESPONSE');
      }
      items.push(...data.items);
      if (data.has_more !== true || typeof data.page_token !== 'string') break;
      pageToken = data.page_token;
    }

    return items;
  }

  private extractBlocksData(
    payload: unknown,
  ): { items?: unknown[]; has_more?: unknown; page_token?: unknown } | null {
    if (!payload || typeof payload !== 'object' || !('data' in payload))
      return null;
    const data = (payload as { data?: unknown }).data;
    return data && typeof data === 'object'
      ? (data as {
          items?: unknown[];
          has_more?: unknown;
          page_token?: unknown;
        })
      : null;
  }

  private async readRawContent(
    token: string,
    documentId: string,
  ): Promise<DocumentReadResult> {
    const baseUrl = FeishuCredentialService.feishuBaseUrl();
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return {
        status: 'unavailable',
        body: null,
        errorCode: 'FEISHU_NETWORK_ERROR',
      };
    }

    if (!response.ok) {
      this.logger.warn(
        `Feishu document read failed with HTTP ${response.status}`,
      );
      return {
        status: 'unavailable',
        body: null,
        errorCode: `FEISHU_HTTP_${response.status}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        status: 'invalid_response',
        body: null,
        errorCode: 'FEISHU_JSON_INVALID',
      };
    }
    const body = this.extractContent(payload);
    if (body === null) {
      return {
        status: 'invalid_response',
        body: null,
        errorCode: 'FEISHU_CONTENT_MISSING',
      };
    }

    return { status: 'ready', body: normalizeDocumentBody(body) };
  }

  private extractContent(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || !('data' in payload))
      return null;
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || !('content' in data)) return null;
    const content = (data as { content?: unknown }).content;
    return typeof content === 'string' ? content : null;
  }

  private extractWikiNode(
    payload: unknown,
  ): { objToken: string; objType: string } | null {
    if (!payload || typeof payload !== 'object' || !('data' in payload))
      return null;
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || !('node' in data)) return null;
    const node = (data as { node?: unknown }).node;
    if (!node || typeof node !== 'object') return null;
    const objToken = (node as { obj_token?: unknown }).obj_token;
    const objType = (node as { obj_type?: unknown }).obj_type;
    if (typeof objToken !== 'string' || typeof objType !== 'string')
      return null;
    return { objToken, objType };
  }

  private authFailure(
    result: Extract<AccessTokenResult, { token: null }>,
  ): DocumentReadResult {
    return {
      status:
        result.errorCode === 'FEISHU_AUTH_NOT_CONFIGURED'
          ? 'not_configured'
          : 'unavailable',
      body: null,
      errorCode: result.errorCode,
    };
  }
}
