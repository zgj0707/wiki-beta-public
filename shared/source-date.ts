export const PINNED_SOURCE_DATE = '9999-12-31';
export const PINNED_SOURCE_DATE_LABEL = '野生狗奶';
const SOURCE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getTodaySourceDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isAllowedSourceDate(
  value: unknown,
  today = getTodaySourceDate(),
): boolean {
  const text = String(value ?? '').trim().slice(0, 10);
  return !text || text === PINNED_SOURCE_DATE || (SOURCE_DATE_RE.test(text) && text <= today);
}

export function isPinnedSourceDate(value: unknown): boolean {
  return String(value ?? '').slice(0, 10) === PINNED_SOURCE_DATE;
}

export function displaySourceDate(value: unknown, fallback = ''): string {
  if (isPinnedSourceDate(value)) return PINNED_SOURCE_DATE_LABEL;
  const text = String(value ?? '').trim();
  return text || fallback;
}
