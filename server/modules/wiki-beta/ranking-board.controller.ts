import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RankingBoardService } from './ranking-board.service';

/**
 * 榜单接口：前端榜单页（/ranking）的数据源。
 * meta 无数据/正文 404 时，前端回退到静态兜底数据（client/src/data/rankings），
 * 保证已上线的榜单在任何情况下都可正常展示。
 */
@Controller('api/rankings')
export class RankingBoardController {
  constructor(private readonly rankingBoard: RankingBoardService) {}

  @Get('meta')
  async meta() {
    return { boards: await this.rankingBoard.listBoardsMeta() };
  }

  @Get(':board/:slug/content')
  async content(@Param('board') board: string, @Param('slug') slug: string) {
    const html = await this.rankingBoard.loadContent(board, slug);
    if (html === null) throw new NotFoundException('Ranking content not found');
    return { html };
  }
}
