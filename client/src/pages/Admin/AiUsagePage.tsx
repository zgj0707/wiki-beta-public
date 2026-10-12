import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';

import {
  ChatAdminError,
  chatAdminLogin,
  chatAdminLogout,
  chatAdminSetDailyLimit,
  chatAdminSetWhitelisted,
  chatAdminStatus,
  chatAdminUpdateNote,
  chatAdminUsage,
  type ChatIpUsageItem,
} from '@client/src/api/admin';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Skeleton } from '@client/src/components/ui/skeleton';

/**
 * AI 用量监控台（管理员专用，/admin/ai-usage）。
 *
 * 零登录站点的管理面：密码哈希在服务端环境变量，登录签 HttpOnly Cookie。
 * 数据 = chat_ip_usage 台账（只统计消耗站点默认 key 的问答）。
 * 页面随路由懒加载，仅打开时挂载；刷新间隔 30s（可手动刷新）。
 */
export default function AiUsagePage() {
  const [phase, setPhase] = useState<'checking' | 'login' | 'ready' | 'disabled'>(
    'checking',
  );
  const [items, setItems] = useState<ChatIpUsageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async (): Promise<boolean> => {
    try {
      const { items: rows } = await chatAdminUsage();
      setItems(rows);
      setError(null);
      return true;
    } catch (err) {
      if (err instanceof ChatAdminError && (err.status === 401 || err.status === 403)) {
        // 401=应用守卫拒（未登录/会话过期）；403=网关拒（同样按未登录处理，
        // 本应用服务端不产生 403）。此前只认 401，网关 403 被误判成「已登录」。
        setPhase('login');
        return false;
      }
      setError(err instanceof Error ? err.message : String(err));
      return true; // 已登录，仅展示错误
    }
  }, []);

  // 首次进入：查状态 → 直接试拉数据（有效 Cookie 则直达，否则落登录框）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { enabled } = await chatAdminStatus();
        if (cancelled) return;
        if (!enabled) {
          setPhase('disabled');
          return;
        }
      } catch {
        // 状态查询失败不阻塞：直接试拉数据判 401
      }
      const ok = await loadUsage();
      if (!cancelled && ok) setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUsage]);

  // 已就绪后 30s 轮询（标签页隐藏时暂停）。
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadUsage();
    }, 30_000);
    return () => clearInterval(timer);
  }, [phase, loadUsage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadUsage();
    setRefreshing(false);
  }, [loadUsage]);

  const handleLogout = useCallback(async () => {
    try {
      await chatAdminLogout();
    } finally {
      setItems([]);
      setPhase('login');
    }
  }, []);

  if (phase === 'checking') {
    return (
      <div className="page-scroll">
        <div className="page-container mx-auto w-full max-w-5xl px-6 py-14">
          <Skeleton className="mb-6 h-8 w-56" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'disabled') {
    return (
      <div className="page-scroll">
        <div className="page-container mx-auto w-full max-w-5xl px-6 py-14">
          <h1 className="text-xl font-semibold">AI 用量监控台</h1>
          <p className="mt-4 text-muted-foreground">
            管理面未启用：服务端未配置管理密码（CHAT_ADMIN_PASSWORD_SHA256）。
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <div className="page-scroll">
        <div className="page-container mx-auto w-full max-w-5xl px-6 py-14">
          <h1 className="text-xl font-semibold">AI 用量监控台</h1>
          <LoginForm
            onSuccess={async () => {
              setPhase('ready');
              await loadUsage();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <div className="page-container mx-auto w-full max-w-5xl px-6 py-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">AI 用量监控台</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              刷新
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
              退出
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          仅统计消耗站点默认配置的问答（自定义 Key 不入账，也不受日限额约束）；
          默认限额 500 次/日/IP，可按 IP 覆盖或白名单豁免；每 30 秒自动刷新。
        </p>
        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <UsageTable items={items} onSaved={loadUsage} />
      </div>
    </div>
  );
}

/** 登录框：密码 → 服务端哈希比对。 */
function LoginForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await chatAdminLogin(password);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting, onSuccess]);

  return (
    <form
      className="mt-8 max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="mb-2 block text-sm font-medium" htmlFor="admin-password">
        管理密码
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="admin-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? '隐藏密码' : '显示密码'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button type="submit" disabled={!password || submitting}>
          {submitting ? '登录中…' : '登录'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </form>
  );
}

/** 用量表：备注行内编辑。 */
function UsageTable({
  items,
  onSaved,
}: {
  items: ChatIpUsageItem[];
  onSaved: () => Promise<boolean>;
}) {
  const totals = items.reduce(
    (acc, item) => ({
      requests: acc.requests + item.requestCount,
      prompt: acc.prompt + item.promptTokens,
      completion: acc.completion + item.completionTokens,
    }),
    { requests: 0, prompt: 0, completion: 0 },
  );

  if (!items.length) {
    return (
      <p className="mt-8 text-sm text-muted-foreground">
        暂无用量记录 —— 站点默认配置生效后，访客问答会在这里逐条入账。
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">IP</th>
            <th className="px-3 py-2 font-medium">备注</th>
            <th className="px-3 py-2 text-right font-medium">今日</th>
            <th className="px-3 py-2 text-right font-medium">问答次数</th>
            <th className="px-3 py-2 text-right font-medium">输入 tokens</th>
            <th className="px-3 py-2 text-right font-medium">输出 tokens</th>
            <th className="px-3 py-2 text-center font-medium">日限额</th>
            <th className="px-3 py-2 text-right font-medium">首次</th>
            <th className="px-3 py-2 text-right font-medium">最近</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <UsageRow key={item.ip} item={item} onSaved={onSaved} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-medium">
            <td className="px-3 py-2" colSpan={2}>
              合计（{items.length} 个 IP）
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {items.reduce((acc, item) => acc + item.todayCount, 0)}
            </td>
            <td className="px-3 py-2 text-right">{totals.requests}</td>
            <td className="px-3 py-2 text-right">{totals.prompt.toLocaleString()}</td>
            <td className="px-3 py-2 text-right">
              {totals.completion.toLocaleString()}
            </td>
            <td className="px-3 py-2" colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 单行：点备注格进入编辑，保存/取消；白名单开关与单 IP 限额覆盖即时生效。 */
function UsageRow({
  item,
  onSaved,
}: {
  item: ChatIpUsageItem;
  onSaved: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 单 IP 日限额覆盖编辑（null = 跟随全局默认 500）。
  const [limitEditing, setLimitEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState('');
  const limitInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (limitEditing) limitInputRef.current?.focus();
  }, [limitEditing]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await chatAdminUpdateNote(item.ip, draft.trim() || null);
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [item.ip, draft, saving, onSaved]);

  const toggleWhitelist = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      await chatAdminSetWhitelisted(item.ip, !item.whitelisted);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }, [item.ip, item.whitelisted, toggling, onSaved]);

  /** 保存单 IP 限额覆盖：留空 = 恢复全局默认（null）。 */
  const saveDailyLimit = useCallback(async () => {
    const raw = limitDraft.trim();
    let value: number | null = null;
    if (raw !== '') {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
        setError('限额需为 1..1000000 的整数，留空恢复默认');
        return;
      }
      value = parsed;
    }
    setError(null);
    try {
      await chatAdminSetDailyLimit(item.ip, value);
      setLimitEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [item.ip, limitDraft, onSaved]);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 font-mono text-xs">{item.ip}</td>
      <td className="px-3 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-7 w-40 text-xs"
              placeholder="备注（可留空）"
            />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void save()} disabled={saving}>
              保存
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setDraft(item.note ?? '');
                setEditing(false);
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(item.note ?? '');
              setEditing(true);
            }}
            className="max-w-56 truncate text-left text-muted-foreground hover:text-foreground hover:underline"
            title="点击编辑备注"
          >
            {item.note || <span className="italic opacity-50">点此备注</span>}
          </button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${
          item.todayCount > 0 && !item.whitelisted ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
        title="今日（北京时间）消耗站点 key 的问答次数"
      >
        {item.todayCount}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{item.requestCount}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {item.promptTokens.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {item.completionTokens.toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => void toggleWhitelist()}
            disabled={toggling}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              item.whitelisted
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'border-muted bg-transparent text-muted-foreground hover:bg-muted'
            }`}
            title={
              item.whitelisted
                ? '已豁免日限额，点击取消豁免'
                : '点击豁免该 IP 的日限额'
            }
          >
            {item.whitelisted ? '豁免' : '限额中'}
          </button>
          {limitEditing ? (
            <div className="flex items-center gap-1">
              <Input
                ref={limitInputRef}
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveDailyLimit();
                  if (e.key === 'Escape') setLimitEditing(false);
                }}
                className="h-6 w-16 px-1 text-center text-xs"
                placeholder="留空默认"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                onClick={() => void saveDailyLimit()}
              >
                ✓
              </Button>
            </div>
          ) : (
            !item.whitelisted && (
              <button
                type="button"
                onClick={() => {
                  setLimitDraft(
                    item.dailyLimitOverride != null
                      ? String(item.dailyLimitOverride)
                      : '',
                  );
                  setLimitEditing(true);
                }}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                title={
                  item.dailyLimitOverride != null
                    ? `单 IP 覆盖：${item.dailyLimitOverride} 次/日，点击修改`
                    : '跟随全局默认 500 次/日，点击设置单 IP 覆盖'
                }
              >
                {item.dailyLimitOverride != null
                  ? `${item.dailyLimitOverride}/日`
                  : '默认 500'}
              </button>
            )
          )}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
        {formatDay(item.firstSeenAt)}
      </td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
        {formatDay(item.lastSeenAt)}
      </td>
    </tr>
  );
}
