import { Injectable, Logger } from '@nestjs/common';

import { FeishuBaseReader } from '../wiki-beta/feishu-base-reader.service';
import type { ResolvedLlmConfig } from './chat-llm.provider';

/**
 * 站点默认 LLM 配置（Base「AI 配置」表承载）。
 *
 * 管理面：改模型/换 Key = 编辑 Base 表（表权限即管理权限），约 10s 内生效。
 * 安全铁规：apiKey 仅在服务端内存流转 —— 不进任何 API 响应体、不打日志、不落库。
 *
 * 降级链：Base 读失败 / 无启用行 / 配置不完整 → resolve() 返回 null，
 * 调用方（ChatLlmProvider）继续落环境变量兜底，行为与历史版本一致。
 */
@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  /**
   * 短缓存：「即时更改」与「每次请求都打 Base API」的折中——
   * 管理端改配置最迟 ~10s 生效，同时避免每个问答请求都多一段 2-3s 的 Base 飞行。
   */
  private static readonly CACHE_TTL_MS = 10_000;

  private cache: {
    at: number;
    config: ResolvedLlmConfig | null;
  } | null = null;
  private inflight: Promise<ResolvedLlmConfig | null> | null = null;

  constructor(private readonly baseReader: FeishuBaseReader) {}

  /** 当前启用的默认配置；不可用时返回 null（调用方自行落回环境变量）。 */
  async resolve(): Promise<ResolvedLlmConfig | null> {
    if (this.cache && Date.now() - this.cache.at < AiConfigService.CACHE_TTL_MS) {
      return this.cache.config;
    }
    if (!this.inflight) {
      this.inflight = this.load().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async load(): Promise<ResolvedLlmConfig | null> {
    let resolved: ResolvedLlmConfig | null = null;
    try {
      const rows = await this.baseReader.listAiConfigRows();
      const row = rows[0] ?? null;
      if (row) {
        resolved = {
          baseUrl: row.baseUrl,
          model: row.model,
          apiKey: row.apiKey,
        };
        // 只记模型与主机名，绝不含 apiKey。
        this.logger.log(
          `ai default config loaded: model=${row.model} host=${safeHost(row.baseUrl)} (source=Base)`,
        );
      }
    } catch (error) {
      // 读失败降级为 null（落环境变量），但要让运维看得见原因。
      this.logger.warn(
        `ai default config read failed, fallback to env: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.cache = { at: Date.now(), config: resolved };
    return resolved;
  }
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '(invalid-url)';
  }
}
