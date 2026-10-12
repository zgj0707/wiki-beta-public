import { createHash } from 'node:crypto';

export const MECHANISM_FIELD_NORMALIZER_VERSION = 'mechanism-table-v2';

const FIELD_ALIASES = new Map([
  ['gameName', ['游戏名']],
  ['sourceMaterial', ['原始材料/来源', '原始材料', '来源']],
  ['coreHook', ['核心钩子']],
  ['adMoments', ['广告瞬间']],
  ['visuality', ['可视化程度']],
  ['operationThreshold', ['操作门槛']],
  ['dramaSource', ['戏剧来源']],
  ['failureFeedback', ['失败反馈']],
  ['growthDriver', ['成长驱动']],
  ['multiplayerValue', ['多人价值']],
  ['acquisitionValue', ['买量价值']],
  ['mechanismFormula', ['题材中立的通用机制公式']],
  ['validationQuestions', ['待验证问题']],
  ['legacyAd', ['3秒素材']],
  ['legacyLoop', ['试玩循环']],
  ['legacyReuse', ['抽离复用']],
  ['legacyAcquisition', ['买量迁移']],
]);

const EXPLICIT_SUBFIELD_ALIASES = new Map([
  ['scene', ['画面事件']],
  ['presentationAdvantage', ['呈现优势']],
  ['operationThreshold', ['操作门槛']],
  ['failureFeedback', ['失败反馈']],
  ['growthDriver', ['成长驱动']],
  ['dramaSource', ['戏剧来源']],
  ['reusableFormula', ['可复用公式']],
  ['mechanismFormula', ['题材中立的通用机制公式']],
  ['acquisitionValue', ['买量价值']],
  ['multiplayerValue', ['多人价值']],
  ['validationQuestions', ['待验证', '待验证问题']],
]);

const ALLOWED_DIMENSIONS = ['Indie', 'Casual', 'Cozy', 'Organizing'];
const TEMPORARY_URL_QUERY =
  /^(?:authcode|token|access_token|signature|expires|expiry|x-amz-[^=]+|x-oss-[^=]+)$/iu;
const LEGACY_COMPOSITE_FIELDS = new Set([
  'legacyAd',
  'legacyLoop',
  'legacyReuse',
  'legacyAcquisition',
]);

function normalizedLabel(value) {
  return String(value || '')
    .replace(/^\s*#{1,6}\s*/u, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/^\s*(?:\*\*|__|`)+/u, '')
    .replace(/(?:\*\*|__|`)+\s*$/u, '')
    .replace(/[\s\u3000]/gu, '')
    .trim();
}

function cleanValue(value) {
  return String(value || '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trim();
}

function nonEmptyLines(value) {
  return cleanValue(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function aliasFor(value, aliases = FIELD_ALIASES) {
  const key = normalizedLabel(value);
  for (const [canonical, labels] of aliases) {
    if (labels.some((label) => normalizedLabel(label) === key))
      return canonical;
  }
  return null;
}

function stripListPrefix(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '')
    .trim();
}

function appendMapValue(map, key, value) {
  if (!value) return;
  map[key] = map[key] ? `${map[key]}\n${value}` : value;
}

/**
 * Reads only explicitly labelled fields. A field heading may use Markdown,
 * bold text, an inline colon, or a following paragraph. Unknown labels are
 * intentionally ignored instead of being guessed into a known field.
 */
export function extractMechanismRawFields(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n?/gu, '\n')
    .split('\n');
  const fields = new Map();
  const rawFieldMap = {};
  const warnings = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    const value = cleanValue(current.parts.join('\n'));
    if (!value) return;
    const existing = fields.get(current.canonical);
    fields.set(current.canonical, {
      sourceLabel: current.sourceLabel,
      value: existing ? `${existing.value}\n${value}` : value,
    });
    appendMapValue(rawFieldMap, current.sourceLabel, value);
    if (existing) warnings.push(`字段重复：${current.sourceLabel}`);
  };

  for (const line of lines) {
    const candidate = line
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '')
      .replace(/^\s*#{1,6}\s*/u, '')
      .trim();
    const withoutDecoration = candidate
      .replace(/^(?:\*\*|__|`)+/u, '')
      .replace(/(?:\*\*|__|`)+\s*$/u, '')
      .trim();
    const separator = withoutDecoration.search(/[:：]/u);
    const labelPart =
      separator >= 0
        ? withoutDecoration.slice(0, separator)
        : withoutDecoration;
    const canonical = aliasFor(labelPart);
    const nestedCanonical = aliasFor(labelPart, EXPLICIT_SUBFIELD_ALIASES);

    // In legacy sections labels such as 操作门槛 and 多人价值 are nested
    // subfields, even though they are also valid names in the new template.
    if (
      current &&
      LEGACY_COMPOSITE_FIELDS.has(current.canonical) &&
      nestedCanonical
    ) {
      current.parts.push(line);
      continue;
    }

    if (canonical) {
      commit();
      const inline =
        separator >= 0 ? withoutDecoration.slice(separator + 1).trim() : '';
      current = {
        canonical,
        sourceLabel: labelPart.trim(),
        parts: inline ? [inline] : [],
      };
      continue;
    }

    if (current) current.parts.push(line);
  }
  commit();

  return { fields, rawFieldMap, warnings };
}

function getField(fields, key) {
  return fields.get(key)?.value || '';
}

function collectExplicitSubfields(value) {
  const result = new Map();
  const warnings = [];
  let current = null;
  const commit = () => {
    if (!current) return;
    const text = cleanValue(current.parts.join('\n'));
    if (!text) return;
    const previous = result.get(current.canonical);
    result.set(current.canonical, previous ? `${previous}\n${text}` : text);
    if (previous) warnings.push(`复合字段重复：${current.sourceLabel}`);
  };

  for (const line of String(value || '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')) {
    const match = line
      .trim()
      .match(/^(?:[-*+]\s+|\d+[.)]\s+)?([^:：]{1,40})\s*[:：]\s*(.*)$/u);
    const canonical = match
      ? aliasFor(match[1], EXPLICIT_SUBFIELD_ALIASES)
      : null;
    if (canonical) {
      commit();
      current = {
        canonical,
        sourceLabel: match[1].trim(),
        parts: match[2] ? [match[2].trim()] : [],
      };
    } else if (current) {
      current.parts.push(line);
    }
  }
  commit();
  return { result, warnings };
}

function splitArrayField(value) {
  const lines = nonEmptyLines(value).map(stripListPrefix).filter(Boolean);
  return lines.length ? lines : cleanValue(value) ? [cleanValue(value)] : [];
}

function exactVisuality(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (key === 'high' || key === '高') return 'high';
  if (key === 'medium' || key === '中') return 'medium';
  if (key === 'low' || key === '低') return 'low';
  return null;
}

function hasTemporaryUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      if (TEMPORARY_URL_QUERY.test(key)) return true;
    }
    return /(?:[?&](?:authcode|access_token|signature)=)/iu.test(rawUrl);
  } catch {
    return /(?:[?&](?:authcode|access_token|signature)=)/iu.test(rawUrl);
  }
}

export function isTemporaryMechanismUrl(rawUrl) {
  return hasTemporaryUrl(String(rawUrl || ''));
}

function trimUrlPunctuation(value) {
  return String(value || '').replace(/[\]}>),.;，。；！？]+$/gu, '');
}

export function canonicalizeMechanismUrl(rawUrl) {
  const candidate = trimUrlPunctuation(rawUrl);
  if (!/^https?:\/\//iu.test(candidate) || hasTemporaryUrl(candidate))
    return null;
  try {
    const url = new URL(candidate);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_[^=]+|scene|share_token|share_id)$/iu.test(key))
        url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

export function extractMechanismUrls(value) {
  return [...String(value || '').matchAll(/https?:\/\/[^\s<>"']+/giu)]
    .map((match) => canonicalizeMechanismUrl(match[0]))
    .filter(Boolean);
}

export function extractSteamAppId(value) {
  const match = String(value || '').match(
    /https?:\/\/store\.steampowered\.com\/app\/(\d+)(?:[/?#]|$)/iu,
  );
  return match?.[1] || null;
}

function extractCoverUrl(rawXml, markdown) {
  const candidates = [];
  const xml = String(rawXml || '');
  for (const match of xml.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/giu))
    candidates.push(match[1]);
  for (const match of String(markdown || '').matchAll(
    /!\[[^\]]*\]\(([^)]+)\)/gu,
  ))
    candidates.push(match[1]);
  for (const candidate of candidates) {
    const url = canonicalizeMechanismUrl(candidate);
    if (url) return { url, warning: null };
    if (isTemporaryMechanismUrl(candidate))
      return { url: null, warning: '已忽略带临时授权参数的图片链接' };
  }
  return { url: null, warning: null };
}

export function buildMechanismIdentity({
  itemKind,
  sourceBlockId,
  sourceMaterial,
  sourceLinks = [],
}) {
  const identityMaterial = [sourceMaterial, ...sourceLinks]
    .filter(Boolean)
    .join(' ');
  const steamAppId = extractSteamAppId(identityMaterial);
  const sourceUrl = extractMechanismUrls(identityMaterial)[0] || null;
  let stableKey;
  if (sourceBlockId) stableKey = `feishu-block:${sourceBlockId}`;
  else if (steamAppId) stableKey = `steam:${steamAppId}`;
  else if (sourceUrl)
    stableKey = `url:${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16)}`;
  else stableKey = `feishu-block:${sourceBlockId || 'missing'}`;
  const prefix =
    itemKind === 'trend_report' ? 'mechanism:trend:' : 'mechanism:game:';
  return {
    stableKey,
    contentDocId: `${prefix}${stableKey}`,
    steamAppId,
    sourceUrl,
  };
}

function parseVisuality(value) {
  const lines = nonEmptyLines(value);
  const first = lines[0] || '';
  const colon = first.search(/[:：]/u);
  const levelText = colon >= 0 ? first.slice(0, colon).trim() : first;
  const level = exactVisuality(levelText);
  const reason =
    colon >= 0
      ? [first.slice(colon + 1).trim(), ...lines.slice(1)]
          .filter(Boolean)
          .join('\n')
      : lines.slice(1).join('\n');
  if (!level && value) {
    return {
      level: null,
      reason: cleanValue(value),
      warning: `无法严格映射可视化程度：${first}`,
    };
  }
  return { level, reason: reason || null, warning: null };
}

function fieldOrSubfield(fields, primary, subfields, fallback = '') {
  return getField(fields, primary) || subfields.get(primary) || fallback;
}

/**
 * Converts an entry's explicitly labelled text into the stable structured
 * shape used by the mechanism revision. Legacy composite fields are split
 * only when their nested labels are present; their full source text remains
 * in rawFieldMap.
 */
export function normalizeMechanismFields(markdown, { rawXml = '' } = {}) {
  const { fields, rawFieldMap, warnings } = extractMechanismRawFields(markdown);
  const legacyAd = getField(fields, 'legacyAd');
  const legacyLoop = getField(fields, 'legacyLoop');
  const legacyReuse = getField(fields, 'legacyReuse');
  const legacyAcquisition = getField(fields, 'legacyAcquisition');
  const adSubfields = collectExplicitSubfields(legacyAd);
  const loopSubfields = collectExplicitSubfields(legacyLoop);
  const reuseSubfields = collectExplicitSubfields(legacyReuse);
  const acquisitionSubfields = collectExplicitSubfields(legacyAcquisition);

  warnings.push(
    ...adSubfields.warnings,
    ...loopSubfields.warnings,
    ...reuseSubfields.warnings,
    ...acquisitionSubfields.warnings,
  );

  const sourceMaterial = getField(fields, 'sourceMaterial');
  const coreHook = getField(fields, 'coreHook');
  const explicitAd = getField(fields, 'adMoments');
  const adMoments = explicitAd
    ? splitArrayField(explicitAd)
    : legacyAd
      ? adSubfields.result.size
        ? [...adSubfields.result.values()].map(cleanValue)
        : [cleanValue(legacyAd)]
      : [];

  const visualityRaw = getField(fields, 'visuality');
  const visuality = visualityRaw
    ? parseVisuality(visualityRaw)
    : {
        level: null,
        reason: adSubfields.result.get('presentationAdvantage') || null,
        warning: null,
      };
  if (visuality.warning) warnings.push(visuality.warning);

  const explicitQuestions = getField(fields, 'validationQuestions');
  const validationQuestions = explicitQuestions
    ? splitArrayField(explicitQuestions)
    : acquisitionSubfields.result.has('validationQuestions')
      ? splitArrayField(acquisitionSubfields.result.get('validationQuestions'))
      : [];

  const sourceUrls = extractMechanismUrls(sourceMaterial);
  const steamAppId = extractSteamAppId(sourceMaterial);
  const cover = extractCoverUrl(rawXml, markdown);
  if (cover.warning) warnings.push(cover.warning);

  return {
    gameName: cleanValue(getField(fields, 'gameName')),
    sourceMaterial: cleanValue(sourceMaterial) || null,
    sourceUrl: sourceUrls[0] || null,
    coreHook: cleanValue(coreHook) || null,
    adMoments,
    visualityLevel: visuality.level,
    visualityReason: cleanValue(visuality.reason) || null,
    operationThreshold:
      fieldOrSubfield(fields, 'operationThreshold', loopSubfields.result) ||
      null,
    dramaSource:
      fieldOrSubfield(fields, 'dramaSource', reuseSubfields.result) || null,
    failureFeedback:
      fieldOrSubfield(fields, 'failureFeedback', loopSubfields.result) || null,
    growthDriver:
      fieldOrSubfield(fields, 'growthDriver', loopSubfields.result) || null,
    multiplayerValue:
      fieldOrSubfield(
        fields,
        'multiplayerValue',
        acquisitionSubfields.result,
      ) || null,
    acquisitionValue:
      fieldOrSubfield(
        fields,
        'acquisitionValue',
        acquisitionSubfields.result,
      ) || null,
    mechanismFormula:
      fieldOrSubfield(fields, 'mechanismFormula', reuseSubfields.result) ||
      null,
    validationQuestions,
    steamAppId,
    coverUrl: cover.url,
    rawFieldMap,
    parseWarnings: warnings,
  };
}

function tableFieldValue(sourceTable, aliases) {
  const target = aliases.map(normalizedLabel);
  const row = (sourceTable?.rows || []).find((candidate) =>
    target.includes(normalizedLabel(candidate.label)),
  );
  return row || null;
}

function tableFieldText(sourceTable, aliases) {
  return cleanValue(tableFieldValue(sourceTable, aliases)?.valueText || '');
}

function tableRawFieldMap(sourceTable) {
  const rawFieldMap = {};
  for (const row of sourceTable?.rows || []) {
    const label = cleanValue(row.label || '');
    if (!label || normalizedLabel(label) === normalizedLabel('分析字段'))
      continue;
    const value = cleanValue(row.valueText || '');
    if (!Object.prototype.hasOwnProperty.call(rawFieldMap, label)) {
      rawFieldMap[label] = value;
    } else if (value) {
      rawFieldMap[label] = rawFieldMap[label]
        ? `${rawFieldMap[label]}\n${value}`
        : value;
    }
  }
  return rawFieldMap;
}

/**
 * Normalizes the actual two-column tables used by the Feishu source.
 * The table parser supplies already-separated cells, so this function never
 * treats Markdown pipes, tabs, or line boundaries as field delimiters.
 */
export function normalizeMechanismTable(sourceTable) {
  const rawFieldMap = tableRawFieldMap(sourceTable);
  const warnings = [];
  const rows = (sourceTable?.rows || []).filter(
    (row) => normalizedLabel(row.label) !== normalizedLabel('分析字段'),
  );
  const labels = new Set();
  for (const row of rows) {
    const key = normalizedLabel(row.label);
    if (!key) {
      warnings.push(`表格第 ${Number(row.position) + 1 || '?'} 行缺少字段名`);
      continue;
    }
    if (labels.has(key)) warnings.push(`字段重复：${row.label}`);
    labels.add(key);
    if (!row.valueText) warnings.push(`字段为空：${row.label}`);
  }

  const explicitAd = tableFieldText(sourceTable, ['广告瞬间']);
  const legacyAd = tableFieldText(sourceTable, ['3秒素材']);
  const sourceMaterialRow = tableFieldValue(sourceTable, [
    '原始材料/来源',
    '原始材料',
    '来源',
  ]);
  const sourceMaterial = cleanValue(sourceMaterialRow?.valueText || '');
  const sourceLinks = (sourceMaterialRow?.links || [])
    .map((link) => link.url)
    .filter(Boolean);
  const sourceUrl = sourceLinks[0] || null;
  const steamAppId =
    sourceLinks.map(extractSteamAppId).find(Boolean) ||
    extractSteamAppId(sourceMaterial) ||
    null;
  const visualityRaw = tableFieldText(sourceTable, ['可视化程度']);
  const visuality = visualityRaw
    ? parseVisuality(visualityRaw)
    : { level: null, reason: null, warning: null };
  if (visuality.warning) warnings.push(visuality.warning);

  const validationRaw = tableFieldText(sourceTable, ['待验证问题']);
  const adMoments = explicitAd
    ? splitArrayField(explicitAd)
    : legacyAd
      ? [legacyAd]
      : [];

  return {
    gameName: tableFieldText(sourceTable, ['游戏名']) || null,
    sourceMaterial: sourceMaterial || null,
    sourceUrl,
    sourceLinks,
    coreHook: tableFieldText(sourceTable, ['核心钩子']) || null,
    adMoments,
    legacyAd: legacyAd || null,
    legacyLoop: tableFieldText(sourceTable, ['试玩循环']) || null,
    legacyReuse: tableFieldText(sourceTable, ['抽离复用']) || null,
    legacyAcquisition: tableFieldText(sourceTable, ['买量迁移']) || null,
    visualityLevel: visuality.level,
    visualityReason: cleanValue(visuality.reason) || null,
    operationThreshold: tableFieldText(sourceTable, ['操作门槛']) || null,
    dramaSource: tableFieldText(sourceTable, ['戏剧来源']) || null,
    failureFeedback: tableFieldText(sourceTable, ['失败反馈']) || null,
    growthDriver: tableFieldText(sourceTable, ['成长驱动']) || null,
    multiplayerValue: tableFieldText(sourceTable, ['多人价值']) || null,
    acquisitionValue: tableFieldText(sourceTable, ['买量价值']) || null,
    mechanismFormula:
      tableFieldText(sourceTable, ['题材中立的通用机制公式']) || null,
    validationQuestions: validationRaw ? splitArrayField(validationRaw) : [],
    steamAppId,
    coverUrl: null,
    rawFieldMap,
    sourceTable,
    parseWarnings: warnings,
  };
}

function parseNumber(value) {
  const text = String(value || '')
    .replace(/,/gu, '')
    .trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/u.test(text)) return null;
  const number = Number(text.replace(/%$/u, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeCell(value) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function metricKeyForHeader(value) {
  const key = normalizeCell(value).toLowerCase();
  if (
    /^(?:发布数|发布量|发行数|数量|游戏数|release\s*count|count)$/iu.test(key)
  )
    return 'release_count';
  if (/^(?:同比|同比增长|year\s*over\s*year|yoy)$/iu.test(key))
    return 'year_over_year_percent';
  if (/^(?:同期|同期变化|same\s*period|same\s*period\s*change)$/iu.test(key))
    return 'same_period_change_percent';
  return null;
}

function isDimension(value) {
  const normalized = normalizeCell(value).toLowerCase();
  return (
    ALLOWED_DIMENSIONS.find(
      (dimension) => dimension.toLowerCase() === normalized,
    ) || null
  );
}

function isPeriod(value) {
  const normalized = normalizeCell(value);
  return /^(?:19|20)\d{2}(?:[-–—/]\d{2,4})?$/u.test(normalized)
    ? normalized
    : null;
}

function metricUnit(metricKey) {
  return metricKey === 'release_count' ? 'count' : 'percent';
}

/**
 * Parses only the allow-listed trend metrics from table rows. The function
 * accepts rows with or without a thead; when headers are absent, only the
 * unambiguous [dimension, value] or [period, dimension, value] shape is used.
 */
export function parseAllowedTrendMetrics(
  tableRows,
  { periodHint = null, sourceUrl = null } = {},
) {
  const rows = (tableRows || [])
    .map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []))
    .filter((row) => row.some(Boolean));
  if (!rows.length) return { metrics: [], warnings: [] };

  const header = rows[0];
  const metricColumns = header.map(metricKeyForHeader);
  const dimensionIndex = header.findIndex((cell) =>
    /^(?:标签|类型|类别|分类|维度|dimension)$/iu.test(cell),
  );
  const periodIndex = header.findIndex((cell) =>
    /^(?:年份|年度|期间|period|year)$/iu.test(cell),
  );
  const hasHeader =
    metricColumns.some(Boolean) || dimensionIndex >= 0 || periodIndex >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const warnings = [];
  const metrics = [];

  for (const row of dataRows) {
    const dimension =
      (dimensionIndex >= 0 ? isDimension(row[dimensionIndex]) : null) ||
      row.map(isDimension).find(Boolean) ||
      null;
    if (!dimension) continue;
    const period =
      (periodIndex >= 0 ? isPeriod(row[periodIndex]) : null) ||
      row.map(isPeriod).find(Boolean) ||
      periodHint ||
      null;
    if (!period) {
      warnings.push(`趋势行缺少明确期间：${row.join(' | ')}`);
      continue;
    }

    const candidates = hasHeader
      ? metricColumns
          .map((metricKey, index) => ({ metricKey, index }))
          .filter((entry) => entry.metricKey)
      : [
          {
            metricKey: 'release_count',
            index: row.findIndex((cell) => parseNumber(cell) !== null),
          },
        ];
    for (const candidate of candidates) {
      if (candidate.index < 0) continue;
      const value = parseNumber(row[candidate.index]);
      if (value === null) continue;
      metrics.push({
        metricKey: candidate.metricKey,
        dimension,
        period,
        value,
        unit: metricUnit(candidate.metricKey),
        evidenceText: row.join(' | '),
        sourceUrl,
      });
    }
  }

  return { metrics, warnings };
}

const TREND_DIMENSION_ALIASES = new Map([
  ['Indie', ['Indie', 'Indie独立游戏']],
  ['Casual', ['Casual', 'Casual简单休闲']],
  ['Cozy', ['Cozy', 'Cozy舒适休闲']],
  ['Organizing', ['Organizing', 'Organizing标签发行数']],
]);

function trendDimension(value) {
  const key = normalizeCell(value).replace(/[\s\u3000]/gu, '');
  for (const [dimension, aliases] of TREND_DIMENSION_ALIASES) {
    if (aliases.some((alias) => key === alias || key.startsWith(alias)))
      return dimension;
  }
  return null;
}

function trendPeriod(value) {
  const result = normalizeCell(value);
  return /(?:19|20)\d{2}/u.test(result) ? result : null;
}

function percentageValue(value) {
  const match = String(value || '').match(
    /([+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*%)/u,
  );
  return match ? parseNumber(match[1]) : null;
}

function asOfDateFromPeriod(value) {
  const match = normalizeCell(value).match(
    /((?:19|20)\d{2}).*?(\d{1,2})月\s*(\d{1,2})日/u,
  );
  return match
    ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
    : null;
}

/**
 * Parses the two explicit trend table shapes in the source document. It does
 * not guess a dimension from arbitrary prose or treat a partial-year count as
 * a percentage metric.
 */
export function parseMechanismTrendTable(
  sourceTable,
  { sourceUrl = null } = {},
) {
  const rows = (sourceTable?.rows || []).map((row) =>
    (row.cells || []).map((cell) => normalizeCell(cell.text)),
  );
  if (rows.length < 2) return { metrics: [], warnings: ['趋势表缺少数据行'] };
  const header = rows[0];
  const firstHeader = normalizedLabel(header[0]);
  const metrics = [];
  const warnings = [];
  const addMetric = (metricKey, dimension, period, value, evidenceText) => {
    if (!dimension || !period || value == null) return;
    metrics.push({
      metricKey,
      dimension,
      period,
      value,
      unit: metricUnit(metricKey),
      asOfDate: asOfDateFromPeriod(period),
      evidenceText,
      sourceUrl,
    });
  };

  if (firstHeader === normalizedLabel('标签')) {
    for (const row of rows.slice(1)) {
      const dimension = trendDimension(row[0]);
      if (!dimension) continue;
      for (let index = 1; index < row.length; index += 1) {
        const period = trendPeriod(header[index]);
        if (!period) continue;
        const value = parseNumber(row[index]);
        if (value == null) continue;
        const metricKey = /同比/u.test(header[index])
          ? 'year_over_year_percent'
          : 'release_count';
        addMetric(metricKey, dimension, period, value, row.join('；'));
      }
    }
    return { metrics, warnings };
  }

  if (firstHeader !== normalizedLabel('指标'))
    return { metrics, warnings: ['趋势表表头无法识别'] };

  let currentDimension = null;
  for (const row of rows.slice(1)) {
    const label = normalizeCell(row[0]);
    const rowDimension =
      trendDimension(label) ||
      (/Organizing/u.test(label) ? 'Organizing' : null);
    if (rowDimension) currentDimension = rowDimension;
    const dimension = rowDimension || currentDimension;
    if (!dimension) continue;
    const evidenceText = row.join('；');
    const metricKey = /同比/u.test(label)
      ? 'year_over_year_percent'
      : /同期/u.test(label)
        ? 'same_period_change_percent'
        : 'release_count';
    let emitted = false;
    for (let index = 1; index < row.length; index += 1) {
      const period = trendPeriod(header[index]);
      if (!period) continue;
      const value =
        metricKey === 'same_period_change_percent'
          ? percentageValue(row[index])
          : metricKey === 'year_over_year_percent'
            ? percentageValue(row[index])
            : parseNumber(row[index]);
      if (value == null) continue;
      addMetric(metricKey, dimension, period, value, evidenceText);
      emitted = true;
    }
    if (!emitted && metricKey === 'same_period_change_percent') {
      const value = percentageValue(row[row.length - 1]);
      const period = header.map(trendPeriod).filter(Boolean).pop() || null;
      if (value != null && period)
        addMetric(metricKey, dimension, period, value, evidenceText);
    }
  }
  return { metrics, warnings };
}

export function canonicalizeMechanismJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeMechanismJson);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalizeMechanismJson(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function normalizeMechanismMarkdown(value) {
  return String(value || '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trim();
}

// These properties are useful for replay and diagnostics, but they are not
// content. Including them in the revision hash makes a harmless source
// serialization change look like a new gameplay observation.
const NON_CONTENT_STRUCTURED_KEYS = new Set([
  'coverUrl',
  'parseErrors',
  'parseWarnings',
  'parserVersion',
  'sourceBlockId',
  'sourceImages',
  'sourceTable',
  'sourceTables',
]);

function isEmptyComparableValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object')
    return Object.keys(value).length === 0;
  return false;
}

/**
 * Returns only stable, semantic source data for equality checks. The full
 * native source table remains stored in the revision; it is deliberately not
 * used as the equality fingerprint because table/image block metadata can be
 * re-serialized without changing the observation.
 */
export function canonicalizeMechanismContent(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalizeMechanismContent(item))
      .filter((item) => !isEmptyComparableValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (NON_CONTENT_STRUCTURED_KEYS.has(key)) return result;
        const normalized = canonicalizeMechanismContent(value[key]);
        if (!isEmptyComparableValue(normalized)) result[key] = normalized;
        return result;
      }, {});
  }
  if (typeof value === 'string') return normalizeMechanismMarkdown(value);
  return value;
}

export function mechanismContentHash({
  itemKind,
  title,
  rawMarkdown,
  structuredData,
}) {
  const comparableData = canonicalizeMechanismContent(structuredData || {});
  const sourceFingerprint = Object.keys(comparableData).length
    ? JSON.stringify(comparableData)
    : normalizeMechanismMarkdown(rawMarkdown);
  const input = [
    itemKind || '',
    normalizeMechanismMarkdown(title),
    sourceFingerprint,
  ].join('\u0000');
  return createHash('sha256').update(input).digest('hex');
}
