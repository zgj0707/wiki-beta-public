import { Controller, Get, Param, Query } from '@nestjs/common';
import { ArticlesService } from './articles.service';

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

@Controller('api/articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  async list(@Query() query: Record<string, string | string[] | undefined>) {
    return this.articlesService.list({
      search: firstValue(query.search),
      gameplayCategory: firstValue(query.gameplayCategory),
      contentType: firstValue(query.contentType),
      sourcePublisher: firstValue(query.sourcePublisher),
      days: parseOptionalInt(firstValue(query.days)),
      order: firstValue(query.order) === 'asc' ? 'asc' : 'desc',
      limit: parseOptionalInt(firstValue(query.limit)),
      offset: parseOptionalInt(firstValue(query.offset)),
    });
  }

  @Get('facets')
  facets(@Query() query: Record<string, string | string[] | undefined>) {
    return this.articlesService.facets({
      search: firstValue(query.search),
      gameplayCategory: firstValue(query.gameplayCategory),
      contentType: firstValue(query.contentType),
      sourcePublisher: firstValue(query.sourcePublisher),
    });
  }

  @Get(':docId')
  detail(@Param('docId') docId: string) {
    return this.articlesService.detail(docId);
  }
}
