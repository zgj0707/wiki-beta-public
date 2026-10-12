import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ArrowLeftRight,
  PanelLeftClose,
  PanelRightClose,
  RotateCcw,
} from 'lucide-react';
import { useIsMobile } from '@client/src/hooks/use-mobile';
import { PaneNavigationProvider, type PaneSide, type PaneTarget } from '@client/src/components/pane-navigation';

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
  initialRatio?: number;
  defaultCollapsed?: 'none' | 'left' | 'right';
  /** 读者页面传入当前打开项，非空时自动展开右栏；窄屏自动显示右栏单栏。 */
  rightOpenKey?: string | null;
  /** 顶部操作条（收起/对换/复位），默认显示 */
  showToolbar?: boolean;
  className?: string;
  onNavigate?: (target: PaneTarget, from: PaneSide) => void;
}

/**
 * 通用双栏布局：
 * - 拖拽中间分隔条调节左右占比（0.2~0.8）
 * - 可单独收起左栏或右栏
 * - 可一键对换左右两侧内容
 */
export default function SplitPane({
  left,
  right,
  leftLabel = '左栏',
  rightLabel = '右栏',
  initialRatio = 0.7,
  defaultCollapsed = 'right',
  rightOpenKey,
  showToolbar = true,
  className = '',
  onNavigate,
}: SplitPaneProps) {
  const clamp = (r: number) =>
    Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
  const [ratio, setRatio] = useState(clamp(initialRatio));
  const [collapsed, setCollapsed] = useState<'none' | 'left' | 'right'>(
    defaultCollapsed,
  );
  const [swapped, setSwapped] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNarrow = useIsMobile();

  const leftContent = swapped ? right : left;
  const rightContent = swapped ? left : right;

  useEffect(() => {
    if (rightOpenKey) {
      setCollapsed(isNarrow ? 'left' : 'none');
      return;
    }
    setCollapsed('right');
  }, [isNarrow, rightOpenKey]);

  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - rect.left;
      setRatio(clamp(x / rect.width));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const CollapsedStrip = ({
    side,
    label,
  }: {
    side: 'left' | 'right';
    label: string;
  }) => (
    <button
      type="button"
      title={`展开${label}`}
      onClick={() => setCollapsed(isNarrow ? 'left' : 'none')}
      className={`flex w-9 shrink-0 items-center justify-center border-border bg-muted/40 text-muted-foreground hover:bg-muted ${
        side === 'left' ? 'border-r' : 'border-l'
      }`}
    >
      <span
        className="text-xs font-medium tracking-wide"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
    </button>
  );

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {showToolbar && (
        <div className="flex shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
          <button
            type="button"
            title="对换左右"
            onClick={() => setSwapped((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            对换
          </button>
          <button
            type="button"
            title="收起左栏"
            onClick={() =>
              setCollapsed((c) => (c === 'left' ? 'none' : 'left'))
            }
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
              collapsed === 'left'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
            左
          </button>
          <button
            type="button"
            title="收起右栏"
            onClick={() =>
              setCollapsed((c) => (c === 'right' ? 'none' : 'right'))
            }
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
              collapsed === 'right'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            <PanelRightClose className="h-3.5 w-3.5" />
            右
          </button>
          <button
            type="button"
            title="复位占比"
            onClick={() => setRatio(clamp(initialRatio))}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            复位
          </button>
          <span className="ml-auto text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{leftLabel}</span>
            <span className="mx-1">/</span>
            <span className="font-medium text-foreground">{rightLabel}</span>
          </span>
        </div>
      )}

      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        {collapsed === 'left' ? (
          <CollapsedStrip side="left" label={leftLabel} />
        ) : collapsed === 'right' ? (
          <div className="min-w-0 flex-1 overflow-auto"><PaneNavigationProvider side="left" onNavigate={onNavigate}>{leftContent}</PaneNavigationProvider></div>
        ) : (
          <div
            className="min-w-0 overflow-auto"
            style={{ width: `calc(${ratio * 100}% - 3px)` }}
          >
            <PaneNavigationProvider side="left" onNavigate={onNavigate}>{leftContent}</PaneNavigationProvider>
          </div>
        )}

        {collapsed === 'none' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调节分屏占比"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={Math.round(MIN_RATIO * 100)}
            aria-valuemax={Math.round(MAX_RATIO * 100)}
            tabIndex={0}
            onMouseDown={startResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setRatio((r) => clamp(r - 0.02));
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                setRatio((r) => clamp(r + 0.02));
              }
            }}
            className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors duration-200 hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        {collapsed === 'right' ? (
          <CollapsedStrip side="right" label={rightLabel} />
        ) : collapsed === 'left' ? (
          <div className="min-w-0 flex-1 overflow-auto"><PaneNavigationProvider side="right" onNavigate={onNavigate}>{rightContent}</PaneNavigationProvider></div>
        ) : (
          <div className="min-w-0 flex-1 overflow-auto"><PaneNavigationProvider side="right" onNavigate={onNavigate}>{rightContent}</PaneNavigationProvider></div>
        )}
      </div>
    </div>
  );
}
