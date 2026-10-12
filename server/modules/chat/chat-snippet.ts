/**
 * Chatbot 片段构建（纯函数，无 Nest/DB 依赖——便于单测与离线量化脚本复用）。
 *
 * 策略（大纲优先 + 命中锚定 + 节首/节末补充，业内 Small-to-Big 的零成本轻量版）：
 * ① 正文 ≤ 预算：原样返回；
 * ② 先提取一~三级标题作为【文章大纲】（上限 OUTLINE_MAX，给模型一张文章地图，
 *    未覆盖部分可诚实说「片段未包含」而非虚构）；
 * ③ 主窗口锚定关键词命中位置（保留相关性定位），命中密集的节自动扩到节边界
 *    （Auto-Merging 轻量版）；
 * ④ 余量按「每节首句/末句优先」（topic-sentence 启发式——结论高度聚集于节首节尾）
 *    轮转补充，节选以【节标题】标注；表格行/列表项/引用/代码块整块原子，
 *    不会被句级切断；窗口间以「……」标示非连续。
 * 预算恒为 SNIPPET_TOTAL（≈1800 字），token 总量与单窗口方案持平。
 */

export const SNIPPET_TOTAL = 1800;
/** 大纲预算上限（实测语料篇均一~三级标题约 418 字）。 */
const OUTLINE_MAX = 480;
/** 主窗口基准与命中密集扩容上限。 */
const MAIN_WINDOW = 900;
const MAIN_WINDOW_MAX = 1200;
/** 为补充节选预留的最小预算。 */
const SUPPLEMENT_RESERVE = 200;
/** 主窗口/节选单块硬上限（防止超长段落吃光预算）。 */
const UNIT_MAX = 420;
/** 补充节选单条上限——压短单条换取覆盖更多节（topic/conclusion 密度优先）。 */
const SUPPLEMENT_UNIT_MAX = 120;

interface Section {
  title: string;
  start: number;
  end: number;
  level: number;
}

/** 剥离图片行与空标题行（与历史口径一致）。 */
function cleanBody(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^!\[|^#{1,6}\s*$/.test(line.trim()))
    .join('\n');
}

/** 解析一~三级标题节结构；首个标题前的内容归入「开篇」节。 */
function parseSections(cleaned: string): { sections: Section[]; outline: string[] } {
  const sections: Section[] = [];
  const outline: string[] = [];
  let offset = 0;
  let current: Section = { title: '开篇', start: 0, end: 0, level: 0 };
  for (const line of cleaned.split('\n')) {
    const m = /^(#{1,3}) (.+)$/.exec(line.trim());
    if (m) {
      current.end = offset;
      sections.push(current);
      outline.push(line.trim());
      current = {
        title: m[2].trim(),
        // 节内容从标题行之后开始，否则节选首条会命中标题行自身。
        start: offset + line.length + 1,
        end: cleaned.length,
        level: m[1].length,
      };
    }
    offset += line.length + 1;
  }
  current.end = cleaned.length;
  sections.push(current);
  return { sections: sections.filter((s) => s.end > s.start), outline };
}

/** 大纲超预算时按 H1 > H2 > H3 优先级裁剪。 */
function capOutline(outline: string[], max: number): string {
  const total = outline.join('\n').length;
  if (total <= max) return outline.join('\n');
  const kept: string[] = [];
  let used = 0;
  for (const level of [1, 2, 3]) {
    for (const line of outline) {
      if (!line.startsWith('#'.repeat(level) + ' ')) continue;
      if (used + line.length + 1 > max) break;
      kept.push(line);
      used += line.length + 1;
    }
  }
  return kept.join('\n');
}

function isAtomicLine(t: string): boolean {
  return (
    t.startsWith('|') || // 表格行
    /^[-*+>]\s/.test(t) || // 无序列表 / 引用
    /^\d+[.、)]\s/.test(t) || // 有序列表
    t.startsWith('#') // 标题（兜底，正常不出现在节内容里）
  );
}

/** 中文句级切分（。！？!?；;），表格/列表/引用/代码块整块原子。 */
function splitUnits(text: string): string[] {
  const units: string[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (t.startsWith('```')) {
      let block = lines[i];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        block += `\n${lines[i]}`;
        i += 1;
      }
      if (i < lines.length) {
        block += `\n${lines[i]}`;
        i += 1;
      }
      units.push(block);
      continue;
    }
    if (isAtomicLine(t)) {
      units.push(t);
      i += 1;
      continue;
    }
    for (const s of t.split(/(?<=[。！？!?；;])/)) {
      if (s.trim()) units.push(s.trim());
    }
    i += 1;
  }
  return units;
}

/** 旧版单窗口兜底（无标题结构的文档），保持既有定位逻辑。 */
function legacyWindow(cleaned: string, hitIndex: number, originalLen: number): string {
  const size = SNIPPET_TOTAL;
  let start = 0;
  if (hitIndex >= 0) {
    const ratio = Math.min(1, hitIndex / Math.max(1, originalLen));
    start = Math.max(0, Math.floor((ratio * cleaned.length) - size / 2));
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

/**
 * 主窗口：锚定命中位置，对齐行边界；命中密集（同节 ≥2 个关键词命中）且节长
 * 在扩容上限内时，扩展到节边界（Auto-Merging 轻量版）。
 */
function locateMainWindow(
  cleaned: string,
  lower: string,
  sections: Section[],
  keywords: string[],
  hitIndex: number,
  originalLen: number,
  maxWindow: number,
): { start: number; end: number } {
  let start = 0;
  if (hitIndex >= 0) {
    const ratio = Math.min(1, hitIndex / Math.max(1, originalLen));
    // 以实际窗口的一半做居中偏移——窗口被预算压缩时命中词仍留在窗口内。
    start = Math.max(0, Math.floor((ratio * cleaned.length) - maxWindow / 2));
  }
  if (start > 0) {
    const nl = cleaned.indexOf('\n', start);
    if (nl >= 0) start = nl + 1;
  }
  let end = Math.min(cleaned.length, start + maxWindow);

  // 命中密集节扩容：统计各节关键词命中数。
  const center = Math.floor((start + end) / 2);
  const host = sections.find((s) => center >= s.start && center < s.end);
  if (host) {
    let hits = 0;
    for (const kw of keywords) {
      const k = kw.toLocaleLowerCase();
      if (!k) continue;
      let from = host.start;
      for (;;) {
        const idx = lower.indexOf(k, from);
        if (idx < 0 || idx >= host.end) break;
        hits += 1;
        from = idx + k.length;
        if (hits >= 2) break;
      }
      if (hits >= 2) break;
    }
    if (hits >= 2 && host.end - host.start <= maxWindow) {
      start = host.start;
      end = host.end;
    }
  }
  // 行边界对齐：起点回退到当前行首（前向对齐会把长行开头的命中词挤出窗口），
  // 终点就近回退到行首。
  if (start > 0 && cleaned[start - 1] !== '\n') {
    const nl = cleaned.lastIndexOf('\n', start - 1);
    start = nl + 1;
  }
  if (end < cleaned.length) {
    const nl = cleaned.lastIndexOf('\n', end);
    if (nl > start && nl > end - 240) end = nl;
  }
  return { start, end };
}

export function buildStructuredSnippet(
  body: string,
  keywords: string[],
  hitIndex: number,
): string {
  const cleaned = cleanBody(body);
  if (cleaned.length <= SNIPPET_TOTAL) return cleaned;
  const { sections, outline } = parseSections(cleaned);
  if (sections.length < 2 || !outline.length) {
    return legacyWindow(cleaned, hitIndex, body.length);
  }

  const outlineText = capOutline(outline, OUTLINE_MAX);
  const parts: string[] = [`【文章大纲】\n${outlineText}`];
  let budget = SNIPPET_TOTAL - outlineText.length - 7;

  const lower = cleaned.toLocaleLowerCase();
  const maxWindow = Math.max(240, Math.min(MAIN_WINDOW_MAX, budget - SUPPLEMENT_RESERVE));
  const { start, end } = locateMainWindow(
    cleaned,
    lower,
    sections,
    keywords,
    hitIndex,
    body.length,
    maxWindow,
  );
  const mainText = cleaned.slice(start, end);
  budget -= mainText.length;
  parts.push(`${start > 0 ? '……' : ''}${mainText}${end < cleaned.length ? '……' : ''}`);

  // 补充节选：未被主窗口覆盖的节，轮转取「首句（topic）→ 末句（conclusion）」。
  const covered = (s: Section) => s.start < end && s.end > start;
  const usedUnits = new Set<string>();
  const candidates = sections.filter((s) => !covered(s) && s.title !== '开篇');
  const picks: Array<{ sec: Section; kind: 'first' | 'last' }> = [];
  for (const sec of candidates) picks.push({ sec, kind: 'first' });
  for (const sec of candidates) picks.push({ sec, kind: 'last' });
  // 首句/末句预算保底：首句轮最多花掉补充预算的 65%，剩余保底给结论（末句）。
  const supStart = budget;
  let firstsDone = false;
  for (const { sec, kind } of picks) {
    if (budget < 90) break;
    if (kind === 'first' && !firstsDone && budget <= supStart * 0.35) {
      firstsDone = true;
    }
    if (kind === 'first' && firstsDone) continue;
    const units = splitUnits(cleaned.slice(sec.start, sec.end));
    if (!units.length) continue;
    const raw = kind === 'first' ? units[0] : units[units.length - 1];
    const unit = raw.slice(0, SUPPLEMENT_UNIT_MAX);
    const key = `${sec.title}|${unit}`;
    if (usedUnits.has(key) || mainText.includes(unit)) continue;
    usedUnits.add(key);
    let text = `【${sec.title}】${unit}`;
    const cost = text.length + 5; // 含分隔符「\n……\n」
    if (cost > budget) {
      const room = budget - 9;
      if (room < 60) break;
      text = `${text.slice(0, room)}……`;
      budget -= room + 9;
    } else {
      budget -= cost;
    }
    parts.push(text);
  }

  return parts.join('\n……\n');
}

/** 机制条目片段预算；三段合计实测中位 ≈435 字、最大 ≈600，上限只作兜底。 */
export const MECHANISM_SNIPPET_MAX = 700;

export interface MechanismSnippetInput {
  coreHook: string | null;
  buyValue: string | null;
  reuseNote: string | null;
}

/**
 * 机制观察条目的片段：三段式（机制 / 优点 / 利用方法）**完整给出，不做节选**。
 *
 * 与文章的「大纲 + 节选」不同——机制条目三段合计仅数百字，远低于文章片段的
 * 1800 字预算，截断只会丢信息。空段以「（未填写）」占位，避免模型把相邻两段
 * 误读成同一段。（全段皆空的行在来源侧已被过滤，不会走到这里。）
 */
export function buildMechanismSnippet(row: MechanismSnippetInput): string {
  const text = [
    `【机制】${row.coreHook?.trim() || '（未填写）'}`,
    `【优点】${row.buyValue?.trim() || '（未填写）'}`,
    `【利用方法】${row.reuseNote?.trim() || '（未填写）'}`,
  ].join('\n');
  return text.length > MECHANISM_SNIPPET_MAX
    ? `${text.slice(0, MECHANISM_SNIPPET_MAX)}……`
    : text;
}
