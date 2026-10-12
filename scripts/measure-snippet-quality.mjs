#!/usr/bin/env node
/**
 * 片段策略量化对比（measure-snippet-quality.mjs）
 *
 * 对 dev 库全量语料（entity_doc_cache，ready+已批准）用「旧单窗口」与
 * 「新大纲+锚定+节选」两种实现，按 4 种查询剖面（无命中/前部命中/中部命中/
 * 尾部命中）生成片段，量化：
 *   - 片段长度（预算遵守）
 *   - 节结构覆盖率（一~三级标题所划分的节，多少节在片段中留有痕迹）
 *   - 节首句捕获率（topic sentence）
 *   - 节末句捕获率（conclusion——「丢结论」的直接度量）
 *   - 命中保留率（命中词附近内容是否仍在片段中，防回归指标）
 *
 * 用法：先 dump 语料 JSON（tmp-edc-dump.json）并完成 nest build，然后
 *   node scripts/measure-snippet-quality.mjs
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildStructuredSnippet } = require('../dist/server/modules/chat/chat-snippet.js');

const SNIPPET_TOTAL = 1800;

/** 旧版单窗口实现（迁移自 chat-retriever.service.ts 历史版本，逐行一致）。 */
function legacySnippet(body, hitIndex) {
  const cleaned = body
    .split('\n')
    .filter((line) => !/^!\[|^#{1,6}\s*$/.test(line.trim()))
    .join('\n');
  const size = SNIPPET_TOTAL;
  let start = 0;
  if (hitIndex >= 0) {
    const ratio = Math.min(1, hitIndex / Math.max(1, body.length));
    start = Math.max(0, Math.floor(ratio * cleaned.length) - size / 2);
  }
  let text = cleaned.slice(start, start + size);
  const cutHead = start > 0;
  const cutTail = start + size < cleaned.length;
  if (cutHead) {
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }
  if (cutTail) {
    const nl = text.lastIndexOf('\n');
    if (nl > text.length - 240) text = text.slice(0, nl);
  }
  return `${cutHead ? '……' : ''}${text}${cutTail ? '……' : ''}`;
}

const norm = (s) => s.replace(/\s+/g, '');
const includes = (hay, needle) => needle.length >= 6 && norm(hay).includes(norm(needle));

/** 一~三级标题划分的节（与 chat-snippet 口径一致）。 */
function parseSections(body) {
  const cleaned = body
    .split('\n')
    .filter((line) => !/^!\[|^#{1,6}\s*$/.test(line.trim()))
    .join('\n');
  const sections = [];
  let offset = 0;
  let current = { start: 0, end: 0, heading: '(开篇)' };
  for (const line of cleaned.split('\n')) {
    const m = /^(#{1,3}) (.+)$/.exec(line.trim());
    if (m) {
      current.end = offset;
      sections.push(current);
      current = { start: offset, end: cleaned.length, heading: m[2].trim() };
    }
    offset += line.length + 1;
  }
  current.end = cleaned.length;
  sections.push(current);
  const kept = sections.filter((s) => s.end > s.start);
  return { cleaned, sections: kept };
}

/** 从节内容中取首/末句（≥8 字的完整句），用于捕获率判定。 */
function sectionSentences(text) {
  const paras = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const sentences = [];
  for (const p of paras) {
    if (/^[|>-]/.test(p) || /^\d+[.、)]/.test(p)) {
      sentences.push(p);
      continue;
    }
    for (const s of p.split(/(?<=[。！？!?；;])/)) {
      if (s.trim().length >= 8) sentences.push(s.trim());
    }
  }
  return sentences;
}

/** 从指定位置附近抽一个 4 字 CJK 词作为模拟查询关键词。 */
function pickKeyword(cleaned, ratio) {
  const pos = Math.floor(cleaned.length * ratio);
  const cjk = cleaned.slice(pos, pos + 400).match(/[\u4e00-\u9fff]{4,}/);
  if (cjk) return cjk[0].slice(0, 4);
  const lat = cleaned.slice(pos, pos + 400).match(/[A-Za-z]{4,}/);
  return lat ? lat[0].toLowerCase() : null;
}

function evaluate(body, keywords, hitIndex, buildFn) {
  const snippet = buildFn(body, keywords, hitIndex);
  const { cleaned, sections } = parseSections(body);
  let topicHit = 0;
  let conclusionHit = 0;
  let structureHit = 0;
  for (const sec of sections) {
    const text = cleaned.slice(sec.start, sec.end);
    const sentences = sectionSentences(text);
    // 句前缀作 needle（节选允许截断，前缀命中即视为捕获）。
    const pre = (s) => (s && s.length > 40 ? s.slice(0, 40) : s);
    const inSnippet =
      includes(snippet, sec.heading) ||
      (sentences[0] && includes(snippet, pre(sentences[0]))) ||
      (sentences[1] && includes(snippet, pre(sentences[1])));
    if (inSnippet) structureHit += 1;
    if (sentences[0] && includes(snippet, pre(sentences[0]))) topicHit += 1;
    const last = sentences[sentences.length - 1];
    if (last && includes(snippet, pre(last))) conclusionHit += 1;
  }
  const hitRetained =
    hitIndex < 0 ||
    (() => {
      // 探针可能横跨大纲与主窗口的拼接边界（中间有「……」分隔），任一半段命中即算保留。
      const probe = norm(body.slice(hitIndex, hitIndex + 16));
      if (probe.length < 6) return true;
      const hay = norm(snippet);
      if (hay.includes(probe)) return true;
      const half = Math.ceil(probe.length / 2);
      return hay.includes(probe.slice(0, half)) || hay.includes(probe.slice(-half));
    })();
  return {
    len: snippet.length,
    structureRate: sections.length ? structureHit / sections.length : 1,
    topicRate: sections.length ? topicHit / sections.length : 1,
    conclusionRate: sections.length ? conclusionHit / sections.length : 1,
    hitRetained,
  };
}

const PROFILES = [
  { name: '总结型（无命中）', ratio: null },
  { name: '前部命中(20%)', ratio: 0.2 },
  { name: '中部命中(50%)', ratio: 0.5 },
  { name: '尾部命中(80%)', ratio: 0.8 },
];

const rows = require('../scripts/tmp-edc-dump.json');
const docs = (rows.data ?? []).filter((r) => r.body_markdown && r.body_len > SNIPPET_TOTAL);
console.log(`语料：${docs.length} 篇超预算文档（总库 41 篇）\n`);

const agg = {};
for (const p of PROFILES) agg[p.name] = { old: [], new: [] };

for (const doc of docs) {
  const body = doc.body_markdown;
  const { cleaned } = parseSections(body);
  for (const profile of PROFILES) {
    if (profile.ratio == null) {
      agg[profile.name].old.push(evaluate(body, [], -1, legacySnippet));
      agg[profile.name].new.push(evaluate(body, [], -1, buildStructuredSnippet));
    } else {
      const kw = pickKeyword(cleaned, profile.ratio);
      if (!kw) continue;
      const hitIndex = cleaned.toLocaleLowerCase().indexOf(kw);
      if (hitIndex < 0) continue;
      const origIndex = Math.floor(hitIndex * (body.length / Math.max(1, cleaned.length)));
      agg[profile.name].old.push(evaluate(body, [kw], origIndex, legacySnippet));
      agg[profile.name].new.push(evaluate(body, [kw], origIndex, buildStructuredSnippet));
    }
  }
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / Math.max(1, arr.length);

console.log(
  '| 查询剖面 | 指标 | 旧·单窗口 | 新·大纲+节选 | 变化 |\n|---|---|---|---|---|',
);
for (const p of PROFILES) {
  const o = agg[p.name].old;
  const n = agg[p.name].new;
  const rowsOut = [
    ['平均片段长度', `${Math.round(avg(o, (x) => x.len))} 字`, `${Math.round(avg(n, (x) => x.len))} 字`, ''],
    ['节结构覆盖率', pct(avg(o, (x) => x.structureRate)), pct(avg(n, (x) => x.structureRate)), `+${((avg(n, (x) => x.structureRate) - avg(o, (x) => x.structureRate)) * 100).toFixed(1)}pp`],
    ['节首句捕获率', pct(avg(o, (x) => x.topicRate)), pct(avg(n, (x) => x.topicRate)), `+${((avg(n, (x) => x.topicRate) - avg(o, (x) => x.topicRate)) * 100).toFixed(1)}pp`],
    ['节末句(结论)捕获率', pct(avg(o, (x) => x.conclusionRate)), pct(avg(n, (x) => x.conclusionRate)), `+${((avg(n, (x) => x.conclusionRate) - avg(o, (x) => x.conclusionRate)) * 100).toFixed(1)}pp`],
    ['命中内容保留率', pct(avg(o, (x) => (x.hitRetained ? 1 : 0))), pct(avg(n, (x) => (x.hitRetained ? 1 : 0))), ''],
  ];
  for (const [k, a, b, d] of rowsOut) {
    console.log(`| ${p.name} | ${k} | ${a} | ${b} | ${d} |`);
  }
}

// 预算遵守检查
const overBudget = [];
for (const doc of docs) {
  const { cleaned } = parseSections(doc.body_markdown);
  for (const ratio of [null, 0.2, 0.5, 0.8]) {
    const kw = ratio == null ? null : pickKeyword(cleaned, ratio);
    const hitIndex = kw ? Math.floor(cleaned.toLocaleLowerCase().indexOf(kw) * (doc.body_markdown.length / Math.max(1, cleaned.length))) : -1;
    const s = buildStructuredSnippet(doc.body_markdown, kw ? [kw] : [], hitIndex);
    if (s.length > SNIPPET_TOTAL + 80) {
      overBudget.push(`${doc.title}: ${s.length} 字`);
      break;
    }
  }
}
console.log(`\n预算遵守：${overBudget.length === 0 ? '全部 41 篇 ≤ 1880 字 ✓' : `超预算 ${overBudget.length} 篇`}`);
for (const t of overBudget) console.log(`  - ${t}`);
