import { useState, useCallback, useEffect } from 'react';
import { Input } from '@client/src/components/ui/input';
import { Search, X, type LucideIcon } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  value?: string;
  /** 左侧图标，默认放大镜；AI 问答框传 Sparkles 以作区分。 */
  icon?: LucideIcon;
}

export default function SearchBar({
  onSearch,
  placeholder = '搜索产品、厂商、关键词...',
  value: externalValue,
  icon: Icon = Search,
}: SearchBarProps) {
  const [value, setValue] = useState(externalValue ?? '');

  useEffect(() => {
    if (externalValue != null) setValue(externalValue);
  }, [externalValue]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(value);
    },
    [onSearch, value],
  );

  const handleClear = useCallback(() => {
    setValue('');
    onSearch('');
  }, [onSearch]);

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0">
      <div className="relative w-full min-w-0">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className="h-9 w-full min-w-0 truncate pl-9 pr-9"
        />
        {value && (
          <button
            type="button"
            aria-label="清空"
            onClick={handleClear}
            className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}
