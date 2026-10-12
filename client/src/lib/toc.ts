export interface TocHeading {
  level: 1 | 2 | 3;
  text: string;
  id: string;
}

function slugify(text: string): string {
  const s = text
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .toLowerCase();
  return s || 'section';
}

/**
 * 从飞书 Markdown 正文中提取 H1-H3 标题，生成稳定锚点 id。
 * 跳过代码围栏（``` / ~~~）内的伪标题；重复标题追加 -2 / -3 区分。
 * 提取顺序即渲染顺序，id 与 Markdown 组件注入的锚点一一对应。
 */
export function extractHeadings(md?: string): TocHeading[] {
  if (!md) return [];
  const lines = md.split('\n');
  const seen = new Map<string, number>();
  const out: TocHeading[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length as 1 | 2 | 3;
      const text = m[2].replace(/[#*_`]/g, '').trim();
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;
      out.push({ level, text, id });
    }
  }
  return out;
}
