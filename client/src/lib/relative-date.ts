/**
 * 来源日期的相对时间文案（sourceDate 粒度为天，形如 '2026-09-08'）。
 * 卡片顶部时间行用：今天 / 昨天 / N 天前；无法解析时回退原始字符串。
 */
export function formatRelativeSourceDate(
  sourceDate: string | undefined,
): string {
  if (!sourceDate) return '';
  const time = new Date(sourceDate).getTime();
  if (!Number.isFinite(time)) return sourceDate;
  const startOfDay = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const dayDiff = Math.round(
    (startOfDay(Date.now()) - startOfDay(time)) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff <= 0) return '今天';
  if (dayDiff === 1) return '昨天';
  if (dayDiff < 30) return `${dayDiff} 天前`;
  return sourceDate;
}
