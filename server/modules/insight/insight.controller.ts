import { Controller, Get, Param, Query } from '@nestjs/common';
import { InsightService } from './insight.service';

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('api')
export class InsightController {
  constructor(private readonly insightService: InsightService) {}

  @Get('mechanisms')
  listMechanisms(
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    return this.insightService.listMechanisms({
      search: firstValue(query.search),
      type: firstValue(query.type),
    });
  }

  @Get('mechanisms/trends')
  mechanismTrends() {
    return this.insightService.mechanismTrends();
  }

  /**
   * 两个指数列的字段描述（Base 侧方法论说明），供前端悬停提示。
   *
   * ⚠️ 必须排在 `mechanisms/:stableKey` **之前**：Nest 按声明顺序匹配，
   * 放到后面会被参数路由当成 stableKey='score-hints' 吃掉（与上面 trends 同理）。
   */
  @Get('mechanisms/score-hints')
  mechanismScoreHints() {
    return this.insightService.mechanismScoreHints();
  }

  @Get('mechanisms/:stableKey')
  mechanismDetail(@Param('stableKey') stableKey: string) {
    return this.insightService.mechanismDetail(stableKey);
  }
}
