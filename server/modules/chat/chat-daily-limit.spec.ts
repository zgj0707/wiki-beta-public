import {
  DEFAULT_DAILY_LIMIT,
  isDailyLimitExceeded,
  resolveDailyLimitFromEnv,
  shanghaiDateString,
} from './chat-daily-limit';

describe('chat-daily-limit', () => {
  describe('shanghaiDateString', () => {
    it('UTC 16:00（北京时间次日 0 点整）翻到新的一天', () => {
      // 2026-10-09T16:00:00Z = 北京时间 2026-10-10 00:00:00
      expect(shanghaiDateString(new Date('2026-10-09T16:00:00Z'))).toBe(
        '2026-10-10',
      );
    });

    it('UTC 15:59 仍属前一天', () => {
      expect(shanghaiDateString(new Date('2026-10-09T15:59:00Z'))).toBe(
        '2026-10-09',
      );
    });

    it('月初边界：北京时间 10 月 1 日 0 点 = UTC 9 月 30 日 16 点', () => {
      expect(shanghaiDateString(new Date('2026-09-30T16:00:00Z'))).toBe(
        '2026-10-01',
      );
    });

    it('容器本地时区不影响结果（固定 UTC 输入）', () => {
      const iso = '2026-01-31T20:00:00Z'; // 北京 2026-02-01 04:00
      expect(shanghaiDateString(new Date(iso))).toBe('2026-02-01');
    });
  });

  describe('resolveDailyLimitFromEnv', () => {
    it('未设置回退默认（DEFAULT_DAILY_LIMIT，现为 500）', () => {
      expect(resolveDailyLimitFromEnv(undefined)).toBe(DEFAULT_DAILY_LIMIT);
      expect(resolveDailyLimitFromEnv('')).toBe(DEFAULT_DAILY_LIMIT);
    });

    it('非法值（非数字/0/负数/小数）回退默认', () => {
      expect(resolveDailyLimitFromEnv('abc')).toBe(DEFAULT_DAILY_LIMIT);
      expect(resolveDailyLimitFromEnv('0')).toBe(DEFAULT_DAILY_LIMIT);
      expect(resolveDailyLimitFromEnv('-5')).toBe(DEFAULT_DAILY_LIMIT);
      expect(resolveDailyLimitFromEnv('1.5')).toBe(DEFAULT_DAILY_LIMIT);
    });

    it('合法正整数生效且可自定义 fallback', () => {
      expect(resolveDailyLimitFromEnv('200')).toBe(200);
      expect(resolveDailyLimitFromEnv('  50  ')).toBe(50);
      expect(resolveDailyLimitFromEnv('abc', 7)).toBe(7);
    });
  });

  describe('isDailyLimitExceeded', () => {
    it('计数含本次请求：第 limit 次放行，第 limit+1 次拦截', () => {
      expect(isDailyLimitExceeded(100, 100)).toBe(false);
      expect(isDailyLimitExceeded(101, 100)).toBe(true);
    });

    it('限额被规范化（非整数防御）', () => {
      expect(isDailyLimitExceeded(2, 1.5)).toBe(true);
      expect(isDailyLimitExceeded(1, 1.5)).toBe(false);
      expect(isDailyLimitExceeded(2, 0)).toBe(true);
    });
  });
});
