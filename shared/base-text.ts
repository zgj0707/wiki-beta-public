/**
 * Base 文本的展示层工具（纯函数）。
 *
 * 约束：无 DOM、无 React、无第三方依赖 —— 本文件同时被前端（tsconfig.app.json）
 * 与服务端（tsconfig.node.json）编译，只能用标准 JS 能力实现。
 * 这里只做「展示层」处理，零语义解析、零信息损失：不猜测、不重排、不删减内容。
 */

/** 需要支持的具名实体（Base 文本里实际出现过的 + 常见等价物）。 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

const HTML_ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

function fromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/**
 * 解码 HTML 实体：`&amp; &lt; &gt; &quot; &#39; &nbsp;` 及数字实体（十进制 / 十六进制）。
 *
 * 线上游戏名会被 Base 存成 `Fell &amp; Sell`，直接渲染就是字面的 `&amp;`。
 * 单次正则替换，不做二次解码（`&amp;amp;` 只会还原一层，符合预期）。
 * 无法识别的实体原样保留。
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text.replace(
    HTML_ENTITY_RE,
    (match: string, entity: string): string => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        return fromCodePoint(Number.parseInt(entity.slice(2), 16), match);
      }
      if (entity.startsWith('#')) {
        return fromCodePoint(Number.parseInt(entity.slice(1), 10), match);
      }
      return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

/**
 * 判定一段文本是不是「内部同步 JSON」（Base 提取阶段把元数据写进了内容列）。
 * 规则：trim 后以 `{` 或 `[` 开头，且能 JSON.parse 成功。
 * 命中时调用方不渲染原文，改渲染一行灰字护栏。
 */
export function isInternalJson(text: string | null | undefined): boolean {
  const value = text?.trim();
  if (!value) return false;
  if (!value.startsWith('{') && !value.startsWith('[')) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** 软切分后的展示片段：label 为行首标签（已去掉冒号），无标签时为 null。 */
export interface DisplayLabelSegment {
  label: string | null;
  body: string;
}

/** 软切分用的分段符：中文分号（Base 内容用 `；` 分隔子标签）。 */
const SEGMENT_SEPARATOR = '；';

/** 行首标签：`操作门槛：` / `画面事件:`；标签最长 12 字，避免把正文里的冒号误判成标签。 */
const LEADING_LABEL_RE = /^([^：:]{1,12})[：:]/;

/**
 * 展示层软切分：按 `；` 切段，段首若匹配 `^([^：:]{1,12})[：:]` 则抽出 label（不含冒号）。
 *
 * 这是**纯展示**处理 —— 只为了按 `；` 软换行、把行首 `标签：` 加粗，
 * 不做任何语义解析与重排（阶段 C 归位前的内容错位问题靠中性标题兜住）。
 * 唯一「损失」是段与段之间的空白被 trim；把各段用 `；` 拼回等于原文 trim 后的结果。
 * 纯空白段被丢弃（不会渲染成空行）。
 */
export function splitDisplayLabels(text: string): DisplayLabelSegment[] {
  const value = text.trim();
  if (!value) return [];

  const segments: DisplayLabelSegment[] = [];
  for (const raw of value.split(SEGMENT_SEPARATOR)) {
    const segment = raw.trim();
    if (!segment) continue;

    const match = segment.match(LEADING_LABEL_RE);
    if (!match) {
      segments.push({ label: null, body: segment });
      continue;
    }

    const label = match[1].trim();
    const body = segment.slice(match[0].length).trim();
    if (!label && !body) continue;
    segments.push({ label: label || null, body });
  }
  return segments;
}

const EXTERNAL_URL_RE = /^https?:\/\//iu;

/**
 * 外链白名单：仅 `http://` / `https://` 开头（大小写不敏感）才返回可用链接，
 * 其余（空值、`javascript:`、相对路径、Base 内部标识）一律返回 null。
 * 调用方拿到 null 时只能渲染纯文本，不得渲染成 `<a href>`。
 */
export function normalizeExternalUrl(link: string | null | undefined): string | null {
  const value = link?.trim();
  if (!value) return null;
  return EXTERNAL_URL_RE.test(value) ? value : null;
}

/**
 * 日期：按本地中文格式展示（`2026/9/20`）；解析不出来退回前 10 位；
 * 空值返回 null，调用方约定 null 即不渲染该字段。
 *
 * 放这里而不是各页面各写一份：多处展示同一时间维度，两份拷贝必然分叉。
 * 命名不带「审核」（2026-09-29 更名）：机制观察的时间维度已从 Base「审核时间」
 * 改为系统「更新时间」，函数本身与语义无关，只用一次就随语义改名避免误用。
 */
export function formatLocalDate(
  value: string | null | undefined,
): string | null {
  const text = value?.trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10) || null;
  return date.toLocaleDateString('zh-CN');
}
