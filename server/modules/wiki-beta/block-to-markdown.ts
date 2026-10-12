/**
 * Converts docx blocks API items into a Markdown document body.
 * Pure functions only — no I/O here.
 */

export const BLOCK_TYPE = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  CALLOUT: 19,
  DIVIDER: 22,
  IMAGE: 27,
  TABLE: 31,
  TABLE_CELL: 32,
  QUOTE_CONTAINER: 34,
} as const;

const HEADING_TYPE_KEYS: Record<number, string> = {
  [BLOCK_TYPE.HEADING1]: 'heading1',
  [BLOCK_TYPE.HEADING2]: 'heading2',
  [BLOCK_TYPE.HEADING3]: 'heading3',
  [BLOCK_TYPE.HEADING4]: 'heading4',
  [BLOCK_TYPE.HEADING5]: 'heading5',
  [BLOCK_TYPE.HEADING6]: 'heading6',
  [BLOCK_TYPE.HEADING7]: 'heading7',
  [BLOCK_TYPE.HEADING8]: 'heading8',
  [BLOCK_TYPE.HEADING9]: 'heading9',
};

const TYPE_KEYS: Record<number, string> = {
  [BLOCK_TYPE.TEXT]: 'text',
  ...HEADING_TYPE_KEYS,
  [BLOCK_TYPE.BULLET]: 'bullet',
  [BLOCK_TYPE.ORDERED]: 'ordered',
  [BLOCK_TYPE.CODE]: 'code',
  [BLOCK_TYPE.QUOTE]: 'quote',
  [BLOCK_TYPE.CALLOUT]: 'callout',
  [BLOCK_TYPE.DIVIDER]: 'divider',
  [BLOCK_TYPE.IMAGE]: 'image',
  [BLOCK_TYPE.TABLE]: 'table',
  [BLOCK_TYPE.TABLE_CELL]: 'table_cell',
  [BLOCK_TYPE.QUOTE_CONTAINER]: 'quote_container',
};

/** Containers rendered atomically; their children are NOT expanded into the flat order. */
const ATOMIC_TYPES = new Set<number>([
  BLOCK_TYPE.TABLE,
  BLOCK_TYPE.QUOTE_CONTAINER,
  BLOCK_TYPE.CALLOUT,
]);

type AnyRecord = Record<string, unknown>;

interface RenderContext {
  byId: Map<string, AnyRecord>;
  parentOf: Map<string, string>;
  documentId: string;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord | null {
  return isRecord(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function normalizeDocumentBody(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function payloadOf(block: AnyRecord): AnyRecord | null {
  const key = TYPE_KEYS[block.block_type as number];
  if (!key) return null;
  return asRecord(block[key]);
}

function renderElement(element: unknown): string {
  const el = asRecord(element);
  if (!el) return '';
  const run = asRecord(el.text_run);
  if (!run) return ''; // mention_doc / mention_user and other kinds are skipped
  let text = asString(run.content) ?? '';
  const style = asRecord(run.text_element_style);
  if (style) {
    const link = asRecord(style.link);
    const url = link ? asString(link.url) : null;
    if (url) text = `[${text}](${decodeUrl(url)})`;
    if (style.inline_code === true) text = `\`${text}\``;
    if (style.bold === true) text = `**${text}**`;
    if (style.italic === true) text = `*${text}*`;
  }
  return text;
}

function renderInline(block: AnyRecord): string {
  const payload = payloadOf(block);
  const elements =
    payload && Array.isArray(payload.elements) ? payload.elements : [];
  return elements.map(renderElement).join('');
}

function depthOf(id: string, ctx: RenderContext): number {
  let depth = 0;
  const seen = new Set<string>([id]);
  let current = ctx.parentOf.get(id);
  while (current && ctx.byId.has(current) && !seen.has(current)) {
    depth += 1;
    seen.add(current);
    current = ctx.parentOf.get(current);
  }
  return depth;
}

function renderCode(block: AnyRecord): string[] {
  const payload = asRecord(block.code);
  const elements =
    payload && Array.isArray(payload.elements) ? payload.elements : [];
  const content = elements
    .map((element) => {
      const run = asRecord(asRecord(element)?.text_run);
      return run ? (asString(run.content) ?? '') : '';
    })
    .join('');
  const style = payload ? asRecord(payload.style) : null;
  const language = style ? asString(style.language) : null;
  return ['```' + (language ?? ''), content, '```'];
}

function renderCell(cell: AnyRecord | undefined, ctx: RenderContext): string {
  if (!cell) return '';
  const childIds = asStringArray(cell.children);
  const parts: string[] = [];
  for (const childId of childIds) {
    const child = ctx.byId.get(childId);
    if (!child) continue;
    const text = renderInline(child);
    if (text) parts.push(text);
  }
  if (parts.length > 0) return parts.join(' ');
  return renderInline(cell);
}

function renderTable(block: AnyRecord, ctx: RenderContext): string[] {
  const payload = asRecord(block.table);
  const cellIds = payload?.cells
    ? asStringArray(payload.cells)
    : asStringArray(block.children);
  const property = payload ? asRecord(payload.property) : null;
  const columnSize =
    property && typeof property.column_size === 'number' && property.column_size > 0
      ? property.column_size
      : 0;
  const rowSize =
    property && typeof property.row_size === 'number' && property.row_size > 0
      ? property.row_size
      : 0;
  const columns =
    columnSize || (rowSize > 0 ? Math.floor(cellIds.length / rowSize) : cellIds.length);
  if (cellIds.length === 0 || columns <= 0) return [];

  const rows: string[][] = [];
  for (let index = 0; index < cellIds.length; index += columns) {
    rows.push(
      cellIds
        .slice(index, index + columns)
        .map((cellId) => renderCell(ctx.byId.get(cellId), ctx)),
    );
  }

  const lines: string[] = [];
  const header = rows[0] ?? [];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows.slice(1)) lines.push(`| ${row.join(' | ')} |`);
  return lines;
}

function renderQuoteContent(
  block: AnyRecord,
  depth: number,
  ctx: RenderContext,
): string[] {
  const childIds = asStringArray(block.children);
  const inner: string[] = [];
  if (childIds.length > 0) {
    const blockId = asString(block.block_id) ?? '';
    const blockDepth = blockId ? depthOf(blockId, ctx) : depth;
    for (const childId of childIds) {
      const child = ctx.byId.get(childId);
      if (!child) continue;
      const childDepth = Math.max(0, depthOf(childId, ctx) - blockDepth);
      inner.push(...renderBlock(child, childDepth, ctx));
    }
  } else {
    const text = renderInline(block); // no children info: fall back to a plain paragraph
    if (text) inner.push(text);
  }
  return inner.map((line) => (line ? `> ${line}` : '>'));
}

function renderBlock(
  block: AnyRecord,
  depth: number,
  ctx: RenderContext,
  orderedNumber?: number,
): string[] {
  const type = block.block_type as number;
  const indent = '  '.repeat(Math.max(0, depth));
  switch (type) {
    case BLOCK_TYPE.HEADING1:
    case BLOCK_TYPE.HEADING2:
    case BLOCK_TYPE.HEADING3:
    case BLOCK_TYPE.HEADING4:
    case BLOCK_TYPE.HEADING5:
    case BLOCK_TYPE.HEADING6:
    case BLOCK_TYPE.HEADING7:
    case BLOCK_TYPE.HEADING8:
    case BLOCK_TYPE.HEADING9: {
      const text = renderInline(block);
      const level = type - BLOCK_TYPE.HEADING1 + 1;
      return text ? [`${'#'.repeat(level)} ${text}`] : [];
    }
    case BLOCK_TYPE.TEXT: {
      const text = renderInline(block);
      return text ? [text] : [];
    }
    case BLOCK_TYPE.BULLET: {
      return [`${indent}- ${renderInline(block)}`];
    }
    case BLOCK_TYPE.ORDERED: {
      return [`${indent}${orderedNumber ?? 1}. ${renderInline(block)}`];
    }
    case BLOCK_TYPE.CODE:
      return renderCode(block);
    case BLOCK_TYPE.QUOTE: {
      const text = renderInline(block);
      return text ? [`> ${text}`] : [];
    }
    case BLOCK_TYPE.CALLOUT:
    case BLOCK_TYPE.QUOTE_CONTAINER:
      return renderQuoteContent(block, depth, ctx);
    case BLOCK_TYPE.DIVIDER:
      return ['---'];
    case BLOCK_TYPE.IMAGE: {
      const imageToken = asString(asRecord(block.image)?.image_token);
      return imageToken
        ? [`![图片](/api/articles/${ctx.documentId}/images/${imageToken})`]
        : [];
    }
    case BLOCK_TYPE.TABLE:
      return renderTable(block, ctx);
    default:
      return []; // unknown block types are skipped
  }
}

function expandRoots(roots: string[], ctx: RenderContext): string[] {
  const ordered: string[] = [];
  const visit = (id: string): void => {
    ordered.push(id);
    const block = ctx.byId.get(id);
    if (!block || ATOMIC_TYPES.has(block.block_type as number)) return;
    for (const childId of asStringArray(block.children)) {
      if (ctx.byId.has(childId)) visit(childId);
    }
  };
  for (const root of roots) visit(root);
  return ordered;
}

/**
 * Converts docx blocks API items into Markdown.
 *
 * Ordering: when the response contains a page block (block_type=1) whose
 * children list the document order, blocks are walked in that order
 * (recursively); otherwise top-level items keep the array order and blocks
 * referenced by other blocks' children are nested under their parents.
 * Nesting depth for bullet/ordered lists is derived from how many blocks
 * reference the block through their children field (one level is exact).
 */
export function blocksToMarkdown(blocks: unknown[], documentId: string): string {
  const records = (Array.isArray(blocks) ? blocks : []).filter(isRecord);
  if (records.length === 0) return '';

  const byId = new Map<string, AnyRecord>();
  const parentOf = new Map<string, string>();
  for (const block of records) {
    const id = asString(block.block_id);
    if (id) byId.set(id, block);
  }
  for (const block of records) {
    const blockId = asString(block.block_id);
    if (!blockId) continue;
    const table = asRecord(block.table);
    const referenced = table?.cells
      ? [...asStringArray(table.cells), ...asStringArray(block.children)]
      : asStringArray(block.children);
    for (const childId of referenced) {
      if (byId.has(childId) && !parentOf.has(childId)) {
        parentOf.set(childId, blockId);
      }
    }
  }
  const ctx: RenderContext = { byId, parentOf, documentId };

  const pageBlock = records.find(
    (block) =>
      block.block_type === BLOCK_TYPE.PAGE && Array.isArray(block.children),
  );
  let roots: string[];
  if (pageBlock) {
    roots = asStringArray(pageBlock.children).filter((id) => byId.has(id));
  } else {
    roots = records
      .map((block) => asString(block.block_id))
      .filter(
        (id): id is string =>
          id !== null &&
          byId.get(id)!.block_type !== BLOCK_TYPE.PAGE &&
          !parentOf.has(id),
      );
  }

  const lines: string[] = [];
  const orderedCounters = new Map<number, number>();
  for (const id of expandRoots(roots, ctx)) {
    const block = byId.get(id)!;
    const type = block.block_type as number;
    const depth = depthOf(id, ctx);

    let orderedNumber: number | undefined;
    if (type === BLOCK_TYPE.ORDERED) {
      orderedNumber = (orderedCounters.get(depth) ?? 0) + 1;
      orderedCounters.set(depth, orderedNumber);
    } else {
      for (const key of orderedCounters.keys()) {
        if (key >= depth) orderedCounters.delete(key);
      }
    }

    lines.push(...renderBlock(block, depth, ctx, orderedNumber));
  }

  return normalizeDocumentBody(lines.filter((line) => line.trim()).join('\n'));
}
