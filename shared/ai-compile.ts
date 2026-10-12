/**
 * AI 编译层共享契约（前端 `/ai` 页签 ↔ 后端 CompileModule）。
 *
 * 核心边界（与 docs/ai-compile-layer-plan.md 一致）：
 * - **LLM 不在服务端**：后端出网被沙箱拦。服务端只做「组装输入 + 校验产物 + 落库」，
 *   模型调用由调用方完成（浏览器 BYO-Key 直连 / WorkBuddy 批跑）。因此模型名与
 *   usage 必须由调用方回传，服务端不信任其中的结构、只信任其中的数字。
 * - **引用白名单由代码校验**：模型输出里的来源引用一律用 **1-based 编号**（短、稳定、
 *   模型不易出错），服务端按 prepare 时确定的编号表映射回 docId；越界编号 → 整条
 *   claim 丢弃并留痕。编号表由服务端按确定性排序生成，prepare / save 两次调用一致。
 */

/** prompt 版本：改动即视为过期（不自动重编，避免成本失控）。 */
/**
 * 提示词 / 输入组装版本号。
 * ⚠️ 改 `COMPILE_PROMPT_VERSION` 会让已落库单元的 promptVersion 不匹配 → 自动
 * 进入 stale 状态并排队重编（见 compile.service 的 stale 判定）。凡是动了
 * buildInput / prompt 文案 / 片段构建逻辑，**必须**同步升版本号，否则旧产物会被
 * 误判为"仍然有效"。
 * 变更史：c1 初版；c2 输入片段改为以主体名锚定（原先无锚定、主窗口恒自文首起）。
 */
export const COMPILE_PROMPT_VERSION = 'c2';

/** 接口前缀（前端走 withClientBasePath 拼接）。 */
export const COMPILE_API_BASE = '/api/compile';

/**
 * 单实体送入 prompt 的文章上限。超出部分不静默丢弃 —— 记入 gaps 明示覆盖率。
 * 12 篇 × 约 1800 字 ≈ 2.2 万字 ≈ 2.4 万 token（按实测系数滚动校准）。
 */
export const COMPILE_MAX_DOCS = 12;

/** 单实体输入 token 硬顶：超过则拒绝发起（L3 层"发请求前预检拒绝"）。 */
export const COMPILE_MAX_INPUT_TOKENS = 32_000;

/**
 * 编译输出的 max_tokens。输出是 JSON 不是长文，但**思考型模型会把预算先花在
 * 思考内容上**（正文 content 为空、finish_reason=length = 预算被吃光），
 * 2000 上限在这种模型上会稳定失败，故留足余量。
 *
 * 4096 → 8192 的依据（09-18 实测，不是预估）：prompt 要求 claims 1–8 条，而
 * 模型**一律顶格给满 8 条**（21/21 份产物全是 8 条），输出规模因此恒定在高位；
 * 唯一带实测 usage 的产物（生存33天）输出了 3056 tokens = 原上限的 74.6%，
 * **余量只剩 25%** —— quote 写长一点或 contradictions 多几条就会撞上限，截断后
 * JSON 不完整，整个编译作废（用户已实际踩到一次）。这是上限不是目标值，正常
 * 输出（~3000）的消耗不会因此变化，只在原本会失败的场景多花。
 */
export const COMPILE_MAX_OUTPUT_TOKENS = 8_192;

/**
 * 网关不接受上面这个值时的回退上限。
 *
 * 各网关对 max_tokens 的上限不一致，传超限值可能被整体拒绝（400），比截断更糟。
 * 调用侧探测到「因 max_tokens 被拒」时自动用本值重试一次，行为等价于改动前。
 */
export const COMPILE_MAX_OUTPUT_TOKENS_FALLBACK = 4_096;

/** 单批任务数上限（批跑脚本用）。 */
export const COMPILE_MAX_BATCH_SIZE = 20;

export type CompileSubjectType = 'entity' | 'mechanism';
export type CompileStatus = 'draft' | 'published' | 'rejected' | 'stale';
export type CompileConfidence = 'high' | 'medium' | 'low';
export type CompileClaimType = 'fact' | 'judgment' | 'metric';
export type CompileJobState = 'pending' | 'running' | 'done' | 'failed';

/** prepare 时确定的编号 → 文献映射。编号 1-based，与 prompt 中的 `[n]` 一致。 */
export interface CompileSourceRef {
  index: number;
  docId: string;
  title: string;
  sourceDate: string | null;
  /** 站内路由 `/article/:docId`。 */
  url: string;
}

/** 模型应输出的 JSON 形态（服务端解析目标，非信任边界）。 */
export interface CompileLlmOutput {
  headline?: unknown;
  claims?: unknown;
  gaps?: unknown;
  contradictions?: unknown;
}

export interface CompileClaim {
  id: string;
  text: string;
  type: CompileClaimType;
  sourceDocIds: string[];
  sourceQuote: string | null;
  sortOrder: number;
  dropped: boolean;
  dropReason: string | null;
}

export interface CompileEvidence {
  docId: string;
  title: string;
  sourceDate: string | null;
  url: string;
  externalUrl: string | null;
}

export interface CompileRevision {
  revisionNo: number;
  changeType: string;
  changeNote: string | null;
  headline: string | null;
  confidence: CompileConfidence | null;
  sourceCount: number | null;
  createdAt: string;
}

export interface CompileUnitSummary {
  subjectType: CompileSubjectType;
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
  status: CompileStatus;
  headline: string;
  confidence: CompileConfidence;
  sourceCount: number;
  gaps: string[];
  /** 代码判定冲突标记：服务端产出 contradictions 非空。 */
  conflictCount: number;
  modelFingerprint: string;
  promptVersion: string;
  generatedAt: string;
  generatedBy: string | null;
  /** 当前输入指纹是否已过期（正文变更 / prompt 改版）。 */
  stale: boolean;
}

export interface CompileUnitDetail extends CompileUnitSummary {
  summaryMd: string | null;
  sourceSpanStart: string | null;
  sourceSpanEnd: string | null;
  actualPromptTokens: number | null;
  actualCompletionTokens: number | null;
  claims: CompileClaim[];
  evidence: CompileEvidence[];
  revisions: CompileRevision[];
  contradictions: Array<{ a: string; b: string; note: string }>;
}

/** 队列项：待编译主体 + 预估消耗（区间，不给单点）。 */
export interface CompileQueueItem {
  subjectType: CompileSubjectType;
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
  docCount: number;
  /** 被送入 prompt 的篇数（docCount 可能更大，超出部分记入 gaps）。 */
  usedDocCount: number;
  /** 待编译 / 失败重试 / 编译中。 */
  state: CompileJobState;
  error: string | null;
  retryCount: number;
  estTokensLow: number | null;
  estTokensHigh: number | null;
  inputHash: string | null;
  /** 已编译产物的结论首句（未编译为 null）——左栏直接露结论，省一次点击。 */
  headline: string | null;
  confidence: CompileConfidence | null;
  /** 产物**实际引用**的来源篇数（与 docCount 不同：后者是候选资料数）。 */
  sourceCount: number | null;
}

export interface CompilePrepareRequest {
  subjectType?: CompileSubjectType;
  subjectId: string;
  /** 调用方模型标识：决定读哪一份校准系数（不同 tokenizer 不可混算）。 */
  modelFingerprint?: string;
}

/**
 * prepare 返回：调用方拿着 messages 去调 LLM，回来后原样回传
 * `subjectType/subjectId/modelFingerprint`。
 * **sources 不下发给模型**，但必须回传给 save 用于编号映射校验 ——
 * 这是"引用由代码验证"的落地方式。
 */
export interface CompilePrepareResult {
  subjectType: CompileSubjectType;
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
  inputHash: string;
  promptVersion: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  sources: CompileSourceRef[];
  /** 关联文章总数（sources.length 可能少于它，差额即未送入篇数）。 */
  docCount: number;
  usedDocCount: number;
  /** 被截掉未送入的文章数（>0 时 prompt 内已明示）。 */
  omittedDocCount: number;
  estTokensLow: number;
  estTokensHigh: number;
  /** 校准样本数：<5 时区间已放宽 1.5 倍。 */
  calibrationSamples: number;
  /** true = 输入超过硬顶，调用方应放弃本次编译。 */
  overBudget: boolean;
  inputChars: number;
  modelFingerprint: string;
}

export interface CompileSaveRequest {
  subjectType?: CompileSubjectType;
  subjectId: string;
  /**
   * prepare 返回的输入指纹，**必填**。
   * save 时服务端重算指纹，不一致即拒绝（reason='input_changed'）。
   * 这不是可选的礼貌校验 —— 编号→docId 的映射依赖资料顺序，指纹不一致时编号
   * 可能已指向另一篇文章，静默接受会把结论挂到错误证据上。
   */
  inputHash: string;
  /** 调用方模型标识：不同模型产物并存互不覆盖。 */
  modelFingerprint: string;
  /** 模型原始输出（字符串，允许包裹 ```json 围栏）。服务端负责解析与校验。 */
  raw: string;
  /** 实测用量（网关 usage）。⚠️ 校准表唯一数据源，缺失则本次不计入校准。 */
  usage?: { promptTokens?: number; completionTokens?: number };
  /**
   * 网关给的结束原因（`length` = 输出撞上 max_tokens 被截断）。
   *
   * 服务端**不采信**它做业务判断，只用于失败诊断：parse 失败时"预算不够"与
   * "格式不对"的处理方式完全不同（前者加预算，后者改 prompt），而模型输出
   * 不留档，事后无法区分。此前调用侧拿了却不传，等于把唯一的判据丢掉了。
   */
  finishReason?: string | null;
  generatedBy?: string;
  /** 调用方 ID（浏览器用户 / 'workbuddy-batch'）。 */
  source?: string;
  batchId?: string;
  /** parse 失败或校验不通过时的调用侧备注（可选）。 */
  note?: string;
}

export interface CompileSaveResult {
  ok: boolean;
  /** 拒绝原因（ok=false 时）。 */
  reason?: string;
  unitId?: string;
  headline?: string;
  confidence?: CompileConfidence;
  claimsKept?: number;
  claimsDropped?: number;
  gaps?: string[];
  revisionNo?: number;
  /** 本次是否新建（false = 覆盖已有产物）。 */
  created?: boolean;
  /** 服务端**重算**的输入指纹（用于核对是否与 prepare 一致）。 */
  inputHash?: string;
}

/** 校准视图：给出可证伪的判据，偏差过大时隐藏数字。 */
export interface CompileCalibrationView {
  scope: string;
  sampleCount: number;
  charFactor: number | null;
  totalChars: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /** 实测/预估偏差分位数（null = 样本不足）。 */
  deviationP50: number | null;
  deviationP90: number | null;
  /** `number` = 显示数字；`band` = 只显示低/中/高档（样本不足或 P90 超阈值时降级）。 */
  displayMode: 'number' | 'band';
  /**
   * 降级原因（`displayMode === 'band'` 时非 null）。给面板用来说明「为什么只给档位」——
   * 只说「样本不足」会让拿到 3 条样本的人困惑，得讲清是「条数不够」还是「偏差太大」。
   */
  displayModeReason: 'no-samples' | 'too-few-samples' | 'too-deviated' | null;
  /**
   * 参与偏差比对的产物条数（= 有真实用量的不同产物数）。
   *
   * ⚠️ 与 `sampleCount` 不是一回事：`sampleCount` 是校准表里 EMA 的**累积更新次数**，
   * 同一主体重复编译会重复计数；这里是**实际参与比对的产物条数**。面板必须用这个
   * 展示「实测样本」——否则会出现「样本 8 次」旁边写着「不足 5 次」的自相矛盾。
   */
  deviationSampleCount: number;
  updatedAt: string | null;
  /** 置信度阈值（代码判定用），随样本回调。判据为「证据充分度 × 时效」二维。 */
  confidenceThresholds: {
    /** 独立来源数 ≥ 此值 → 证据充分。 */
    sufficientMinSources: number;
    /** 独立来源数 ≥ 此值 → 证据偏薄，否则薄弱。 */
    thinMinSources: number;
    /** 最新来源距今 ≤ 此天数 → 新鲜。 */
    freshDays: number;
    /** 最新来源距今 ≤ 此天数 → 渐旧，超出即陈旧（降 low）。 */
    agingDays: number;
  };
}

/** 工作台总览：本周结论变化（0 次 LLM 调用）。 */
export interface CompileWorkbenchView {
  /** 最近变更（含 headline 快照，无需 join）。 */
  recentRevisions: Array<
    CompileRevision & {
      subjectName: string;
      subjectSlug: string;
      subjectType: CompileSubjectType;
    }
  >;
  stats: {
    compiledUnits: number;
    totalUnits: number;
    pendingJobs: number;
    failedJobs: number;
    staleUnits: number;
  };
  queue: CompileQueueItem[];
  calibration: CompileCalibrationView | null;
  modelFingerprint: string;
}

/** 前端把区间渲染成文本：样本不足或偏差过大时不假装精确。 */
export function formatTokenRange(
  low: number | null,
  high: number | null,
  displayMode: 'number' | 'band' = 'number',
): string {
  if (low == null || high == null) return '—';
  if (displayMode === 'band') {
    if (high >= 40_000) return '高';
    if (high >= 15_000) return '中';
    return '低';
  }
  return `${Math.round(low / 1000)}k–${Math.round(high / 1000)}k`;
}
