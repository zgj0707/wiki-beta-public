#!/usr/bin/env node
/**
 * AI 编译层批跑脚本（WorkBuddy 侧 / 维护者种子批）。
 *
 * 设计要点：**只替换"LLM 调用方"这一步**，前后两端与服务端接口完全一致
 * （GET/POST /api/compile/prepare → LLM → POST /api/compile/save）：
 *
 *   浏览器直连：前端组装 prompt → [LLM] → 前端解析 → POST /api/compile/save
 *   本脚本：    POST /api/compile/prepare → [LLM] → POST /api/compile/save
 *               └──────────── 完全相同 ────────────┘
 *
 * 子命令：
 *   list                              列队列（只读）
 *   export  --limit N --out FILE      导出批任务（含 prompt，供外部执行 LLM）
 *   run     --in FILE --out FILE      对导出的批任务调用 LLM（需 LLM_KEY）
 *   save    --in FILE                 回填结果（服务端会重新校验引用）
 *   auto    --limit N                 一体化：prepare → LLM → save，逐条落盘可续跑
 *
 * 环境变量：
 *   BASE_URL       站点根地址（默认 http://127.0.0.1:3000）
 *   CSRF_TOKEN     站点的 X-Suda-Csrf-Token（若站点要求）
 *   MODEL          模型标识（默认 deepseek-flash），决定产物分区与校准分区
 *   LLM_BASE_URL   OpenAI 兼容网关（如 https://llm.example.com/v1）
 *   LLM_KEY        LLM Key（run / auto 需要；export / save 不需要）
 *   DAY_BUDGET_TOKENS  单日 prompt token 硬顶（默认 300000）
 *
 * 稳健性（与方案 §6 一致）：
 *   - 断点续跑：每完成一条即写 progress 文件，重启跳过已完成条目
 *   - 硬顶：单批条数 / 单日 token 用尽即停，不静默超支
 *   - 熔断：连续失败（引用校验不通过）超阈值即停批
 *   - 失败不写产物：服务端保证（本脚本只记录原因）
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const CSRF_TOKEN = process.env.CSRF_TOKEN ?? '';
const MODEL = process.env.MODEL ?? 'deepseek-flash';
const LLM_BASE_URL = (process.env.LLM_BASE_URL ?? 'https://llm.example.com/v1').replace(/\/+$/, '');
const LLM_KEY = process.env.LLM_KEY ?? '';
const DAY_BUDGET_TOKENS = Number(process.env.DAY_BUDGET_TOKENS ?? 300000);
const WORK_DIR = resolve(process.cwd(), '.compile-batch');
const PROGRESS_FILE = resolve(WORK_DIR, 'progress.json');
/** 连续失败熔断阈值（引用校验不通过视为质量事故，不停下来会持续烧钱）。 */
const MAX_CONSECUTIVE_FAILURES = 3;

function fingerprintOf(model) {
  return model.trim().toLowerCase().replace(/[\s_]+/g, '-').slice(0, 120);
}

function headers(extra = {}) {
  const base = { 'Content-Type': 'application/json', ...extra };
  if (CSRF_TOKEN) base['X-Suda-Csrf-Token'] = CSRF_TOKEN;
  return base;
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: headers(init.headers),
    credentials: 'include',
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${path} 失败 ${response.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)?.slice(0, 200)}`);
  }
  return data;
}

async function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return { saved: [], failed: [], tokensUsed: 0 };
  try {
    return JSON.parse(await readFile(PROGRESS_FILE, 'utf8'));
  } catch {
    return { saved: [], failed: [], tokensUsed: 0 };
  }
}

async function saveProgress(progress) {
  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

/** 调用 LLM（非流式）。刻意不传 response_format：网关兼容性风险高于收益。 */
async function callLlm(messages) {
  if (!LLM_KEY) throw new Error('缺少 LLM_KEY（run / auto 模式必需）');
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('LLM 返回为空');
  return {
    raw,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
    },
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function cmdList() {
  const queue = await api('/api/compile/queue');
  const pending = queue.filter((item) => item.state !== 'done');
  console.log(`队列 ${queue.length} 个主体，未编译 ${pending.length}`);
  for (const item of queue.slice(0, 40)) {
    const est = item.estTokensLow == null ? '—' : `${item.estTokensLow}-${item.estTokensHigh}`;
    console.log(
      [
        item.state.padEnd(8),
        String(item.docCount).padStart(4),
        est.padStart(12),
        item.subjectId,
        item.subjectName,
      ].join('  '),
    );
  }
  return queue;
}

async function cmdExport(args) {
  const limit = Number(args.limit ?? 20);
  const out = args.out ?? resolve(WORK_DIR, `batch-${Date.now()}.json`);
  const queue = await api('/api/compile/queue');
  const targets = queue.filter((item) => item.state !== 'done').slice(0, limit);
  if (!targets.length) {
    console.log('没有待编译主体');
    return;
  }
  const batch = { model: MODEL, createdAt: new Date().toISOString(), items: [] };
  for (const target of targets) {
    const prepared = await api('/api/compile/prepare', {
      method: 'POST',
      body: JSON.stringify({
        subjectId: target.subjectId,
        modelFingerprint: fingerprintOf(MODEL),
      }),
    });
    if (prepared.overBudget) {
      console.warn(`跳过 ${target.subjectName}：输入超硬顶（预估 ${prepared.estTokensLow}-${prepared.estTokensHigh}）`);
      continue;
    }
    batch.items.push({
      subjectId: target.subjectId,
      subjectName: target.subjectName,
      inputHash: prepared.inputHash,
      modelFingerprint: prepared.modelFingerprint,
      messages: prepared.messages,
      sources: prepared.sources,
      estTokensLow: prepared.estTokensLow,
      estTokensHigh: prepared.estTokensHigh,
      inputChars: prepared.inputChars,
    });
    console.log(
      `已导出 ${target.subjectName}（${prepared.usedDocCount}/${prepared.docCount} 篇，预估 ${prepared.estTokensLow}-${prepared.estTokensHigh} tokens）`,
    );
  }
  batch.totalEstHigh = batch.items.reduce((sum, item) => sum + (item.estTokensHigh ?? 0), 0);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(batch, null, 2), 'utf8');
  console.log(`\n批次已写入 ${out}`);
  console.log(`共 ${batch.items.length} 条，预估上界 ${batch.totalEstHigh} tokens`);
}

async function cmdRun(args) {
  const input = args.in;
  if (!input) throw new Error('缺少 --in');
  const out = args.out ?? input.replace(/\.json$/, '.results.json');
  const batch = JSON.parse(await readFile(input, 'utf8'));
  const results = { model: MODEL, savedAt: new Date().toISOString(), items: [] };
  for (const item of batch.items) {
    try {
      const llm = await callLlm(item.messages);
      results.items.push({
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        inputHash: item.inputHash,
        modelFingerprint: item.modelFingerprint,
        raw: llm.raw,
        usage: llm.usage,
      });
      console.log(`LLM 完成 ${item.subjectName}（in ${llm.usage.promptTokens} / out ${llm.usage.completionTokens}）`);
    } catch (error) {
      console.error(`LLM 失败 ${item.subjectName}: ${error.message}`);
      results.items.push({
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        error: String(error.message ?? error),
      });
    }
  }
  await writeFile(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n结果已写入 ${out}`);
}

async function cmdSave(args) {
  const input = args.in;
  if (!input) throw new Error('缺少 --in');
  const results = JSON.parse(await readFile(input, 'utf8'));
  const progress = await loadProgress();
  let saved = 0;
  let failed = 0;
  for (const item of results.items) {
    if (progress.saved.includes(item.subjectId)) {
      console.log(`跳过（已完成）${item.subjectName}`);
      continue;
    }
    if (item.error || !item.raw) {
      progress.failed.push({ subjectId: item.subjectId, reason: item.error ?? 'empty_raw' });
      failed += 1;
      continue;
    }
    const result = await api('/api/compile/save', {
      method: 'POST',
      body: JSON.stringify({
        subjectId: item.subjectId,
        inputHash: item.inputHash,
        modelFingerprint: item.modelFingerprint,
        raw: item.raw,
        usage: item.usage,
        generatedBy: 'workbuddy-batch',
        source: 'workbuddy',
      }),
    });
    if (result.ok) {
      saved += 1;
      progress.saved.push(item.subjectId);
      progress.tokensUsed = (progress.tokensUsed ?? 0) + (item.usage?.promptTokens ?? 0);
      console.log(
        `已落库 ${item.subjectName}：结论 ${result.claimsKept} 条（丢弃 ${result.claimsDropped}）置信度 ${result.confidence}`,
      );
    } else {
      failed += 1;
      progress.failed.push({ subjectId: item.subjectId, reason: result.reason });
      console.error(`落库被拒 ${item.subjectName}: ${result.reason}`);
    }
    await saveProgress(progress);
  }
  console.log(`\n保存 ${saved}，失败 ${failed}`);
}

/** 一体化：prepare → LLM → save。逐条落盘，中断后重跑自动跳过已完成。 */
async function cmdAuto(args) {
  const limit = Number(args.limit ?? 20);
  const queue = await api('/api/compile/queue');
  const progress = await loadProgress();
  const targets = queue
    .filter((item) => item.state !== 'done' && !progress.saved.includes(item.subjectId))
    .slice(0, limit);
  if (!targets.length) {
    console.log('没有待编译主体（或均已完成）');
    return;
  }
  console.log(`本次目标 ${targets.length} 个，今日已用 ${progress.tokensUsed ?? 0}/${DAY_BUDGET_TOKENS} tokens\n`);

  let consecutiveFailures = 0;
  for (const target of targets) {
    if ((progress.tokensUsed ?? 0) >= DAY_BUDGET_TOKENS) {
      console.warn(`已达单日预算硬顶 ${DAY_BUDGET_TOKENS} tokens，停止`);
      break;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`连续失败 ${consecutiveFailures} 次，熔断停批`);
      break;
    }
    try {
      const prepared = await api('/api/compile/prepare', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: target.subjectId,
          modelFingerprint: fingerprintOf(MODEL),
        }),
      });
      if (prepared.overBudget) {
        console.warn(`跳过 ${target.subjectName}：输入超硬顶`);
        continue;
      }
      console.log(
        `[${target.subjectName}] ${prepared.usedDocCount}/${prepared.docCount} 篇，预估 ${prepared.estTokensLow}-${prepared.estTokensHigh} tokens`,
      );
      const llm = await callLlm(prepared.messages);
      const result = await api('/api/compile/save', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: target.subjectId,
          inputHash: prepared.inputHash,
          modelFingerprint: prepared.modelFingerprint,
          raw: llm.raw,
          usage: llm.usage,
          generatedBy: 'workbuddy-batch',
          source: 'workbuddy',
        }),
      });
      if (!result.ok) {
        consecutiveFailures += 1;
        progress.failed.push({ subjectId: target.subjectId, reason: result.reason });
        console.error(`  落库被拒：${result.reason}`);
      } else {
        consecutiveFailures = 0;
        progress.saved.push(target.subjectId);
        console.log(
          `  ✓ 结论 ${result.claimsKept} 条（丢弃 ${result.claimsDropped}）置信度 ${result.confidence}｜实测 ${llm.usage.promptTokens} tokens`,
        );
      }
      progress.tokensUsed = (progress.tokensUsed ?? 0) + (llm.usage.promptTokens ?? 0);
    } catch (error) {
      consecutiveFailures += 1;
      progress.failed.push({ subjectId: target.subjectId, reason: String(error.message ?? error) });
      console.error(`  失败：${error.message ?? error}`);
    }
    await saveProgress(progress);
  }
  console.log(`\n完成。累计已落库 ${progress.saved.length} 个，token 用量 ${progress.tokensUsed ?? 0}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? 'list';
  console.log(`站点 ${BASE_URL} ｜ 模型 ${MODEL}（${fingerprintOf(MODEL)}）\n`);
  switch (command) {
    case 'list':
      await cmdList();
      break;
    case 'export':
      await cmdExport(args);
      break;
    case 'run':
      await cmdRun(args);
      break;
    case 'save':
      await cmdSave(args);
      break;
    case 'auto':
      await cmdAuto(args);
      break;
    default:
      console.error(`未知子命令：${command}`);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
