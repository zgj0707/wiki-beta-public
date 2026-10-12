#!/usr/bin/env node
/**
 * 榜单数据生成器（#榜单静态化 → React 数据驱动）
 *
 * 读取「数据监控与榜单」下 3 张飞书多维表格的真实数据：
 *   - AppStore SLG 周下载榜：多周期（周榜 + 收入月榜）
 *   - 微信小游戏畅销榜：单页（双品类 → 各品类下子品类卡片）
 *   - Steam 榜单：按周次索引；内嵌 workbuddy.link 生成的 HTML 文档（srcdoc iframe）
 *
 * 输出 client/src/data/rankings/ 与 shared/ranking-fallback-meta.ts：
 *   - contents/<board>-<slug>.html：每周期/单页的 inner body HTML 片段
 *     （Steam 周期是完整 HTML 文档，含 <head><style>...</style></head><body>...</body>）
 *   - index.ts：AUTO-GENERATED，导出 BOARDS_META 元数据 + BOARD_CONTENT_LOADERS
 *     （正文经动态 import(?raw) 按需加载，不进主包）
 *   - ranking-fallback-meta.ts：服务端可读的静态归档元数据（期次 + 排序键）
 *
 * 运行时无需静态服务器，无需 iframe；每个周期是独立的 React 路由页面。
 * Steam 周期用 iframe + srcdoc 载入自包含 HTML，样式天然隔离。
 *
 * 两条产出口径（前端依赖）：
 *   1. periods 一律按时间倒序（索引 0 = 最新一期），前端默认展示最新一期；
 *   2. 空榜不产出：源表登记了周次但拉不到 HTML 的周期会被跳过，并清理其残留内容文件。
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const WIKI = process.env.WIKI_BETA_FEISHU_WIKI_BASE_URL?.trim() || 'https://example.feishu.cn/wiki/';
const MAIN_SHEET_TOKEN = process.env.WIKI_BETA_RANKING_MAIN_SHEET_TOKEN?.trim() || 'shtEXAMPLEMAINSHEET01';
const MAIN_SHEET_ID = process.env.WIKI_BETA_RANKING_MAIN_SHEET_ID?.trim() || 'sheetEXAMPLE01';
const DATA_DIR = join(process.cwd(), 'client/src/data/rankings');
const CONTENTS_DIR = join(DATA_DIR, 'contents');
const INDEX_TS = join(DATA_DIR, 'index.ts');
const FALLBACK_META_TS = join(process.cwd(), 'shared/ranking-fallback-meta.ts');

// ---------- lark-cli ----------
function resolveLarkCli() {
  if (process.env.LARK_CLI?.trim()) return process.env.LARK_CLI.trim();
  const base = join(os.homedir(), '.workbuddy', 'binaries', 'node');
  try {
    for (const v of readdirSync(join(base, 'versions'))) {
      const p = join(base, 'versions', v, 'lark-cli.cmd');
      if (existsSync(p)) return p;
    }
  } catch {}
  return 'lark-cli';
}
const LARK = resolveLarkCli();

function runLark(args) {
  const cmd = `"${LARK}" ${args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')}`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
function parseJson(out) {
  const s = out.indexOf('{');
  const e = out.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    return JSON.parse(out.slice(s, e + 1));
  } catch {
    return null;
  }
}

// AppStore 榜单在主知识库表的「数据监控&榜单统计」列中以 @提及维护。
// 不再依赖知识库树里可能过期的同名旧节点，避免漏掉新周期。
function resolveMentionedSheetToken(titleMatcher) {
  const res = parseJson(
    runLark([
      'sheets',
      '+cells-get',
      '--spreadsheet-token',
      MAIN_SHEET_TOKEN,
      '--sheet-id',
      MAIN_SHEET_ID,
      '--range',
      'A1:D200',
      '--as',
      'user',
      '--format',
      'json',
    ]),
  );
  const ranges = res?.data?.ranges ?? [];
  for (const range of ranges) {
    for (const row of range.cells ?? []) {
      for (const cell of row ?? []) {
        for (const item of cell.rich_text ?? []) {
          if (item.type === 'mention' && item.mention_token && titleMatcher.test(String(item.text ?? ''))) {
            return item.mention_token;
          }
        }
      }
    }
  }
  throw new Error('未在主知识库表中找到匹配的榜单 @提及');
}

// ---------- 读取 ----------
function workbookInfo(nodeToken) {
  const res = parseJson(
    runLark(['sheets', '+workbook-info', '--url', WIKI + nodeToken, '--as', 'user', '--format', 'json']),
  );
  return res?.data?.sheets ?? [];
}
function csvRows(nodeToken, loc) {
  const arg = loc.sheetId ? ['--sheet-id', loc.sheetId] : ['--sheet-name', loc.sheetName];
  const res = parseJson(
    runLark(['sheets', '+csv-get', '--url', WIKI + nodeToken, ...arg, '--range', 'A1:T200', '--as', 'user', '--format', 'json']),
  );
  const txt = res?.data?.annotated_csv || '';
  return parseAnnotatedCsv(txt);
}

function parseAnnotatedCsv(text) {
  const lines = text.split('\n');
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    const m = line.match(/^\[row=\d+\]\s?(.*)$/);
    if (m) line = m[1];
    else if (/^\[row=\d+\]/.test(line)) {
      i++;
      continue;
    }
    let field = line;
    let depth = (field.match(/"/g) || []).length;
    while (depth % 2 === 1 && i + 1 < lines.length) {
      i++;
      field += '\n' + lines[i];
      depth = (field.match(/"/g) || []).length;
    }
    rows.push(csvLineToArray(field));
    i++;
  }
  return rows;
}
function csvLineToArray(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (inQ) {
      if (c === '"') {
        if (line[k + 1] === '"') {
          cur += '"';
          k++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- Steam HTML 抓取 ----------
/**
 * 把 workbuddy.link/p/<nodeId> 这条分享链接解析到真实的静态资源 URL：
 *   1. 拉 share 页 → 抽取 __PUBLISH_BOOTSTRAP__ JSON
 *   2. bootstrap.artifact.url + bootstrap.artifact.artifacts[0].path = 真实 HTML 路径
 * 不同周次的 page 索引可能是 0 或 1，文件名可能是 Steam_XX.html 或 Steam_2026XX.html，
 * 必须从 bootstrap 取，不能写死。
 */
function fetchSteamArtifactHtml(shareUrl) {
  const share = execSync(
    `curl -sL -A "Mozilla/5.0" --max-time 20 "${shareUrl.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const m = share.match(/__PUBLISH_BOOTSTRAP__=({[^<]*});/);
  if (!m) throw new Error('bootstrap not found: ' + shareUrl);
  const boot = JSON.parse(m[1]);
  const base = boot?.artifact?.url;
  const path = boot?.artifact?.artifacts?.[0]?.path;
  if (!base || !path) throw new Error('artifact fields missing: ' + shareUrl);
  const url = base + path;
  const html = execSync(
    `curl -sL -A "Mozilla/5.0" --max-time 30 "${url.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (html.length < 500) throw new Error('artifact too small: ' + url);
  return html;
}

/** 去掉 workbuddy.link 编辑器注入的元数据（不影响视觉，但增加体积） */
function stripEditorMeta(html) {
  return html
    .replace(/\s*data-page-node-id="[^"]*"/g, '')
    .replace(/\s*data-pnid-children="[^"]*"/g, '')
    .replace(/<!--pnid:[^>]*-->/g, '');
}

// ---------- 周期时间排序 / 空榜过滤 ----------
// 约定：periods 一律按时间倒序输出（索引 0 = 最新一期），前端据此默认展示最新一期。
// 键值只在同一 board 内比较，数值越大越新。
/** AppStore 周榜：slug 形如 w08260902（0826-0902），取区间结束日 MMDD 作键。 */
function appstoreWeekKey(slug) {
  const m = slug.match(/^w(\d{4})(\d{4})$/);
  if (!m) return 0;
  const start = Number(m[1]);
  const end = Number(m[2]);
  // 跨年周（如 1229-0104）结束日小于开始日：抬高到次年之后，避免排到最后。
  return end >= start ? end : end + 10000;
}
/**
 * AppStore 收入月榜：源表名里带月份（如「8月」），以「月末」参与排序，
 * 使月榜与周榜在同一时间轴上可比（8月 → 831，落在 0812-0818 与 0826-0902 之间）。
 * 解析不到月份时返回 0，退化为排在最后。
 */
function appstoreMonthlyKey(sheetName) {
  const m = String(sheetName).match(/(\d{1,2})\s*月/);
  if (!m) return 0;
  return Number(m[1]) * 100 + 31;
}
/** Steam：label 形如「2026年第37周」，键 = 年 * 100 + 周。 */
function steamWeekKey(label) {
  const m = String(label).match(/(\d{4})\D*?(\d{1,2})\s*周/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}
/** 按时间倒序排列（同键保持原顺序，Node 的 sort 稳定）。 */
function sortByTimeDesc(list) {
  return list.slice().sort((a, b) => b.key - a.key);
}
/** 清理该 board 已不再产出的旧内容文件（如空榜周次被跳过后的残留）。 */
function pruneStaleContents(board, keepSlugs) {
  const keep = new Set(keepSlugs.map((slug) => `${board}-${slug}.html`));
  for (const file of readdirSync(CONTENTS_DIR)) {
    if (!file.startsWith(`${board}-`) || !file.endsWith('.html')) continue;
    if (keep.has(file)) continue;
    rmSync(join(CONTENTS_DIR, file), { force: true });
    console.log(`[${board}] 清理过期内容文件 ${file}`);
  }
}

/** 抽取 <head><style>...</style> 全部 CSS + <body>...</body> 全部内容 */
function extractCssAndBody(html) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  let css = '';
  if (headMatch) {
    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let sm;
    while ((sm = styleRe.exec(headMatch[1])) !== null) css += sm[1] + '\n';
  }
  const body = bodyMatch ? bodyMatch[1] : html;
  return { css, body };
}

/** 把多个源 HTML（同一周次的多个分享链接）合成一个自包含文档；无可用来源时返回 null（空榜）。 */
function buildSteamDoc(shareUrls, weekLabel) {
  const docs = [];
  for (const u of shareUrls) {
    try {
      const raw = fetchSteamArtifactHtml(u);
      docs.push(stripEditorMeta(raw));
    } catch (e) {
      console.warn(`[steam] 拉取失败 ${u}: ${e?.message || e}`);
    }
  }
  // 空榜：源表登记了周次但没有任何可用的榜单 HTML → 返回 null，由调用方跳过该周次，
  // 不再产出「暂时不可达」占位页（占位页会让榜单页出现空榜入口）。
  if (!docs.length) return null;
  let allCss = '';
  let allBody = '';
  docs.forEach((html, i) => {
    const { css, body } = extractCssAndBody(html);
    allCss += css + '\n';
    if (i > 0) allBody += `\n<div style="margin:24px 0;border-top:2px dashed #e5e7eb"></div>\n`;
    allBody += body;
  });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steam 榜单 · ${esc(weekLabel)}</title>
<style>
${allCss}
/* host 页字体兜底 */
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
</style>
</head>
<body>
${allBody}
</body>
</html>`;
}

// ---------- builders ----------
function buildTablePage(rows) {
  if (!rows.length) return null;
  let headerIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const first = (rows[r][0] || '').trim();
    if (first && /排名/.test(first)) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) return null;
  let note = '';
  for (let r = 0; r < headerIdx; r++) {
    const first = (rows[r][0] || '').trim();
    if (first && !/排名/.test(first)) {
      note = first;
      break;
    }
  }
  const header = rows[headerIdx];
  const data = rows.slice(headerIdx + 1).filter((r) => (r[0] || '').trim() && (r[1] || '').trim());
  // 过滤空列：整列数据都为空的列（图片列 CSV 导出为空、或飞书表尾部的空列）不渲染，
  // 避免空列占宽导致右侧有内容列（备注/投放地区）被挤出容器、横向截断。
  const keepCol = [];
  for (let i = 0; i < header.length; i++) {
    if (data.every((r) => !(r[i] || '').trim())) continue;
    keepCol.push(i);
  }
  const th = keepCol.map((i) => `<th class="${i === 0 ? 'rank' : ''}">${esc(header[i])}</th>`).join('');
  const tr = data
    .map((r) => {
      const tds = keepCol.map((i) => {
        const c = r[i];
        let v = esc(c);
        if (/^https?:\/\//.test((c || '').trim()) && /\.(png|jpe?g|gif|webp|svg)$/i.test(c)) {
          v = `<img src="${esc(c)}" alt="icon" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">`;
        }
        return `<td class="${i === 0 ? 'rank' : ''}">${v}</td>`;
      });
      return `<tr>${tds.join('')}</tr>`;
    })
    .join('');
  const body = `<div class="table-card"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  return { note, body };
}

/**
 * 微信榜单：以"like 品类"为单元分卡片，绝不渲染成排行榜。
 *  - 所有 like 品类（含靶心like / 无尽-like）平等，平铺进一个 grid，不设任何小标题。
 *  - 子品类识别：名字以 like 结尾（兼容 "X-like" / "X/Y-like"，如 DNF-like、闪烁/AFK-like）。
 */
function buildWeixinInner(rows) {
  const g1Name = (rows[0] && rows[0][0]) || '靶心like';
  const g2Name = (rows[0] && rows[0][3]) || '无尽-like';
  const data = rows.slice(1);

  function extractCards(rows, nameCol, descCol, defaultName) {
    const cards = [];
    let current = { name: defaultName, games: [] };
    for (const r of rows) {
      const name = (r[nameCol] || '').trim();
      const desc = (r[descCol] || '').trim();
      if (!name && !desc) continue;
      // 子品类识别：名字以 like 结尾（兼容 "X-like" / "X/Y-like"，如 DNF-like、闪烁/AFK-like）。
      // desc 为空或 "融合点" 都允许，避免源数据漏写 desc 导致被当成游戏名吞进上一张卡。
      const isSubLike = /[-/]?like$/i.test(name);
      if (isSubLike) {
        if (current.games.length > 0) cards.push(current);
        current = { name, games: [] };
      } else if (name) {
        current.games.push({ name, desc });
      }
    }
    if (current.games.length > 0) cards.push(current);
    return cards;
  }

  // 两列各取出 like 卡，合并为平铺数组（靶心like / 无尽-like 只是其中一个普通卡，不当标题）
  const cards = [...extractCards(data, 0, 1, g1Name), ...extractCards(data, 3, 4, g2Name)];

  const card = (c) => {
    const games = c.games.length
      ? `<ul class="like-games">${c.games
          .map(
            (g) =>
              `<li><div class="game-name">${esc(g.name)}</div>${g.desc ? `<div class="game-desc">${esc(g.desc)}</div>` : ''}</li>`,
          )
          .join('')}</ul>`
      : `<div class="like-empty">该 like 品类下暂无收录游戏。</div>`;
    return `<article class="like-card"><h3 class="like-name">${esc(c.name)}</h3>${games}</article>`;
  };

  // 扁平 grid：所有 like 平等平铺，不渲染任何 section 小标题
  return `<div class="like-grid">${cards.map(card).join('')}</div>`;
}

// ---------- inner body emit ----------
// 写临时文件再重命名，规避 Windows 文件锁导致的间歇 EPERM
function replaceGeneratedFile(tmp, final) {
  try {
    renameSync(tmp, final);
  } catch (error) {
    // Windows 的 renameSync 不能覆盖已有文件；只在确认目标是本生成器的既有产物时替换。
    if (process.platform !== 'win32' || !existsSync(final)) throw error;
    rmSync(final, { force: true });
    renameSync(tmp, final);
  }
}
function emit(board, slug, innerHtml) {
  const final = join(CONTENTS_DIR, `${board}-${slug}.html`);
  const tmp = final + '.tmp';
  writeFileSync(tmp, innerHtml, 'utf8');
  replaceGeneratedFile(tmp, final);
}
function varName(board, slug) {
  return board + slug.charAt(0).toUpperCase() + slug.slice(1);
}

// ---------- generate ----------
const appStoreNode = resolveMentionedSheetToken(/AppStore\s*SLG.*下载榜/i);
const NODES = {
  appstore: appStoreNode,
  weixin:
    process.env.WIKI_BETA_RANKING_WEIXIN_WIKI_NODE_TOKEN?.trim() ||
    'wikEXAMPLEWEIXIN001',
  steam:
    process.env.WIKI_BETA_RANKING_STEAM_WIKI_NODE_TOKEN?.trim() ||
    'wikEXAMPLESTEAM0001',
};

mkdirSync(CONTENTS_DIR, { recursive: true });
// 不在脚本内清理 contents/：由生成器对每个已知 slug 覆盖写（writeFileSync 不经过 safe-delete）。
// 如有遗漏的旧 slug 残留，运行前手动 rm 'client/src/data/rankings/contents/*.html'。

const boards = {};

// AppStore
{
  console.log(`[appstore] source ← 主知识库 @提及 ${NODES.appstore}`);
  const tabs = workbookInfo(NODES.appstore);
  const collected = [];
  for (const t of tabs) {
    const rows = csvRows(NODES.appstore, { sheetId: t.sheet_id });
    const isMonthly = /月/.test(t.sheet_name);
    const slug = isMonthly ? 'monthly' : `w${t.sheet_name.replace(/[^0-9]/g, '')}`;
    const label = isMonthly ? '收入月榜' : `周榜 ${t.sheet_name}`;
    const built = buildTablePage(rows);
    if (!built) continue;
    const inner = (built.note ? `<div class="note">${esc(built.note)}</div>` : '') + built.body;
    collected.push({
      slug,
      label,
      inner,
      key: isMonthly ? appstoreMonthlyKey(t.sheet_name) : appstoreWeekKey(slug),
    });
  }
  const ordered = sortByTimeDesc(collected);
  const periods = [];
  const contents = {};
  for (const p of ordered) {
    emit('appstore', p.slug, p.inner);
    periods.push({ slug: p.slug, label: p.label, sortKey: p.key });
    contents[p.slug] = varName('appstore', p.slug);
  }
  pruneStaleContents('appstore', periods.map((p) => p.slug));
  boards.appstore = {
    title: 'AppStore SLG 周下载榜',
    sourceUrl: WIKI + NODES.appstore,
    type: 'periods',
    periods,
    contents,
  };
  console.log(`[appstore] ${periods.length} 个周期（时间倒序，默认 ${periods[0]?.label ?? '—'}）`);
}

// Weixin
{
  const rows = csvRows(NODES.weixin, { sheetName: 'Sheet1' });
  const inner = buildWeixinInner(rows);
  emit('weixin', 'index', inner);
  boards.weixin = {
    title: '微信小游戏畅销榜',
    sourceUrl: WIKI + NODES.weixin,
    type: 'single',
    periods: [],
    contents: { index: varName('weixin', 'index') },
  };
  console.log(`[weixin] 1 页（按 like 品类分卡片）`);
}

// Steam
{
  const rows = csvRows(NODES.steam, { sheetName: 'Sheet1' });
  const weeks = rows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && /(周|月)/.test(r[0]));
  const collected = [];
  const skipped = [];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const week = (w[0] || '').trim();
    const slug = 'w' + i;
    const shareUrls = (w[1] || '').split(/[\n;；]+/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x));
    const doc = buildSteamDoc(shareUrls, week);
    // 空榜（源表登记了周次但没有可用 HTML）：跳过，不产出入口与内容文件。
    if (!doc) {
      skipped.push(week);
      continue;
    }
    console.log(`[steam] ${week} ← ${shareUrls.length} 个分享链接`);
    collected.push({ slug, label: week, doc, key: steamWeekKey(week) });
  }
  const ordered = sortByTimeDesc(collected);
  const periods = [];
  const contents = {};
  for (const p of ordered) {
    emit('steam', p.slug, p.doc);
    periods.push({ slug: p.slug, label: p.label, sortKey: p.key });
    contents[p.slug] = varName('steam', p.slug);
  }
  pruneStaleContents('steam', periods.map((p) => p.slug));
  boards.steam = {
    title: 'Steam 榜单',
    sourceUrl: WIKI + NODES.steam,
    type: 'periods',
    periods,
    contents,
  };
  console.log(
    `[steam] ${periods.length} 个周次（时间倒序，默认 ${periods[0]?.label ?? '—'}）` +
      (skipped.length ? `；跳过空榜 ${skipped.length} 个：${skipped.join('、')}` : ''),
  );
}

// ---------- write index.ts ----------
// 榜单正文不再静态 import 打进主包：BOARDS_META 只含元数据；
// 正文经动态 import(?raw) 按需加载（每期独立 chunk），避免 600KB+ HTML 进入首屏。
function genIndexTs(boards) {
  const loaderEntries = [];
  const entries = [];
  for (const [key, b] of Object.entries(boards)) {
    const loaders = Object.keys(b.contents)
      .map(
        (slug) =>
          `    ${JSON.stringify(slug)}: () => import('./contents/${key}-${slug}.html?raw').then((m) => m.default),`,
      )
      .join('\n');
    loaderEntries.push(`  ${key}: {\n${loaders}\n  }`);
    const periodsStr = b.periods.length
      ? '[' + b.periods.map((p) => `{ slug: ${JSON.stringify(p.slug)}, label: ${JSON.stringify(p.label)} }`).join(', ') + ']'
      : '[]';
    entries.push(`  ${key}: {
    title: ${JSON.stringify(b.title)},
    sourceUrl: ${JSON.stringify(b.sourceUrl)},
    type: ${JSON.stringify(b.type)} as const,
    periods: ${periodsStr},
  }`);
  }
  return `// AUTO-GENERATED by scripts/gen-ranking-pages.mjs — do not edit.
// 榜单元数据（标题/来源/周期）与正文 HTML 分离：
//   - BOARDS_META 不含正文，可被任意页面静态引用（体积仅数百字节）
//   - 正文通过 BOARD_CONTENT_LOADERS 按期动态 import(?raw)，仅榜单页当前期才下载

export type BoardKey = ${Object.keys(boards).map((k) => JSON.stringify(k)).join(' | ')};
export type Period = { slug: string; label: string };
export type BoardData = {
  title: string;
  sourceUrl: string;
  type: 'periods' | 'single';
  periods: Period[];
};

export const BOARDS_META: Record<BoardKey, BoardData> = {
${entries.join(',\n')},
};

/** 正文按需加载器：每个文件独立 chunk，仅命中当前期的下载。 */
export const BOARD_CONTENT_LOADERS: Record<
  BoardKey,
  Record<string, () => Promise<string>>
> = {
${loaderEntries.join(',\n')},
};

/** 按榜单+周期取正文 HTML；无对应内容时返回 null（调用方据此展示未找到）。 */
export async function loadBoardContent(
  board: BoardKey,
  slug: string,
): Promise<string | null> {
  const load = BOARD_CONTENT_LOADERS[board]?.[slug];
  if (!load) return null;
  return load();
}
`;
}

function genFallbackMetaTs(boards) {
  const entries = Object.entries(boards).map(([key, board]) => {
    const periods = board.periods
      .map(
        (period) =>
          `      { slug: ${JSON.stringify(period.slug)}, label: ${JSON.stringify(period.label)}, sortKey: ${period.sortKey ?? 0} },`,
      )
      .join('\n');
    return `  ${key}: {
    title: ${JSON.stringify(board.title)},
    type: ${JSON.stringify(board.type)},
    periods: [\n${periods}\n    ],
  }`;
  });
  return `/**
 * AUTO-GENERATED by scripts/gen-ranking-pages.mjs — do not edit.
 * Static metadata used when the website falls back to its local ranking archive.
 */
import type { RankingBoardKey } from './rankings';

export interface RankingFallbackPeriod {
  slug: string;
  label: string;
  sortKey: number;
}

export interface RankingFallbackBoard {
  title: string;
  type: 'periods' | 'single';
  periods: RankingFallbackPeriod[];
}

export const RANKING_FALLBACK_META: Record<RankingBoardKey, RankingFallbackBoard> = {
${entries.join(',\n')},
};
`;
}
const tmp = INDEX_TS + '.tmp';
writeFileSync(tmp, genIndexTs(boards), 'utf8');
replaceGeneratedFile(tmp, INDEX_TS);
writeFileSync(FALLBACK_META_TS, genFallbackMetaTs(boards), 'utf8');
console.log('DONE ->', DATA_DIR);
