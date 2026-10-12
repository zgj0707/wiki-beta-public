import { Button } from '@client/src/components/ui/button';

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;          // 从 1 开始
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between" aria-label="分页">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        第 {page} / {pageCount} 页
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
