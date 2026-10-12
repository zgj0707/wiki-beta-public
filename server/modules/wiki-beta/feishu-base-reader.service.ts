import { Injectable, Logger } from '@nestjs/common';
import {
  GAMEPLAY_CHILD_FIELD,
  GAMEPLAY_LEGACY_PARENT_FIELD,
  GAMEPLAY_PARENT_FIELD,
  normalizeGameplayName,
} from '@shared/gameplay-category';
import { RANKING_FIELD_NAMES } from '@shared/rankings';
import { QUICK_TOOLS_FIELD_NAMES } from '@shared/quick-tools';
import { FeishuDocumentReader } from './document-reader.service';
import {
  resolveWikiBetaBaseToken,
  wikiBetaFieldIds,
  wikiBetaTableIds,
} from './wiki-beta-env';

/** 封面/附件单张上限，防止超大附件被读进内存。 */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * 附件下载并发上限。
 * 机制观察列表一屏要同时取 30+ 张图标，全量并发会打到下游限流，
 * 出现「同一秒内 200 与 404 交错」的零散裂图（2026-09-20 线上实测 34 并发中 8 个失败）。
 */
const ATTACHMENT_FETCH_CONCURRENCY = 8;

/** 附件下载的重试轮数（含首轮）与每轮退避毫秒；瞬时失败留出恢复窗口。 */
const ATTACHMENT_FETCH_ATTEMPTS = 3;
const ATTACHMENT_RETRY_BACKOFF_MS = [0, 250, 600];
/** 重试总时长上限（毫秒）；超出即放弃，避免图片请求被重试拖成悬挂。 */
const ATTACHMENT_RETRY_WINDOW_MS = 6_000;

/** 极简信号量：限制同时进行的附件下载数，避免下游限流。 */
class FetchGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const attachmentFetchGate = new FetchGate(ATTACHMENT_FETCH_CONCURRENCY);

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();


export interface FeishuBaseRecord {
  record_id: string;
  fields: Record<string, unknown>;
  last_modified_time?: number;
}

export interface WikiBetaArticleRow {
  baseRecordId: string;
  title: string;
  appDocId: string | null;
  docLink: string | null;
  approvalStatus: string | null;
  abstract: string | null;
  keyFindings: string | null;
  /** Base「内容类型」原文（研究报告 / 外链文章 / 竞品周报…），原文即筛选值。 */
  contentType: string;
  sourceAuthor: string;
  sourcePublisher: string;
  /** 玩法分类父项（顶层分类名）；空串 = 未分类。 */
  gameplayParent: string;
  /** 玩法分类子项（二级分类名）；空串 = 该篇未细分。 */
  gameplayChild: string;
  sourceDateFeishu: string;
  /** 「封面图」附件字段第一张图的 file_token；未上传为 null。 */
  coverFileToken: string | null;
  /** 「附件」字段第一份文章附件；未上传为 null。 */
  articleAttachment: WikiBetaArticleAttachment | null;
  updateTime: Date | null;
}

export interface WikiBetaArticleAttachment {
  fileToken: string;
  fileName: string | null;
}

export interface WikiBetaEntityRow {
  baseRecordId: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  type: string;
  description: string;
  status: string;
  updateTime: Date | null;
}

export interface WikiBetaRelationRow {
  baseRecordId: string;
  subjectEntityRecordIds: string[];
  objectEntityRecordIds: string[];
  relationType: string;
  status: string;
  sourceMode: string;
  evidenceArticleRecordIds: string[];
  evidenceText: string;
  evidenceAnchor: string;
  reviewNote: string;
  updateTime: Date | null;
}

export interface WikiBetaRankingRow {
  baseRecordId: string;
  /** 「榜单板块」原文（AppStore / 微信 / Steam）。 */
  board: string;
  /** 「榜单周期」slug，如 appstore-w08260902 / weixin-index / steam-w7。 */
  slug: string;
  /** 「周期标签」展示名，如「周榜 0826-0902」「2026年第37周」。 */
  label: string;
  /** 「榜单 HTML」附件第一个文件的 file_token；未上传为 null（走 sheet 驱动或空榜）。 */
  htmlFileToken: string | null;
  /** 「数据源」原文：sheet 名或显式覆盖格式（wiki:/sheet: token#sheet名）。 */
  dataSource: string;
}

export interface WikiBetaQuickToolRow {
  baseRecordId: string;
  /** 工具名称；同时是附件代理 URL 的路径段。 */
  name: string;
  description: string | null;
  /** Base「分类」原文（四值：链接 / 文档 / 互动内容 / 机制周报，2026-10-10 收敛）。 */
  category: string;
  /** 外链 URL；纯附件行为 null（走附件代理）。 */
  url: string | null;
  /** 「附件」列第一份文件的 file_token；外链行为 null。 */
  attachmentToken: string | null;
  /** 「图标」附件第一份文件的 file_token；未上传为 null。 */
  iconFileToken: string | null;
  /** skills 工具正文 README（markdown 原文，含真实换行）；非 skills 或未填为 null。 */
  readme: string | null;
  /** 手动填写的日期（ISO 字符串）；未填为 null。 */
  date: string | null;
}

export interface WikiBetaMechanismRow {
  baseRecordId: string;
  /** Base「稳定键」原文；与 PG `mechanism_observation.stable_key` 同源同值。 */
  stableKey: string;
  /** 「机制流程图」附件字段第一张图的 file_token；未上传为 null。 */
  figureFileToken: string | null;
  /** 「中文名」列原文（官方中文名或带「（试译）」后缀的试译值）；未填为 null。 */
  nameCn: string | null;
  /** 「游戏图标」附件字段第一张图的 file_token；未上传为 null。 */
  iconFileToken: string | null;
}

/**
 * 「AI 配置」表的单行启用配置（OpenAI 兼容三件套）。
 * 🔴 `apiKey` 仅在服务端内存流转：不进任何 API 响应、不打日志、不落库。
 */
export interface WikiBetaAiConfigRow {
  baseRecordId: string;
  configName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  note: string | null;
}

export class FeishuBaseReadError extends Error {  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'FeishuBaseReadError';
  }
}

interface BaseConfig {
  baseToken: string;
  articleTableId: string;
  rankingTableId: string;
  mechanismTableId: string;
  quickToolsTableId: string;
  aiConfigTableId: string;
}

@Injectable()
export class FeishuBaseReader {
  private readonly logger = new Logger(FeishuBaseReader.name);

  /** 单表记录 TTL：Base 全量拉取约 2-3s，短缓存供列表/详情/实体页共用一次飞行。 */
  private static readonly TABLE_CACHE_TTL_MS = 60_000;
  private readonly tableCache = new Map<
    string,
    { at: number; records: FeishuBaseRecord[] }
  >();
  private readonly tableInflight = new Map<
    string,
    Promise<FeishuBaseRecord[]>
  >();

  /**
   * 字段描述（schema 元数据）缓存 —— 与记录缓存**分开存**：
   * 同一个 tableId 下两者是不同数据，共用一个 Map 会互相覆盖。
   */
  private static readonly FIELD_DESCRIPTION_TTL_MS = 60_000;
  private readonly fieldDescriptionCache = new Map<
    string,
    { at: number; descriptions: Record<string, string> }
  >();
  private readonly fieldDescriptionInflight = new Map<
    string,
    Promise<Record<string, string>>
  >();

  constructor(private readonly documentReader: FeishuDocumentReader) {}

  async listArticleRows() {
    const config = this.getConfig();
    return (await this.listRecordsCached(config, config.articleTableId)).map(
      toArticleRow,
    );
  }

  /**
   * 榜单内容行（独立表「榜单」的记录）。
   * 一行 = 一个板块的一期内容；HTML 存「榜单HTML」附件字段。
   * 独立表缓存 60s TTL，与文章表互不干扰。
   */
  async listRankingRows(): Promise<WikiBetaRankingRow[]> {
    const config = this.getConfig();
    return (await this.listRecordsCached(config, config.rankingTableId)).map(
      toRankingRow,
    );
  }

  /**
   * 便捷工具行（独立表「便捷工具表」的记录）。
   * 一行 = 一个工具（链接 / 文档 / 互动内容 / 机制周报）；HTML 附件存「附件」列
   * 「游戏文件」附件字段，「图标」附件供列表展示。
   * 独立表缓存 60s TTL，与文章表、榜单表、机制观察表互不干扰。
   * 未启用（enabled 非 true）的行由 toQuickToolRow 过滤掉。
   */
  async listQuickToolRows(): Promise<WikiBetaQuickToolRow[]> {
    const config = this.getConfig();
    return (await this.listRecordsCached(config, config.quickToolsTableId))
      .map(toQuickToolRow)
      .filter((row): row is WikiBetaQuickToolRow => row !== null);
  }

  /**
   * 「AI 配置」表的启用行（站点默认 LLM 配置）。
   * 门禁：`enabled = ☑`（与便捷工具表同语义）；取第一条启用行，无启用行返回 null。
   * ⚠️ 调用方（AiConfigService）对返回值负全责：apiKey 绝不出服务端。
   */
  async listAiConfigRows(): Promise<WikiBetaAiConfigRow[]> {
    const config = this.getConfig();
    return (await this.listRecordsCached(config, config.aiConfigTableId))
      .map(toAiConfigRow)
      .filter((row): row is WikiBetaAiConfigRow => row !== null);
  }

  /**
   * 机制观察行（独立表「机制观察」的记录）。
   * 只取「稳定键 + 机制流程图附件 token + 中文名 + 游戏图标 token」四列：
   * 稳定键用于与 PG 的 `mechanism_observation.stable_key` 对齐；流程图/图标
   * 供站内 media 代理路由下载字节；中文名直接透传到列表与详情。
   * 独立表缓存 60s TTL，与文章表、榜单表互不干扰（四列共用同一次拉取，
   * 不额外增加 Base 请求）。
   */
  async listMechanismRows(): Promise<WikiBetaMechanismRow[]> {
    const config = this.getConfig();
    return (await this.listRecordsCached(config, config.mechanismTableId)).map(
      toMechanismRow,
    );
  }

  /**
   * 机制观察表的「字段名 → 字段描述」映射（只含**设置过描述**的字段）。
   *
   * 站内两处用到它：机制列表的排序按钮悬停提示、指数分值徽标悬停提示。
   * 描述是 Base 侧的方法论说明（分档含义、量纲），属于「改了不该发版」的
   * 内容 ⇒ 直读 Base 字段定义并沿用 60s TTL，与记录缓存同策略。
   */
  async listMechanismFieldDescriptions(): Promise<Record<string, string>> {
    const config = this.getConfig();
    return this.listFieldDescriptionsCached(config, config.mechanismTableId);
  }

  /**
   * 取回记录附件的字节。附件下载走「下载素材」接口；
   * Base 若开启高级权限则需要额外的 extra 鉴权参数，故先直连、失败后再带 extra 重试一次。
   *
   * @param fieldId 附件所在字段的字段 ID；extra bitablePerm 按字段构造，
   *                默认是封面图字段（历史调用方），榜单 HTML 走专用字段 ID。
   * @param fallbackContentType 响应缺少 Content-Type 时使用的 MIME 类型。
   */
  async downloadAttachment(
    recordId: string,
    fileToken: string,
    fieldId: string = wikiBetaFieldIds.cover(),
    tableId: string = this.getConfig().articleTableId,
    fallbackContentType = 'image/png',
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const accessToken = await this.documentReader.getTenantAccessToken();
    if (!accessToken.token) {
      this.logger.warn(
        `attachment download skipped: no tenant access token (record=${recordId} field=${fieldId})`,
      );
      return null;
    }
    const baseUrl = (
      process.env.FEISHU_OPENAPI_BASE_URL || 'https://open.feishu.cn'
    ).replace(/\/+$/u, '');
    const endpoint = `${baseUrl}/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`;
    const extra = JSON.stringify({
      bitablePerm: {
        tableId,
        attachments: {
          [fieldId]: { [recordId]: [fileToken] },
        },
      },
    });
    const label = `token=${fileToken.slice(0, 8)} field=${fieldId} record=${recordId}`;
    // 带 extra 优先：租户身份（tenant_access_token）读取开启了高级权限的 Base
    // 附件时必须携带 bitablePerm，不带会稳定返回 400（已用线上应用凭据实测）。
    // 若在未开高级权限的 Base 上 extra 形态被拒，再回退直连。
    // 顺序不能反过来——先直连等于每次取图都白付一次必然失败的往返。
    //
    // 整轮（extra + 直连）失败后按退避重试：并发取图时下游会零散失败，
    // 单次失败不代表附件不可用（2026-09-20 线上 34 并发中 8 个瞬时失败被静默吞成 404）。
    let response: Response | null = null;
    let reason = 'not-attempted';
    const retryStartedAt = Date.now();
    for (let attempt = 1; attempt <= ATTACHMENT_FETCH_ATTEMPTS; attempt += 1) {
      // 重试必须有总时长上限：单次超时 15s，无上限时最坏会拖到分钟级，
      // 把图片请求变成悬挂。超过窗口即放弃，宁可这一张裂图。
      if (
        attempt > 1 &&
        Date.now() - retryStartedAt > ATTACHMENT_RETRY_WINDOW_MS
      ) {
        break;
      }
      await sleep(ATTACHMENT_RETRY_BACKOFF_MS[attempt - 1] ?? 600);
      const viaExtra = await this.fetchAttachment(
        `${endpoint}?extra=${encodeURIComponent(extra)}`,
        accessToken.token,
      );
      if (viaExtra.response) {
        response = viaExtra.response;
        break;
      }
      const direct = await this.fetchAttachment(endpoint, accessToken.token);
      if (direct.response) {
        response = direct.response;
        break;
      }
      reason = `${viaExtra.reason}/${direct.reason}`;
      this.logger.warn(
        `attachment fetch failed (attempt ${attempt}/${ATTACHMENT_FETCH_ATTEMPTS}) ${label} reason=${reason}`,
      );
    }
    if (!response) return null;
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES)
      return null;
    try {
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.byteLength || data.byteLength > MAX_ATTACHMENT_BYTES)
        return null;
      return {
        data,
        contentType:
          response.headers.get('content-type') ?? fallbackContentType,
      };
    } catch {
      return null;
    }
  }

  /**
   * 单次下载尝试。失败原因必须带出来（`reason`），
   * 否则调用方只能报「附件不可用」，诊断时无从区分限流 / 鉴权 / 网络。
   * 并发经 `attachmentFetchGate` 限流，避免首屏几十张图同时打到下游。
   */
  private async fetchAttachment(
    url: string,
    token: string,
  ): Promise<{ response: Response | null; reason: string }> {
    try {
      const response = await attachmentFetchGate.run(() =>
        fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (response.ok) return { response, reason: 'ok' };
      try {
        await response.body?.cancel();
      } catch {
        /* 取消失败无关紧要，仅避免响应体悬挂 */
      }
      return { response: null, reason: `http-${response.status}` };
    } catch (error) {
      return {
        response: null,
        reason: error instanceof Error ? error.name : 'unknown-error',
      };
    }
  }

  /**
   * 带短 TTL 与并发去重的按表读取：同表的并发/近邻请求共享同一次
   * 飞行与结果，避免每个请求都全量拉取 Base（实测 1.8-2.9s/次）。
   */
  private async listRecordsCached(
    config: BaseConfig,
    tableId: string,
  ): Promise<FeishuBaseRecord[]> {
    const cached = this.tableCache.get(tableId);
    if (cached && Date.now() - cached.at < FeishuBaseReader.TABLE_CACHE_TTL_MS) {
      return cached.records;
    }
    const inflight = this.tableInflight.get(tableId);
    if (inflight) return inflight;
    const flight = this.listRecords(config, tableId)
      .then((records) => {
        this.tableCache.set(tableId, { at: Date.now(), records });
        return records;
      })
      .finally(() => {
        this.tableInflight.delete(tableId);
      });
    this.tableInflight.set(tableId, flight);
    return flight;
  }

  /**
   * 字段描述读取：与 listRecordsCached 同款「短 TTL + 并发去重」。
   * 缓存 key 带 `:fields` 后缀，避免与记录缓存互相污染。
   */
  private async listFieldDescriptionsCached(
    config: BaseConfig,
    tableId: string,
  ): Promise<Record<string, string>> {
    const cacheKey = `${tableId}:fields`;
    const cached = this.fieldDescriptionCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.at < FeishuBaseReader.FIELD_DESCRIPTION_TTL_MS
    ) {
      return cached.descriptions;
    }
    const inflight = this.fieldDescriptionInflight.get(cacheKey);
    if (inflight) return inflight;
    const flight = this.fetchFieldDescriptions(config, tableId)
      .then((descriptions) => {
        this.fieldDescriptionCache.set(cacheKey, {
          at: Date.now(),
          descriptions,
        });
        return descriptions;
      })
      .finally(() => {
        this.fieldDescriptionInflight.delete(cacheKey);
      });
    this.fieldDescriptionInflight.set(cacheKey, flight);
    return flight;
  }

  /**
   * `GET /open-apis/bitable/v1/apps/{token}/tables/{table_id}/fields`。
   *
   * ⚠️ 两个与 lark-cli 不同的点（2026-09-29 直调原始接口实测）：
   * 1. 字段名键是 **`field_name`**（lark-cli `+field-list` 会扁平化成 `name`）；
   * 2. `description` 是**顶层字符串**，且**未设置描述的字段没有这个键**（不是 null）
   *    ⇒ 必须显式判 `typeof === 'string'` 再取用，别写成 `description ?? ''`。
   */
  private async fetchFieldDescriptions(
    config: BaseConfig,
    tableId: string,
  ): Promise<Record<string, string>> {
    const accessToken = await this.documentReader.getTenantAccessToken();
    if (!accessToken.token) {
      throw new FeishuBaseReadError(
        accessToken.errorCode ?? 'FEISHU_AUTH_UNAVAILABLE',
        'Feishu user/app access token is unavailable for Base reads',
      );
    }
    const baseUrl = (
      process.env.FEISHU_OPENAPI_BASE_URL || 'https://open.feishu.cn'
    ).replace(/\/+$/u, '');
    const url = new URL(
      `${baseUrl}/open-apis/bitable/v1/apps/${encodeURIComponent(config.baseToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    );
    url.searchParams.set('page_size', '200');

    const descriptions: Record<string, string> = {};
    let pageToken: string | undefined;
    // 字段数远小于记录数，但该接口自身也分页，沿用 records 的逐页取全写法。
    for (let page = 0; page < 5; page += 1) {
      if (pageToken) url.searchParams.set('page_token', pageToken);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken.token}`,
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new FeishuBaseReadError(
          'FEISHU_BASE_NETWORK_ERROR',
          'Feishu Base request failed due to a network error',
        );
      }
      if (!response.ok) {
        this.logger.warn(
          `Feishu Base fields read failed with HTTP ${response.status}`,
        );
        throw new FeishuBaseReadError(
          `FEISHU_BASE_HTTP_${response.status}`,
          `Feishu Base request failed with HTTP ${response.status}`,
        );
      }
      const payload = (await response.json()) as {
        data?: {
          has_more?: boolean;
          page_token?: string;
          items?: Array<{ field_name?: unknown; description?: unknown }>;
        };
      };
      // 解析规则收敛到 toFieldDescriptions（含 4 个边界，另有单测护栏）。
      Object.assign(
        descriptions,
        toFieldDescriptions(payload.data?.items ?? []),
      );
      pageToken = payload.data?.page_token;
      if (!payload.data?.has_more || !pageToken) break;
    }
    return descriptions;
  }

  private getConfig(): BaseConfig {
    const baseToken = resolveWikiBetaBaseToken(extractBaseToken);
    const articleTableId =
      process.env.WIKI_BETA_ARTICLE_TABLE_ID?.trim() ||
      process.env.WIKI_BETA_SYNC_DIRECTORY_TABLE?.trim() ||
      wikiBetaTableIds.article();
    return {
      baseToken,
      articleTableId,
      rankingTableId: wikiBetaTableIds.ranking(),
      mechanismTableId: wikiBetaTableIds.mechanism(),
      quickToolsTableId: wikiBetaTableIds.quickTools(),
      aiConfigTableId: wikiBetaTableIds.aiConfig(),
    };
  }

  private async listRecords(
    config: BaseConfig,
    tableId: string,
  ): Promise<FeishuBaseRecord[]> {
    const accessToken = await this.documentReader.getTenantAccessToken();
    if (!accessToken.token) {
      throw new FeishuBaseReadError(
        accessToken.errorCode ?? 'FEISHU_AUTH_UNAVAILABLE',
        'Feishu user/app access token is unavailable for Base reads',
      );
    }
    const baseUrl = (
      process.env.FEISHU_OPENAPI_BASE_URL || 'https://open.feishu.cn'
    ).replace(/\/+$/u, '');
    const records: FeishuBaseRecord[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const url = new URL(
        `${baseUrl}/open-apis/bitable/v1/apps/${encodeURIComponent(config.baseToken)}/tables/${encodeURIComponent(tableId)}/records`,
      );
      url.searchParams.set('page_size', '500');
      // 链接（关联）字段默认返回纯展示分段（无 record id），快照侧的
      // subject/object/evidence 链接字段会恒为空数组 → isPublicRelation
      // 门禁永假、关系卡永不上站（P4a 线上实测根因）。置 true 后分段
      // 携带 record_ids，fieldRecordIds/recordId 按该键解析。
      url.searchParams.set('text_field_as_array', 'true');
      if (pageToken) url.searchParams.set('page_token', pageToken);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken.token}`,
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new FeishuBaseReadError(
          'FEISHU_BASE_NETWORK_ERROR',
          'Feishu Base request failed due to a network error',
        );
      }
      if (!response.ok) {
        this.logger.warn(
          `Feishu Base read failed with HTTP ${response.status}`,
        );
        throw new FeishuBaseReadError(
          `FEISHU_BASE_HTTP_${response.status}`,
          `Feishu Base request failed with HTTP ${response.status}`,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new FeishuBaseReadError(
          'FEISHU_BASE_JSON_INVALID',
          'Feishu Base returned invalid JSON',
        );
      }
      const result = parseBasePage(payload);
      if (!result)
        throw new FeishuBaseReadError(
          'FEISHU_BASE_RESPONSE_INVALID',
          'Feishu Base returned an invalid records response',
        );
      if (result.apiCode !== 0)
        throw new FeishuBaseReadError(
          `FEISHU_BASE_API_${result.apiCode}`,
          'Feishu Base rejected a records request',
        );
      records.push(...result.items);
      if (!result.hasMore || !result.pageToken) return records;
      pageToken = result.pageToken;
    }
    throw new FeishuBaseReadError(
      'FEISHU_BASE_PAGE_LIMIT',
      'Feishu Base returned too many pages',
    );
  }
}

export function extractBaseToken(value: string | undefined): string | null {
  if (!value) return null;
  return value.match(/\/base\/([A-Za-z0-9_-]+)/u)?.[1] ?? null;
}

export function parseBasePage(payload: unknown): {
  apiCode: number;
  items: FeishuBaseRecord[];
  hasMore: boolean;
  pageToken: string | null;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  const apiCode = typeof root.code === 'number' ? root.code : 0;
  const rawItems = body.items ?? body.records;
  // Feishu omits `items`/`records` for a successful empty table response in
  // some Base environments. Preserve that as an empty page; malformed or
  // failed responses still go through the normal error boundary.
  if (!Array.isArray(rawItems)) {
    const isEmptySuccess =
      apiCode === 0 &&
      (body.total === 0 || body.has_more === false || body.hasMore === false);
    if (!isEmptySuccess) return null;
  }
  return {
    apiCode,
    items: Array.isArray(rawItems) ? rawItems.filter(isBaseRecord) : [],
    hasMore: body.has_more === true || body.hasMore === true,
    pageToken:
      typeof (body.page_token ?? body.pageToken) === 'string'
        ? String(body.page_token ?? body.pageToken) || null
        : null,
  };
}

/**
 * 从 fields 接口的 `items` 抽出「字段名 → 字段描述」。
 *
 * 单独导出以便单测：这里有三处「不算数」的边界，人工读代码容易漏——
 * 1. 未设置描述的字段**根本没有 `description` 键**（不是 null，也不是空串）；
 * 2. 描述可能是纯空白（Base 编辑器里删剩的空格）；
 * 3. `field_name` 缺失或类型不对（接口从不保证）。
 *
 * 字段名键是 **`field_name`**（原始 OpenAPI 口径）；lark-cli `+field-list`
 * 会把它扁平化成 `name`，别照搬。
 */
export function toFieldDescriptions(
  items: readonly unknown[],
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const { field_name: name, description } = item as {
      field_name?: unknown;
      description?: unknown;
    };
    if (typeof name !== 'string' || typeof description !== 'string') continue;
    const trimmed = description.trim();
    if (trimmed) descriptions[name] = trimmed;
  }
  return descriptions;
}

function isBaseRecord(value: unknown): value is FeishuBaseRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.record_id === 'string' &&
    Boolean(record.record_id) &&
    Boolean(record.fields) &&
    typeof record.fields === 'object' &&
    !Array.isArray(record.fields)
  );
}

function toArticleRow(record: FeishuBaseRecord): WikiBetaArticleRow {
  const fields = record.fields;
  return {
    baseRecordId: record.record_id,
    title: fieldText(fields, '标题'),
    appDocId: fieldNullableText(fields, '文档ID'),
    docLink: fieldNullableText(fields, '文档链接'),
    approvalStatus: fieldNullableText(fields, '审批状态'),
    abstract: fieldNullableText(fields, '摘要'),
    keyFindings: fieldNullableText(fields, '关键结论'),
    contentType: fieldText(fields, '内容类型'),
    sourceAuthor: fieldText(fields, '来源作者'),
    sourcePublisher: fieldText(fields, '来源发布方'),
    // 父项优先读新列名，回退旧列名，使字段改名不产生空窗期。
    gameplayParent: normalizeGameplayName(
      fieldText(fields, GAMEPLAY_PARENT_FIELD) ||
        fieldText(fields, GAMEPLAY_LEGACY_PARENT_FIELD),
    ),
    gameplayChild: normalizeGameplayName(
      fieldText(fields, GAMEPLAY_CHILD_FIELD),
    ),
    sourceDateFeishu: sourceDateText(fields['飞书来源日期']),
    coverFileToken: fieldAttachmentToken(fields, '封面图'),
    articleAttachment: fieldAttachment(fields, '附件'),
    updateTime:
      parseDateValue(fields['更新时间']) ??
      parseEpochDate(record.last_modified_time),
  };
}

// toEntityRow / toRelationRow 已随 Phase 4 语料冻结下线（2026-10-09）：
// Base「实体词典」「实体关系」两表删除，实体行唯一来源 = PG entity_row_cache
// jsonb 快照（见 entity-mention-projection.service loadEntities）。
// WikiBetaEntityRow / WikiBetaRelationRow 类型保留：投影服务与 matcher 仍消费。

// toMentionRow 已随「文章实体提及」表于 2026-09-11 下线移除
//（见 snapshots/2026-09-11-mention-table/）。

function toRankingRow(record: FeishuBaseRecord): WikiBetaRankingRow {
  const fields = record.fields;
  return {
    baseRecordId: record.record_id,
    board: fieldText(fields, RANKING_FIELD_NAMES.board),
    slug: fieldText(fields, RANKING_FIELD_NAMES.slug),
    label: fieldText(fields, RANKING_FIELD_NAMES.label),
    htmlFileToken: fieldAttachmentToken(fields, RANKING_FIELD_NAMES.html),
    dataSource: fieldText(fields, RANKING_FIELD_NAMES.dataSource),
  };
}

function toQuickToolRow(record: FeishuBaseRecord): WikiBetaQuickToolRow | null {
  const fields = record.fields;
  // 门禁：仅「启用 = ☑」的行进入列表（与机制观察「当前发布」同语义）。
  if (fields[QUICK_TOOLS_FIELD_NAMES.enabled] !== true) return null;
  return {
    baseRecordId: record.record_id,
    name: fieldText(fields, QUICK_TOOLS_FIELD_NAMES.name),
    description: fieldNullableText(fields, QUICK_TOOLS_FIELD_NAMES.description),
    category: fieldText(fields, QUICK_TOOLS_FIELD_NAMES.category),
    url: extractUrl(fieldNullableText(fields, QUICK_TOOLS_FIELD_NAMES.url)),
    attachmentToken: fieldAttachmentToken(fields, QUICK_TOOLS_FIELD_NAMES.attachment),
    iconFileToken: fieldAttachmentToken(fields, QUICK_TOOLS_FIELD_NAMES.icon),
    readme: fieldRichText(fields, QUICK_TOOLS_FIELD_NAMES.readme) || null,
    // 🔴 日期列必须走 sourceDateText：Base datetime 经 OpenAPI 返回毫秒时间戳，
    // 裸 scalarText 会产出 "1789324800000" ⇒ Date.parse 为 NaN、排序整表失效
    // （09-10 实测：09-28 旧行排在最前），前端还会显示「更新于 1789324800」。
    date: sourceDateText(fields[QUICK_TOOLS_FIELD_NAMES.date]) || null,
  };
}

function toAiConfigRow(record: FeishuBaseRecord): WikiBetaAiConfigRow | null {
  const fields = record.fields;
  // 门禁：仅「enabled = ☑」的行生效（与便捷工具「启用」同语义）。
  if (fields.enabled !== true) return null;
  const baseUrl = fieldText(fields, 'base_url').replace(/\/+$/u, '');
  const model = fieldText(fields, 'model').trim();
  const apiKey = fieldText(fields, 'api_key').trim();
  // 三件套任一为空即视为配置不完整，不生效（避免半行配置引发运行期错误）。
  if (!baseUrl || !model || !apiKey) return null;
  return {
    baseRecordId: record.record_id,
    configName: fieldText(fields, 'config_name'),
    baseUrl,
    model,
    apiKey,
    note: fieldNullableText(fields, 'note'),
  };
}

/**
 * 从 Base url 列文本提取裸 URL。
 * Base 的 url 列读回可能是 markdown 链接（`[text](https://…)`）或裸 URL；
 * 前端 `<a href>` 需要裸 URL，不能把 markdown 原文塞进 href。
 */
function extractUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // markdown 链接：`[text](url)` → 取括号内 URL。
  const markdown = trimmed.match(/\[[^\]]*\]\(([^)]+)\)/u);
  if (markdown?.[1]) return markdown[1].trim();
  // 裸 URL：直接返回。
  return trimmed;
}

function toMechanismRow(record: FeishuBaseRecord): WikiBetaMechanismRow {
  const fields = record.fields;
  return {
    baseRecordId: record.record_id,
    stableKey: fieldText(fields, '稳定键'),
    figureFileToken: fieldAttachmentToken(fields, '机制流程图'),
    nameCn: fieldNullableText(fields, '中文名'),
    iconFileToken: fieldAttachmentToken(fields, '游戏图标'),
  };
}

function fieldText(fields: Record<string, unknown>, name: string): string {
  return scalarText(fields[name]);
}
function fieldNullableText(
  fields: Record<string, unknown>,
  name: string,
): string | null {
  const value = fieldText(fields, name);
  return value || null;
}
/**
 * 多行文本列（markdown 原文）读取：按富文本分段**原样拼接**。
 *
 * `text_field_as_array=true` 下，Base 的多行文本列返回分段数组
 * `[{ text, type, link? }]`，每段 `text` 自带真实换行。逐段原样拼接才能还原
 * markdown 原文；若走 `scalarText` 的数组分支，会被逐段 `.trim()` 削掉段尾
 * 换行、再以「、」连接——整篇 markdown 塌成一行，标题/表格/代码块全部失解析
 * （2026-09-28「便捷工具 README 不渲染」的根因）。
 *
 * url 分段只取 `text`：markdown 链接的方括号/圆括号本就落在相邻 text 分段里，
 * 直接拼回即得 `[label](url)` 原文；Base 对裸文件名的自动加链
 * （`server.py` → `http://server.py`）也只留在 text 中，不会伪造超链接。
 */
function fieldRichText(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  if (Array.isArray(value) && value.length > 0 && value.every(isRichTextSegment)) {
    return value.map((segment) => String(segment.text ?? '')).join('').trim();
  }
  return scalarText(value);
}
/** 富文本分段判定：`{ text, type }` 形态且非关联字段分段（关联分段带 record_ids）。 */
function isRichTextSegment(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.text === 'string' &&
    typeof segment.type === 'string' &&
    !('record_ids' in segment)
  );
}
/**
 * 附件字段形如 [{ file_token, name, size }]，封面只取第一张。
 * 不复用 scalarText：它遇到对象会走 id/record_id 分支，取不到 file_token。
 */
function fieldAttachmentToken(
  fields: Record<string, unknown>,
  name: string,
): string | null {
  return fieldAttachment(fields, name)?.fileToken ?? null;
}

function fieldAttachment(
  fields: Record<string, unknown>,
  name: string,
): WikiBetaArticleAttachment | null {
  const value = fields[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'object') return null;
  const attachment = first as Record<string, unknown>;
  const token = attachment.file_token;
  if (typeof token !== 'string' || !token.trim()) return null;
  const fileName = attachment.name;
  return {
    fileToken: token.trim(),
    fileName:
      typeof fileName === 'string' && fileName.trim()
        ? fileName.trim()
        : null,
  };
}
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value).trim();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value))
    return value.map(scalarText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const text = scalarText(object.text ?? object.name ?? object.value);
    const link = scalarText(object.url ?? object.href ?? object.link);
    if (text && link && /^https?:\/\//iu.test(link) && !text.includes(link))
      return `[${text}](${link})`;
    if (text) return text;
    if (link) return link;
    for (const key of ['id', 'record_id']) {
      const fallback = scalarText(object[key]);
      if (fallback) return fallback;
    }
  }
  return '';
}

/** Base 日期字段通过 OpenAPI 返回毫秒时间戳；统一成日期字符串供站内日期筛选和展示使用。 */
function sourceDateText(value: unknown): string {
  const text = scalarText(value);
  if (!text) return '';
  const timestamp =
    typeof value === 'number'
      ? value
      : /^\d{13}$/u.test(text)
        ? Number(text)
        : Number.NaN;
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 1_000_000_000_000 ||
    timestamp > 8_640_000_000_000_000
  )
    return text;

  const timeZone =
    process.env.WIKI_BETA_BASE_TIME_ZONE?.trim() || 'Asia/Shanghai';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(timestamp);
    let year = '';
    let month = '';
    let day = '';
    for (const part of parts) {
      if (part.type === 'year') year = part.value;
      else if (part.type === 'month') month = part.value;
      else if (part.type === 'day') day = part.value;
    }
    return year && month && day ? `${year}-${month}-${day}` : text;
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}
function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function parseDateValue(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return parseEpochDate(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return parseDateValue(object.value ?? object.timestamp ?? object.date);
  }
  return null;
}
function parseEpochDate(value: number | undefined): Date | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const parsed = new Date(value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
// 2026-09-11：内容类型与玩法分类去枚举。
// 原 normalizeContentKind 把 Base 中文值翻成固定 slug（未知值兜底为
// research_report），原 normalizeBaseGameplayCategory 只认 6 个分类、其余丢成
// null —— 两者都会让 Base 里新加的值凭空消失。现改为原文透传，
// 分类树由「父项/子项」两列的实际组合派生。
