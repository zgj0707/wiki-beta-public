import { Injectable, Logger } from '@nestjs/common';

export type AccessTokenResult =
  { token: string; errorCode?: undefined } | { token: null; errorCode: string };

export function isAccessTokenFailure(
  result: AccessTokenResult,
): result is Extract<AccessTokenResult, { token: null }> {
  return result.token === null;
}

/**
 * Shared server-side Feishu credential provider.
 * Prefers a pre-issued FEISHU_TENANT_ACCESS_TOKEN; otherwise exchanges
 * FEISHU_APP_ID / FEISHU_APP_SECRET for a cached tenant token.
 */
@Injectable()
export class FeishuCredentialService {
  private readonly logger = new Logger(FeishuCredentialService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  getAuthDiagnostics(): {
    status: 'configured' | 'not_configured';
    mode: 'tenant_access_token' | 'app_credentials' | 'missing';
  } {
    if (process.env.FEISHU_TENANT_ACCESS_TOKEN?.trim()) {
      return { status: 'configured', mode: 'tenant_access_token' };
    }
    if (
      process.env.FEISHU_APP_ID?.trim() &&
      process.env.FEISHU_APP_SECRET?.trim()
    ) {
      return { status: 'configured', mode: 'app_credentials' };
    }
    return { status: 'not_configured', mode: 'missing' };
  }

  static feishuBaseUrl(): string {
    return (
      process.env.FEISHU_OPENAPI_BASE_URL || 'https://open.feishu.cn'
    ).replace(/\/+$/u, '');
  }

  async getAccessToken(): Promise<AccessTokenResult> {
    const configuredToken = process.env.FEISHU_TENANT_ACCESS_TOKEN?.trim();
    if (configuredToken) return { token: configuredToken };

    const appId = process.env.FEISHU_APP_ID?.trim();
    const appSecret = process.env.FEISHU_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      return { token: null, errorCode: 'FEISHU_AUTH_NOT_CONFIGURED' };
    }
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now())
      return { token: this.cachedToken.value };

    let response: Response;
    try {
      response = await fetch(
        `${FeishuCredentialService.feishuBaseUrl()}/open-apis/auth/v3/tenant_access_token/internal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      this.logger.warn('Feishu token exchange failed due to a network error');
      return { token: null, errorCode: 'FEISHU_TOKEN_EXCHANGE_NETWORK_ERROR' };
    }
    if (!response.ok) {
      this.logger.warn(
        `Feishu token exchange failed with HTTP ${response.status}`,
      );
      return {
        token: null,
        errorCode: `FEISHU_TOKEN_EXCHANGE_HTTP_${response.status}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      this.logger.warn('Feishu token exchange returned invalid JSON');
      return {
        token: null,
        errorCode: 'FEISHU_TOKEN_EXCHANGE_INVALID_RESPONSE',
      };
    }
    if (!payload || typeof payload !== 'object') {
      this.logger.warn(
        'Feishu token exchange returned an invalid response shape',
      );
      return {
        token: null,
        errorCode: 'FEISHU_TOKEN_EXCHANGE_INVALID_RESPONSE',
      };
    }
    const apiCode = (payload as { code?: unknown }).code;
    if (typeof apiCode === 'number' && apiCode !== 0) {
      this.logger.warn(
        `Feishu token exchange rejected with API code ${apiCode}`,
      );
      return { token: null, errorCode: `FEISHU_TOKEN_EXCHANGE_API_${apiCode}` };
    }
    const token = (payload as { tenant_access_token?: unknown })
      .tenant_access_token;
    const expire = (payload as { expire?: unknown }).expire;
    if (typeof token !== 'string' || !token || typeof expire !== 'number') {
      this.logger.warn('Feishu token exchange returned an incomplete response');
      return {
        token: null,
        errorCode: 'FEISHU_TOKEN_EXCHANGE_INVALID_RESPONSE',
      };
    }
    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + Math.max(60, expire - 60) * 1000,
    };
    return { token };
  }
}
