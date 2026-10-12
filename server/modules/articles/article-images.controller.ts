import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArticlesService } from './articles.service';

/**
 * 封面二进制必须挂在 /api 之外。
 *
 * 平台 CSRF 中间件只作用于 /api/*（fullstack-nestjs-core 的 csrfRoutes 默认 ["/api/*"]），
 * 校验的是自定义请求头 x-suda-csrf-token；而 <img> 无法携带自定义请求头，
 * 封面若挂在 /api 下，在浏览器里必然 403 并回退成占位图。
 * （服务端 curl 带 cookie + 该请求头会返回 200，很容易把这条路误判为已经打通。）
 * 挂在 /media 下则不受 CSRF 约束，可被 <img> 直接加载并按静态资源缓存。
 */
@Controller('media/articles')
export class ArticleCoverMediaController {
  constructor(private readonly articlesService: ArticlesService) {}

  /**
   * 卡片封面：服务端透传字节，不使用飞书临时下载链接。
   * 临时链接小时级过期，若直接 302 并被浏览器按 max-age 缓存会必现裂图。
   */
  @Get(':docId/cover')
  async cover(
    @Param('docId') docId: string,
    @Res() response: Response,
  ): Promise<void> {
    const cover = await this.articlesService.getCoverImage(docId);
    response.setHeader('Content-Type', cover.contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.send(cover.data);
  }

  /**
   * Base 文章附件通过同源地址打开；只按文章 ID 查已批准记录中的附件。
   */
  @Get(':docId/attachment')
  async attachment(
    @Param('docId') docId: string,
    @Query('download') download: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const attachment = await this.articlesService.getArticleAttachment(docId);
    response.setHeader('Content-Type', attachment.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (
      attachment.contentType.startsWith('text/html') ||
      attachment.contentType.startsWith('application/xml') ||
      attachment.contentType === 'image/svg+xml'
    ) {
      response.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:",
      );
      response.setHeader('Referrer-Policy', 'no-referrer');
    }
    const disposition = download === '1' ? 'attachment' : 'inline';
    const encodedFileName = encodeURIComponent(attachment.fileName).replace(
      /[!'()*]/gu,
      (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodedFileName}`,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.send(attachment.data);
  }
}

@Controller('api/articles')
export class ArticleImagesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get(':docId/images/:fileToken')
  async redirect(
    @Param('docId') docId: string,
    @Param('fileToken') fileToken: string,
    @Res() response: Response,
  ): Promise<void> {
    const target = await this.articlesService.getImageRedirect(docId, fileToken);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.redirect(302, target);
  }
}
