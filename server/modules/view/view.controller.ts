import { Controller, Get, Render, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ArticlesService,
  type ArticleListItem,
} from '../articles/articles.service';
import { FeishuBaseReader } from '../wiki-beta/feishu-base-reader.service';
import { APPROVAL_STATUS_PUBLISHED } from '../wiki-beta/publication-policy';
import { safeJson } from './safe-json';

interface InitialData {
  revision: string;
  library: {
    items: ArticleListItem[];
    total: number;
  };
  bootstrap: {
    revision: string;
    generatedAt: string;
    recent: ArticleListItem[];
  };
}

const LIBRARY_PAGE_SIZE = 20;
const RECENT_SIZE = 12;

@Controller()
export class ViewController {
  constructor(
    private readonly articlesService: ArticlesService,
    private readonly baseReader: FeishuBaseReader,
  ) {}

  @Get(['/', '*'])
  @Render('index')
  async render(
    @Req() req: Request & { __platform_data__?: Record<string, unknown> },
  ): Promise<{ __platform__: string; __initial_data__: string }> {
    const platformData = req.__platform_data__ ?? {};
    let initialData: InitialData | null = null;
    try {
      const [items, total] = await this.loadLibrary();
      const revision = await this.catalogRevision();
      initialData = {
        revision,
        library: { items, total },
        bootstrap: {
          revision,
          generatedAt: new Date().toISOString(),
          recent: items.slice(0, RECENT_SIZE),
        },
      };
    } catch {
      initialData = null;
    }

    return {
      // don't delete this line, it's used by client to get platform info
      __platform__: safeJson(platformData),
      __initial_data__: safeJson(initialData),
    };
  }

  /** 首屏书库快照：直接复用公开 API（/api/articles）的过滤与门禁语义。 */
  private async loadLibrary(): Promise<[ArticleListItem[], number]> {
    const { items, total } = await this.articlesService.list({
      limit: LIBRARY_PAGE_SIZE,
      offset: 0,
    });
    return [items, total];
  }

  /** 目录修订号：max(update_time) + 已批准记录数，数据变化即失效 SSR 缓存。 */
  private async catalogRevision(): Promise<string> {
    const rows = (await this.baseReader.listArticleRows()).filter(
      (row) => row.approvalStatus === APPROVAL_STATUS_PUBLISHED,
    );
    const latest = rows.reduce<Date | null>(
      (current, row) =>
        row.updateTime && (!current || row.updateTime > current)
          ? row.updateTime
          : current,
      null,
    );
    return `${latest?.toISOString() ?? '0'}:${rows.length}`;
  }
}
