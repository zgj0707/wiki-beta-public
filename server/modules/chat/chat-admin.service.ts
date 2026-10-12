import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/**
 * 监控台管理员验证：零用户体系的最小实现。
 *
 * - 密码哈希存平台环境变量 `CHAT_ADMIN_PASSWORD_SHA256`（sha256 hex，64 位）。
 *   未设置 = 管理面关闭（登录接口恒 401，站点其余功能不受影响）。
 * - 验证通过签发 HttpOnly 签名 Cookie（7 天）：`<过期秒>.<HMAC>`，
 *   签名密钥复用该哈希本身 —— 不新增 env、密码轮换即全体下线。
 * - 站点公开面零登录：只有带本 Cookie 的监控台 API 放行。
 */
@Injectable()
export class ChatAdminService {
  private readonly logger = new Logger(ChatAdminService.name);

  static readonly COOKIE_NAME = 'wb_admin_sig';
  static readonly TTL_SECONDS = 7 * 24 * 3600;

  /** 管理面是否已配置（env 未设 = 未启用）。 */
  get enabled(): boolean {
    return Boolean(this.passwordHash());
  }

  /**
   * 校验密码；通过返回 Set-Cookie 值，失败返回 null。
   * 比对全程 timingSafeEqual，不泄露逐字节匹配位置。
   */
  login(password: unknown): string | null {
    if (typeof password !== 'string' || !password) return null;
    const hash = this.passwordHash();
    if (!hash) return null;
    const attempt = sha256Hex(password);
    if (!safeEqualHex(attempt, hash)) return null;
    const exp = Math.floor(Date.now() / 1000) + ChatAdminService.TTL_SECONDS;
    this.logger.log('chat admin login ok');
    return `${ChatAdminService.COOKIE_NAME}=${exp}.${this.sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ChatAdminService.TTL_SECONDS}`;
  }

  /** 校验请求自带的 Cookie 值；有效且未过期返回 true。 */
  verify(cookieValue: string | undefined): boolean {
    if (!cookieValue || !this.passwordHash()) return false;
    const dot = cookieValue.indexOf('.');
    if (dot <= 0) return false;
    const exp = Number(cookieValue.slice(0, dot));
    if (!Number.isInteger(exp) || exp * 1000 <= Date.now()) return false;
    const expected = this.sign(exp);
    const got = cookieValue.slice(dot + 1);
    return /^[0-9a-f]{64}$/.test(got) && safeEqualHex(got, expected);
  }

  /** 注销：返回清 Cookie 的 Set-Cookie 值。 */
  logoutCookie(): string {
    return `${ChatAdminService.COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private sign(exp: number): string {
    return createHmac('sha256', this.passwordHash() ?? '')
      .update(String(exp))
      .digest('hex');
  }

  private passwordHash(): string | null {
    const hash = process.env.CHAT_ADMIN_PASSWORD_SHA256?.trim() ?? '';
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
