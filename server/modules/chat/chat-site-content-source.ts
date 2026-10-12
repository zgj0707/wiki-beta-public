import { Injectable, Logger } from '@nestjs/common';

import { CHANGELOG } from '@shared/changelog';
import { REPORT_CONTENT_HTML } from '@shared/labs-report';
import { SITE_SOURCE_PREFIX } from '@shared/chat-source';
import type { QuickToolItem } from '@shared/quick-tools';

import { ArticlesService } from '../articles/articles.service';
import { InsightService } from '../insight/insight.service';
import { QuickToolsService } from '../wiki-beta/quick-tools.service';
import {
  extractKeywords,
  MULTI_QUERY_BONUS,
  scoreByKeywords,
  type RetrievedDoc,
} from './chat-retrieval-common';

const SITE_TOP_K = 6;
const SITE_SNIPPET_BUDGET = 1_800;
const QUICK_TOOL_ATTACHMENT_BUDGET = 12_000;
const ATTACHMENT_READ_CONCURRENCY = 3;
const ATTACHMENT_CACHE_TTL_MS = 5 * 60_000;
const CONTENT_CATALOG_CACHE_TTL_MS = 60_000;

type SiteContentKind =
  | 'changelog'
  | 'report'
  | 'mechanism-hints'
  | 'quick-tool'
  | 'content-catalog';

interface SiteCandidate {
  doc: RetrievedDoc;
  searchableText: string;
  kind: SiteContentKind;
  quickTool?: QuickToolItem;
  recencyRank?: number;
}

interface ScoredCandidate extends SiteCandidate {
  firstHitIndex: number;
}

/**
 * 可见站内文本来源：更新日志、静态报告、文章库公开目录，以及已启用便捷工具的名称/说明/README/HTML 可见文字。
 * 文章正文、机制观察和榜单仍由各自的结构化检索器负责；这里不读取 AI 配置、管理数据或未启用条目。
 */
@Injectable()
export class ChatSiteContentSource {
  private readonly logger = new Logger(ChatSiteContentSource.name);
  private readonly attachmentCache = new Map<string, { at: number; text: string }>();
  private readonly attachmentInflight = new Map<string, Promise<string>>();
  private contentCatalogCache: { at: number; candidate: SiteCandidate | null } | null = null;
  private contentCatalogInflight: Promise<SiteCandidate | null> | null = null;

  constructor(
    private readonly quickTools: QuickToolsService,
    private readonly insight: InsightService,
    private readonly articles: ArticlesService,
  ) {}

  async retrieve(questions: string[]): Promise<RetrievedDoc[]> {
    const unique = [...new Set(questions.map((question) => question.trim()).filter(Boolean))];
    if (!unique.length) return [];

    const [tools, mechanismHints, contentCatalog] = await Promise.all([
      this.loadQuickTools(),
      this.loadMechanismHints(),
      this.loadContentCatalog(),
    ]);
    const candidates = [
      ...this.changelogCandidates(),
      this.reportCandidate(),
      ...(mechanismHints ? [mechanismHints] : []),
      ...(contentCatalog ? [contentCatalog] : []),
      ...tools.map((tool) => this.quickToolCandidate(tool)),
    ];
    // HTML 附件正文不能靠名称/README 预判命中；先把全部启用工具的可见文字
    // 纳入短期内存索引，再统一排序，避免问到附件内部内容时因候选没选中而漏检。
    const attachmentCandidates = candidates
      .filter(
        (candidate) =>
          candidate.kind === 'quick-tool' && candidate.quickTool?.attachmentToken,
      );
    await mapWithConcurrency(
      attachmentCandidates,
      ATTACHMENT_READ_CONCURRENCY,
      async (candidate) => {
        const item = candidate.quickTool;
        if (!item) return;
        const text = await this.loadAttachmentText(item.id, item.attachmentToken!);
        if (!text) return;
        candidate.searchableText += `\n附件 HTML 可见文字：\n${text}`;
      },
    );

    const picked = this.rankCandidates(candidates, unique).slice(0, SITE_TOP_K);

    return picked.map((candidate) => ({
      ...candidate.doc,
      score: candidate.doc.score,
      snippet: makeExcerpt(
        candidate.searchableText,
        candidate.firstHitIndex,
        SITE_SNIPPET_BUDGET,
      ),
    }));
  }

  private changelogCandidates(): SiteCandidate[] {
    const sorted = CHANGELOG.slice().sort((a, b) => b.date.localeCompare(a.date));
    return sorted.map((entry, recencyRank) => {
      const itemLines = entry.items.map((item) => {
        const typeLabel =
          item.type === 'feat' ? '新增' : item.type === 'fix' ? '修复' : '优化';
        return `【${typeLabel}】${item.text}`;
      });
      const searchableText = [`日期：${entry.date}`, ...itemLines].join('\n');
      return {
        kind: 'changelog',
        recencyRank,
        searchableText,
        doc: {
          docId: `${SITE_SOURCE_PREFIX}changelog:${entry.date}`,
          title: `网站更新日志 · ${entry.date}`,
          sourceDate: entry.date,
          // 更新日志目前通过首页顶栏「关于网站」弹窗展示。
          url: '/',
          snippet: searchableText,
          score: 0,
          matchedEntities: [],
          source: 'site',
        },
      };
    });
  }

  private reportCandidate(): SiteCandidate {
    const searchableText = htmlToVisibleText(REPORT_CONTENT_HTML);
    return {
      kind: 'report',
      searchableText,
      doc: {
        docId: `${SITE_SOURCE_PREFIX}report:ai-games`,
        title: '动态与发现 · AI 游戏：从管线到玩法',
        sourceDate: null,
        url: '/labs',
        snippet: searchableText,
        score: 0,
        matchedEntities: [],
        source: 'site',
      },
    };
  }

  private async loadMechanismHints(): Promise<SiteCandidate | null> {
    try {
      const hints = await this.insight.mechanismScoreHints();
      const searchableText = [
        hints.market ? `市场认可度指数口径：${hints.market}` : '',
        hints.innovation ? `核心创新指数口径：${hints.innovation}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      if (!searchableText) return null;
      return {
        kind: 'mechanism-hints',
        searchableText,
        doc: {
          docId: `${SITE_SOURCE_PREFIX}mechanism-score-hints`,
          title: '机制观察 · 指数口径',
          sourceDate: null,
          url: '/mechanism-observatory',
          snippet: searchableText,
          score: 0,
          matchedEntities: [],
          source: 'site',
        },
      };
    } catch {
      // 指数说明读取失败时不影响其他站内检索来源。
      this.logger.warn('chat site content mechanism score hints unavailable');
      return null;
    }
  }

  /** 文章库公开筛选目录：玩法父子分类、内容类型和发布方及其当前计数。 */
  private async loadContentCatalog(): Promise<SiteCandidate | null> {
    if (
      this.contentCatalogCache &&
      Date.now() - this.contentCatalogCache.at < CONTENT_CATALOG_CACHE_TTL_MS
    ) {
      return this.contentCatalogCache.candidate;
    }
    if (this.contentCatalogInflight) return this.contentCatalogInflight;

    const flight = this.articles
      .facets()
      .then((facets) => {
        const lines = [
          '玩法分类：',
          ...facets.gameplay.map((node) =>
            `- ${node.label}（${node.count} 篇；未细分 ${node.selfCount} 篇）${
              node.children.length
                ? `；子类：${node.children.map((child) => `${child.label}（${child.count} 篇）`).join('、')}`
                : ''
            }`,
          ),
          '内容类型：',
          ...facets.contentTypes.map((item) => `- ${item.label}（${item.count} 篇）`),
          '发布方：',
          ...facets.publishers.map((item) => `- ${item.label}（${item.count} 篇）`),
        ];
        const searchableText = lines.join('\n');
        if (!facets.gameplay.length && !facets.contentTypes.length && !facets.publishers.length) {
          return null;
        }
        return {
          kind: 'content-catalog' as const,
          searchableText,
          doc: {
            docId: `${SITE_SOURCE_PREFIX}article-catalog`,
            title: '文章库 · 玩法分类、内容类型与发布方',
            sourceDate: null,
            url: '/library',
            snippet: searchableText,
            score: 0,
            matchedEntities: [],
            source: 'site' as const,
          },
        };
      })
      .catch(() => {
        this.logger.warn('chat site content article catalog unavailable');
        return null;
      })
      .then((candidate) => {
        this.contentCatalogCache = { at: Date.now(), candidate };
        return candidate;
      })
      .finally(() => {
        this.contentCatalogInflight = null;
      });
    this.contentCatalogInflight = flight;
    return flight;
  }

  private quickToolCandidate(item: QuickToolItem): SiteCandidate {
    const parts = [
      `分类：${item.category}`,
      item.date ? `日期：${formatDate(item.date) ?? item.date}` : '',
      item.description ? `说明：${item.description}` : '',
      item.readme ? `README：\n${item.readme}` : '',
      item.url ? `公开链接：${item.url}` : '',
      item.attachmentToken ? '包含可读取的 HTML 附件。' : '',
    ].filter(Boolean);
    const searchableText = parts.join('\n');
    return {
      kind: 'quick-tool',
      quickTool: item,
      searchableText,
      doc: {
        docId: `${SITE_SOURCE_PREFIX}quick-tool:${item.id}`,
        title: `发现页内容 · ${item.name}`,
        sourceDate: formatDate(item.date),
        url: '/quick-tools',
        snippet: searchableText,
        score: 0,
        matchedEntities: [],
        source: 'site',
      },
    };
  }

  private rankCandidates(
    candidates: SiteCandidate[],
    questions: string[],
  ): ScoredCandidate[] {
    return candidates
      .map((candidate) => {
        let best = 0;
        let hits = 0;
        let firstHitIndex = -1;
        let recencyBoost = 0;
        for (const question of questions) {
          const keywords = extractKeywords(question);
          if (!keywords.length) continue;
          const result = scoreByKeywords(
            candidate.doc.title,
            candidate.searchableText,
            keywords,
          );
          if (result.score > 0) hits += 1;
          if (result.score > best) {
            best = result.score;
            firstHitIndex = result.firstHitIndex;
          }
          if (
            candidate.kind === 'changelog' &&
            isRecentChangelogQuery(question) &&
            candidate.recencyRank != null
          ) {
            recencyBoost = Math.max(
              recencyBoost,
              Math.max(0, 8 - candidate.recencyRank * 2),
            );
          }
        }
        return {
          ...candidate,
          firstHitIndex,
          doc: {
            ...candidate.doc,
            score: best + Math.max(0, hits - 1) * MULTI_QUERY_BONUS + recencyBoost,
          },
        };
      })
      .filter((candidate) => candidate.doc.score > 0)
      .sort(
        (a, b) =>
          b.doc.score - a.doc.score ||
          (b.doc.sourceDate ?? '').localeCompare(a.doc.sourceDate ?? '') ||
          a.doc.title.localeCompare(b.doc.title),
      );
  }

  private async loadQuickTools(): Promise<QuickToolItem[]> {
    try {
      // QuickToolsService returns only enabled rows and reuses FeishuBaseReader's 60s table cache.
      return await this.quickTools.listTools();
    } catch {
      // A temporary Base/network issue must not break article/mechanism retrieval.
      this.logger.warn('chat site content quick-tool list unavailable');
      return [];
    }
  }

  private async loadAttachmentText(
    recordId: string,
    attachmentToken: string,
  ): Promise<string> {
    const cacheKey = `${recordId}:${attachmentToken}`;
    const cached = this.attachmentCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ATTACHMENT_CACHE_TTL_MS) {
      return cached.text;
    }
    const inflight = this.attachmentInflight.get(cacheKey);
    if (inflight) return inflight;

    const flight = this.quickTools
      .loadAttachment(recordId)
      .then((file) =>
        file
          ? htmlToVisibleText(file.data.toString('utf8')).slice(0, QUICK_TOOL_ATTACHMENT_BUDGET)
          : '',
      )
      .catch(() => {
        this.logger.warn('chat site content quick-tool attachment unavailable');
        return '';
      })
      .then((text) => {
        this.attachmentCache.set(cacheKey, { at: Date.now(), text });
        return text;
      })
      .finally(() => this.attachmentInflight.delete(cacheKey));
    this.attachmentInflight.set(cacheKey, flight);
    return flight;
  }
}

function isRecentChangelogQuery(question: string): boolean {
  if (/20\d{2}|第\s*[一二两三四五六七八九十\d]+\s*周/.test(question)) {
    return false;
  }
  return /(changelog|release notes|\bupdates?\b|\brecent updates?\b|\blatest updates?\b|\bchanged\b|更新日志|最近.{0,3}更新|近期.{0,3}更新|最新.{0,3}更新|网站更新|版本更新|新功能|改了什么|更新了什么|发布公告|最近.{0,4}(新增|新功能|改了|功能)|这次更新)/i.test(
    question,
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const calendarDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (calendarDate) return calendarDate;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function makeExcerpt(text: string, hitIndex: number, budget: number): string {
  const normalized = text.trim();
  if (normalized.length <= budget) return normalized;
  const hit = hitIndex >= 0 ? hitIndex : 0;
  const start = Math.max(0, Math.min(hit - Math.floor(budget / 3), normalized.length - budget));
  const end = start + budget;
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`;
}

/** HTML 附件只抽取文本/无障碍标签；脚本、样式、明确隐藏节点和运行时代码不入索引。 */
function htmlToVisibleText(html: string): string {
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!doctype\b[^>]*>/gi, ' ')
    .replace(/<(script|style|noscript|template|head|iframe|object|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const stack: Array<{ tag: string; hidden: boolean }> = [];
  const visibleParts: string[] = [];
  const accessibleLabels: string[] = [];
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const blockElements = new Set([
    'address', 'article', 'blockquote', 'dd', 'div', 'dl', 'dt', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'ol', 'p',
    'section', 'table', 'td', 'th', 'tr', 'ul',
  ]);

  for (const match of withoutActiveContent.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)) {
    if (match[3] !== undefined) {
      if (!stack.some((element) => element.hidden)) visibleParts.push(match[3]);
      continue;
    }

    const tag = match[1].toLocaleLowerCase();
    const attributes = match[2] ?? '';
    if (match[0].startsWith('</')) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        stack.splice(index);
        break;
      }
      visibleParts.push(blockElements.has(tag) ? '\n' : ' ');
      continue;
    }

    const parentHidden = stack.some((element) => element.hidden);
    const hidden = parentHidden || hasHiddenAttribute(attributes);
    if (!hidden) {
      accessibleLabels.push(...readAccessibleLabels(attributes));
    }
    if (tag === 'br' || tag === 'hr') visibleParts.push('\n');
    else visibleParts.push(blockElements.has(tag) ? '\n' : ' ');
    if (!voidElements.has(tag) && !attributes.trimEnd().endsWith('/')) {
      stack.push({ tag, hidden });
    }
  }

  return decodeHtmlEntities(
    [visibleParts.join(''), accessibleLabels.join(' ')].filter(Boolean).join('\n无障碍标签：'),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function hasHiddenAttribute(attributes: string): boolean {
  if (/\shidden(?:\s|=|$)/i.test(attributes)) return true;
  if (/\baria-hidden\s*=\s*(?:["']true["']|true\b)/i.test(attributes)) {
    return true;
  }
  const style = attributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const styleText = style?.[1] ?? style?.[2] ?? style?.[3] ?? '';
  return /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(styleText);
}

function readAccessibleLabels(attributes: string): string[] {
  return [...attributes.matchAll(/\b(?:alt|aria-label|title|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter(Boolean);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, codePoint: string) => decodeCodePoint(codePoint, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) => decodeCodePoint(codePoint, 16));
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        await worker(item);
      }
    }),
  );
}

function decodeCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return ' ';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return ' ';
  }
}
