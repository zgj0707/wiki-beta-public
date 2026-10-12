/**
 * 榜单 HTML 渲染器（#榜单数据源 Base 化 · sheet 直读）。
 *
 * 从 scripts/gen-ranking-pages.mjs 移植的纯函数：飞书表格 values → 站内 HTML 片段。
 * 服务端 sheet 驱动行（「榜单」表无 HTML 附件、有数据源）用它们实时渲染；
 * 渲染契约与静态产物一致（.table-card / .note / .like-card / .like-grid），
 * 前端 ranking.css 消费，零改动。
 */

export function renderEsc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * 表头行判定：首格以「排名」结尾的短语开头（排名/周排名/月排名/收入排名……）。
 * 不能用包含匹配——「数据范围：……不代表合并后的地区排名。」这类说明行
 * 文本里也含「排名」，包含匹配会把说明行误判成表头（线上 0909-0915 期实翻车）；
 * 也不能写死前缀——收入月榜表头是「收入排名」。
 */
function isRankingHeaderRow(first: string): boolean {
  return /^.{0,4}排名/.test(first);
}

/**
 * 通用表格渲染（AppStore 榜）：定位「排名」表头行，取其上方首个非空行作为说明 note，
 * 过滤整列皆空的列（图片列/表尾空列），输出 .table-card。
 * 无「排名」表头行 → 返回 null（空榜/非榜单 sheet，调用方跳过）。
 */
export function buildRankingTable(
  rows: string[][],
): { note: string; body: string } | null {
  let headerIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const first = (rows[r][0] || '').trim();
    if (first && isRankingHeaderRow(first)) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) return null;
  let note = '';
  for (let r = 0; r < headerIdx; r++) {
    const first = (rows[r][0] || '').trim();
    if (first && !isRankingHeaderRow(first)) {
      note = first;
      break;
    }
  }
  const header = rows[headerIdx];
  const data = rows
    .slice(headerIdx + 1)
    .filter((r) => (r[0] || '').trim() && (r[1] || '').trim());
  // 过滤空列：整列数据都为空的列（图片列 values 导出为空、或飞书表尾部的空列）不渲染，
  // 避免空列占宽导致右侧有内容列（备注/投放地区）被挤出容器、横向截断。
  const keepCol: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (data.every((r) => !(r[i] || '').trim())) continue;
    keepCol.push(i);
  }
  const th = keepCol
    .map((i) => `<th class="${i === 0 ? 'rank' : ''}">${renderEsc(header[i])}</th>`)
    .join('');
  const tr = data
    .map((r) => {
      const tds = keepCol
        .map((i) => {
          const c = r[i];
          let v = renderEsc(c);
          if (
            /^https?:\/\//.test((c || '').trim()) &&
            /\.(png|jpe?g|gif|webp|svg)$/i.test(c)
          ) {
            v = `<img src="${renderEsc(c)}" alt="icon" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">`;
          }
          return `<td class="${i === 0 ? 'rank' : ''}">${v}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const body = `<div class="table-card"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  return { note, body };
}

/** AppStore 榜单行最终 inner：说明 note（如有）+ 表格主体。 */
export function renderAppstoreInner(rows: string[][]): string | null {
  const built = buildRankingTable(rows);
  if (!built) return null;
  return (
    (built.note ? `<div class="note">${renderEsc(built.note)}</div>` : '') +
    built.body
  );
}

/**
 * 微信榜单：以"like 品类"为单元分卡片，绝不渲染成排行榜。
 *  - 所有 like 品类（含靶心like / 无尽-like）平等，平铺进一个 grid，不设任何小标题。
 *  - 子品类识别：名字以 like 结尾（兼容 "X-like" / "X/Y-like"，如 DNF-like、闪烁/AFK-like）。
 */
export function buildWeixinInner(rows: string[][]): string {
  const g1Name = (rows[0] && rows[0][0]) || '靶心like';
  const g2Name = (rows[0] && rows[0][3]) || '无尽-like';
  const data = rows.slice(1);

  function extractCards(
    rows: string[][],
    nameCol: number,
    descCol: number,
    defaultName: string,
  ) {
    const cards: { name: string; games: { name: string; desc: string }[] }[] =
      [];
    let current = { name: defaultName, games: [] as { name: string; desc: string }[] };
    for (const r of rows) {
      const name = (r[nameCol] || '').trim();
      const desc = (r[descCol] || '').trim();
      if (!name && !desc) continue;
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

  const cards = [
    ...extractCards(data, 0, 1, g1Name),
    ...extractCards(data, 3, 4, g2Name),
  ];

  const card = (c: { name: string; games: { name: string; desc: string }[] }) => {
    const games = c.games.length
      ? `<ul class="like-games">${c.games
          .map(
            (g) =>
              `<li><div class="game-name">${renderEsc(g.name)}</div>${g.desc ? `<div class="game-desc">${renderEsc(g.desc)}</div>` : ''}</li>`,
          )
          .join('')}</ul>`
      : `<div class="like-empty">该 like 品类下暂无收录游戏。</div>`;
    return `<article class="like-card"><h3 class="like-name">${renderEsc(c.name)}</h3>${games}</article>`;
  };

  return `<div class="like-grid">${cards.map(card).join('')}</div>`;
}
