/** 审核/同步状态样式：全站唯一来源，禁止在页面里再写一套。 */
export function statusClass(status: string): string {
  switch (status) {
    case 'approved':
    case 'published':
    case 'synced':
      return 'bg-success/15 text-success';
    case 'pending':
    case 'reviewing':
      return 'bg-warning/15 text-warning';
    case 'rejected':
    case 'failed':
      return 'bg-destructive/15 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
