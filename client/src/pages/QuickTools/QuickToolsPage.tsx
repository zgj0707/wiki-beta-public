import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, Copy, ExternalLink, Gamepad2, Link as LinkIcon, Orbit, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchQuickTools, openQuickTool } from '@client/src/api/quick-tools';
import { formatRelativeSourceDate } from '@client/src/lib/relative-date';
import {
  QUICK_TOOLS_CATEGORIES,
  QUICK_TOOLS_CATEGORY_LABELS,
  QUICK_TOOLS_INTERACTIVE_CATEGORY,
  quickToolTarget,
} from '@shared/quick-tools';
import type { QuickToolItem } from '@shared/quick-tools';
import { Skeleton } from '@client/src/components/ui/skeleton';
import EmptyState from '@client/src/components/ui/empty-state';
import Markdown from '@client/src/components/Markdown';
import { cn } from '@client/src/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@client/src/components/ui/dialog';

/** 分类 → 默认 lucide 图标（图标附件暂不渲染，统一用分类默认图标）。 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  链接: LinkIcon,
  文档: BookOpen,
};

/** 单枚筛选胶囊：选中=主色实心，未选中=描边（复用文章库 FilterChip 样式）。 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
        active
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

/**
 * 复制文本到剪贴板：优先 Clipboard API（需 https/localhost 安全上下文），
 * 降级用隐藏 textarea + execCommand（兼容 http 内网环境）。
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 安全上下文不可用或被拒绝 → 走降级。
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 文档 README 正文弹窗：点击「文档」卡片就地渲染「README」文本列（markdown）。
 * 服务端 fieldRichText 已按富文本分段保真还原换行，前端直接 ReactMarkdown 渲染，
 * 不做任何 `\n` 字符替换（会把代码块里 `printf '%s\n'` 这类字面转义破坏掉）。
 * 「打开原仓库」「复制提示词」「关闭」按钮置于标题栏右侧；隐藏默认右上角 X
 * （与「关闭」按钮重复）。其他分类卡片不触发本弹窗。
 */
function QuickToolReadmeDialog({
  item,
  onClose,
}: {
  item: QuickToolItem | null;
  onClose: () => void;
}) {
  const open = item != null;
  // 关闭后保留上一份内容一帧，避免 Radix 退场动画期间正文闪空。
  const [content, setContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (item) setContent(item.readme);
  }, [item]);

  // 卸载时清理复制反馈计时器，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    if (!content) return;
    const ok = await copyText(content);
    if (ok) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* 默认右上角 X 已隐藏（showCloseButton=false）：与「关闭」按钮重复 */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(90vh,60rem)] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Wrench className="h-4.5 w-4.5" aria-hidden />
              </span>
              <span className="min-w-0 truncate text-base font-bold">
                {item?.name ?? ''}
              </span>
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!content}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  copied
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                )}
              >
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? '已复制' : '复制提示词'}
              </button>
              {item?.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  打开原仓库
                </a>
              ) : null}
              <DialogClose asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  关闭
                </button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>
        {/* 正文区：flex-1 + min-h-0 在受限高度内滚动（父级已 flex flex-col + overflow-hidden） */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {content ? (
            <Markdown content={content} />
          ) : (
            <p className="text-sm text-muted-foreground">暂无 README 内容。</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function QuickToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('cat') ?? '';
  // 文档 README 弹窗当前条目；null = 关闭。
  const [readmeItem, setReadmeItem] = useState<QuickToolItem | null>(null);

  const toolsQuery = useQuery({
    queryKey: ['quick-tools'],
    queryFn: fetchQuickTools,
  });
  const tools = toolsQuery.data ?? [];
  const loading = toolsQuery.isPending;
  const error = toolsQuery.isError;

  // 互动内容（tag 勾稽修正 2026-10-09）：SSOT 是 Base「便捷工具表」分类=互动内容
  // 的行（H5 游戏 / HTML 评测）。打开方式与主网格同规则（有什么读什么，读列解锁
  // 2026-10-10）：链接行外链新标签、附件行 openQuickTool() fetch→Blob 新窗渲染
  // （顶部带返回条）、README 行弹窗。文章工作台不承载互动内容。
  const interactiveItems = useMemo(
    () =>
      tools.filter(
        (item) =>
          item.category === QUICK_TOOLS_INTERACTIVE_CATEGORY &&
          quickToolTarget(item) !== null,
      ),
    [tools],
  );

  // 分类筛选在前端做：一次拉全量，按 category 过滤；后端已按「日期」降序，保持顺序。
  // 本页只展示「链接/文档」两分类（QUICK_TOOLS_CATEGORIES）；
  // 互动内容独立成区，机制周报归机制观察页（分类四值收敛 2026-10-10）。
  const toolItems = useMemo(
    () =>
      tools.filter((item) =>
        (QUICK_TOOLS_CATEGORIES as readonly string[]).includes(item.category),
      ),
    [tools],
  );
  const filtered = useMemo(
    () =>
      categoryParam
        ? toolItems.filter((item) => item.category === categoryParam)
        : toolItems,
    [toolItems, categoryParam],
  );

  const updateCategory = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete('cat');
        else next.set('cat', value);
        return next;
      },
      { replace: false },
    );
  };

  return (
    <div className="page-scroll">
      <div className="page-container page-container-wide pt-5">
        {/* 工具条承担语境（无标题横幅，与榜单入口页一致） */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            发现
          </span>
          <span className="text-xs text-muted-foreground">
            链接、文档与互动内容；卡片按内容打开（README 弹窗 / HTML 新窗 / 外链）
          </span>
          {/* 任务化后 /labs 失去顶栏页签，入口收编到本页（P2 将做深度合并）。 */}
          <Link
            to="/labs"
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
          >
            <Orbit className="h-3.5 w-3.5" />
            动态与发现 ↗
          </Link>
        </div>

        {/* 分类筛选胶囊行：全部 + 三个分类，状态写入 ?cat= 可分享可回退 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip
            active={!categoryParam}
            onClick={() => updateCategory('')}
          >
            全部
          </FilterChip>
          {QUICK_TOOLS_CATEGORIES.map((category) => (
            <FilterChip
              key={category}
              active={categoryParam === category}
              onClick={() =>
                updateCategory(categoryParam === category ? '' : category)
              }
            >
              {QUICK_TOOLS_CATEGORY_LABELS[category]}
            </FilterChip>
          ))}
        </div>

        {/* 互动内容区（tag 勾稽修正 2026-10-09）：便捷工具表分类=互动内容，按行内容打开 */}
        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <Gamepad2 className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-bold">互动内容</h2>
            <span className="text-xs text-muted-foreground">
              H5 游戏 / HTML 评测，按行内容在新窗或外链打开
            </span>
          </div>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          ) : interactiveItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              暂无互动内容 —— 在 Base「便捷工具表」新建分类=互动内容的行，填入链接 /
              README / 附件任一内容后自动进站。
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {interactiveItems.map((item) => {
                const target = quickToolTarget(item);
                if (!target) return null;
                const cardInner = (
                  <>
                    <div className="flex items-center gap-2">
                      <Gamepad2
                        className="h-4 w-4 shrink-0 text-primary"
                        aria-hidden
                      />
                      <h3 className="min-w-0 truncate text-sm font-semibold group-hover:text-primary">
                        {item.name}
                      </h3>
                    </div>
                    {item.description && (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    <span className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
                      <span>
                        {target.kind === 'external'
                          ? '外部链接 ↗'
                          : target.kind === 'readme'
                            ? 'README'
                            : 'HTML 附件'}
                      </span>
                      <span className="shrink-0">
                        {formatRelativeSourceDate(item.date?.slice(0, 10))}
                      </span>
                    </span>
                  </>
                );
                const cardClass =
                  'group flex flex-col rounded-2xl border bg-card p-4 text-left transition hover:border-primary/50 hover:shadow-sm';
                if (target.kind === 'external') {
                  return (
                    <a
                      key={item.id}
                      href={target.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cardClass}
                    >
                      {cardInner}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (target.kind === 'readme') {
                        setReadmeItem(item);
                        return;
                      }
                      void openQuickTool(item).catch(() => {
                        window.alert(
                          `「${item.name}」打开失败，请稍后重试。`,
                        );
                      });
                    }}
                    className={cardClass}
                  >
                    {cardInner}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-8 pb-10">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-40 w-full rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <EmptyState title="便捷工具暂时无法加载" description="请稍后重试。" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="当前分类下暂无工具"
              description="试试切换其他分类。"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {filtered.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] ?? LinkIcon;
                const target = quickToolTarget(item);
                // 有 README 正文 → 整卡变按钮，点击开弹窗（与分类无关，按行内容判定）。
                const isReadmeCard = target?.kind === 'readme';
                const cardInner = (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <h3 className="min-w-0 text-sm font-semibold group-hover:text-primary">
                        {item.name}
                      </h3>
                    </div>
                    {item.description && (
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-primary">
                      {isReadmeCard ? '查看 README' : '打开 ↗'}
                    </span>
                  </>
                );
                const cardClass =
                  'group flex flex-col rounded-2xl border bg-card p-5 text-left transition hover:border-primary/50 hover:shadow-sm';
                if (isReadmeCard) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setReadmeItem(item)}
                      className={cardClass}
                    >
                      {cardInner}
                    </button>
                  );
                }
                // 附件行走点击处理器 openQuickTool（fetch→Blob 新窗渲染）：
                // /media、/api、多段深链的 URL 直开在平台全部不可达
                // （shared/quick-tools.ts 头注释）；外链保留 <a> 原生语义。
                if (!target) return null;
                if (target.kind === 'external') {
                  return (
                    <a
                      key={item.id}
                      href={target.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cardClass}
                    >
                      {cardInner}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      void openQuickTool(item).catch(() => {
                        window.alert(
                          `「${item.name}」打开失败，请稍后重试。`,
                        );
                      });
                    }}
                    className={cardClass}
                  >
                    {cardInner}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <QuickToolReadmeDialog
        item={readmeItem}
        onClose={() => setReadmeItem(null)}
      />
    </div>
  );
}