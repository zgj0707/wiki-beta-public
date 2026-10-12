import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InsightService } from './insight.service';

/**
 * 机制流程图二进制必须挂在 /api 之外：平台 CSRF 中间件只作用于 /api/*
 * （校验自定义请求头 x-suda-csrf-token），而 <img> 无法携带自定义头，
 * 挂 /api 下浏览器必 403 回退破图（服务端 curl 带头会 200，极易误判为已打通）。
 * 详见 article-images.controller.ts:5-13。
 */
@Controller('media/mechanisms')
export class MechanismFiguresController {
  constructor(private readonly insightService: InsightService) {}

  /**
   * 流程图：服务端透传字节，不 302 到飞书临时链接——临时链接小时级过期，
   * 被浏览器按 max-age 缓存后必现裂图。
   */
  @Get(':stableKey/flowchart')
  async flowchart(
    @Param('stableKey') stableKey: string,
    @Res() response: Response,
  ): Promise<void> {
    const figure = await this.insightService.getMechanismFigure(stableKey);
    response.setHeader('Content-Type', figure.contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.send(figure.data);
  }

  /**
   * 方形图标（Base「游戏图标」附件，128×128 PNG）。
   * 同样是字节透传而非 302 到飞书临时链接；`v=` 由前端按 token 前 8 位拼接，
   * 换图后 URL 变，长缓存立刻失效。
   */
  @Get(':stableKey/icon')
  async icon(
    @Param('stableKey') stableKey: string,
    @Res() response: Response,
  ): Promise<void> {
    const icon = await this.insightService.getMechanismIcon(stableKey);
    response.setHeader('Content-Type', icon.contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.send(icon.data);
  }
}
