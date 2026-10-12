import type { CompileClaimType } from '@shared/ai-compile';

/**
 * 编译 prompt 契约 + 模型输出解析（纯函数）。
 *
 * 输入 → 输出的**唯一**信任边界在 `parseCompileOutput` / `validateClaims`：
 * prompt 里写的规则只是"请求"，不是"保证"。模型说的任何事都必须由代码复核，
 * 这条沿用 chat 链路已确立的铁律（引用 SSOT 是检索结果，不信任模型输出）。
 */

/** 送入 prompt 的单篇资料。 */
export interface CompileDocInput {
  /** 1-based 编号，与 prompt 中的 `[n]` 一致，也是模型回填的唯一引用方式。 */
  index: number;
  docId: string;
  title: string;
  sourceDate: string | null;
  /** 结构化片段（复用 chat-snippet 的"大纲 + 主窗口 + 节首末节选"）。 */
  snippet: string;
}

export interface CompileMessages {
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  /** 送入 prompt 的字符总数（input + system），供 token 预估用。 */
  chars: number;
}

const CLAIM_TYPES = new Set<CompileClaimType>(['fact', 'judgment', 'metric']);
const MAX_CLAIMS = 8;
const MAX_GAPS = 6;
const MAX_CONTRADICTIONS = 5;
const MAX_HEADLINE_LEN = 80;
const MAX_CLAIM_LEN = 300;
const MAX_QUOTE_LEN = 120;

const SYSTEM_PROMPT = [
  '你是游戏行业情报编译员。你的任务是把一批同一主体的资料，编译成一份可核查的结论卡。',
  '',
  '硬规则（违反即无效）：',
  '1. 只能依据【资料】中的内容作答。禁止引入资料之外的任何知识、常识推测或行业印象。',
  '2. 每条结论必须标注支撑它的资料编号（sources，数组，元素是资料前的数字编号）。',
  '   没有资料支撑的结论不要写；如果你认为重要但资料未提及，写进 gaps。',
  '3. sources 只能使用资料区出现过的编号，不得虚构编号，不得凭印象补编号。',
  '4. quote 必须是资料原文的直接摘录（可截断），不是你的概括。',
  '5. 资料之间说法不一致时，不要"调和"，要在 contradictions 里并列两组说法。',
  '6. 只输出 JSON，不要 markdown 代码围栏，不要任何解释文字。',
].join('\n');

/** 输出 JSON schema 说明（与 parseCompileOutput 的解析目标严格对齐）。 */
const OUTPUT_SCHEMA = [
  '输出 JSON，字段如下：',
  '{',
  '  "headline": "一句话结论，40 字以内，直接给判断，不要"本文介绍…"式开头",',
  '  "claims": [',
  '    {',
  '      "text": "一条结论，尽量具体（含数值/时间/产品名）",',
  '      "type": "fact | judgment | metric",',
  '      "sources": [1, 3],',
  '      "quote": "支撑这条的资料原文摘录，60 字以内"',
  '    }',
  '  ],',
  '  "gaps": ["资料中未覆盖的关键问题，例如：7 篇资料均未提及次留数据"],',
  '  "contradictions": [{ "a": "说法A", "b": "说法B", "note": "冲突点" }]',
  '}',
  '',
  `约束：claims 1–${MAX_CLAIMS} 条（按重要性排序）；gaps 0–${MAX_GAPS} 条；`,
  `contradictions 0–${MAX_CONTRADICTIONS} 条（没有就输出空数组）。`,
].join('\n');

/**
 * 组装编译任务的 messages。
 * `omittedDocCount` > 0 时在 prompt 内明示覆盖率 —— 静默截断会让模型把
 * "没看到"当成"不存在"，进而在 gaps 里漏报。
 */
export function buildCompileMessages(
  subject: { name: string; type: string },
  docs: CompileDocInput[],
  omittedDocCount: number,
): CompileMessages {
  const header = [
    `主体：${subject.name}（${subject.type}）`,
    `资料篇数：${docs.length}${omittedDocCount > 0 ? `（另有 ${omittedDocCount} 篇关联资料因篇幅上限未提供，请勿据此推断"无相关记录"）` : ''}`,
    '',
    '【资料】',
  ].join('\n');

  const body = docs
    .map((doc) => {
      const meta = [doc.sourceDate ? `日期 ${doc.sourceDate}` : '日期未知'].join(
        ' · ',
      );
      return `[${doc.index}] ${doc.title || '（无标题）'}（${meta}）\n${doc.snippet}`;
    })
    .join('\n\n---\n\n');

  const user = `${header}\n${body}\n\n---\n\n${OUTPUT_SCHEMA}`;
  const messages: CompileMessages['messages'] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
  return {
    messages,
    chars: SYSTEM_PROMPT.length + user.length,
  };
}

export interface RawCompileClaim {
  text: string;
  type: CompileClaimType;
  sources: number[];
  quote: string | null;
}

export interface ParsedCompileOutput {
  headline: string;
  claims: RawCompileClaim[];
  gaps: string[];
  contradictions: Array<{ a: string; b: string; note: string }>;
}

export class CompileParseError extends Error {}

/**
 * 切出候选 JSON：**括号平衡扫描**，而不是「首个 `{` 到末个 `}`」。
 *
 * 后者在两种很常见的情况下会切错：
 *   ① 输出被 max_tokens 截断 —— 末个 `}` 落在数组中间，切出来必然不是合法 JSON，
 *      且错误会被报成"解析失败"，掩盖真正的"预算不够"；
 *   ② JSON 之后还跟了解释文字且解释里含 `}` —— 末个 `}` 落在解释里。
 * 返回 null 表示括号没闭合（= 输出不完整）。
 */
function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      // 转义只在字符串内成立；字符串外的反斜杠不当转义处理。
      if (inString) escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * 语义等价的修复，只做两件确定安全的事：
 *   ① 字符串字面量内的裸换行 → `\n`（JSON 标准禁止裸换行，模型照原文摘录时
 *      极易带出来，尤其是多行 quote）；
 *   ② 尾随逗号。
 * 刻意**不尝试**修未转义引号：无法判断哪个引号才是字符串结束符，猜错就是改语义。
 */
function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && (ch === '\n' || ch === '\r')) {
      out += '\\n';
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 解析模型输出。容忍四类常见噪声（不改变语义，只做剥离）：
 * ① ```json 代码围栏；② 前后解释文字；③ 字符串内裸换行；④ 尾随逗号。
 * 解析失败直接抛——由调用方决定"未编译"，**绝不落半成品**。
 */
export function parseCompileOutput(raw: string): ParsedCompileOutput {
  const text = stripFence(raw ?? '');
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new CompileParseError(
      text.includes('{')
        ? 'JSON 未闭合（输出很可能被截断）'
        : '响应中找不到 JSON 对象',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(repairJson(candidate));
    } catch {
      throw new CompileParseError(
        'JSON 解析失败（尾随逗号 / 字符串内换行修复后仍失败）',
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CompileParseError('顶层不是 JSON 对象');
  }
  const obj = parsed as Record<string, unknown>;

  const headline = asText(obj.headline).slice(0, MAX_HEADLINE_LEN);
  if (!headline) throw new CompileParseError('缺少 headline');

  return {
    headline,
    claims: asClaimList(obj.claims),
    gaps: asTextList(obj.gaps, MAX_GAPS),
    contradictions: asContradictionList(obj.contradictions),
  };
}

export interface ClaimDraft {
  text: string;
  type: CompileClaimType;
  /** 已映射为 docId 的支撑来源。 */
  sourceDocIds: string[];
  sourceQuote: string | null;
  sortOrder: number;
}

export interface DroppedClaim {
  text: string;
  reason: string;
}

export interface ClaimValidation {
  kept: ClaimDraft[];
  dropped: DroppedClaim[];
}

/**
 * 引用白名单校验（**代码做，不由模型自称**）。
 * - 编号越界 → 整条 claim 丢弃（reason=out_of_range）；
 * - 无有效编号 → 整条丢弃（reason=no_source）——这是防幻觉的主防线：
 *   模型"自己知道但资料没写"的内容一律进不来；
 * - 同一条内重复编号去重；
 * - 只保留 sources 里真实存在的 docId。
 */
export function validateClaims(
  claims: RawCompileClaim[],
  sources: Array<{ index: number; docId: string }>,
): ClaimValidation {
  const byIndex = new Map<number, string>();
  for (const source of sources) byIndex.set(source.index, source.docId);

  const kept: ClaimDraft[] = [];
  const dropped: DroppedClaim[] = [];

  claims.forEach((claim) => {
    const text = claim.text.slice(0, MAX_CLAIM_LEN);
    if (!text) return;
    if (!claim.sources.length) {
      dropped.push({ text, reason: 'no_source' });
      return;
    }
    const docIds: string[] = [];
    let outOfRange = false;
    for (const index of claim.sources) {
      const docId = byIndex.get(index);
      if (!docId) {
        outOfRange = true;
        continue;
      }
      if (!docIds.includes(docId)) docIds.push(docId);
    }
    if (!docIds.length) {
      dropped.push({
        text,
        reason: outOfRange ? 'out_of_range' : 'no_source',
      });
      return;
    }
    kept.push({
      text,
      type: claim.type,
      sourceDocIds: docIds,
      sourceQuote: claim.quote ? claim.quote.slice(0, MAX_QUOTE_LEN) : null,
      sortOrder: kept.length,
    });
    if (outOfRange) {
      // 部分越界：保留本条但留痕，便于审计模型引用习惯。
      dropped.push({ text, reason: 'partially_out_of_range' });
    }
  });

  return { kept, dropped };
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asClaimList(value: unknown): RawCompileClaim[] {
  if (!Array.isArray(value)) return [];
  const claims: RawCompileClaim[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = asText(record.text);
    if (!text) continue;
    const typeRaw = asText(record.type) as CompileClaimType;
    const type = CLAIM_TYPES.has(typeRaw) ? typeRaw : 'fact';
    const sources = Array.isArray(record.sources)
      ? [
          ...new Set(
            record.sources
              .map((n) => (typeof n === 'number' ? n : Number(asText(n))))
              .filter((n) => Number.isInteger(n) && n > 0)
              .map((n) => n as number),
          ),
        ]
      : [];
    claims.push({
      text: text.slice(0, MAX_CLAIM_LEN),
      type,
      sources,
      quote: asText(record.quote) || null,
    });
    if (claims.length >= MAX_CLAIMS) break;
  }
  return claims;
}

function asContradictionList(
  value: unknown,
): Array<{ a: string; b: string; note: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ a: string; b: string; note: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const a = asText(record.a);
    const b = asText(record.b);
    if (!a || !b) continue;
    out.push({ a, b, note: asText(record.note) });
    if (out.length >= MAX_CONTRADICTIONS) break;
  }
  return out;
}
