import { Skeleton } from '@client/src/components/ui/skeleton';

/** 路由级懒加载时的页面骨架占位，避免白屏闪烁。 */
export default function PageFallback() {
  return (
    <div className="flex-1 space-y-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
