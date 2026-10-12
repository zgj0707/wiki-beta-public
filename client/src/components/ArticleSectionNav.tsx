import { useState, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { List, X } from 'lucide-react';
import type { TocHeading } from '@client/src/lib/toc';

interface ArticleSectionNavProps {
  headings: TocHeading[];
  mode: 'split' | 'page';
}

/**
 * 文章分节导航：
 * - page 模式：常驻 sticky 目录卡片（标题下方，滚动时固定在顶部）。
 * - split 模式：可拖动悬浮球，点击展开分节菜单。
 * 点击条目滚动到对应锚点（id 由 Markdown 注入）。
 */
export default function ArticleSectionNav({
  headings,
  mode,
}: ArticleSectionNavProps) {
  const [open, setOpen] = useState(false);
  // 悬浮球停靠在文章框左上角，位置相对文章框（offsetParent）定位
  const [pos, setPos] = useState(() => ({ x: 16, y: 16 }));
  const movedRef = useRef(false);
  const dragRef = useRef<{
    dx: number;
    dy: number;
    pl: number;
    pt: number;
    pw: number;
    ph: number;
  } | null>(null);

  if (headings.length === 0) return null;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (mode === 'split') setOpen(false);
  };

  if (mode === 'page') {
    return (
      <nav className="sticky top-3 z-20 mb-6 rounded-lg border bg-card/95 p-3 text-sm shadow-sm backdrop-blur">
        <div className="mb-2 font-semibold text-muted-foreground">本文目录</div>
        <ul className="max-h-[42vh] space-y-1 overflow-y-auto">
          {headings.map((h) => (
            <li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}>
              <button
                type="button"
                onClick={() => scrollTo(h.id)}
                title={h.text}
                className="block w-full truncate rounded px-2 py-1 text-left text-foreground/80 hover:bg-muted hover:text-foreground"
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  // split 模式：可拖动悬浮球（限定在文章框内）+ 展开菜单（左上角）
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    movedRef.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.offsetParent as HTMLElement | null;
    const pr = parent?.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      pl: pr?.left ?? 0,
      pt: pr?.top ?? 0,
      pw: pr?.width ?? window.innerWidth,
      ph: pr?.height ?? window.innerHeight,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    movedRef.current = true;
    const d = dragRef.current;
    // 限定在文章框（offsetParent）范围内，防止拖出框产生定位/层级 bug
    const nx = Math.min(Math.max(8, e.clientX - d.pl - d.dx), d.pw - 56);
    const ny = Math.min(Math.max(8, e.clientY - d.pt - d.dy), d.ph - 56);
    setPos({ x: nx, y: ny });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <>
      <button
        type="button"
        aria-label="分节导航"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          if (!movedRef.current) setOpen((o) => !o);
        }}
        style={{ position: 'absolute', left: pos.x, top: pos.y, zIndex: 40 }}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-background/80 text-primary shadow-lg backdrop-blur transition hover:scale-105 hover:bg-primary/5 active:scale-95"
      >
        <List className="h-5 w-5" />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 64,
            zIndex: 40,
            width: 260,
            maxHeight: '60vh',
          }}
          className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">分节导航</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="overflow-y-auto p-2">
            {headings.map((h) => (
              <li key={h.id} style={{ paddingLeft: (h.level - 1) * 10 }}>
                <button
                  type="button"
                  onClick={() => scrollTo(h.id)}
                  title={h.text}
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
