import {
  displaySourceDate,
  getTodaySourceDate,
  isAllowedSourceDate,
  isPinnedSourceDate,
  PINNED_SOURCE_DATE,
  PINNED_SOURCE_DATE_LABEL,
} from '../../shared/source-date';

describe('source date easter egg', () => {
  it('treats 9999-12-31 as the pinned date and displays its label', () => {
    expect(isPinnedSourceDate(PINNED_SOURCE_DATE)).toBe(true);
    expect(displaySourceDate(PINNED_SOURCE_DATE)).toBe(PINNED_SOURCE_DATE_LABEL);
  });

  it('keeps ordinary dates and fallbacks unchanged', () => {
    expect(isPinnedSourceDate('2026-08-26')).toBe(false);
    expect(displaySourceDate('2026-08-26')).toBe('2026-08-26');
    expect(displaySourceDate('', '未记录')).toBe('未记录');
  });

  it('allows dates through today or the pinned date, but rejects the gap', () => {
    expect(getTodaySourceDate(new Date(2026, 7, 26))).toBe('2026-08-26');
    expect(isAllowedSourceDate('', '2026-08-26')).toBe(true);
    expect(isAllowedSourceDate('2026-08-26', '2026-08-26')).toBe(true);
    expect(isAllowedSourceDate('2026-08-27', '2026-08-26')).toBe(false);
    expect(isAllowedSourceDate(PINNED_SOURCE_DATE, '2026-08-26')).toBe(true);
  });
});
