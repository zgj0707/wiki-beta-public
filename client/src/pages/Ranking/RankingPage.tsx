import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTheme } from 'next-themes';
import { BOARDS_META, BoardData, BoardKey, Period, loadBoardContent } from '../../data/rankings';
import { fetchBoardsMeta, fetchBoardContent, RemoteBoardsMeta } from '../../data/rankings/remote';
import { mergeBoardPeriods } from '../../data/rankings/latest-period';
import NotFound from '../NotFound/NotFound';
import '../../styles/ranking.css';
import { themeSteamHtml } from '@client/src/lib/steam-theme';

const BOARD_KEYS = Object.keys(BOARDS_META) as BoardKey[];

export default function RankingPage() {
  const { board, period } = useParams<{ board: string; period?: string }>();
  const key = BOARD_KEYS.find((k) => k === board);

  // meta 双源：服务端（Base 驱动，含新增周期）优先，静态产物兜底；
  // title/type/periods 以远端为准，sourceUrl 静态数据专属，远端覆盖时保留。
  const [remoteMeta, setRemoteMeta] = useState<RemoteBoardsMeta | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchBoardsMeta().then((meta) => {
      if (alive) setRemoteMeta(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  const data: BoardData | undefined = useMemo(() => {
    if (!key) return undefined;
    const staticData = BOARDS_META[key];
    const remote = remoteMeta?.[key];
    if (!remote) return staticData;
    if (!staticData || staticData.type !== 'periods' || remote.type !== 'periods') {
      return { ...staticData, ...remote };
    }
    // 两个数据源都是部分集（Base 只录新期，静态停更）——整体覆盖会丢期，
    // 必须按 slug 合并去重：同 slug 远端为准（Base 是 SSOT），再按时间键倒序。
    const periods = mergeBoardPeriods(key, staticData.periods, remote.periods);
    return { ...staticData, ...remote, periods };
  }, [key, remoteMeta]);

  // periods 由生成器按时间倒序输出（索引 0 = 最新一期）：
  // periods 型榜单进页默认展示最新一期（periods[0]），选择行与 HTML 同屏。
  const latestSlug = data?.type === 'periods' ? data.periods[0]?.slug : undefined;
  const [activeSlug, setActiveSlug] = useState<string | undefined>(
    period ?? latestSlug,
  );
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setActiveSlug(period ?? latestSlug);
  }, [latestSlug, period]);

  // 正文 HTML 按需异步加载：仅当前期会下载对应 chunk。
  const slugToLoad = data
    ? data.type === 'single'
      ? 'index'
      : (activeSlug ?? latestSlug)
    : undefined;
  const [bodyHtml, setBodyHtml] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);

  useEffect(() => {
    if (!data || !slugToLoad || !key) return;
    let alive = true;
    setBodyLoading(true);
    // 正文双源：服务端（Base 附件）优先，失败或无对应期时回退静态 chunk，
    // 保证 Base 数据未就绪/接口异常时已上线榜单不受影响。
    void (async () => {
      const remote = await fetchBoardContent(key, slugToLoad);
      if (!alive) return;
      if (remote) {
        setBodyHtml(remote);
        setBodyLoading(false);
        return;
      }
      const html = await loadBoardContent(key as BoardKey, slugToLoad);
      if (!alive) return;
      setBodyHtml(html ?? null);
      setBodyLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [data, key, slugToLoad]);

  const renderedBodyHtml = useMemo(() => {
    if (bodyHtml === null || key !== 'steam') return bodyHtml;
    const initialTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';
    return themeSteamHtml(bodyHtml, resolvedTheme === 'dark' || (resolvedTheme === undefined && initialTheme === 'dark') ? 'dark' : 'light');
  }, [bodyHtml, key, resolvedTheme]);

  if (!data) return <NotFound />;
  if (bodyLoading || bodyHtml === null) {
    // 加载中或本期无内容（首次渲染未解析完成）：先展示骨架，避免误报未找到
    return (
      <div className="flex h-full flex-col">
        <RankingHeader title={data.title} sourceUrl={data.sourceUrl} />
        <div className="flex-1 overflow-auto bg-background">
          <div className="ranking-content max-w-[1100px] mx-auto px-5 py-6 space-y-4" aria-busy="true">
            {bodyLoading ? (
              <>
                <div className="h-8 w-72 animate-pulse rounded bg-muted" />
                <div className="h-64 animate-pulse rounded-lg bg-muted" />
              </>
            ) : (
              <NotFound />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <RankingHeader title={data.title} sourceUrl={data.sourceUrl} />
      <div className="flex-1 overflow-auto bg-background">
        <div className="ranking-content max-w-[1100px] mx-auto px-5 py-6">
          {data.type === 'periods' && (
            <PeriodSwitcher
              periods={data.periods}
              active={activeSlug ?? latestSlug}
              onChange={setActiveSlug}
            />
          )}

          {key === 'steam' ? (
            // Steam 周期内容是完整 HTML 文档（含 head/style），用 iframe + srcdoc 渲染，
            // 样式天然隔离，避免 .wrap/.card/.table 等类名与宿主页冲突
            <iframe
              srcDoc={renderedBodyHtml ?? bodyHtml}
              title={`Steam · ${activeSlug ?? latestSlug}`}
              sandbox=""
              className="steam-iframe"
            />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 榜单页头部：返回入口 + 榜单名 + 飞书源文档。
 * 返回指向 /ranking 榜单入口页（不再指向旧的板块页）；加载态与正文态共用，
 * 避免正文加载期间丢失返回入口。样式与站内页面工具条一致（描边按钮 + 主色胶囊）。
 */
function RankingHeader({
  title,
  sourceUrl,
}: {
  title: string;
  sourceUrl?: string;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-4 py-2.5">
      <Link
        to="/ranking"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回榜单
      </Link>
      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
        {title}
      </span>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          查看飞书源文档
        </a>
      ) : null}
    </header>
  );
}

function PeriodSwitcher({
  periods,
  active,
  onChange,
}: {
  periods: Period[];
  active?: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div className="period-nav">
      {periods.map((p) => (
        <button
          key={p.slug}
          type="button"
          className={`period-nav-btn${active === p.slug ? ' active' : ''}`}
          onClick={() => onChange(p.slug)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
