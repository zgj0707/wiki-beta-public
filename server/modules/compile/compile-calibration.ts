/**
 * token 预估与预算守卫（纯函数，无 IO）。
 *
 * 设计立场：**不试图"算得更准"，而是设计成"算不准也不出事"**。
 * 依据（见 docs/ai-compile-layer-plan.md §6.1）：
 * - cl100k_base 中文实测系数 ≈1.16，而经验公式 1.6 → 系统性高估约 21%；
 * - 换 tokenizer 同一文本 token 数差 5–25%；
 * - `len/4` 这类估算在长文上会静默失控（100k 字符估 25k、实际 12k）。
 * 因此本模块不采用理论系数，只用 **闭环实测校准**（EMA）+ **区间表达** + **硬边界**。
 */

/** 冷启动兜底系数（tokens/字符）。取偏保守的高值：宁可高估不可低估。 */
export const DEFAULT_CHAR_FACTOR = 1.3;

/** 稳态带宽：±25%（经验区间，真实偏差由 computeDeviation 实测）。 */
export const STEADY_BAND = 0.25;

/** 样本不足时的带宽放大倍数（方案 §6.2 L2：样本 <5 时区间放宽）。 */
export const COLD_START_BAND_MULTIPLIER = 1.5;

/** 冷启动样本阈值：低于此值不做单点估计。 */
export const MIN_SAMPLES_FOR_TIGHT_BAND = 5;

/** 偏差 P90 超过此比例 → 校准面板隐藏数字，只显示低/中/高档。 */
export const DEVIATION_HIDE_THRESHOLD = 0.25;

/** EMA 新样本权重（0.2 ≈ 最近 5 次样本占一半权重）。 */
export const EMA_ALPHA = 0.2;

/** 偏差分位数计算窗口（取最近 N 个已编译单元的实测值）。 */
export const DEVIATION_WINDOW = 50;

/**
 * 置信度阈值。
 *
 * ⚠️ 已按 N=20 真实编译实测回调（2026-09-18）。原值时 `highMinSources=3`，
 * 而锚定修复后 claim 实际引用的独立来源数分布为 7–12（中位 9）——绝对值
 * 恒 ≥7 → 20/20 全 high，字段等于没有信息。根因是「独立来源数」被
 * `COMPILE_MAX_DOCS=12` 截断后落在极窄区间，绝对阈值不可能有区分度。
 *
 * 改判据为二维：**证据充分度（绝对量） × 时效（最新来源距今）**。
 * 实测分布（2026-09-18）：sufficient 16 / thin 5 / weak 0；fresh 13 / aging 8 / stale 0
 * → high 10 / medium 11 / low 0。low 为 0 是**正确结论而非缺陷**：这批主体
 * 最少也有 7 篇近期资料，不存在「证据薄弱」者。
 *
 * 仍待复核：网站直连网关后可积累更广样本（当前仅产品类前 20 个），届时再看
 * 是否需要引入「未解冲突数」作为第三维。
 */
export const CONFIDENCE_THRESHOLDS = {
  /** 独立来源数 ≥ 此值 → 证据充分。 */
  sufficientMinSources: 8,
  /** 独立来源数 ≥ 此值 → 证据偏薄，否则薄弱。 */
  thinMinSources: 4,
  /** 最新来源距今 ≤ 此天数 → 新鲜。 */
  freshDays: 30,
  /** 最新来源距今 ≤ 此天数 → 渐旧，超出即陈旧。 */
  agingDays: 90,
} as const;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** 校准快照（来自 ai_compile_calibration 一行）。 */
export interface CalibrationSnapshot {
  sampleCount: number;
  charFactor: number | null;
}

export interface TokenEstimate {
  low: number;
  high: number;
  samples: number;
  /** 实际使用的系数（用于诊断）。 */
  factor: number;
}

/** `model:<fingerprint>` —— 不同模型 tokenizer 不同，校准必须分区。 */
export function scopeFor(modelFingerprint: string): string {
  const normalized = modelFingerprint.trim().toLowerCase() || 'unknown';
  return `model:${normalized}`.slice(0, 120);
}

/** 聚合口径下 scope 的展示名（无指纹调用路径用，如工作台/校准面板）。 */
export const AGGREGATE_SCOPE_LABEL = 'model:*（全部模型聚合）';

/** 校准分区行的结构化入参：只取需要字段，不与 Drizzle 行类型耦合。 */
export interface CalibrationScopeRow {
  sampleCount: number;
  charFactor: string | number | null;
  totalChars: number | string;
  totalPromptTokens: number | string;
  totalCompletionTokens: number | string;
  updatedAt: Date | null;
}

export interface AggregatedCalibration {
  sampleCount: number;
  charFactor: number | null;
  totalChars: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  updatedAt: Date | null;
}

/**
 * 多分区聚合（无指纹调用路径专用）。
 *
 * 为什么必须有：校准按 `model:<fingerprint>` 分区，但**读结论、看面板**的调用方
 * 不该被迫指定模型（与 getUnit 同一个道理）。早先无指纹时直接落读
 * `model:unknown`，而站内直连编译写入的是 `model:<浏览器模型名>` —— 于是
 * `sampleCount / charFactor / 累计 token` 恒为死值，「用实测校准预估」这件事在
 * 无指纹路径上等于没生效（面板永远显示「冷启动 1.3」与 0 样本）。
 *
 * 系数按**字符量加权**：charFactor 是 tokens/字符，等权平均会让样本少的分区
 * 被过度放大（例如 10 字符的小分区与 2 万字符的大分区等权）。
 */
export function aggregateCalibration(
  rows: CalibrationScopeRow[],
): AggregatedCalibration {
  let sampleCount = 0;
  let totalChars = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let weightedFactor = 0;
  let updatedAt: Date | null = null;

  for (const row of rows) {
    const chars = Number(row.totalChars) || 0;
    sampleCount += row.sampleCount;
    totalChars += chars;
    totalPromptTokens += Number(row.totalPromptTokens) || 0;
    totalCompletionTokens += Number(row.totalCompletionTokens) || 0;
    const factor = row.charFactor == null ? 0 : Number(row.charFactor);
    if (factor > 0 && chars > 0) weightedFactor += factor * chars;
    if (row.updatedAt && (!updatedAt || row.updatedAt > updatedAt)) {
      updatedAt = row.updatedAt;
    }
  }

  return {
    sampleCount,
    charFactor:
      totalChars > 0 && weightedFactor > 0 ? weightedFactor / totalChars : null,
    totalChars,
    totalPromptTokens,
    totalCompletionTokens,
    updatedAt,
  };
}

/** 把模型名归一为指纹（大小写/空格/下划线与点号统一），避免同一模型多份系数。 */
export function fingerprintOf(model: string): string {
  return model.trim().toLowerCase().replace(/[\s_]+/g, '-').slice(0, 120);
}

/**
 * 字符数 → token 区间。冷启动（样本 <5）不做收紧，直接放大带宽。
 * 返回区间而非单点：调用方必须原样透出 low–high，禁止只显示中心值。
 */
export function estimateTokens(
  chars: number,
  snapshot: CalibrationSnapshot,
): TokenEstimate {
  const factor =
    snapshot.charFactor && snapshot.charFactor > 0
      ? snapshot.charFactor
      : DEFAULT_CHAR_FACTOR;
  const center = Math.max(1, chars) * factor;
  const band =
    snapshot.sampleCount < MIN_SAMPLES_FOR_TIGHT_BAND
      ? STEADY_BAND * COLD_START_BAND_MULTIPLIER
      : STEADY_BAND;
  return {
    low: Math.max(1, Math.round(center * (1 - band))),
    high: Math.max(1, Math.round(center * (1 + band))),
    samples: snapshot.sampleCount,
    factor,
  };
}

/**
 * EMA 滚动校准：新样本权重 EMA_ALPHA，首样本直接取实测。
 * 输入必须是真实 `usage.prompt_tokens`——方法层已拒绝估算值，见 compile.service。
 */
export function nextCharFactor(
  previous: number | null,
  chars: number,
  promptTokens: number,
  previousSamples: number,
): number | null {
  if (!chars || chars <= 0 || !promptTokens || promptTokens <= 0) return previous;
  const observed = promptTokens / chars;
  if (previous == null || previous <= 0 || previousSamples < 1) return observed;
  return previous * (1 - EMA_ALPHA) + observed * EMA_ALPHA;
}

export interface DeviationStats {
  p50: number | null;
  p90: number | null;
  sampleCount: number;
}

/**
 * 偏差分位数：对「预估区间」与「实测值」逐条算相对偏差。
 * 判据用「实测是否落在区间内」的正向定义（out-of-range 时记超出比例），
 * 而非单纯的中心点误差——用户看到的是区间，区间不准才是问题。
 */
export function computeDeviation(
  samples: Array<{ estLow: number | null; estHigh: number | null; actual: number | null }>,
): DeviationStats {
  const values: number[] = [];
  for (const sample of samples) {
    const { estLow, estHigh, actual } = sample;
    if (!actual || actual <= 0 || !estLow || !estHigh) continue;
    if (actual >= estLow && actual <= estHigh) {
      values.push(0);
      continue;
    }
    // 超出区间：记相对超出比例（超出下限按低估处理，超出上限按高估处理）。
    const bound = actual < estLow ? estLow : estHigh;
    values.push(Math.abs(actual - bound) / bound);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return { p50: null, p90: null, sampleCount: 0 };
  return {
    p50: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    sampleCount: values.length,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export type DisplayMode = 'number' | 'band';

/** 降级原因（`displayMode === 'band'` 时用于解释「为什么只给档位」）。 */
export type DisplayReason =
  /** 还没有任何带实测用量的编译。 */
  | 'no-samples'
  /** 样本数不足 `MIN_SAMPLES_FOR_TIGHT_BAND`，分位数本身不可靠。 */
  | 'too-few-samples'
  /** 样本够了，但 P90 超出 `DEVIATION_HIDE_THRESHOLD`。 */
  | 'too-deviated';

export interface DisplayDecision {
  mode: DisplayMode;
  reason: DisplayReason | null;
}

/**
 * 是否允许显示精确数字（可证伪的降级判据，见方案 §6.3）。
 *
 * ⚠️ 必须**同时**看「样本量」与「偏差」，只看 P90 会出现荒唐局面：
 * 单条样本的 P90 就是它自己，只要它恰好低于 25% 阈值，面板就敢用小数点级
 * 精度报数；而系统自己在 `estimateTokens` 里对同一批样本判定「不可靠」、
 * 并把区间带宽放大 1.5 倍。同一个事实被两把尺子量出相反结论，是设计缺陷。
 * 现在两个判据同源（都用 `MIN_SAMPLES_FOR_TIGHT_BAND`），口径自洽。
 */
export function displayDecisionFor(deviation: DeviationStats): DisplayDecision {
  if (deviation.p90 == null || deviation.sampleCount === 0) {
    return { mode: 'band', reason: 'no-samples' };
  }
  if (deviation.sampleCount < MIN_SAMPLES_FOR_TIGHT_BAND) {
    return { mode: 'band', reason: 'too-few-samples' };
  }
  if (deviation.p90 > DEVIATION_HIDE_THRESHOLD) {
    return { mode: 'band', reason: 'too-deviated' };
  }
  return { mode: 'number', reason: null };
}

/** 时效档：以最新来源日期距今判定；日期不可解析时归入 `aging`（保守但不误杀）。 */
export type FreshnessLevel = 'fresh' | 'aging' | 'stale';

/**
 * 时效定档。`latestSourceDate` 为 null / 不可解析 → `aging`：
 * 不因缺日期把结论打到 low（那会惩罚数据缺失而非惩罚过时），
 * 也不放行到 high（无日期不足以佐证新鲜）。
 */
export function freshnessOf(
  latestSourceDate: string | null,
  now: Date = new Date(),
): FreshnessLevel {
  const { freshDays, agingDays } = CONFIDENCE_THRESHOLDS;
  const parsed = parseSourceDate(latestSourceDate);
  if (!parsed) return 'aging';
  const ageDays = (now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= freshDays) return 'fresh';
  if (ageDays <= agingDays) return 'aging';
  return 'stale';
}

/**
 * 置信度判定 —— **代码算，不由模型自称**。
 *
 * 二维映射（证据充分度 × 时效）：
 *
 * | 充分度 \ 时效 | fresh  | aging  | stale |
 * |---------------|--------|--------|-------|
 * | sufficient    | high   | medium | low   |
 * | thin          | medium | medium | low   |
 * | weak          | low    | low    | low   |
 *
 * 注意：这里刻意不含"是否含一线来源"这类条件——库里没有可靠的来源分级数据，
 * 引入无法核实的判据只会制造虚假精度。
 */
export function judgeConfidence(
  sourceCount: number,
  latestSourceDate: string | null,
  now: Date = new Date(),
): ConfidenceLevel {
  const { sufficientMinSources, thinMinSources } = CONFIDENCE_THRESHOLDS;
  const freshness = freshnessOf(latestSourceDate, now);

  if (sourceCount >= sufficientMinSources) {
    if (freshness === 'fresh') return 'high';
    return freshness === 'stale' ? 'low' : 'medium';
  }
  if (sourceCount >= thinMinSources) {
    return freshness === 'stale' ? 'low' : 'medium';
  }
  return 'low';
}

/** 解析 Base「飞书来源日期」口径的字符串（yyyy-MM-dd / yyyy/M/d / ISO）。 */
export function parseSourceDate(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 15;
  if (!year || !month || month > 12 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, Math.min(day, 28)));
}
