#!/usr/bin/env node
/**
 * 文章封面图上传工具（L0 方案：本地按约定规格压好再传，服务端零改动）
 * ---------------------------------------------------------------------------
 * 背景：Base「文章工作台」的「封面图」是 attachment 字段，服务端 `/media/articles/:recordId/cover`
 * 只透传第一张图。Base 的 append_attachments 是 **追加** 语义，直接传会在一格里堆多张图，
 * 因此本工具统一走「压缩 -> 清旧 -> 上传 -> 读回校验」四步。
 *
 * L0 约定规格（与前端 aspect-[16/9] + object-cover 对齐）：
 *   1600×900（16:9 居中裁切）/ JPEG / ≤ 300KB；原图更小时不放大。
 *
 * 用法：
 *   node scripts/cover.mjs list [--missing]            列出全部文章与封面状态
 *   node scripts/cover.mjs check <图片> [--fit ...]    只做规格体检，不写 Base
 *   node scripts/cover.mjs set <图片> --record recXXX  指定记录上传（替换式）
 *   node scripts/cover.mjs set <图片> --title 关键词   按标题模糊匹配（命中必须唯一）
 *   node scripts/cover.mjs clear --record recXXX       清空该记录封面
 *   node scripts/cover.mjs batch <清单文件>            批量：每行「标题关键词<TAB>图片路径」
 *
 * 通用开关：--fit cover|inside（默认 cover）--position centre|attention|top|bottom
 *          --dry-run（只压缩与匹配，不写 Base）
 *
 * 依赖：sharp（图像处理）。优先从本仓库 node_modules 解析，
 *       否则回退到 WorkBuddy 隔离工作区；两者都没有时给出安装提示。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------- 常量与配置

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const BASE_TOKEN = requireEnv('WIKI_BETA_BASE_TOKEN');
const TABLE_ID = requireEnv('WIKI_BETA_ARTICLE_TABLE_ID');
/**
 * 字段一律用 ID 传参（全 ASCII，规避 Windows 下中文经 cmd 往返的编码风险）。
 * ⚠️ 注意：CLI 返回的 `fields` 数组回显的是**字段中文名**，`field_id_list` 才是 ID，
 *    因此定位列必须用 field_id_list.indexOf(id)，不能拿 ID 去 fields 里找（恒为 -1）。
 * 字段若在 Base 里重建，需同步这两个 ID（可用环境变量覆盖）。
 */
const COVER_FIELD_ID = requireEnv('WIKI_BETA_COVER_FIELD_ID');
const TITLE_FIELD_ID = requireEnv('WIKI_BETA_TITLE_FIELD_ID');
/** 请求顺序：与返回的数据列顺序一一对应，作为 field_id_list 缺失时的回退依据。 */
const REQUESTED_FIELDS = [TITLE_FIELD_ID, COVER_FIELD_ID];

const APP_ID = process.env.WIKI_BETA_APP_ID?.trim() || 'app_EXAMPLE0000001';
const SITE_ORIGIN = (process.env.WIKI_BETA_SITE_ORIGIN || 'https://example.feishu.cn').replace(/\/+$/, '');

const TARGET_WIDTH = 1600;
const TARGET_HEIGHT = 900;
const MAX_BYTES = 300 * 1024;
/** 质量阶梯：依次降质，首次落到 300KB 以下即停。 */
const QUALITY_LADDER = [88, 82, 76, 70, 64, 58];
/** 降质到底仍超限时，再按这些宽度逐级缩小。 */
const WIDTH_LADDER = [TARGET_WIDTH, 1400, 1200, 1000, 800];
/** 每页拉取记录数（CLI 上限 200）。 */
const PAGE_SIZE = 100;

// ---------------------------------------------------------------- 终端输出

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text));
const dim = c('2');
const bold = c('1');
const red = c('31');
const green = c('32');
const yellow = c('33');
const cyan = c('36');

const info = (msg) => console.log(msg);
const ok = (msg) => console.log(`${green('✔')} ${msg}`);
const warn = (msg) => console.log(`${yellow('!')} ${msg}`);
const fail = (msg) => console.log(`${red('✘')} ${msg}`);

/** 中文按 2 列宽计算，用于对齐。 */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u.test(ch) ? 2 : 1;
  }
  return width;
}
function padDisplay(text, width) {
  const value = String(text);
  const pad = Math.max(0, width - displayWidth(value));
  return value + ' '.repeat(pad);
}
function truncateDisplay(text, width) {
  const value = String(text);
  if (displayWidth(value) <= width) return value;
  let acc = '';
  let used = 0;
  for (const ch of value) {
    const w = displayWidth(ch);
    if (used + w > width - 1) break;
    acc += ch;
    used += w;
  }
  return `${acc}…`;
}
const formatBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;

function previewUrl(recordId, fileToken) {
  const id = encodeURIComponent(recordId);
  const v = encodeURIComponent(String(fileToken).slice(0, 8));
  return `${SITE_ORIGIN}/app/${APP_ID}/media/articles/${id}/cover?v=${v}`;
}

// ---------------------------------------------------------------- 依赖解析

function loadSharp() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'sharp',
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'sharp'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* 继续尝试下一个候选路径 */
    }
  }
  throw new Error(
    [
      '未找到 sharp（图像处理依赖）。任选一种方式安装：',
      `  1) 装到本仓库：npm i -D sharp`,
      `  2) 装到隔离工作区：cd "${path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace')}" && npm i sharp`,
    ].join('\n'),
  );
}

function resolveCli() {
  const candidates = [
    process.env.LARK_CLI,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'cli-connector-packages', 'lark-cli.cmd'),
    'lark-cli',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'lark-cli' || existsSync(candidate)) return candidate;
  }
  throw new Error('未找到 lark-cli，请设置 LARK_CLI 环境变量指向 lark-cli 可执行文件。');
}

/** 从可能混有日志的输出里抠出 JSON 主体。 */
function extractJson(text) {
  if (!text) return null;
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(String(text).slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 调用 lark-cli 并解析 JSON。
 * 传参一律使用 ID（table-id / field-id / record-id），避免中文经 cmd 往返的编码风险。
 */
function runCli(args, { allowFail = false, quiet = false } = {}) {
  const cli = resolveCli();
  const fullArgs = [...args];
  if (!quiet) info(dim(`  $ ${path.basename(cli)} ${fullArgs.join(' ')}`));
  let stdout = '';
  try {
    stdout = execFileSync(cli, fullArgs, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const out = error.stdout?.toString() ?? '';
    const err = error.stderr?.toString() ?? '';
    const payload = extractJson(out) ?? extractJson(err);
    const message =
      payload?.error?.message || payload?.msg || payload?.error || err.trim().split('\n')[0] || error.message;
    if (allowFail) return { ok: false, error: message };
    throw new Error(`lark-cli 执行失败：${message}`);
  }
  const parsed = extractJson(stdout);
  if (!parsed) throw new Error(`无法解析 lark-cli 输出：${stdout.slice(0, 400)}`);
  return parsed;
}

// ---------------------------------------------------------------- Base 读写

/** 拉取全部文章记录：{ recordId, title, coverToken, coverName, coverSize }[] */
function fetchArticles() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = runCli(
      [
        'base',
        '+record-list',
        '--base-token',
        BASE_TOKEN,
        '--table-id',
        TABLE_ID,
        ...REQUESTED_FIELDS.flatMap((fieldId) => ['--field-id', fieldId]),
        '--limit',
        String(PAGE_SIZE),
        '--offset',
        String(offset),
        '--format',
        'json',
      ],
      { quiet: true },
    );
    if (res.ok === false) throw new Error(`读取记录失败：${res.error ?? '未知错误'}`);
    const data = res?.data ?? {};
    const matrix = data.data ?? [];
    const ids = data.record_id_list ?? [];
    const { titleIndex, coverIndex } = locateColumns(data);
    for (let i = 0; i < ids.length; i += 1) {
      const row = matrix[i] ?? [];
      const attachment = row[coverIndex];
      const first = Array.isArray(attachment) ? attachment[0] : null;
      rows.push({
        recordId: ids[i],
        title: String(row[titleIndex] ?? '').trim(),
        coverToken: first?.file_token ?? null,
        coverName: first?.name ?? null,
        coverSize: typeof first?.size === 'number' ? first.size : null,
      });
    }
    if (!data.has_more || ids.length === 0) break;
  }
  return rows;
}

/**
 * 定位「标题」「封面图」在数据行里的列下标。
 * field_id_list 是字段 ID 数组，与数据列一一对应；它缺失时回退到请求顺序。
 * 不能用 data.fields（那里回显的是字段中文名，拿 ID 去 indexOf 恒为 -1）。
 */
function locateColumns(data) {
  const idList = Array.isArray(data.field_id_list) ? data.field_id_list : [];
  const titleIndex = idList.indexOf(TITLE_FIELD_ID);
  const coverIndex = idList.indexOf(COVER_FIELD_ID);
  if (titleIndex >= 0 && coverIndex >= 0) return { titleIndex, coverIndex };
  return { titleIndex: 0, coverIndex: 1 };
}

/** 读单条记录的封面附件列表（用于上传后校验）。 */
function fetchCoverAttachments(recordId) {
  const res = runCli(
    [
      'base',
      '+record-get',
      '--base-token',
      BASE_TOKEN,
      '--table-id',
      TABLE_ID,
      '--record-id',
      recordId,
      '--field-id',
      COVER_FIELD_ID,
      '--format',
      'json',
    ],
    { quiet: true },
  );
  if (res.ok === false) throw new Error(`读取记录失败：${res.error ?? '未知错误'}`);
  const data = res?.data ?? {};
  const row = (data.data ?? [])[0] ?? [];
  const idList = Array.isArray(data.field_id_list) ? data.field_id_list : [];
  const index = idList.indexOf(COVER_FIELD_ID);
  const value = row[index >= 0 ? index : 0];
  return Array.isArray(value) ? value : [];
}

function removeAttachments(recordId, tokens) {
  if (!tokens.length) return;
  runCli(
    [
      'base',
      '+record-remove-attachment',
      '--base-token',
      BASE_TOKEN,
      '--table-id',
      TABLE_ID,
      '--record-id',
      recordId,
      '--field-id',
      COVER_FIELD_ID,
      ...tokens.flatMap((token) => ['--file-token', token]),
      '--yes',
      '--format',
      'json',
    ],
    { quiet: true },
  );
}

function uploadAttachment(recordId, filePath) {
  const res = runCli([
    'base',
    '+record-upload-attachment',
    '--base-token',
    BASE_TOKEN,
    '--table-id',
    TABLE_ID,
    '--record-id',
    recordId,
    '--field-id',
    COVER_FIELD_ID,
    '--file',
    filePath,
    '--format',
    'json',
  ]);
  if (res.ok === false) throw new Error(`上传失败：${res.error ?? '未知错误'}`);
  return res;
}

/** 清空封面：attachment 不能用普通 CellValue 写，但 null 可以清（坏附件删不掉时的唯一出路）。 */
function clearCoverCell(recordId) {
  const res = runCli([
    'base',
    '+record-batch-update',
    '--base-token',
    BASE_TOKEN,
    '--table-id',
    TABLE_ID,
    '--json',
    JSON.stringify({ update_records: { [recordId]: { [COVER_FIELD_ID]: null } } }),
    '--format',
    'json',
  ]);
  if (res.ok === false) throw new Error(`清空失败：${res.error ?? '未知错误'}`);
  return res;
}

// ---------------------------------------------------------------- 图像处理

/**
 * 按 L0 规格处理图片：16:9 裁切 -> 降质 -> 必要时缩小。
 * 返回 { buffer, width, height, quality, path, originalBytes, originalWidth, originalHeight }
 *
 * 几何说明：sharp 的 `withoutEnlargement` 与 `fit: cover` 同时使用会产出**非 16:9** 的结果
 * （例如 1080×900），因此这里自行算出「不放大前提下最大的 16:9 尺寸」再交给 cover 裁切。
 */
async function prepareImage(sharp, inputPath, { fit = 'cover', position = 'centre' } = {}) {
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata();
  const originalBytes = statSync(inputPath).size;
  // EXIF 方向 5-8 表示横竖互换，参与几何计算前先按显示方向纠正
  const swapped = [5, 6, 7, 8].includes(meta.orientation ?? 1);
  const srcWidth = (swapped ? meta.height : meta.width) ?? 0;
  const srcHeight = (swapped ? meta.width : meta.height) ?? 0;
  const ratio = TARGET_WIDTH / TARGET_HEIGHT;

  /** 不放大前提下，能容纳的最大 16:9 矩形。 */
  const coverSizeFor = (width) => {
    let w = Math.min(width, srcWidth || width, TARGET_WIDTH);
    let h = Math.round(w / ratio);
    if (srcHeight && h > srcHeight) {
      h = Math.min(srcHeight, TARGET_HEIGHT);
      w = Math.round(h * ratio);
    }
    return { w, h };
  };
  /** inside 模式：等比缩到指定宽，不放大。 */
  const insideWidthFor = (width) => Math.min(width, srcWidth || width);

  const buildPipeline = (width, quality) => {
    let pipe = sharp(inputPath, { failOn: 'none' }).rotate(); // 按 EXIF 自动校正方向
    if (fit === 'cover') {
      const { w, h } = coverSizeFor(width);
      pipe = pipe.resize(w, h, { fit: 'cover', position });
    } else {
      pipe = pipe.resize({ width: insideWidthFor(width), withoutEnlargement: true, fit: 'inside' });
    }
    return pipe.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' });
  };

  let best = null;
  let lastKey = '';
  outer: for (const width of WIDTH_LADDER) {
    const geometry = fit === 'cover' ? coverSizeFor(width) : { w: insideWidthFor(width) };
    const key = `${geometry.w}x${geometry.h ?? ''}`;
    if (key === lastKey) continue; // 原图本就比目标小：后续档位尺寸不变，跳过重复编码
    lastKey = key;
    for (const quality of QUALITY_LADDER) {
      const buffer = await buildPipeline(width, quality).toBuffer();
      best = { buffer, quality, width: geometry.w, height: geometry.h ?? null };
      if (buffer.length <= MAX_BYTES) break outer;
    }
  }

  const outDir = path.join(os.tmpdir(), 'wiki-beta-covers');
  mkdirSync(outDir, { recursive: true });
  const baseName = path.basename(inputPath).replace(/\.[^.]+$/u, '');
  const outPath = path.join(outDir, `${baseName}-l0.jpg`);
  writeFileSync(outPath, best.buffer);

  const outMeta = await sharp(best.buffer).metadata();
  return {
    buffer: best.buffer,
    path: outPath,
    width: outMeta.width,
    height: outMeta.height,
    quality: best.quality,
    originalBytes,
    originalWidth: srcWidth,
    originalHeight: srcHeight,
    oversized: best.buffer.length > MAX_BYTES,
  };
}

function reportImage(prepared, inputPath) {
  const { originalBytes, originalWidth, originalHeight, width, height, quality, buffer, oversized } = prepared;
  info(`  原图  ${path.basename(inputPath)}  ${originalWidth}×${originalHeight}  ${formatBytes(originalBytes)}`);
  info(`  产出  ${width}×${height}  JPEG q${quality}  ${formatBytes(buffer.length)}`);
  const saved = originalBytes > 0 ? (1 - buffer.length / originalBytes) * 100 : 0;
  if (saved > 0) info(dim(`  体积  减少 ${saved.toFixed(0)}%`));
  if (oversized) warn(`压缩到极限仍超过 ${formatBytes(MAX_BYTES)}，建议换一张构图更简单的图。`);
}

// ---------------------------------------------------------------- 记录匹配

function matchRecord(articles, { recordId, title }) {
  if (recordId) {
    const hit = articles.find((item) => item.recordId === recordId);
    if (!hit) throw new Error(`找不到记录 ${recordId}（共 ${articles.length} 条文章记录）。`);
    return hit;
  }
  const keyword = String(title ?? '').trim().toLowerCase();
  if (!keyword) throw new Error('请用 --record <记录ID> 或 --title <标题关键词> 指定目标记录。');
  const hits = articles.filter((item) => item.title.toLowerCase().includes(keyword));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    const loose = articles.filter((item) => {
      const a = [...item.title.toLowerCase()];
      return [...keyword].filter((ch) => a.includes(ch)).length >= Math.min(4, keyword.length);
    });
    const hint = loose.slice(0, 5).map((item) => `    ${item.title}`).join('\n');
    throw new Error(`标题不含「${title}」，没有匹配到记录。${hint ? `\n  可能想找的是：\n${hint}` : ''}`);
  }
  const list = hits.slice(0, 10).map((item) => `    ${item.title}  [${item.recordId}]`).join('\n');
  throw new Error(`「${title}」命中 ${hits.length} 条，无法确定目标，请改用 --record 精确指定：\n${list}`);
}

// ---------------------------------------------------------------- 子命令

function cmdList(articles, flags) {
  const rows = flags.missing ? articles.filter((item) => !item.coverToken) : articles;
  if (flags.json) {
    info(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    ok('所有文章都已有封面图。');
    return;
  }
  const withCover = articles.filter((item) => item.coverToken).length;
  info(
    `${bold('文章封面状态')}  ${dim(`共 ${articles.length} 篇 · 已配图 ${withCover} 篇 · 待配图 ${articles.length - withCover} 篇`)}`,
  );
  info('');
  info(dim(`  ${padDisplay('#', 4)}${padDisplay('封面', 6)}${padDisplay('标题', 56)}记录 ID`));
  rows.forEach((item, index) => {
    const mark = item.coverToken ? green('有') : yellow('无');
    const size = item.coverSize ? dim(` (${formatBytes(item.coverSize)})`) : '';
    info(
      `  ${padDisplay(index + 1, 4)}${padDisplay(mark, 6)}${padDisplay(truncateDisplay(item.title, 54), 56)}${dim(item.recordId)}${size}`,
    );
  });
  info('');
  info(dim('  传图：node scripts/cover.mjs set <图片路径> --record <记录ID>'));
  info(dim('  或　：node scripts/cover.mjs set <图片路径> --title "标题关键词"'));
}

async function cmdCheck(sharp, inputPath, flags) {
  if (!existsSync(inputPath)) throw new Error(`图片不存在：${inputPath}`);
  info(bold('规格体检（不写 Base）'));
  const prepared = await prepareImage(sharp, inputPath, {
    fit: flags.fit ?? 'cover',
    position: flags.position ?? 'centre',
  });
  reportImage(prepared, inputPath);
  ok(`合格，可直接上传。临时文件：${prepared.path}`);
}

async function applyCover(sharp, articles, inputPath, flags) {
  const dryRun = Boolean(flags['dry-run']);
  if (!existsSync(inputPath)) throw new Error(`图片不存在：${inputPath}`);

  const target = matchRecord(articles, { recordId: flags.record, title: flags.title });
  const prepared = await prepareImage(sharp, inputPath, {
    fit: flags.fit ?? 'cover',
    position: flags.position ?? 'centre',
  });

  info('');
  info(`${bold('目标')}  ${target.title}`);
  info(dim(`      ${target.recordId}`));
  reportImage(prepared, inputPath);
  info('');

  if (dryRun) {
    warn('--dry-run：已完成压缩与匹配，未写入 Base。');
    return { status: 'dry-run', target };
  }

  const previous = fetchCoverAttachments(target.recordId);
  if (previous.length) {
    info(dim(`  清理旧封面 ${previous.length} 张（append 语义必须先清后传）`));
    removeAttachments(
      target.recordId,
      previous.map((item) => item.file_token).filter(Boolean),
    );
  }

  uploadAttachment(target.recordId, prepared.path);

  // 读回校验：append 语义下 CLI 偶发双写，此处做自愈收敛
  let attachments = fetchCoverAttachments(target.recordId);
  if (attachments.length > 1) {
    warn(`检测到 ${attachments.length} 张附件，正在收敛为 1 张…`);
    const newest = attachments[attachments.length - 1];
    const stale = attachments.filter((item) => item.file_token !== newest.file_token).map((item) => item.file_token);
    removeAttachments(target.recordId, stale.filter(Boolean));
    attachments = fetchCoverAttachments(target.recordId);
  }
  if (attachments.length !== 1) {
    throw new Error(`写入后校验失败：封面字段现有 ${attachments.length} 张附件（期望 1 张）。`);
  }

  const token = attachments[0].file_token;
  ok(`上传成功  ${token}`);
  info(`  预览  ${cyan(previewUrl(target.recordId, token))}`);
  return { status: 'uploaded', target, token };
}

async function cmdSet(sharp, articles, inputPath, flags) {
  if (!inputPath) throw new Error('用法：node scripts/cover.mjs set <图片路径> --record <记录ID>');
  await applyCover(sharp, articles, inputPath, flags);
}

function cmdClear(articles, flags) {
  const target = matchRecord(articles, { recordId: flags.record, title: flags.title });
  if (!target.coverToken) {
    warn(`「${target.title}」本来就没有封面图，无需清理。`);
    return;
  }
  if (flags['dry-run']) {
    warn(`--dry-run：将清空「${target.title}」的封面（${target.coverToken}）。`);
    return;
  }
  const attachments = fetchCoverAttachments(target.recordId);
  const tokens = attachments.map((item) => item.file_token).filter(Boolean);
  if (tokens.length) {
    // 常规路径：先尝试按 token 删除
    try {
      removeAttachments(target.recordId, tokens);
    } catch (error) {
      warn(`按 token 删除失败（${error.message}），改用置空。`);
    }
  }
  if (fetchCoverAttachments(target.recordId).length) {
    warn('仍残留附件（可能是坏附件），改用 null 置空。');
    clearCoverCell(target.recordId);
  }
  ok(`已清空「${target.title}」的封面。`);
}

async function cmdBatch(sharp, articles, manifestPath, flags) {
  if (!existsSync(manifestPath)) throw new Error(`清单文件不存在：${manifestPath}`);
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/u);
  const jobs = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\t|\s*\|\s*/u).map((part) => part.trim());
    if (parts.length < 2) {
      warn(`第 ${index + 1} 行格式不对，已跳过：${line}`);
      return;
    }
    jobs.push({ title: parts[0], image: parts[1], line: index + 1 });
  });
  if (!jobs.length) throw new Error('清单里没有有效任务行（格式：「标题关键词<TAB>图片路径」）。');

  info(bold(`批量上传 ${jobs.length} 条`));
  const results = [];
  for (const job of jobs) {
    info('');
    info(`▸ [${job.line}] ${job.title}`);
    try {
      const result = await applyCover(sharp, articles, job.image, { ...flags, title: job.title, record: undefined });
      results.push({ ...job, status: result.status });
    } catch (error) {
      fail(`${job.title} -> ${error.message.split('\n')[0]}`);
      results.push({ ...job, status: 'failed', error: error.message });
    }
  }
  info('');
  const done = results.filter((item) => item.status === 'uploaded').length;
  const skipped = results.filter((item) => item.status === 'dry-run').length;
  const failed = results.filter((item) => item.status === 'failed');
  info(bold(`完成：成功 ${done} · 试跑 ${skipped} · 失败 ${failed.length}`));
  failed.forEach((item) => info(`  ${red('✘')} ${item.title}：${item.error.split('\n')[0]}`));

  const logPath = path.join(os.tmpdir(), 'wiki-beta-covers', 'batch-result.json');
  writeFileSync(logPath, JSON.stringify(results, null, 2));
  info(dim(`  明细：${logPath}`));
}

// ---------------------------------------------------------------- 入口

const USAGE = `
${bold('文章封面图上传工具（L0）')}

  列出文章与封面状态    node scripts/cover.mjs list [--missing] [--json]
  规格体检（不写库）    node scripts/cover.mjs check <图片> [--fit inside]
  上传/替换封面         node scripts/cover.mjs set <图片> --record <记录ID>
                        node scripts/cover.mjs set <图片> --title <标题关键词>
  清空封面              node scripts/cover.mjs clear --record <记录ID>
  批量上传              node scripts/cover.mjs batch <清单文件>

  规格：1600×900（16:9 裁切）/ JPEG / ≤300KB，小图不放大
  开关：--fit cover|inside   --position centre|attention|top|bottom   --dry-run

  清单文件格式（每行一条，# 开头为注释）：
    杖剑传说<TAB>E:/covers/zhangjian.png
    Example Game | ./covers/example.jpg
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || flags.help || command === 'help') {
    info(USAGE.trim());
    return;
  }

  if (command === 'list') {
    cmdList(fetchArticles(), flags);
    return;
  }
  if (command === 'check') {
    await cmdCheck(loadSharp(), positional[1], flags);
    return;
  }
  if (command === 'clear') {
    cmdClear(fetchArticles(), flags);
    return;
  }
  if (command === 'set') {
    const sharp = loadSharp();
    await cmdSet(sharp, fetchArticles(), positional[1], flags);
    return;
  }
  if (command === 'batch') {
    const sharp = loadSharp();
    await cmdBatch(sharp, fetchArticles(), positional[1], flags);
    return;
  }

  throw new Error(`未知子命令「${command}」。\n\n${USAGE.trim()}`);
}

main().catch((error) => {
  fail(error.message);
  process.exitCode = 1;
});
