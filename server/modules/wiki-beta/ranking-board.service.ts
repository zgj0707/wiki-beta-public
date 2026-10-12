import { Injectable, Logger } from '@nestjs/common';
import {
  RANKING_BOARD_KEYS,
  RANKING_BOARD_TITLES,
  RankingBoardKey,
  RankingBoardsMeta,
  deriveAppstoreSheetName,
  parseRankingDataSource,
  rankingBoardKey,
  normalizeRankingSlug,
  rankingPeriodSortKey,
} from '@shared/rankings';
import {
  renderAppstoreInner,
  buildWeixinInner,
} from '@shared/ranking-render';
import {
  FeishuBaseReader,
  WikiBetaRankingRow,
} from './feishu-base-reader.service';
import { FeishuSheetsReader } from './feishu-sheets-reader.service';
import { wikiBetaFieldIds, wikiBetaTableIds } from './wiki-beta-env';

/** 内容下载/渲染的短缓存：与表级 60s 缓存对齐，避免同一期反复下载或读表。 */
const CONTENT_CACHE_TTL_MS = 60_000;

/**
 * 榜单板块服务：把独立表「榜单」的行投影成前端榜单页消费的
 * meta（板块/周期结构）与按期 HTML 正文。
 *
 * 每行的内容来源二选一：
 *  1. 「榜单HTML」附件（Steam 分享页整文档等，渲染产物直接上传）；
 *  2. 「数据源」sheet 驱动（AppStore/微信）：按板块默认源或行内显式覆盖定位
 *     飞书电子表格，实时读 values 并用 shared/ranking-render 渲染成 inner 片段。
 *
 * 口径继承自原静态生成器 gen-ranking-pages.mjs：
 *   - periods 一律按时间倒序（索引 0 = 最新一期）；
 *   - 空榜不产出：附件与 sheet 渲染都拿不到内容的行不出现在 meta 里。
 */
@Injectable()
export class RankingBoardService {
  private readonly logger = new Logger(RankingBoardService.name);
  private readonly contentCache = new Map<
    string,
    { at: number; html: string }
  >();

  constructor(
    private readonly baseReader: FeishuBaseReader,
    private readonly sheetsReader: FeishuSheetsReader,
  ) {}

  /** 全部板块的 meta；无有效行的板块不出现（前端回退静态兜底）。 */
  async listBoardsMeta(): Promise<RankingBoardsMeta> {
    const rows = await this.baseReader.listRankingRows();
    const grouped = new Map<RankingBoardKey, WikiBetaRankingRow[]>();
    for (const row of rows) {
      const key = rankingBoardKey(row.board);
      // slug 归一化：兼容「steam-w7」这类带板块前缀的写法，统一为静态产物口径（w7）。
      const slug = key ? normalizeRankingSlug(key, row.slug) : '';
      if (!key || !slug) continue;
      const bucket = grouped.get(key) ?? [];
      bucket.push({ ...row, slug });
      grouped.set(key, bucket);
    }

    const boards: RankingBoardsMeta = {};
    for (const key of RANKING_BOARD_KEYS) {
      const boardRows = grouped.get(key) ?? [];
      if (!boardRows.length) continue;
      // slug 去重：同 slug 后出现的行覆盖先出现的（Base 行编辑残留防护）。
      const bySlug = new Map<string, WikiBetaRankingRow>();
      for (const row of boardRows) bySlug.set(row.slug, row);
      const unique = [...bySlug.values()];
      const isSingle = unique.length === 1 && unique[0].slug === 'index';
      const periods = isSingle
        ? []
        : unique
            .map((row) => ({
              slug: row.slug,
              label: row.label || row.slug,
              key: rankingPeriodSortKey(key, row.slug, row.label),
            }))
            .sort((a, b) => b.key - a.key)
            .map(({ slug, label }) => ({ slug, label }));
      boards[key] = {
        title: RANKING_BOARD_TITLES[key],
        type: isSingle ? 'single' : 'periods',
        periods,
      };
    }
    return boards;
  }

  /** 按板块+周期取 HTML 正文；无对应行/附件/渲染失败时返回 null（调用方回退静态兜底）。 */
  async loadContent(board: string, slug: string): Promise<string | null> {
    const key = rankingBoardKey(board);
    if (!key || !slug) return null;
    // 入参同样归一化：裸 slug（w7）与带前缀 slug（steam-w7）都能命中。
    const normalized = normalizeRankingSlug(key, slug);
    const cacheKey = `${key}:${normalized}`;
    const cached = this.contentCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CONTENT_CACHE_TTL_MS) {
      return cached.html;
    }

    const rows = await this.baseReader.listRankingRows();
    const row = rows.find(
      (r) =>
        rankingBoardKey(r.board) === key &&
        normalizeRankingSlug(key, r.slug) === normalized,
    );
    if (!row) return null;

    let html: string | null = null;
    if (row.htmlFileToken) {
      html = await this.downloadHtml(row);
    } else {
      html = await this.renderFromSheet(key, row);
      if (html) {
        this.logger.log(
          `[ranking-board] sheet-rendered ${cacheKey} bytes=${html.length}`,
        );
      }
    }
    if (html) this.contentCache.set(cacheKey, { at: Date.now(), html });
    return html;
  }

  private async downloadHtml(row: WikiBetaRankingRow): Promise<string | null> {
    if (!row.htmlFileToken) return null;
    const attachment = await this.baseReader.downloadAttachment(
      row.baseRecordId,
      row.htmlFileToken,
      wikiBetaFieldIds.rankingHtml(),
      wikiBetaTableIds.ranking(),
    );
    if (!attachment) {
      this.logger.warn(
        `Ranking content download failed: record=${row.baseRecordId}`,
      );
      return null;
    }
    return attachment.data.toString('utf8') || null;
  }

  /**
   * sheet 驱动渲染：定位电子表格 → 按名匹配 sheet → 读 values → 渲染。
   *  - AppStore：默认源 = SLG 周下载榜年度工作簿（shared RANKING_SHEET_DEFAULTS）；
   *    「数据源」填 sheet 名（如 0826-0902），留空则从 slug 推导（w08260902 → 0826-0902）；
   *  - 微信：默认源 = 固定 wiki 节点 Sheet1；「数据源」可覆盖。
   * 任何一步失败返回 null（前端回退静态兜底），不打断调用链。
   */
  private async renderFromSheet(
    key: RankingBoardKey,
    row: WikiBetaRankingRow,
  ): Promise<string | null> {
    if (key === 'steam') return null;
    const source = parseRankingDataSource(row.dataSource, key);
    if (!source) return null;

    const spreadsheetToken = source.isWikiNode
      ? await this.sheetsReader.resolveWikiSpreadsheet(source.sourceToken)
      : source.sourceToken;
    if (!spreadsheetToken) return null;

    const sheetName =
      source.sheetName ||
      (key === 'appstore' ? deriveAppstoreSheetName(row.slug) : null);
    if (!sheetName) {
      this.logger.warn(
        `[ranking-board] no sheet name for row: board=${key} slug=${row.slug} (fill 数据源 with the sheet name)`,
      );
      return null;
    }

    const values = await this.readSheetValues(spreadsheetToken, sheetName);
    if (!values) return null;
    if (key === 'appstore') return renderAppstoreInner(values);
    return buildWeixinInner(values);
  }

  /** 按 sheet 名定位并读值；v3 列表 + v2 values，两段都可能因权限缺失失败 → null。 */
  private async readSheetValues(
    spreadsheetToken: string,
    sheetName: string,
  ): Promise<string[][] | null> {
    const sheets = await this.sheetsReader.listSheets(spreadsheetToken);
    const target = sheets.find((s) => s.title.trim() === sheetName.trim());
    if (!target) {
      this.logger.warn(
        `[ranking-board] sheet not found: "${sheetName}" in ${spreadsheetToken} (known: ${sheets.map((s) => s.title).join('、') || '—'})`,
      );
      return null;
    }
    return this.sheetsReader.readValues(spreadsheetToken, target.sheetId);
  }
}
