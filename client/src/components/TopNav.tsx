import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@client/src/lib/utils';
import { useIsMobile } from '@client/src/hooks/use-mobile';
import SearchBar from '@client/src/components/SearchBar';
import AiAskBar from '@client/src/components/AiAskBar';
import AiSettingsDialog from '@client/src/components/chat/AiSettingsDialog';

/**
 * 「关于网站」弹窗走懒加载（硬约束）：其数据源 `data/changelog.ts` 单文件约 25KB raw，
 * 静态引入会把整份更新日志塞进 client 入口 chunk 并撑破 `budget:check` 的入口预算。
 * 改为仅在真正打开弹窗时才下载，入口体积与引入前一致。
 */
const AboutSiteDialog = lazy(
  () => import('@client/src/components/AboutSiteDialog'),
);
import {
  isChatLlmConfigured,
  loadChatLlmConfig,
} from '@client/src/lib/chat-llm-config';
import {
  Bot,
  Heart,
  Info,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  X,
  Menu,
} from 'lucide-react';
import {
  MAIN_NAV_ITEMS,
  type MainNavLink,
} from '@client/src/navigation';
import '@client/src/styles/nav-labs.css';
import { prefetchPublicRoute } from '@client/src/navigation-prefetch';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';

const THEME_OPTIONS = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
] as const;

/** 导航高亮：精确匹配，或位于该页签的子路由（如 /ranking/steam 时「榜单」保持高亮）。 */
function isNavActive(currentPath: string, itemPath: string) {
  return (
    currentPath === itemPath ||
    (itemPath !== '/' && currentPath.startsWith(`${itemPath}/`))
  );
}

export default function TopNav() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  // 路径可能含中文并被 URL 编码，需解码后再与导航项原始路径比较，否则无法正确高亮。
  const currentPath = decodeURIComponent(location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const { theme, setTheme } = useTheme();
  const selectedTheme =
    THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2];

  type NavItem = (typeof MAIN_NAV_ITEMS)[number];
  // 收藏不进桌面导航链接（对齐 v4：桌面端仅保留右上角图标入口，移动端抽屉保留链接）。
  // 显式放宽为 MainNavLink[]：单项的 glow 特效标记需要在渲染处读取。
  const navLinks: MainNavLink[] = MAIN_NAV_ITEMS.filter(
    (item): item is Extract<NavItem, { kind: 'link' }> => item.kind === 'link',
  ).filter((item) => item.path !== '/favorites');

  // 全站搜索：统一落 /search 结果页（聚合文章 + 机制观察；任务化 P2）。
  const handleSearch = (query: string) => {
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  // AI 问答搜索框（/ask 全页问答落地）：空查询也进页（页内可输入）。
  const handleAiAsk = (query: string) => {
    const q = query.trim();
    navigate(q ? `/ask?q=${encodeURIComponent(q)}` : '/ask');
  };

  // 抽屉打开时支持 Esc 关闭
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  // 挂载时读取本机 AI 配置状态（已配置则图标高亮）。
  useEffect(() => {
    setAiConfigured(isChatLlmConfigured(loadChatLlmConfig()));
  }, []);

  return (
    <header className="sticky top-0 z-50 shrink-0 border-b bg-background/95 backdrop-blur">
      {/* 第一行：Logo + 主导航 + 搜索/主题 + 移动端汉堡 */}
      <div className="flex h-14 items-center gap-3 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-600">
            <span className="text-sm font-bold text-primary-foreground">W</span>
          </div>
          <span className="text-sm font-semibold whitespace-nowrap">
            W Research
          </span>
        </Link>

        {!isMobile && (
          <>
            <nav
              aria-label="主导航"
              className="flex flex-1 items-center justify-center gap-1"
            >
              {navLinks.map((item) => {
                const Icon = item.icon;
                const isActive = isNavActive(currentPath, item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onMouseEnter={() => prefetchPublicRoute(item.path)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      item.glow && 'nav-labs-glow',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* AI 问答框（渐变呼吸边框，醒目入口）：xl 与文章搜索框并排并加宽，
                2xl 起给足 384px；容器同步放宽避免挤压。 */}
            <div className="flex w-full max-w-xs items-center gap-2 xl:max-w-md 2xl:max-w-3xl">
              <div className="hidden w-52 shrink-0 2xl:w-96 xl:block">
                <AiAskBar onAsk={handleAiAsk} />
              </div>
              {/* 窄屏退化：AI 问答图标按钮，进 /ask 页内输入。 */}
              <Link
                to="/ask"
                aria-label="AI 问答"
                className={cn(
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden',
                  currentPath === '/ask' && 'bg-primary/10 text-primary',
                )}
              >
                <Sparkles className="h-4 w-4" />
              </Link>
              <SearchBar onSearch={handleSearch} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="切换主题"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <selectedTheme.Icon className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {THEME_OPTIONS.map(({ value, label, Icon }) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => setTheme(value)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* AI 设置入口：外观切换右侧 */}
              <button
                type="button"
                aria-label="AI 设置"
                onClick={() => setAiSettingsOpen(true)}
                className={cn(
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  aiConfigured && 'text-primary',
                )}
              >
                <Bot className="h-4 w-4" />
              </button>
              {/* 收藏入口：外观切换右侧（对齐 v4 nav-right 顺序） */}
              <Link
                to="/favorites"
                aria-label="我的收藏"
                className={cn(
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  currentPath === '/favorites' &&
                    'bg-primary/10 text-primary',
                )}
              >
                <Heart className="h-4 w-4" />
              </Link>
              {/* 关于网站（更新公告）：收藏入口右侧 */}
              <button
                type="button"
                aria-label="关于网站"
                onClick={() => setAboutOpen(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {isMobile && (
          <button
            type="button"
            aria-label={mobileOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        )}
      </div>

      {/* 移动端抽屉：遮罩 + 左侧滑出面板 */}
      {isMobile && mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 z-50 h-full w-72 overflow-y-auto bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">导航</span>
              <button
                type="button"
                aria-label="关闭导航菜单"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="移动端导航" className="mt-2 flex flex-col gap-1">
              <Link
                to="/ask"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  currentPath === '/ask'
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'font-medium text-primary',
                )}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>AI 问答</span>
              </Link>
              {navLinks.map((item) => {
                const Icon = item.icon;
                const isActive = isNavActive(currentPath, item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            {/* 关于网站（更新公告）：移动端无右侧图标组，收进抽屉 */}
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                setAboutOpen(true);
              }}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Info className="h-4 w-4 shrink-0" />
              <span>关于网站</span>
            </button>
          </div>
        </>
      )}
      <AiSettingsDialog
        open={aiSettingsOpen}
        onOpenChange={setAiSettingsOpen}
        onSaved={(config) => setAiConfigured(isChatLlmConfigured(config))}
      />
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutSiteDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        </Suspense>
      )}
    </header>
  );
}
