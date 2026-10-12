import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { QuickToolsService } from './quick-tools.service';

/**
 * 便捷工具接口：前端顶栏「便捷工具」页签 + /labs 右栏的数据源。
 * 列表走 /api（受平台 CSRF 中间件约束，前端 fetch 会带 x-suda-csrf-token 头）。
 */
@Controller('api/quick-tools')
export class QuickToolsController {
  constructor(private readonly quickTools: QuickToolsService) {}

  @Get()
  async list() {
    return { tools: await this.quickTools.listTools() };
  }

  /**
   * 附件 HTML 字节（labs Demo/评测页等），按 Base record_id 精确命中。
   *
   * 🔴 必须挂在 /api 下、且只能由 SPA fetch（带 x-suda-csrf-token 头）访问，
   * 不能做 <a> 顶导航直开：
   *   - `/api/*` 受平台 CSRF 中间件约束（校验自定义请求头），<a> 导航带不了
   *     自定义头，必然 403；
   *   - `/media/*` 也走不通：平台静态路由层会把顶导航型 /media/* 请求直接
   *     转交对象存储（TOS NoSuchKey，请求从未到达 Node，2026-10-08 实测——
   *     先后用中文名称与 record_id 两种路径段均复现；<img> 子资源请求例外，
   *     所以文章封面/机制图标的 /media 代理能正常显示）。
 * 因此前端统一走「点击手势内 window.open 空白窗 → fetch 本端点 →
 * Blob → location.replace」通道（client/src/api/quick-tools.ts openQuickTool）。
   *
   * 🔴 路径段用 Base record_id（纯 ASCII、稳定不可变），不用工具名称。
   */
  @Get('attachment/:recordId')
  async attachment(
    @Param('recordId') recordId: string,
    @Res() response: Response,
  ): Promise<void> {
    const decoded = decodeURIComponent(recordId);
    const file = await this.quickTools.loadAttachment(decoded);
    if (!file) throw new NotFoundException('Quick tool attachment not found');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.send(file.data);
  }
}
