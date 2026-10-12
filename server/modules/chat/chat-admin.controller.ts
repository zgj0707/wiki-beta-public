import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Put,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

import { ChatAdminService } from './chat-admin.service';
import type { ChatIpUsageItem } from './chat-ip-usage.service';
import { ChatIpUsageService } from './chat-ip-usage.service';

const LOGIN_RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const IP_PATTERN = /^[A-Za-z0-9:.]{1,64}$/;
/** 归账日格式（Asia/Shanghai 日界，应用侧生成）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 监控台管理接口（/admin/ai-usage 页面的后端）。
 *
 * 验证模型：环境变量存密码哈希（CHAT_ADMIN_PASSWORD_SHA256），登录签
 * HttpOnly 签名 Cookie；除 login 外全部接口先过 requireAdmin。
 * 站点公开面零登录 —— 本控制器是唯一带验证的管理面。
 */
@Controller('api/chat-admin')
export class ChatAdminController {
  /** 登录尝试桶（防爆破）：ip -> 时间戳列表。 */
  private readonly loginBuckets = new Map<string, number[]>();
  private readonly logger = new Logger(ChatAdminController.name);

  constructor(
    private readonly admin: ChatAdminService,
    private readonly ipUsage: ChatIpUsageService,
  ) {}

  /** 管理面状态（登录框据此显示/隐藏）。 */
  @Get('status')
  status(@Res() res: Response): void {
    res.json({ enabled: this.admin.enabled });
  }

  /** 登录：密码哈希比对通过签 7 天 HttpOnly Cookie。 */
  @Post('login')
  login(@Body() body: unknown, @Res() res: Response): void {
    const ip = this.resolveIp(res);
    if (!this.admin.enabled) {
      throw new UnauthorizedException('管理面未启用');
    }
    this.consumeLoginQuota(ip);
    const password = (body as { password?: unknown } | null)?.password;
    const cookie = this.admin.login(password);
    if (!cookie) {
      this.logger.warn(`chat admin login failed (ip=${ip})`);
      throw new UnauthorizedException('密码错误');
    }
    res.setHeader('Set-Cookie', cookie);
    res.json({ ok: true });
  }

  /** 注销：清 Cookie。 */
  @Post('logout')
  logout(@Res() res: Response): void {
    res.setHeader('Set-Cookie', this.admin.logoutCookie());
    res.json({ ok: true });
  }

  /** 按 IP 用量列表（最近活跃在前）。 */
  @Get('usage')
  async usage(@Res() res: Response): Promise<void> {
    this.requireAdmin(res);
    const items: ChatIpUsageItem[] = await this.ipUsage.list();
    res.json({ items });
  }

  /** 行内备注编辑；ip 不存在返回 404（提示刷新）。 */
  @Put('usage/note')
  async updateNote(
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(res);
    const { ip, note } = (body ?? {}) as { ip?: unknown; note?: unknown };
    if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
      throw new BadRequestException('ip 格式非法');
    }
    if (note !== null && note !== undefined && typeof note !== 'string') {
      throw new BadRequestException('note 必须是字符串或 null');
    }
    const noteValue = typeof note === 'string' ? note : null;
    const ok = await this.ipUsage.updateNote(ip, noteValue);
    if (!ok) {
      res.status(404).json({ ok: false, message: '该 IP 无用量记录，请刷新' });
      return;
    }
    res.json({ ok: true });
  }

  /**
   * 日限额白名单开关（迁移 035）。行不存在时服务端补零用量行 ——
   * 可对尚未提问的 IP 预设豁免，因此不返回 404。
   */
  @Put('usage/whitelist')
  async setWhitelisted(
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(res);
    const { ip, whitelisted } = (body ?? {}) as {
      ip?: unknown;
      whitelisted?: unknown;
    };
    if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
      throw new BadRequestException('ip 格式非法');
    }
    if (typeof whitelisted !== 'boolean') {
      throw new BadRequestException('whitelisted 必须是布尔值');
    }
    const ok = await this.ipUsage.setWhitelisted(ip, whitelisted);
    if (!ok) {
      res.status(500).json({ ok: false, message: '保存失败，请重试' });
      return;
    }
    res.json({ ok: true });
  }

  /**
   * 单 IP 日限额覆盖（迁移 035 `daily_limit_override`）。
   * limit=null 恢复跟随全局默认（CHAT_DAILY_LIMIT，现为 500）；行不存在时补零用量行。
   */
  @Put('usage/limit')
  async setDailyLimit(
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(res);
    const { ip, limit } = (body ?? {}) as { ip?: unknown; limit?: unknown };
    if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
      throw new BadRequestException('ip 格式非法');
    }
    let value: number | null = null;
    if (limit !== null && limit !== undefined) {
      if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1_000_000
      ) {
        throw new BadRequestException('limit 必须是 1..1000000 的整数或 null');
      }
      value = limit;
    }
    const ok = await this.ipUsage.setDailyLimitOverride(ip, value);
    if (!ok) {
      res.status(500).json({ ok: false, message: '保存失败，请重试' });
      return;
    }
    res.json({ ok: true });
  }

  /** 日榜：某归账日（默认今天，Asia/Shanghai）的按 IP 用量，次数降序。 */
  @Get('usage/daily')
  async usageDaily(
    @Query('date') date: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    this.requireAdmin(res);
    if (date !== undefined && !DATE_PATTERN.test(date)) {
      throw new BadRequestException('date 格式应为 YYYY-MM-DD');
    }
    const items = await this.ipUsage.listDaily(date);
    res.json({ items });
  }

  /** 除 login 外全部接口的门禁。 */
  private requireAdmin(res: Response): void {
    const cookie = this.parseCookie(res, ChatAdminService.COOKIE_NAME);
    if (!this.admin.verify(cookie)) {
      throw new UnauthorizedException('需要管理员登录');
    }
  }

  private parseCookie(res: Response, name: string): string | undefined {
    const raw = res.req?.headers?.cookie;
    if (!raw) return undefined;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq).trim() === name) {
        return part.slice(eq + 1).trim();
      }
    }
    return undefined;
  }

  /** 登录限流：每 IP 每分钟 5 次（防爆破）。 */
  private consumeLoginQuota(ip: string): void {
    const now = Date.now();
    const bucket = (this.loginBuckets.get(ip) ?? []).filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (bucket.length >= LOGIN_RATE_LIMIT_MAX) {
      throw new BadRequestException('尝试太频繁，请稍后再试');
    }
    bucket.push(now);
    this.loginBuckets.set(ip, bucket);
    if (this.loginBuckets.size > 1000) {
      for (const [key, stamps] of this.loginBuckets) {
        if (!stamps.some((ts) => now - ts < RATE_LIMIT_WINDOW_MS)) {
          this.loginBuckets.delete(key);
        }
      }
    }
  }

  private resolveIp(res: Response): string {
    return res.req?.socket?.remoteAddress || 'unknown';
  }
}
