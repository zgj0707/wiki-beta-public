import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@client/src/lib/utils';
import '../styles/ai-ask-bar.css';

/**
 * AI 问答框（V1 渐变呼吸边框）：渐变描边流动 + 光晕呼吸动效，
 * hover/focus 时暂停。空查询也提交——/ask 页内可继续输入。
 * 首页 hero 形态：`hero` 传入时放大尺寸（呼吸边框动效样式仍以本组件为唯一实现）。
 */
export default function AiAskBar({
  onAsk,
  hero = false,
  placeholder,
  autoFocus = false,
}: {
  onAsk: (query: string) => void;
  /** 首页等大入口场景：加高放大；顶栏默认形态不变。 */
  hero?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className={cn(
        'ai-ask-bar flex items-center gap-2',
        hero ? 'h-14 rounded-2xl px-5' : 'h-9 rounded-xl px-3',
        hero && 'ai-ask-bar--hero',
      )}
      onSubmit={(e) => {
        e.preventDefault();
        onAsk(value);
        setValue('');
      }}
    >
      <Sparkles
        className={cn('shrink-0 text-primary', hero ? 'h-5 w-5' : 'h-4 w-4')}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? '问知识库，Enter 提问...'}
        maxLength={2000}
        aria-label="AI 问答"
        autoFocus={autoFocus}
        className={cn(
          'h-full w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground',
          hero ? 'text-base' : 'text-sm',
        )}
      />
    </form>
  );
}
