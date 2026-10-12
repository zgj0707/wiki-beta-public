import type { LucideIcon } from 'lucide-react';
import { cn } from '@client/src/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** 全站唯一空状态：虚线容器 + 图标 + 标题 + 描述 + 可选操作。 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/70" />}
      {title && <p className="mt-3 text-sm font-medium">{title}</p>}
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
