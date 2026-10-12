import {
  getTodaySourceDate,
  isPinnedSourceDate,
  PINNED_SOURCE_DATE,
  PINNED_SOURCE_DATE_LABEL,
} from '@shared/source-date';

export function SourceDatePicker({
  value,
  onChange,
  disabled,
  className = 'h-8 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:border-primary',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const pinned = isPinnedSourceDate(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        max={getTodaySourceDate()}
        value={pinned ? '' : value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={className}
      />
      <button
        type="button"
        aria-pressed={pinned}
        title={pinned ? `${PINNED_SOURCE_DATE}：${PINNED_SOURCE_DATE_LABEL}` : `选择${PINNED_SOURCE_DATE}后置顶`}
        onClick={() => onChange(pinned ? '' : PINNED_SOURCE_DATE)}
        disabled={disabled}
        className={`shrink-0 rounded-md border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pinned ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary hover:text-primary'}`}
      >
        {pinned ? `置顶：${PINNED_SOURCE_DATE_LABEL}` : `${PINNED_SOURCE_DATE}（${PINNED_SOURCE_DATE_LABEL}）`}
      </button>
    </div>
  );
}
