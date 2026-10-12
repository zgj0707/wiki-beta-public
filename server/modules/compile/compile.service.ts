import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import {
  COMPILE_MAX_DOCS,
  COMPILE_MAX_INPUT_TOKENS,
  COMPILE_PROMPT_VERSION,
  type CompileCalibrationView,
  type CompileClaim,
  type CompileClaimType,
  type CompileConfidence,
  type CompileEvidence,
  type CompileJobState,
  type CompilePrepareRequest,
  type CompilePrepareResult,
  type CompileQueueItem,
  type CompileRevision,
  type CompileSaveRequest,
  type CompileSaveResult,
  type CompileSourceRef,
  type CompileSubjectType,
  type CompileUnitDetail,
  type CompileUnitSummary,
  type CompileWorkbenchView,
} from '@shared/ai-compile';

import { buildStructuredSnippet } from '../chat/chat-snippet';
import { APPROVAL_STATUS_PUBLISHED } from '../wiki-beta/publication-policy';
import {
  MENTION_STATUS_ACTIVE,
  PARSE_STATUS_READY,
  entityDocCache,
  entityMention,
  entityRowCache,
} from '../wiki-beta/entity-mention.schema';
import {
  AGGREGATE_SCOPE_LABEL,
  CONFIDENCE_THRESHOLDS,
  DEVIATION_WINDOW,
  aggregateCalibration,
  computeDeviation,
  displayDecisionFor,
  estimateTokens,
  fingerprintOf,
  judgeConfidence,
  nextCharFactor,
  scopeFor,
  type CalibrationSnapshot,
} from './compile-calibration';
import {
  buildCompileMessages,
  CompileParseError,
  parseCompileOutput,
  validateClaims,
  type CompileDocInput,
} from './compile.prompt';
import {
  COMPILE_JOB_DONE,
  COMPILE_JOB_FAILED,
  COMPILE_JOB_PENDING,
  COMPILE_JOB_RUNNING,
  COMPILE_STATUS_DRAFT,
  aiCompileCalibration,
  aiCompileClaim,
  aiCompileEvidence,
  aiCompileJob,
  aiCompileRevision,
  aiCompileUnit,
  type AiCompileUnitRow,
} from './compile.schema';

/** 任务租约：取走后 running，超期未回填视为可重取（断点续跑靠这条）。 */
const LEASE_MINUTES = 10;
/** 队列返回上限。 */
const MAX_QUEUE = 60;
/**
 * 首期只编译「产品」类型（游戏/产品，用户已确认长期只涉及这两类）。
 * 扩展时改这里 + 验证队列规模，不要顺手放开全部类型（成本会失控）。
 */
const SUBJECT_ENTITY_TYPES = ['产品'];
/** 被丢弃 claim 的序位起点：避免与保留条目（0 起递增）抢占同一唯一键。 */
const DROPPED_CLAIM_ORDER_BASE = 1000;

interface SubjectRecord {
  id: string;
  slug: string;
  name: string;
  entityType: string;
}

interface DocHashRow {
  docId: string;
  contentHash: string;
  sourceDate: string | null;
}

interface CompileInput {
  subject: SubjectRecord;
  sources: CompileSourceRef[];
  docs: CompileDocInput[];
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  chars: number;
  /** 关联资料总数（可能是 sources.length 的数倍）。 */
  docCount: number;
  /** 因篇幅上限未送入的篇数。 */
  omitted: number;
  hash: string;
  latestSourceDate: string | null;
}

/**
 * AI 编译层服务：**只做「组装输入 + 校验产物 + 落库」**。
 *
 * 三条不可越界的实现约束：
 * 1. 服务端不调 LLM —— 后端出网被沙箱拦（chat.service 同因）。模型调用由调用方完成，
 *    因此 model 与 usage 必须由调用方回传，服务端只信其中的数字、不信其中的结构。
 * 2. save 必须**重算输入**：不信任 prepare 的返回值，也不信任调用方回传的编号表。
 *    引用白名单的 SSOT 是"服务端此刻算出来的关联资料集"。
 * 3. 校验不过不落半成品：解析失败 / 有效 claim 为 0 → 只把 job 标 failed，不写 unit。
 */
@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ── ① 组装输入 ────────────────────────────────────────────────

  /**
   * 编译输入组装。**确定性**是硬要求：prepare 与 save 两次调用必须得到同一顺序，
   * 否则编号 → docId 的映射会错位（结论会挂到错误的证据上）。
   * 排序键 = source_date DESC（NULL 最后）→ doc_id ASC，且 input_hash 覆盖**全部**
   * 关联资料（不只入选的 12 篇）——任何可能影响选择的变化都会让指纹改变。
   */
  private async buildInput(
    subjectType: CompileSubjectType,
    subjectId: string,
  ): Promise<CompileInput | null> {
    const subject = await this.loadSubject(subjectId);
    if (!subject) return null;

    const hashes = await this.loadDocHashes(subjectId);
    if (!hashes.length) return null;
    const hash = this.hashOf(hashes);

    const picked = hashes.slice(0, COMPILE_MAX_DOCS);
    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        title: entityDocCache.title,
        sourceDate: entityDocCache.sourceDate,
        docLink: entityDocCache.docLink,
        body: entityDocCache.bodyMarkdown,
      })
      .from(entityDocCache)
      .where(
        inArray(
          entityDocCache.docId,
          picked.map((row) => row.docId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.docId, row]));

    const sources: CompileSourceRef[] = [];
    const docs: CompileDocInput[] = [];
    picked.forEach((row, index) => {
      const detail = byId.get(row.docId);
      if (!detail) return;
      const source: CompileSourceRef = {
        index: sources.length + 1,
        docId: row.docId,
        title: detail.title ?? '',
        sourceDate: detail.sourceDate ?? null,
        url: `/article/${row.docId}`,
      };
      sources.push(source);
      docs.push({
        index: source.index,
        docId: source.docId,
        title: source.title,
        sourceDate: source.sourceDate,
        // 复用问答链路的片段构建（大纲 + 主窗口 + 节首/末节选）。
        // 以**主体名**作锚定词。2026-09-18 实测 205 篇关联文档：主体首提及平均
        // 落在正文 3,837 字符处，而正文篇均 11,797 字符；无锚定时主窗口恒自文首
        // 起（keywords=[] / hitIndex=-1），只有 42% 的文章能把主体段带进片段，
        // 实测片段内主体命中率 36.8%——"关联成立但内容被截掉"是结论偏薄的主因。
        // 锚定后主窗口居中于首次提及，关键词同时触发"命中密集节扩容"。
        // 主体名不在正文中时 indexOf 返回 -1，自动退回原文首窗口行为。
        snippet: buildStructuredSnippet(
          detail.body ?? '',
          [subject.name],
          (detail.body ?? '').indexOf(subject.name),
        ),
      });
    });
    if (!sources.length) return null;

    const built = buildCompileMessages(
      { name: subject.name, type: subject.entityType },
      docs,
      hashes.length - sources.length,
    );

    return {
      subject,
      sources,
      docs,
      messages: built.messages,
      chars: built.chars,
      docCount: hashes.length,
      omitted: hashes.length - sources.length,
      hash,
      latestSourceDate: hashes
        .map((row) => row.sourceDate)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    };
  }

  /** 关联资料（轻量：只取指纹列，不读正文）。getUnit 的 stale 判定也走这里。 */
  private async loadDocHashes(subjectId: string): Promise<DocHashRow[]> {
    const mentions = await this.db
      .selectDistinct({ docId: entityMention.docId })
      .from(entityMention)
      .where(
        and(
          eq(entityMention.entityId, subjectId),
          eq(entityMention.status, MENTION_STATUS_ACTIVE),
        ),
      );
    if (!mentions.length) return [];
    const rows = await this.db
      .select({
        docId: entityDocCache.docId,
        contentHash: entityDocCache.contentHash,
        sourceDate: entityDocCache.sourceDate,
      })
      .from(entityDocCache)
      .where(
        and(
          inArray(
            entityDocCache.docId,
            mentions.map((row) => row.docId),
          ),
          eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
          eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
        ),
      );
    return rows.sort(
      (a, b) =>
        (b.sourceDate ?? '').localeCompare(a.sourceDate ?? '') ||
        a.docId.localeCompare(b.docId),
    );
  }

  private async loadSubject(subjectId: string): Promise<SubjectRecord | null> {
    const [row] = await this.db
      .select()
      .from(entityRowCache)
      .where(eq(entityRowCache.baseRecordId, subjectId))
      .limit(1);
    if (!row) return null;
    const raw = (row.row ?? {}) as { type?: string; name?: string };
    return {
      // 实体词典的 slug 就是 Base record_id（feishu-base-entity.service toSummary 口径）。
      id: row.baseRecordId,
      slug: row.baseRecordId,
      name: row.name || raw.name || row.baseRecordId,
      entityType: raw.type ?? '未知',
    };
  }

  /** 指纹覆盖 docId + contentHash + sourceDate：正文、日期、集合任一变化即失效。 */
  private hashOf(rows: DocHashRow[]): string {
    const payload = rows
      .map((row) => `${row.docId}:${row.contentHash}:${row.sourceDate ?? ''}`)
      .sort()
      .join('\n');
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 48);
    return `${digest}|${COMPILE_PROMPT_VERSION}`;
  }

  // ── ② 对外接口 ────────────────────────────────────────────────

  async prepare(payload: CompilePrepareRequest): Promise<CompilePrepareResult> {
    const subjectType = payload.subjectType ?? 'entity';
    const subjectId = String(payload.subjectId ?? '').trim();
    if (!subjectId) throw new BadRequestException('subjectId 不能为空');
    const input = await this.buildInput(subjectType, subjectId);
    if (!input) {
      throw new BadRequestException(
        '该主体没有可用关联资料（需正文 ready 且文章已批准）——无可编译',
      );
    }
    const fingerprint = fingerprintOf(payload.modelFingerprint ?? 'unknown');
    const snapshot = await this.loadCalibration(fingerprint);
    const estimate = estimateTokens(input.chars, snapshot);
    /**
     * 硬顶判定用**中心估计**而非区间上界。
     * 冷启动带宽 ±37.5%，用上界会把正常输入误判为超顶（实测：chars=22544 →
     * center≈29.3k、上界 40.3k，而真实 prompt_tokens 仅约 26k）。区间上界本就是
     * 最坏情况估计，不该充当拒绝条件；真正的越界保护交给网关上下文限制与 max_tokens。
     */
    const centerEstimate = Math.round(input.chars * estimate.factor);
    const overBudget = centerEstimate > COMPILE_MAX_INPUT_TOKENS;

    await this.upsertJob({
      subjectType,
      subjectId,
      slug: input.subject.slug,
      name: input.subject.name,
      inputHash: input.hash,
      state: overBudget ? COMPILE_JOB_FAILED : COMPILE_JOB_RUNNING,
      error: overBudget
        ? `输入超过硬顶 ${COMPILE_MAX_INPUT_TOKENS} tokens（中心估计 ${centerEstimate}，区间 ${estimate.low}–${estimate.high}）`
        : null,
      estLow: estimate.low,
      estHigh: estimate.high,
      requestedBy: fingerprint,
    });

    return {
      subjectType,
      subjectId,
      subjectSlug: input.subject.slug,
      subjectName: input.subject.name,
      inputHash: input.hash,
      promptVersion: COMPILE_PROMPT_VERSION,
      messages: input.messages,
      sources: input.sources,
      docCount: input.docCount,
      usedDocCount: input.sources.length,
      omittedDocCount: input.omitted,
      estTokensLow: estimate.low,
      estTokensHigh: estimate.high,
      calibrationSamples: estimate.samples,
      overBudget,
      inputChars: input.chars,
      modelFingerprint: fingerprint,
    };
  }

  /**
   * 落库。调用方（浏览器 / WorkBuddy 批跑）只回传模型原始输出 + usage，
   * 其余一切由服务端重算与校验。
   */
  async save(payload: CompileSaveRequest): Promise<CompileSaveResult> {
    const subjectType = payload.subjectType ?? 'entity';
    const subjectId = String(payload.subjectId ?? '').trim();
    const fingerprint = fingerprintOf(payload.modelFingerprint ?? '');
    if (!subjectId) return { ok: false, reason: 'subject_id_required' };
    if (!fingerprint) return { ok: false, reason: 'model_fingerprint_required' };
    if (!payload.raw?.trim()) return { ok: false, reason: 'empty_raw' };

    const input = await this.buildInput(subjectType, subjectId);
    if (!input) {
      await this.failJob(subjectType, subjectId, 'no_sources');
      return { ok: false, reason: 'no_sources' };
    }
    if (payload.inputHash !== input.hash) {
      await this.failJob(subjectType, subjectId, 'input_changed');
      return { ok: false, reason: 'input_changed' };
    }

    let parsed;
    try {
      parsed = parseCompileOutput(payload.raw);
    } catch (error) {
      const raw = String(payload.raw ?? '');
      // 截断要单列：它和"格式不对"的处理方式相反（加预算 vs 改 prompt）。
      const truncated = payload.finishReason === 'length';
      const base =
        error instanceof CompileParseError
          ? error.message
          : String(error);
      const reason = `parse_failed: ${
        truncated ? `输出被 max_tokens 截断（${base}）` : base
      }`;
      // 模型原始输出不留档，parse 失败就成了无法在线复现的黑盒。至少把规模、
      // 首尾原文与网关结束原因留下来，下一次失败不必再靠猜。
      const squash = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);
      this.logger.warn(
        `compile parse failed: subject=${subjectId} model=${fingerprint} rawLen=${raw.length} finish=${payload.finishReason ?? 'none'} reason=${reason} head=${squash(raw.slice(0, 200))} tail=${squash(raw.slice(-200))}`,
      );
      await this.failJob(
        subjectType,
        subjectId,
        `${reason}（rawLen=${raw.length}${truncated ? '' : `, finish=${payload.finishReason ?? 'none'}`}）`,
      );
      return { ok: false, reason };
    }

    const { kept, dropped } = validateClaims(parsed.claims, input.sources);
    if (!kept.length) {
      // 关键防线：过滤后无有效结论 → 整个编译失败，不落空卡片。
      await this.failJob(subjectType, subjectId, 'no_valid_claim');
      this.logger.warn(
        `compile save rejected: subject=${subjectId} claims=${parsed.claims.length} dropped=${dropped.length} reason=no_valid_claim`,
      );
      return { ok: false, reason: 'no_valid_claim' };
    }

    const distinctSources = new Set<string>();
    kept.forEach((claim) =>
      claim.sourceDocIds.forEach((docId) => distinctSources.add(docId)),
    );
    // 置信度由代码判定（来源数 + 时效衰减），不采信模型自称。
    const confidence = judgeConfidence(
      distinctSources.size,
      input.latestSourceDate,
    );

    const snapshot = await this.loadCalibration(fingerprint);
    const estimate = estimateTokens(input.chars, snapshot);

    const [existing] = await this.db
      .select({
        id: aiCompileUnit.id,
        headline: aiCompileUnit.headline,
        confidence: aiCompileUnit.confidence,
      })
      .from(aiCompileUnit)
      .where(
        and(
          eq(aiCompileUnit.subjectType, subjectType),
          eq(aiCompileUnit.subjectId, subjectId),
          eq(aiCompileUnit.modelFingerprint, fingerprint),
        ),
      )
      .limit(1);

    const usage = payload.usage ?? {};
    const promptTokens =
      typeof usage.promptTokens === 'number' && usage.promptTokens > 0
        ? Math.round(usage.promptTokens)
        : null;
    const completionTokens =
      typeof usage.completionTokens === 'number' && usage.completionTokens > 0
        ? Math.round(usage.completionTokens)
        : null;

    const baseValues = {
      subjectType,
      subjectId,
      subjectSlug: input.subject.slug,
      subjectName: input.subject.name,
      inputHash: input.hash,
      promptVersion: COMPILE_PROMPT_VERSION,
      modelFingerprint: fingerprint,
      status: COMPILE_STATUS_DRAFT,
      headline: parsed.headline,
      summaryMd: null,
      confidence,
      sourceCount: distinctSources.size,
      sourceSpanStart: input.sources
        .map((source) => source.sourceDate)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
      sourceSpanEnd: input.latestSourceDate,
      gapsJson: parsed.gaps,
      conflictJson: parsed.contradictions,
      estTokensLow: estimate.low,
      estTokensHigh: estimate.high,
      actualPromptTokens: promptTokens,
      actualCompletionTokens: completionTokens,
      generatedAt: new Date(),
      generatedBy: payload.generatedBy?.slice(0, 120) ?? payload.source?.slice(0, 120) ?? null,
    };

    const [unit] = await this.db
      .insert(aiCompileUnit)
      .values({ id: randomUUID(), ...baseValues })
      .onConflictDoUpdate({
        target: [
          aiCompileUnit.subjectType,
          aiCompileUnit.subjectId,
          aiCompileUnit.modelFingerprint,
        ],
        set: {
          subjectSlug: sql`excluded.subject_slug`,
          subjectName: sql`excluded.subject_name`,
          inputHash: sql`excluded.input_hash`,
          promptVersion: sql`excluded.prompt_version`,
          status: sql`excluded.status`,
          headline: sql`excluded.headline`,
          summaryMd: sql`excluded.summary_md`,
          confidence: sql`excluded.confidence`,
          sourceCount: sql`excluded.source_count`,
          sourceSpanStart: sql`excluded.source_span_start`,
          sourceSpanEnd: sql`excluded.source_span_end`,
          gapsJson: sql`excluded.gaps_json`,
          conflictJson: sql`excluded.conflict_json`,
          estTokensLow: sql`excluded.est_tokens_low`,
          estTokensHigh: sql`excluded.est_tokens_high`,
          actualPromptTokens: sql`excluded.actual_prompt_tokens`,
          actualCompletionTokens: sql`excluded.actual_completion_tokens`,
          generatedAt: sql`excluded.generated_at`,
          generatedBy: sql`excluded.generated_by`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: aiCompileUnit.id });

    const unitId = unit?.id;
    if (!unitId) {
      await this.failJob(subjectType, subjectId, 'unit_upsert_failed');
      return { ok: false, reason: 'unit_upsert_failed' };
    }

    // 结论 + 证据：**先 upsert 全集，再删陈旧**。
    // 平台运行时禁用 transaction（异常会被吞成静默 no-op），原子性只能靠这个顺序。
    await this.replaceClaims(unitId, kept, dropped);
    await this.replaceEvidence(unitId, input.sources);
    const revisionNo = await this.appendRevision(unitId, existing, {
      headline: parsed.headline,
      confidence,
      sourceCount: distinctSources.size,
      gaps: parsed.gaps,
      contradictions: parsed.contradictions,
    });

    await this.upsertJob({
      subjectType,
      subjectId,
      slug: input.subject.slug,
      name: input.subject.name,
      inputHash: input.hash,
      state: COMPILE_JOB_DONE,
      error: null,
      estLow: estimate.low,
      estHigh: estimate.high,
      requestedBy: fingerprint,
    });

    if (promptTokens) {
      await this.accumulateCalibration(
        fingerprint,
        input.chars,
        promptTokens,
        completionTokens ?? 0,
      );
    }

    this.logger.log(
      `compile saved: subject=${subjectId} slug=${input.subject.slug} model=${fingerprint} docs=${input.sources.length}/${input.docCount} claims=${kept.length} dropped=${dropped.length} confidence=${confidence} revision=${revisionNo} tokens=${promptTokens ?? '?'}/${completionTokens ?? '?'}`,
    );

    return {
      ok: true,
      unitId,
      headline: parsed.headline,
      confidence,
      claimsKept: kept.length,
      claimsDropped: dropped.length,
      gaps: parsed.gaps,
      revisionNo,
      created: !existing,
      inputHash: input.hash,
    };
  }

  /**
   * 按 slug（= 实体 Base record_id）取结论卡。
   *
   * ⚠️ 刻意**不按 `modelFingerprint` 过滤**（参数保留仅为兼容既有调用方）：
   * 结论是全库共享资产，读者该看到「当前生效的那一份」，不应取决于自己浏览器
   * 里配了什么模型名。曾经按指纹过滤的后果是硬伤：`queue()` 按 subjectId 匹配
   * 单元（不看模型），于是队列显示「已编译」，点进卡片却说「尚未编译」——
   * 同一屏内两处口径自相矛盾。
   * 同一实体被多个模型编译过时取**最新生成**的那份；来源模型由 summary 里的
   * `modelFingerprint` + `generatedAt` 标注给读者。校准统计仍严格按模型分区。
   */
  async getUnit(
    slug: string,
    modelFingerprint?: string,
  ): Promise<CompileUnitDetail | null> {
    void modelFingerprint;
    const key = decodeURIComponent(String(slug ?? '').trim());
    if (!key) return null;
    const [unit] = await this.db
      .select()
      .from(aiCompileUnit)
      .where(eq(aiCompileUnit.subjectSlug, key))
      .orderBy(desc(aiCompileUnit.generatedAt))
      .limit(1);
    if (!unit) return null;

    const [claimRows, evidenceRows, revisionRows, hashes] = await Promise.all([
      this.db
        .select()
        .from(aiCompileClaim)
        .where(eq(aiCompileClaim.unitId, unit.id))
        .orderBy(asc(aiCompileClaim.sortOrder)),
      this.db
        .select()
        .from(aiCompileEvidence)
        .where(eq(aiCompileEvidence.unitId, unit.id)),
      this.db
        .select()
        .from(aiCompileRevision)
        .where(eq(aiCompileRevision.unitId, unit.id))
        .orderBy(desc(aiCompileRevision.revisionNo))
        .limit(20),
      this.loadDocHashes(unit.subjectId),
    ]);

    const stale = !hashes.length || this.hashOf(hashes) !== unit.inputHash;

    return {
      ...this.toSummary(unit, stale),
      summaryMd: unit.summaryMd,
      sourceSpanStart: unit.sourceSpanStart,
      sourceSpanEnd: unit.sourceSpanEnd,
      actualPromptTokens: unit.actualPromptTokens,
      actualCompletionTokens: unit.actualCompletionTokens,
      claims: claimRows
        .filter((row) => !row.dropped)
        .map((row) => this.toClaim(row)),
      evidence: evidenceRows.map(
        (row): CompileEvidence => ({
          docId: row.docId,
          title: row.title ?? '',
          sourceDate: row.sourceDate,
          url: row.url,
          externalUrl: row.externalUrl,
        }),
      ),
      revisions: revisionRows.map(
        (row): CompileRevision => ({
          revisionNo: row.revisionNo,
          changeType: row.changeType,
          changeNote: row.changeNote,
          headline: row.headline,
          confidence: (row.confidence as CompileConfidence | null) ?? null,
          sourceCount: row.sourceCount,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
      contradictions: this.parseContradictions(unit.conflictJson),
    };
  }

  /** 工作台总览：变更史（0 次 LLM 调用）+ 队列 + 校准 + 统计。 */
  async workbench(
    modelFingerprint?: string,
    limit = MAX_QUEUE,
  ): Promise<CompileWorkbenchView> {
    const fingerprint = fingerprintOf(modelFingerprint ?? '');
    const [units, revisionRows, jobRows, queue] = await Promise.all([
      this.db
        .select({
          subjectId: aiCompileUnit.subjectId,
          subjectSlug: aiCompileUnit.subjectSlug,
          subjectType: aiCompileUnit.subjectType,
          inputHash: aiCompileUnit.inputHash,
          promptVersion: aiCompileUnit.promptVersion,
          confidence: aiCompileUnit.confidence,
        })
        .from(aiCompileUnit)
        // 与 queue() 同口径：只统计队列会遍历到的主体（产品类且启用）。
        // 否则一旦存在越界产物（例如脚本直调 prepare 编译了「厂商」类），
        // stats 会报出「有过期产物」，但队列里根本找不到该条目——用户
        // 看到「1 个待重编」却无法重编，属于面板自相矛盾。
        //
        // ⚠️ 也**不再按 modelFingerprint 过滤**：`queue()` 不看模型，若这里看，
        // 就会出现「队列里 20 个 done，统计却说 0 个已编译」的自相矛盾
        // （与 getUnit 同一个坑）。模型的差异只体现在校准面板，那是它该管的事。
        .where(
          and(
            inArray(
              aiCompileUnit.subjectId,
              this.db
                .select({ id: entityRowCache.baseRecordId })
                .from(entityRowCache)
                .where(
                  and(
                    inArray(
                      sql`${entityRowCache.row}->>'type'`,
                      SUBJECT_ENTITY_TYPES,
                    ),
                    eq(entityRowCache.status, '启用'),
                  ),
                ),
            ),
          ),
        ),
      this.db
        .select({
          revisionNo: aiCompileRevision.revisionNo,
          changeType: aiCompileRevision.changeType,
          changeNote: aiCompileRevision.changeNote,
          headline: aiCompileRevision.headline,
          confidence: aiCompileRevision.confidence,
          sourceCount: aiCompileRevision.sourceCount,
          createdAt: aiCompileRevision.createdAt,
          subjectName: aiCompileUnit.subjectName,
          subjectSlug: aiCompileUnit.subjectSlug,
          subjectType: aiCompileUnit.subjectType,
        })
        .from(aiCompileRevision)
        .innerJoin(aiCompileUnit, eq(aiCompileRevision.unitId, aiCompileUnit.id))
        .orderBy(desc(aiCompileRevision.createdAt))
        .limit(30),
      this.db.select().from(aiCompileJob),
      this.queue(limit),
    ]);

    const jobBySubject = new Map(
      jobRows.map((row) => [`${row.subjectType}:${row.subjectId}`, row]),
    );
    const staleUnits = units.filter((unit) => {
      const job = jobBySubject.get(`${unit.subjectType}:${unit.subjectId}`);
      return (
        unit.promptVersion !== COMPILE_PROMPT_VERSION ||
        (job?.inputHash != null && job.inputHash !== unit.inputHash)
      );
    }).length;

    return {
      recentRevisions: revisionRows.map((row) => ({
        revisionNo: row.revisionNo,
        changeType: row.changeType,
        changeNote: row.changeNote,
        headline: row.headline,
        confidence: (row.confidence as CompileConfidence | null) ?? null,
        sourceCount: row.sourceCount,
        createdAt: row.createdAt.toISOString(),
        subjectName: row.subjectName,
        subjectSlug: row.subjectSlug,
        subjectType: row.subjectType as CompileSubjectType,
      })),
      stats: {
        compiledUnits: units.length,
        totalUnits: queue.length,
        pendingJobs: queue.filter((item) => item.state === COMPILE_JOB_PENDING)
          .length,
        failedJobs: queue.filter((item) => item.state === COMPILE_JOB_FAILED)
          .length,
        staleUnits,
      },
      queue,
      calibration: await this.calibration(fingerprint || undefined),
      modelFingerprint: fingerprint,
    };
  }

  /**
   * 待编译队列：产品类实体 × 关联资料数，按资料量倒序（信息量优先）。
   * 已编译且未变更的排在后面（state=done），前端据此折叠。
   */
  async queue(limit = MAX_QUEUE): Promise<CompileQueueItem[]> {
    const entityRows = await this.db
      .select({
        id: entityRowCache.baseRecordId,
        name: entityRowCache.name,
        status: entityRowCache.status,
      })
      .from(entityRowCache)
      .where(
        and(
          inArray(
            sql`${entityRowCache.row}->>'type'`,
            SUBJECT_ENTITY_TYPES,
          ),
          eq(entityRowCache.status, '启用'),
        ),
      );
    if (!entityRows.length) return [];

    const [countRows, jobRows, unitRows] = await Promise.all([
      this.db
        .select({
          entityId: entityMention.entityId,
          docCount: sql<number>`count(distinct ${entityMention.docId})::int`,
        })
        .from(entityMention)
        .innerJoin(entityDocCache, eq(entityMention.docId, entityDocCache.docId))
        .where(
          and(
            eq(entityMention.status, MENTION_STATUS_ACTIVE),
            eq(entityDocCache.parseStatus, PARSE_STATUS_READY),
            eq(entityDocCache.approvalStatus, APPROVAL_STATUS_PUBLISHED),
          ),
        )
        .groupBy(entityMention.entityId),
      this.db.select().from(aiCompileJob),
      this.db
        .select({
          subjectId: aiCompileUnit.subjectId,
          inputHash: aiCompileUnit.inputHash,
          promptVersion: aiCompileUnit.promptVersion,
          // 左栏列表要直接露「结论首句 + 置信度」，否则使用者得逐个点开才知道
          // 哪些值得看——挑主体这一步才是工作台的主要动作。
          headline: aiCompileUnit.headline,
          confidence: aiCompileUnit.confidence,
          sourceCount: aiCompileUnit.sourceCount,
        })
        .from(aiCompileUnit)
        // 同一实体可能被多个模型各编译过一份。这里按生成时间倒序并「首个优先」
        // 建索引，保证队列看到的单元与 getUnit 取到的是**同一份**（都取最新），
        // 否则队列的 stale 判定会对着一份、卡片展示另一份。
        .orderBy(desc(aiCompileUnit.generatedAt)),
    ]);

    const countById = new Map(countRows.map((row) => [row.entityId, row.docCount]));
    const jobById = new Map(
      jobRows.map((row) => [`${row.subjectType}:${row.subjectId}`, row]),
    );
    const unitById = new Map<string, (typeof unitRows)[number]>();
    for (const row of unitRows) {
      if (!unitById.has(row.subjectId)) unitById.set(row.subjectId, row);
    }

    // 不传指纹：预估系数走「全部分区聚合」（队列是跨模型口径的，预估也该是）。
    const snapshot = await this.loadCalibration('');
    const items: CompileQueueItem[] = [];
    for (const entity of entityRows) {
      const docCount = countById.get(entity.id) ?? 0;
      if (docCount <= 0) continue;
      const used = Math.min(docCount, COMPILE_MAX_DOCS);
      // 预估只按篇均片段长度粗算，真实值由 prepare 给出（那里有完整 prompt 文本）。
      const estimate = estimateTokens(used * 1800 + 1200, snapshot);
      const job = jobById.get(`entity:${entity.id}`);
      const unit = unitById.get(entity.id);
      // 产物是否仍与「当前 prompt 版本 + 当前输入指纹」一致。
      const unitFresh =
        unit != null &&
        unit.promptVersion === COMPILE_PROMPT_VERSION &&
        (job?.inputHash == null || job.inputHash === unit.inputHash);
      // ⚠️ 关键：产物过期（prompt 版本升级 / 输入变更）必须重新排队。
      // 早先写成 `unitFresh ? done : job?.state`，会让 stale 单元沿用 job 里上一次的
      // `done` —— 结果升 prompt 版本后旧产物永远不会被刷新，只能靠手工传
      // SUBJECT_IDS 才能重编。只有 `failed` 值得保留（前端要展示失败原因与重试次数），
      // 其余非新鲜状态一律视为待办。
      const state: CompileJobState = unitFresh
        ? COMPILE_JOB_DONE
        : job?.state === COMPILE_JOB_FAILED
          ? COMPILE_JOB_FAILED
          : COMPILE_JOB_PENDING;
      items.push({
        subjectType: 'entity',
        subjectId: entity.id,
        subjectSlug: entity.id,
        subjectName: entity.name ?? entity.id,
        docCount,
        usedDocCount: used,
        state,
        error: job?.error ?? null,
        retryCount: job?.retryCount ?? 0,
        estTokensLow: estimate.low,
        estTokensHigh: estimate.high,
        inputHash: job?.inputHash ?? null,
        // 只在该单元「新鲜」时才把结论露出来：过期产物的 headline 会让左栏
        // 看起来「已经有结论了」，而右侧卡会同时提示「待重编」，自相矛盾。
        headline: unitFresh ? (unit?.headline ?? null) : null,
        confidence: unitFresh
          ? ((unit?.confidence as CompileConfidence | null) ?? null)
          : null,
        sourceCount: unitFresh ? (unit?.sourceCount ?? null) : null,
      });
    }
    // 排序口径：已编译优先 → 组内按「参考篇数」降序；未编译组内仍按资料量降序。
    //
    // ⚠️ 早先写成 `Number(a.state === DONE) - Number(b.state === DONE)`：比较函数返回
    // **正数**表示 a 排在 b 之后，于是结果与意图相反——待编译的挤在最前、已编译的
    // 沉底，工作台默认选中项还因此落在「尚未编译」的主体上（右栏一打开就是空状态）。
    const isDone = (item: CompileQueueItem) => item.state === COMPILE_JOB_DONE;
    // 「参考篇数」= 产物实际引用的去重来源数（sourceCount）。它和 docCount（候选资料数）
    // 不是一回事：一篇资料可能只贡献了背景、没进任何结论。历史产物缺 sourceCount 时
    // 退化成 docCount，避免排到组尾。
    const refCount = (item: CompileQueueItem) => item.sourceCount ?? item.docCount;
    return items
      .sort((a, b) => {
        if (isDone(a) !== isDone(b)) return isDone(a) ? -1 : 1;
        return isDone(a) ? refCount(b) - refCount(a) : b.docCount - a.docCount;
      })
      .slice(0, limit);
  }

  /** 校准视图：偏差过大即隐藏数字（可证伪的降级判据）。 */
  async calibration(
    modelFingerprint?: string,
  ): Promise<CompileCalibrationView> {
    const fingerprint = fingerprintOf(modelFingerprint ?? '');
    // 无指纹 → 聚合全部分区。站内直连编译写入的是 `model:<浏览器模型名>`，
    // 若落读 `model:unknown`，面板的样本数 / 系数 / 累计 token 会恒为死值：
    // 校准这件事在无指纹路径上等于没生效（与 getUnit 不按模型过滤同一个道理）。
    const scope = fingerprint ? scopeFor(fingerprint) : AGGREGATE_SCOPE_LABEL;
    const calibrationRows = fingerprint
      ? await this.db
          .select()
          .from(aiCompileCalibration)
          .where(eq(aiCompileCalibration.scope, scope))
          .limit(1)
      : await this.db.select().from(aiCompileCalibration);
    const aggregated = aggregateCalibration(calibrationRows);

    const samples = await this.db
      .select({
        estLow: aiCompileUnit.estTokensLow,
        estHigh: aiCompileUnit.estTokensHigh,
        actual: aiCompileUnit.actualPromptTokens,
      })
      .from(aiCompileUnit)
      .where(
        and(
          sql`${aiCompileUnit.actualPromptTokens} is not null`,
          fingerprint
            ? eq(aiCompileUnit.modelFingerprint, fingerprint)
            : sql`true`,
        ),
      )
      .orderBy(desc(aiCompileUnit.generatedAt))
      .limit(DEVIATION_WINDOW);

    const deviation = computeDeviation(samples);
    const display = displayDecisionFor(deviation);
    return {
      scope,
      sampleCount: aggregated.sampleCount,
      charFactor: aggregated.charFactor,
      totalChars: aggregated.totalChars,
      totalPromptTokens: aggregated.totalPromptTokens,
      totalCompletionTokens: aggregated.totalCompletionTokens,
      deviationP50: deviation.p50,
      deviationP90: deviation.p90,
      displayMode: display.mode,
      displayModeReason: display.reason,
      deviationSampleCount: deviation.sampleCount,
      updatedAt: aggregated.updatedAt
        ? aggregated.updatedAt.toISOString()
        : null,
      confidenceThresholds: {
        sufficientMinSources: CONFIDENCE_THRESHOLDS.sufficientMinSources,
        thinMinSources: CONFIDENCE_THRESHOLDS.thinMinSources,
        freshDays: CONFIDENCE_THRESHOLDS.freshDays,
        agingDays: CONFIDENCE_THRESHOLDS.agingDays,
      },
    };
  }

  // ── ③ 落库辅助 ────────────────────────────────────────────────

  private toSummary(row: AiCompileUnitRow, stale: boolean): CompileUnitSummary {
    return {
      subjectType: row.subjectType as CompileSubjectType,
      subjectId: row.subjectId,
      subjectSlug: row.subjectSlug,
      subjectName: row.subjectName,
      status: row.status as CompileUnitSummary['status'],
      headline: row.headline,
      confidence: row.confidence as CompileConfidence,
      sourceCount: row.sourceCount,
      gaps: this.parseStringArray(row.gapsJson),
      conflictCount: this.parseContradictions(row.conflictJson).length,
      modelFingerprint: row.modelFingerprint,
      promptVersion: row.promptVersion,
      generatedAt: row.generatedAt.toISOString(),
      generatedBy: row.generatedBy,
      stale,
    };
  }

  private toClaim(row: typeof aiCompileClaim.$inferSelect): CompileClaim {
    return {
      id: row.id,
      text: row.claimText,
      type: row.claimType as CompileClaimType,
      sourceDocIds: this.parseStringArray(row.sourceDocIds),
      sourceQuote: row.sourceQuote,
      sortOrder: row.sortOrder,
      dropped: row.dropped,
      dropReason: row.dropReason,
    };
  }

  /**
   * 结论全量替换。保留下跌到 0 是不可能的（上层已拒绝空结论），
   * 因此这里只需保证「新全集 upsert → 删旧序位」。
   */
  private async replaceClaims(
    unitId: string,
    kept: Array<{
      text: string;
      type: CompileClaimType;
      sourceDocIds: string[];
      sourceQuote: string | null;
      sortOrder: number;
    }>,
    dropped: Array<{ text: string; reason: string }>,
  ): Promise<void> {
    const values = [
      ...kept.map((claim) => ({
        id: randomUUID(),
        unitId,
        claimText: claim.text,
        claimType: claim.type,
        sourceDocIds: claim.sourceDocIds,
        sourceQuote: claim.sourceQuote,
        sortOrder: claim.sortOrder,
        dropped: false,
        dropReason: null as string | null,
      })),
      ...dropped.map((claim, index) => ({
        id: randomUUID(),
        unitId,
        claimText: claim.text,
        claimType: 'fact',
        sourceDocIds: [] as string[],
        sourceQuote: null as string | null,
        sortOrder: DROPPED_CLAIM_ORDER_BASE + index,
        dropped: true,
        dropReason: claim.reason,
      })),
    ];
    await this.db
      .insert(aiCompileClaim)
      .values(values)
      .onConflictDoUpdate({
        target: [aiCompileClaim.unitId, aiCompileClaim.sortOrder],
        set: {
          claimText: sql`excluded.claim_text`,
          claimType: sql`excluded.claim_type`,
          sourceDocIds: sql`excluded.source_doc_ids`,
          sourceQuote: sql`excluded.source_quote`,
          dropped: sql`excluded.dropped`,
          dropReason: sql`excluded.drop_reason`,
          updatedAt: sql`now()`,
        },
      });
    await this.db.delete(aiCompileClaim).where(
      and(
        eq(aiCompileClaim.unitId, unitId),
        notInArray(
          aiCompileClaim.sortOrder,
          values.map((value) => value.sortOrder),
        ),
      ),
    );
  }

  private async replaceEvidence(
    unitId: string,
    sources: CompileSourceRef[],
  ): Promise<void> {
    if (!sources.length) return;
    const values = sources.map((source) => ({
      id: randomUUID(),
      unitId,
      docId: source.docId,
      title: source.title,
      sourceDate: source.sourceDate,
      url: source.url,
      externalUrl: null as string | null,
    }));
    await this.db
      .insert(aiCompileEvidence)
      .values(values)
      .onConflictDoUpdate({
        target: [aiCompileEvidence.unitId, aiCompileEvidence.docId],
        set: {
          title: sql`excluded.title`,
          sourceDate: sql`excluded.source_date`,
          url: sql`excluded.url`,
          externalUrl: sql`excluded.external_url`,
          updatedAt: sql`now()`,
        },
      });
    await this.db.delete(aiCompileEvidence).where(
      and(
        eq(aiCompileEvidence.unitId, unitId),
        notInArray(
          aiCompileEvidence.docId,
          values.map((value) => value.docId),
        ),
      ),
    );
  }

  private async appendRevision(
    unitId: string,
    existing: { headline: string; confidence: string } | undefined,
    next: {
      headline: string;
      confidence: CompileConfidence;
      sourceCount: number;
      gaps: string[];
      contradictions: Array<{ a: string; b: string; note: string }>;
    },
  ): Promise<number> {
    const [prev] = await this.db
      .select({
        maxNo: sql<number>`coalesce(max(${aiCompileRevision.revisionNo}), 0)::int`,
      })
      .from(aiCompileRevision)
      .where(eq(aiCompileRevision.unitId, unitId));
    const revisionNo = (prev?.maxNo ?? 0) + 1;
    const changeType = !existing
      ? 'created'
      : existing.headline === next.headline
        ? existing.confidence === next.confidence
          ? 'unchanged_recompiled'
          : 'confidence_changed'
        : 'headline_changed';
    await this.db.insert(aiCompileRevision).values({
      id: randomUUID(),
      unitId,
      revisionNo,
      changeType,
      changeNote: null,
      diffJson: {
        previousHeadline: existing?.headline ?? null,
        previousConfidence: existing?.confidence ?? null,
        gaps: next.gaps,
        contradictions: next.contradictions.length,
      },
      headline: next.headline,
      confidence: next.confidence,
      sourceCount: next.sourceCount,
    });
    return revisionNo;
  }

  private async upsertJob(input: {
    subjectType: CompileSubjectType;
    subjectId: string;
    slug: string;
    name: string;
    inputHash: string;
    state: CompileJobState;
    error: string | null;
    estLow: number;
    estHigh: number;
    requestedBy: string;
  }): Promise<void> {
    const leaseUntil =
      input.state === COMPILE_JOB_RUNNING
        ? new Date(Date.now() + LEASE_MINUTES * 60_000)
        : null;
    await this.db
      .insert(aiCompileJob)
      .values({
        id: randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectSlug: input.slug,
        subjectName: input.name,
        inputHash: input.inputHash,
        state: input.state,
        leaseUntil,
        retryCount: 0,
        error: input.error,
        batchId: null,
        requestedBy: input.requestedBy,
        estTokensLow: input.estLow,
        estTokensHigh: input.estHigh,
      })
      .onConflictDoUpdate({
        target: [aiCompileJob.subjectType, aiCompileJob.subjectId],
        set: {
          subjectSlug: sql`excluded.subject_slug`,
          subjectName: sql`excluded.subject_name`,
          inputHash: sql`excluded.input_hash`,
          state: sql`excluded.state`,
          leaseUntil: sql`excluded.lease_until`,
          // 失败重试计数只在从 failed 再次进入时累加。
          retryCount:
            input.state === COMPILE_JOB_RUNNING
              ? sql`${aiCompileJob.retryCount} + 1`
              : sql`${aiCompileJob.retryCount}`,
          error: sql`excluded.error`,
          estTokensLow: sql`excluded.est_tokens_low`,
          estTokensHigh: sql`excluded.est_tokens_high`,
          updatedAt: sql`now()`,
        },
      });
  }

  private async failJob(
    subjectType: CompileSubjectType,
    subjectId: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .update(aiCompileJob)
      .set({
        state: COMPILE_JOB_FAILED,
        error: reason.slice(0, 500),
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiCompileJob.subjectType, subjectType),
          eq(aiCompileJob.subjectId, subjectId),
        ),
      );
  }

  /**
   * 读校准快照（预估系数用）。
   *
   * 有指纹 → 严格读该模型分区；无指纹 → **聚合全部分区**。
   * ⚠️ 不能无指纹时就落读 `model:unknown`：站内直连编译写入的是
   * `model:<浏览器模型名>`，那样预估会永远用冷启动系数 1.3，实测校准白跑。
   */
  private async loadCalibration(
    fingerprint: string,
  ): Promise<CalibrationSnapshot> {
    if (fingerprint) {
      const [row] = await this.db
        .select({
          sampleCount: aiCompileCalibration.sampleCount,
          charFactor: aiCompileCalibration.charFactor,
        })
        .from(aiCompileCalibration)
        .where(eq(aiCompileCalibration.scope, scopeFor(fingerprint)))
        .limit(1);
      return {
        sampleCount: row?.sampleCount ?? 0,
        charFactor: row?.charFactor ? Number(row.charFactor) : null,
      };
    }
    const rows = await this.db.select().from(aiCompileCalibration);
    const aggregated = aggregateCalibration(rows);
    return {
      sampleCount: aggregated.sampleCount,
      charFactor: aggregated.charFactor,
    };
  }

  /** 实测用量回填校准（**唯一**数据源是网关 usage，不接受估算值）。 */
  private async accumulateCalibration(
    fingerprint: string,
    chars: number,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    const scope = scopeFor(fingerprint);
    const previous = await this.loadCalibration(fingerprint);
    const factor = nextCharFactor(
      previous.charFactor,
      chars,
      promptTokens,
      previous.sampleCount,
    );
    await this.db
      .insert(aiCompileCalibration)
      .values({
        scope,
        sampleCount: 1,
        totalChars: chars,
        totalPromptTokens: promptTokens,
        totalCompletionTokens: completionTokens,
        charFactor: factor == null ? null : factor.toFixed(6),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: aiCompileCalibration.scope,
        set: {
          sampleCount: sql`${aiCompileCalibration.sampleCount} + 1`,
          totalChars: sql`${aiCompileCalibration.totalChars} + ${chars}`,
          totalPromptTokens: sql`${aiCompileCalibration.totalPromptTokens} + ${promptTokens}`,
          totalCompletionTokens: sql`${aiCompileCalibration.totalCompletionTokens} + ${completionTokens}`,
          charFactor: factor == null ? null : factor.toFixed(6),
          updatedAt: sql`now()`,
        },
      });
  }

  /** 首期不产出长综述（卡片直接渲染结论条目），保留列位为后续扩展。 */

  private parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private parseContradictions(
    value: unknown,
  ): Array<{ a: string; b: string; note: string }> {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is { a: string; b: string; note?: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as { a?: unknown }).a === 'string' &&
          typeof (item as { b?: unknown }).b === 'string',
      )
      .map((item) => ({ a: item.a, b: item.b, note: item.note ?? '' }));
  }
}
