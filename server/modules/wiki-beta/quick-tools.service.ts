import { Injectable, Logger } from '@nestjs/common';
import { type QuickToolItem } from '@shared/quick-tools';
import { wikiBetaFieldIds, wikiBetaTableIds } from './wiki-beta-env';
import { FeishuBaseReader } from './feishu-base-reader.service';

/**
 * 便捷工具服务：把独立表「便捷工具表」的行投影成前端「便捷工具」页签与
 * 「动态与发现」右栏消费的列表，并按名称提供「附件」列 HTML 的字节代理下载。
 *
 * 纯直读 Base（仿榜单链路），无 PG、无 cron：
 *   - listTools：全部启用的工具，按日期降序（最新在上，无日期沉底）；
 *   - loadAttachment：按 Base record_id 精确命中，返回「附件」列 HTML 字节
 *     （text/html 直渲；H5 游戏与 /labs 的评测页共用此代理）。
 *   - skills README 走「README」文本列（fieldRichText 保真换行），不走附件。
 */
@Injectable()
export class QuickToolsService {
  private readonly logger = new Logger(QuickToolsService.name);

  constructor(private readonly baseReader: FeishuBaseReader) {}

  /** 全部启用的工具，按日期降序（最新在上）；无日期的排最后。 */
  async listTools(): Promise<QuickToolItem[]> {
    const rows = await this.baseReader.listQuickToolRows();
    return rows
      .slice()
      .sort((a, b) => {
        const at = a.date ? Date.parse(a.date) : -Infinity;
        const bt = b.date ? Date.parse(b.date) : -Infinity;
        return bt - at;
      })
      .map((row): QuickToolItem => ({
        id: row.baseRecordId,
        name: row.name,
        description: row.description,
        category: row.category,
        url: row.url,
        attachmentToken: row.attachmentToken,
        iconFileToken: row.iconFileToken,
        readme: row.readme,
        date: row.date,
      }));
  }

  /** 按 Base record_id 取「附件」列 HTML 字节；无该行或该行无附件时返回 null。 */
  async loadAttachment(
    recordId: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const rows = await this.baseReader.listQuickToolRows();
    const row = rows.find(
      (candidate) =>
        candidate.baseRecordId === recordId &&
        Boolean(candidate.attachmentToken),
    );
    if (!row?.attachmentToken) return null;
    return this.baseReader.downloadAttachment(
      row.baseRecordId,
      row.attachmentToken,
      wikiBetaFieldIds.quickToolsGameFile(),
      wikiBetaTableIds.quickTools(),
    );
  }
}
