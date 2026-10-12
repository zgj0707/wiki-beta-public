import type { LucideIcon } from 'lucide-react';
import { cn } from '@client/src/lib/utils';

export default function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          <h2 className="section-title">{title}</h2>
        </div>
        {description && <p className="section-desc">{description}</p>}
      </div>
      {action}
    </div>
  );
}
