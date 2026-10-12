import { Injectable, Logger } from '@nestjs/common';
import { FeishuDocumentReader } from './document-reader.service';

/**
 * 飞书电子表格读取（应用身份 tenant_access_token，#榜单数据源 sheet 直读）。
 *
 * 依赖应用身份权限 sheets:spreadsheet:readonly（未开通时 API 返回 99991672，
 * 调用方须把失败转成 null 让上层回退，不得抛出打断列表/详情链路）。
 *
 * 与 feishu-base-reader 的差异：Base 走 bitable OpenAPI（有 60s 表缓存），
 * 这里是逐次直读——调用方（RankingBoardService）自己负责结果缓存。
 */

interface SheetMeta {
  sheetId: string;
  title: string;
}

const FEISHU_TIMEOUT_MS = 15_000;

@Injectable()
export class FeishuSheetsReader {
  private readonly logger = new Logger(FeishuSheetsReader.name);

  constructor(private readonly documentReader: FeishuDocumentReader) {}

  private baseUrl(): string {
    return (
      process.env.FEISHU_OPENAPI_BASE_URL || 'https://open.feishu.cn'
    ).replace(/\/+$/u, '');
  }

  private async authedFetch(url: string): Promise<unknown | null> {
    const accessToken = await this.documentReader.getTenantAccessToken();
    if (!accessToken.token) return null;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken.token}` },
        signal: AbortSignal.timeout(FEISHU_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(
          `[feishu-sheets-reader] HTTP ${response.status} ${url.replace(/\?.*$/u, '')}`,
        );
        return null;
      }
      return await response.json();
    } catch (e) {
      this.logger.warn(
        `[feishu-sheets-reader] fetch failed: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  /**
   * wiki 节点 → spreadsheet token（仅接受 obj_type=sheet 的节点）。
   * get_node 与 Base/文档读取共用同一套应用身份鉴权。
   */
  async resolveWikiSpreadsheet(nodeToken: string): Promise<string | null> {
    const payload = (await this.authedFetch(
      `${this.baseUrl()}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`,
    )) as { data?: { node?: { obj_type?: string; obj_token?: string } } } | null;
    const node = payload?.data?.node;
    if (!node || node.obj_type !== 'sheet' || !node.obj_token) return null;
    return node.obj_token;
  }

  /** 列出电子表格全部工作表（sheetId + 标题）。 */
  async listSheets(spreadsheetToken: string): Promise<SheetMeta[]> {
    const payload = (await this.authedFetch(
      `${this.baseUrl()}/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query?page_size=200`,
    )) as {
      data?: { sheets?: { sheet_id?: string; title?: string }[] };
    } | null;
    const sheets = payload?.data?.sheets ?? [];
    return sheets
      .filter((s) => s.sheet_id)
      .map((s) => ({ sheetId: s.sheet_id as string, title: s.title ?? '' }));
  }

  /** 读单个 sheet 的 A1:T200 二维值（FormattedValue 渲染：日期/千分位与表格展示一致）。 */
  async readValues(
    spreadsheetToken: string,
    sheetId: string,
    range = 'A1:T200',
  ): Promise<string[][] | null> {
    const rangeParam = encodeURIComponent(`${sheetId}!${range}`);
    const payload = (await this.authedFetch(
      `${this.baseUrl()}/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${rangeParam}?valueRenderOption=FormattedValue&dateTimeRenderOption=FormattedString`,
    )) as { data?: { valueRange?: { values?: unknown[][] } } } | null;
    const values = payload?.data?.valueRange?.values;
    if (!values) return null;
    return values.map((row) =>
      row.map((cell) =>
        cell == null || typeof cell === 'object' ? '' : String(cell),
      ),
    );
  }
}
