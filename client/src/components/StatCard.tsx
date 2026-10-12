import type { LucideIcon } from 'lucide-react';
import { cn } from '@client/src/lib/utils';

export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
