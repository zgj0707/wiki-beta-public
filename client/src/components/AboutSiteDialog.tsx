import { useState } from 'react';
import { ExternalLink, Loader2, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { chatAdminLogin, chatAdminUsage } from '@client/src/api/admin';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { CHANGELOG } from '@client/src/data/changelog';
import { cn } from '@client/src/lib/utils';

/**
 * 使用手册的**唯一权威版本**是飞书文档，站内只做跳转、不维护独立副本。
 *
 * 硬约束（改前必读）：这两条链接指向的文档由人工在飞书侧维护，改内容不需要发版。
 * 因此**不要**把手册正文搬进本文件或 `docs/` 当作第二份来源 —— 两处并存必然出现口径打架，
 * 而站内无法判断哪份更新，届时用户会按旧的那份操作。
 */
const SITE_GUIDE_URL =
  'https://example.feishu.cn/docx/docxEXAMPLESITEGUIDE01';
const OPS_HANDBOOK_URL =
  'https://example.feishu.cn/docx/docxEXAMPLEOPSHANDBOOK1';

interface AboutSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_ORDER = ['feat', 'fix', 'other'] as const;

const TYPE_LABEL: Record<(typeof TYPE_ORDER)[number], string> = {
  feat: '新增',
  fix: '修复',
  other: '优化',
};

const TYPE_BADGE_CLASS: Record<(typeof TYPE_ORDER)[number], string> = {
  feat: 'bg-success/15 text-success',
  fix: 'bg-warning/15 text-warning',
  other: 'bg-muted text-muted-foreground',
};

/**
 * 「关于网站」更新公告：直接读取 `client/src/data/changelog.ts` 渲染。
 *
 * 数据源与 GitHub 版本归档 PR 正文同源 —— 每次网站改动后先更新 changelog，
 * 再据此归纳 PR 正文。
 */
export default function AboutSiteDialog({
  open,
  onOpenChange,
}: AboutSiteDialogProps) {
  return (    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg">
        <DialogHeader>
          <DialogTitle>关于网站</DialogTitle>
          <DialogDescription>W Research · 使用手册与更新公告</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="text-sm font-medium">使用手册</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            内容怎么进站内、网站怎么用、发现问题怎么反馈，都写在这里。手册以飞书文档为准，站内不再另存副本。
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a
              href={SITE_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              站内使用手册
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <a
              href={OPS_HANDBOOK_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
            >
              内容运营手册
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </div>

        <div className="max-h-80 space-y-5 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <div key={entry.date}>
              <h3 className="text-sm font-semibold">{entry.label}</h3>
              <div className="mt-2 space-y-3 text-sm">
                {TYPE_ORDER.map((type) => {
                  const items = entry.items.filter(
                    (item) => item.type === type,
                  );
                  if (!items.length) return null;
                  return (
                    <div key={type}>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        {TYPE_LABEL[type]}
                      </div>
                      <ul className="space-y-1.5">
                        {items.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span
                              className={cn(
                                'mt-0.5 inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] leading-none font-semibold',
                                TYPE_BADGE_CLASS[type],
                              )}
                            >
                              {TYPE_LABEL[type]}
                            </span>
                            <span className="text-foreground/80">
                              {item.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 管理入口：刻意低调（仅悬停可辨）。先验证密码、成功才跳监控台；
            已有有效会话时点击直接跳。 */}
        <AdminEntry onProceed={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 弹窗内的管理入口：点击后静默探测会话——有效 Cookie 直接跳转；
 * 否则就地展开密码框，登录成功（服务端种下 Cookie）后才跳走，
 * 避免把访客领到一个裸登录页。失败原因就地显示（密码错误/管理面未启用）。
 */
function AdminEntry({ onProceed }: { onProceed: () => void }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = () => {
    onProceed();
    navigate('/admin/ai-usage');
  };

  /** 首次点击：静默探测是否已有有效会话（有效则免密直达）。 */
  const handleEntryClick = async () => {
    if (expanded || busy) return;
    setBusy(true);
    try {
      await chatAdminUsage();
      go(); // 已登录
    } catch {
      setExpanded(true); // 未登录/网关拒 → 展开密码框
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await chatAdminLogin(password);
      go();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => void handleEntryClick()}
        title="AI 用量监控台"
        aria-label="AI 用量监控台"
        className="mt-1 inline-flex items-center gap-1 self-start rounded text-[11px] text-muted-foreground/25 transition-colors hover:text-muted-foreground"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <Lock className="size-3" aria-hidden />
        )}
        管理入口
      </button>
    );
  }

  return (
    <form
      className="mt-2 flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="管理密码"
        autoComplete="current-password"
        autoFocus
        className="h-7 w-40 text-xs"
      />
      <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!password || busy}>
        {busy ? '验证中…' : '进入'}
      </Button>
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
