import {
  buildMechanismIdentity,
  canonicalizeMechanismUrl,
  canonicalizeMechanismJson,
  isTemporaryMechanismUrl,
  mechanismContentHash,
  normalizeMechanismTable,
  normalizeMechanismMarkdown,
  parseMechanismTrendTable,
} from './mechanism-field-normalizer.mjs';

export const MECHANISM_DOCUMENT_PARSER_VERSION = 'mechanism-table-v2';
export const MECHANISM_SECTION_TITLES = Object.freeze({
  scope: '研究范围与阅读方式',
  games: '游戏分析条目（正文）',
  trend: '休闲游戏供给趋势观察',
});

const EXCLUDED_SECTION_TITLES = new Set([
  '后续游戏分析统一模板（不重要）',
  '条目模板（复制后填写）',
  '待分析游戏清单',
]);

function decodeXml(value) {
  return String(value || '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function cleanText(value) {
  return decodeXml(String(value || '').replace(/<[^>]+>/gu, ' '))
    .replace(/\u200B|\u200C|\u200D|\uFEFF/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value || '').matchAll(
    /([:\w-]+)\s*=\s*["']([^"']*)["']/gu,
  )) {
    attributes[match[1].toLowerCase()] = decodeXml(match[2]);
  }
  return attributes;
}

function headingLevel(tagName, attributes) {
  const match = String(tagName || '').match(/^h([1-6])$/iu);
  if (match) return Number(match[1]);
  const explicit = Number(
    attributes.level || attributes.depth || attributes.heading_level,
  );
  return Number.isInteger(explicit) && explicit >= 1 && explicit <= 6
    ? explicit
    : null;
}

function findHeadings(xml) {
  const headings = [];
  const source = String(xml || '');
  const pattern = /<(h[1-6]|heading)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu;
  for (const match of source.matchAll(pattern)) {
    const attributes = parseAttributes(match[2]);
    const level = headingLevel(match[1], attributes);
    if (!level) continue;
    const fullEnd = match.index + match[0].length;
    headings.push({
      level,
      title: cleanText(match[3]),
      blockId:
        attributes.block_id ||
        attributes['block-id'] ||
        attributes.blockid ||
        attributes.id ||
        null,
      start: match.index,
      contentStart: fullEnd,
      fullEnd,
      attributes,
    });
  }
  return headings;
}

function normalizedTitle(value) {
  return cleanText(value).replace(/[\s\u3000]/gu, '');
}

function sameTitle(left, right) {
  return normalizedTitle(left) === normalizedTitle(right);
}

function nextHeadingEnd(headings, currentIndex, maxLevel = 6) {
  const current = headings[currentIndex];
  for (let index = currentIndex + 1; index < headings.length; index += 1) {
    if (headings[index].level <= maxLevel) return headings[index].start;
  }
  return Number.POSITIVE_INFINITY;
}

function sectionRange(xml, headings, sectionIndex) {
  const section = headings[sectionIndex];
  const end = nextHeadingEnd(headings, sectionIndex, section.level);
  return {
    section,
    end,
    body: String(xml || '').slice(
      section.contentStart,
      end === Number.POSITIVE_INFINITY ? undefined : end,
    ),
  };
}

function childrenOfSection(headings, sectionIndex, end) {
  const section = headings[sectionIndex];
  return headings
    .map((heading, index) => ({ heading, index }))
    .filter(
      ({ heading }) =>
        heading.start >= section.contentStart &&
        heading.start < end &&
        heading.level === section.level + 1,
    );
}

function xmlFragmentToMarkdown(fragment) {
  const withTables = String(fragment || '').replace(
    /<table\b[^>]*>[\s\S]*?<\/table\s*>/giu,
    (tableXml) => `\n${sourceTableToMarkdown(parseSourceTable(tableXml))}\n`,
  );
  return normalizeMechanismMarkdown(
    decodeXml(
      withTables
        .replace(
          /<img\b[^>]*alt\s*=\s*["']([^"']*)["'][^>]*>/giu,
          (_, alt) => `[图片：${alt}]`,
        )
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<li\b[^>]*>/giu, '\n- ')
        .replace(
          /<\/(?:p|div|li|blockquote|h[1-6]|heading|section)\s*>/giu,
          '\n',
        )
        .replace(/<[^>]+>/gu, ' ')
        .replace(/[ \t]+\n/gu, '\n'),
    ),
  );
}

function normalizeCellText(fragment) {
  return normalizeMechanismMarkdown(
    decodeXml(
      String(fragment || '')
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<\/?(?:p|div|li|blockquote)\b[^>]*>/giu, '\n')
        .replace(/<img\b[^>]*>/giu, '')
        .replace(/<[^>]+>/gu, '')
        .replace(/\t/gu, ' '),
    ),
  );
}

function extractCellLinks(fragment) {
  return [
    ...String(fragment || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu),
  ]
    .map((match) => {
      const attributes = parseAttributes(match[1]);
      const rawUrl = attributes.href || attributes.url || '';
      const url = canonicalizeMechanismUrl(rawUrl);
      return {
        text: cleanText(match[2]),
        url,
        temporary: Boolean(rawUrl && isTemporaryMechanismUrl(rawUrl)),
      };
    })
    .filter((link) => link.url || link.text);
}

function hasOnlyImageContent(fragment) {
  const source = String(fragment || '');
  if (!/<img\b/iu.test(source)) return false;
  const withoutImages = source
    .replace(/<img\b[^>]*\/?\s*>/giu, '')
    .replace(/<br\s*\/?>/giu, '')
    .replace(/<[^>]+>/gu, '');
  return !cleanText(withoutImages);
}

function cellMarkdown(fragment) {
  let value = String(fragment || '');
  value = value.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu,
    (match, attributesText, inner) => {
      const attributes = parseAttributes(attributesText);
      const url = canonicalizeMechanismUrl(
        attributes.href || attributes.url || '',
      );
      const label = normalizeCellText(inner);
      return url ? `[${label}](${url})` : label;
    },
  );
  value = value.replace(/<img\b[^>]*\/?\s*>/giu, '');
  return normalizeCellText(value);
}

function parseSourceTable(tableXml) {
  if (!tableXml) return null;
  const tableTag = String(tableXml).match(/<table\b([^>]*)>/iu);
  const tableAttributes = parseAttributes(tableTag?.[1]);
  const rows = [
    ...String(tableXml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/giu),
  ]
    .map((rowMatch, position) => {
      const rawCells = [
        ...rowMatch[1].matchAll(
          /<(th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)\s*>/giu,
        ),
      ];
      if (
        rawCells.slice(1).some((cellMatch) => hasOnlyImageContent(cellMatch[3]))
      )
        return null;
      const cells = rawCells.map((cellMatch) => ({
        tag: cellMatch[1].toLowerCase(),
        attributes: parseAttributes(cellMatch[2]),
        text: normalizeCellText(cellMatch[3]),
        markdown: cellMarkdown(cellMatch[3]),
        links: extractCellLinks(cellMatch[3]),
      }));
      return {
        position,
        cells,
        label: cells[0]?.text || '',
        valueText: cells[1]?.text || '',
        valueMarkdown: cells[1]?.markdown || '',
        links: cells[1]?.links || [],
      };
    })
    .filter(Boolean);
  const warnings = [];
  for (const row of rows) {
    if (row.cells.length !== 2)
      warnings.push(
        `表格第 ${row.position + 1} 行不是两列，实际为 ${row.cells.length} 列`,
      );
  }
  return {
    tableId: tableAttributes.id || null,
    columns: rows[0]?.cells.map((cell) => cell.text) || [],
    rows,
    warnings,
  };
}

function extractTables(fragment) {
  return [
    ...String(fragment || '').matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/giu),
  ]
    .map((match) => parseSourceTable(match[0]))
    .filter(Boolean);
}

function sourceTableToMarkdown(sourceTable) {
  if (!sourceTable) return '';
  return sourceTable.rows
    .filter(
      (row) =>
        row.label && normalizedTitle(row.label) !== normalizedTitle('分析字段'),
    )
    .map((row) => `## ${row.label}\n\n${row.valueMarkdown || '（空）'}`)
    .join('\n\n');
}

function sourceRevisionFrom(xml, metadata) {
  const supplied = Number(metadata?.sourceRevision ?? metadata?.revision);
  if (Number.isInteger(supplied) && supplied >= 0) return supplied;
  const root = String(xml || '').match(/<(?:document|doc)\b([^>]*)>/iu);
  const attributes = parseAttributes(root?.[1]);
  const detected = Number(
    attributes.revision_id || attributes.revision || attributes.version,
  );
  return Number.isInteger(detected) && detected >= 0 ? detected : 0;
}

function parseGameEntry(xml, headings, child, index, sourceRevision) {
  const end = nextHeadingEnd(headings, child.index, child.heading.level);
  const bodyXml = String(xml || '').slice(
    child.heading.contentStart,
    end === Number.POSITIVE_INFINITY ? undefined : end,
  );
  const sourceTables = extractTables(bodyXml);
  const sourceTable = sourceTables[0] || {
    tableId: null,
    columns: [],
    rows: [],
    warnings: [],
  };
  const rawMarkdown =
    sourceTableToMarkdown(sourceTable) || xmlFragmentToMarkdown(bodyXml);
  const normalized = normalizeMechanismTable(sourceTable);
  const gameName = normalized.gameName || child.heading.title;
  const identity = buildMechanismIdentity({
    itemKind: 'game_analysis',
    sourceBlockId: child.heading.blockId,
    sourceMaterial: normalized.sourceMaterial || rawMarkdown,
    sourceLinks: normalized.sourceLinks,
    title: gameName,
  });
  const parseWarnings = normalized.parseWarnings || [];
  const parseErrors = [
    ...(sourceTable.warnings || []),
    ...(sourceTables.length === 0 ? ['游戏条目缺少原生表格'] : []),
    ...(sourceTables.length > 1
      ? [`游戏条目包含 ${sourceTables.length} 张原生表格，无法保证字段没有遗漏`]
      : []),
  ];
  const structuredData = {
    ...normalized,
    parseWarnings,
    parseErrors,
    sourceBlockId: child.heading.blockId,
    parserVersion: MECHANISM_DOCUMENT_PARSER_VERSION,
  };
  return {
    itemKind: 'game_analysis',
    stableKey: identity.stableKey,
    contentDocId: identity.contentDocId,
    sourceBlockId: child.heading.blockId,
    sourcePosition: index,
    sourceRevision,
    title: gameName,
    rawMarkdown,
    structuredData: canonicalizeMechanismJson(structuredData),
    contentHash: mechanismContentHash({
      itemKind: 'game_analysis',
      sourceBlockId: child.heading.blockId,
      title: gameName,
      rawMarkdown,
      structuredData,
    }),
    parseWarnings,
    parseErrors,
  };
}

function parseTrendEntry(xml, range, sourceRevision) {
  const rawMarkdown = xmlFragmentToMarkdown(range.body);
  const sourceTables = extractTables(range.body).map((table) => ({
    ...table,
    // Trend tables intentionally have more than two columns; the two-column
    // width check is only a game-entry contract.
    warnings: [],
  }));
  const sourceMaterial = rawMarkdown;
  const identity = buildMechanismIdentity({
    itemKind: 'trend_report',
    sourceBlockId: range.section.blockId,
    sourceMaterial,
    sourceLinks: sourceTables.flatMap((table) =>
      table.rows.flatMap((row) =>
        row.links.map((link) => link.url).filter(Boolean),
      ),
    ),
    title: range.section.title,
  });
  const metricResult = sourceTables.reduce(
    (result, table) => {
      const parsed = parseMechanismTrendTable(table, {
        sourceUrl: identity.sourceUrl,
      });
      return {
        metrics: [...result.metrics, ...parsed.metrics],
        warnings: [...result.warnings, ...parsed.warnings],
      };
    },
    { metrics: [], warnings: [] },
  );
  const structuredData = {
    metrics: metricResult.metrics,
    sourceTables,
    rawFieldMap: {},
    parseWarnings: metricResult.warnings,
    parseErrors: [
      ...(sourceTables.length === 0 ? ['趋势区域缺少原生表格'] : []),
      ...(metricResult.metrics.length === 0
        ? ['趋势表未解析出可验证指标']
        : []),
    ],
    sourceBlockId: range.section.blockId,
    parserVersion: MECHANISM_DOCUMENT_PARSER_VERSION,
  };
  return {
    itemKind: 'trend_report',
    stableKey: identity.stableKey,
    contentDocId: identity.contentDocId,
    sourceBlockId: range.section.blockId,
    sourcePosition: 0,
    sourceRevision,
    title: range.section.title,
    rawMarkdown,
    structuredData: canonicalizeMechanismJson(structuredData),
    contentHash: mechanismContentHash({
      itemKind: 'trend_report',
      sourceBlockId: range.section.blockId,
      title: range.section.title,
      rawMarkdown,
      structuredData,
    }),
    parseWarnings: metricResult.warnings,
    parseErrors: structuredData.parseErrors,
  };
}

/**
 * Deterministically parses the three contracted top-level sections of the
 * Feishu XML export. It never scans unrelated headings or infers a game from
 * a title outside the game-analysis section.
 */
export function parseMechanismDocument(input, metadata = {}) {
  const xml =
    typeof input === 'string' ? input : input?.xml || input?.content || '';
  const headings = findHeadings(xml);
  const sourceRevision = sourceRevisionFrom(xml, metadata);
  const includeTrend = metadata.includeTrend !== false;
  const warnings = [];
  if (!sourceRevision)
    warnings.push('来源 revision 缺失，使用 0；同步时必须提供最新 revision');

  const sections = {};
  const errors = [];
  for (const [key, title] of Object.entries(MECHANISM_SECTION_TITLES)) {
    if (key === 'trend' && !includeTrend) continue;
    const found = headings.findIndex((heading) =>
      sameTitle(heading.title, title),
    );
    if (found >= 0) sections[key] = sectionRange(xml, headings, found);
    else errors.push(`缺少顶层区域：${title}`);
  }

  const games = [];
  if (sections.games) {
    const sectionIndex = headings.indexOf(sections.games.section);
    const children = childrenOfSection(
      headings,
      sectionIndex,
      sections.games.end,
    );
    for (const [index, child] of children.entries()) {
      if (EXCLUDED_SECTION_TITLES.has(normalizedTitle(child.heading.title)))
        continue;
      games.push(parseGameEntry(xml, headings, child, index, sourceRevision));
    }
  }

  const trends =
    includeTrend && sections.trend
      ? [parseTrendEntry(xml, sections.trend, sourceRevision)]
      : [];
  const allItems = [...games, ...trends];
  const duplicateKeys = new Set();
  for (const item of allItems) {
    if (duplicateKeys.has(item.stableKey))
      errors.push(`稳定 ID 重复：${item.stableKey}`);
    duplicateKeys.add(item.stableKey);
    if (!item.sourceBlockId)
      item.parseErrors.push('缺少 block id，无法建立可回放的来源定位');
    if (item.itemKind === 'game_analysis' && !item.structuredData.gameName)
      item.parseWarnings.push('缺少明确游戏名字段，暂使用 H2 标题');
    for (const message of item.parseErrors || [])
      errors.push(`${item.title}: ${message}`);
    for (const message of item.parseWarnings || [])
      warnings.push(`${item.title}: ${message}`);
  }

  return {
    parserVersion: MECHANISM_DOCUMENT_PARSER_VERSION,
    documentId: metadata.documentId || metadata.document_id || null,
    sourceRevision,
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [
        key,
        {
          title: value.section.title,
          blockId: value.section.blockId,
        },
      ]),
    ),
    games,
    trends,
    items: allItems,
    errors,
    warnings,
  };
}

export {
  cleanText,
  parseSourceTable,
  sourceTableToMarkdown,
  xmlFragmentToMarkdown,
};
