import { useEffect, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import { chatLlmDefault, type ChatLlmDefaultInfo } from '@client/src/api/chat';
import {
  CHAT_LLM_DEFAULTS,
  clearChatLlmConfig,
  isChatLlmConfigured,
  loadChatLlmConfig,
  saveChatLlmConfig,
  type ChatLlmConfig,
} from '@client/src/lib/chat-llm-config';
import { cn } from '@client/src/lib/utils';

interface AiSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存后回调（用于父组件刷新「已配置」状态）。 */
  onSaved?: (config: ChatLlmConfig) => void;
}

type SettingsMode = 'default' | 'custom';

/**
 * AI 设置，双档：
 * - 默认档：站点统一配置（Base「AI 配置」表管理），无需填 Key；走服务端全托管。
 * - 自定义档（BYO-Key）：API 接入地址 / 模型 / Key 仅存本机浏览器。
 */
export default function AiSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: AiSettingsDialogProps) {
  const [mode, setMode] = useState<SettingsMode>('default');
  const [baseUrl, setBaseUrl] = useState(CHAT_LLM_DEFAULTS.baseUrl);
  const [model, setModel] = useState(CHAT_LLM_DEFAULTS.model);
  const [apiKey, setApiKey] = useState('');
  const [deepRetrieval, setDeepRetrieval] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultInfo, setDefaultInfo] = useState<ChatLlmDefaultInfo | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const configured = isChatLlmConfigured(loadChatLlmConfig());
    setMode(configured ? 'custom' : 'default');
    const config = loadChatLlmConfig();
    setBaseUrl(config.baseUrl);
    setModel(config.model);
    setApiKey(config.apiKey);
    setDeepRetrieval(config.deepRetrieval === true);
    setError(null);
    let cancelled = false;
    void chatLlmDefault().then((info) => {
      if (!cancelled) setDefaultInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSave = () => {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
    const trimmedModel = model.trim();
    const trimmedKey = apiKey.trim();
    if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
      setError('接入地址需以 http(s):// 开头');
      return;
    }
    if (!trimmedModel) {
      setError('模型名不能为空');
      return;
    }
    if (!trimmedKey) {
      setError('API Key 不能为空');
      return;
    }
    const config: ChatLlmConfig = {
      baseUrl: trimmedUrl,
      model: trimmedModel,
      apiKey: trimmedKey,
      deepRetrieval,
    };
    saveChatLlmConfig(config);
    onSaved?.(config);
    onOpenChange(false);
  };

  /** 切回默认档：清除本机 BYO 配置（发问走站点默认配置）。 */
  const handleUseDefault = () => {
    clearChatLlmConfig();
    setApiKey('');
    setDeepRetrieval(false);
    onSaved?.({ ...CHAT_LLM_DEFAULTS, apiKey: '' });
    onOpenChange(false);
  };

  const handleClear = () => {
    clearChatLlmConfig();
    setApiKey('');
    setDeepRetrieval(false);
    setMode('default');
  };

  const modeButton = (value: SettingsMode, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setMode(value);
        setError(null);
      }}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors',
        mode === value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AI 设置</DialogTitle>
          <DialogDescription>
            {mode === 'default'
              ? '使用站点统一配置的模型作答，无需任何填写。'
              : '配置你自己的大模型接入信息（OpenAI 兼容格式），仅存本机浏览器。'}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex gap-1 rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="AI 配置方式"
        >
          {modeButton('default', '站点默认')}
          {modeButton('custom', '自定义')}
        </div>

        {mode === 'default' ? (
          <div className="flex flex-col gap-3 text-sm">
            {defaultInfo?.available ? (
              <div className="rounded-lg border bg-card px-3 py-2.5">
                <p className="font-medium">默认配置可用</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  模型：{defaultInfo.model ?? '（未指定）'}
                  {defaultInfo.baseUrlHost
                    ? ` · 网关：${defaultInfo.baseUrlHost}`
                    : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Key 由站点服务端持有，不出现在浏览器；模型由管理员统一调整。
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                站点默认配置暂未启用（可能未开放或维护中）。可先切换到
                「自定义」配置自己的模型。
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              深度检索（多路改写 + 片段过滤）仅自定义档支持。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-llm-base-url">API 接入地址</Label>
              <Input
                id="chat-llm-base-url"
                placeholder="https://api.deepseek.com/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-llm-model">模型</Label>
              <Input
                id="chat-llm-model"
                placeholder="deepseek-chat"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-llm-api-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="chat-llm-api-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setShowKey((visible) => !visible)}
                >
                  {showKey ? '隐藏' : '显示'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Key 仅保存在本机浏览器 localStorage，不写入本站数据库；提问时由浏览器直连你配置的网关，Key 不经过本站后端。
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-llm-deep">检索模式</Label>
              <label
                htmlFor="chat-llm-deep"
                className="flex cursor-pointer items-start gap-2 text-sm"
              >
                <input
                  id="chat-llm-deep"
                  type="checkbox"
                  checked={deepRetrieval}
                  onChange={(event) => setDeepRetrieval(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span>
                  深度检索
                  <span className="block text-xs text-muted-foreground">
                    追问时多路改写并发检索 + 低相关片段过滤，召回更全；每轮追问额外
                    2 次小调用（约多 2–4 秒与少量 token）。
                  </span>
                </span>
              </label>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={handleClear}>
            清除本机配置
          </Button>
          {mode === 'default' ? (
            <Button type="button" onClick={handleUseDefault}>
              使用站点默认
            </Button>
          ) : (
            <Button type="button" onClick={handleSave}>
              保存
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
