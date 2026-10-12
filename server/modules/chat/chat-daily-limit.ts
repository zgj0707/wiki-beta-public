/**
 * chatbot 日限额纯逻辑（迁移 035 / nav-tasks-p3a）。
 *
 * 单独成文件的原因：日界与阈值判定必须可单测（时区与 env 解析是历史事故高发位），
 * 且 ChatIpUsageService 与 ChatAdminController 共用同一口径——「同一缺陷只能有一处实现」。
 */

/** 全局默认日限额（env CHAT_DAILY_LIMIT 未设或非法时兜底；监控台可按 IP 覆盖）。 */
export const DEFAULT_DAILY_LIMIT = 500;

/**
 * 归账日界：**Asia/Shanghai**。
 * 用户与运营都在东八区，「今日额度」必须按用户感知的日历日翻转，
 * 而平台容器时区不可假设（曾按 UTC 算日界导致限额晚 8 小时重置的同类教训）。
 */
const DAY_TZ = 'Asia/Shanghai';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 当前时刻的归账日（YYYY-MM-DD，Asia/Shanghai 日界）。 */
export function shanghaiDateString(now: Date): string {
  return dayFormatter.format(now);
}

/** 解析 env 中的日限额；非法值（非正整数，含小数）静默回退默认值。 */
export function resolveDailyLimitFromEnv(
  raw: string | undefined,
  fallback = DEFAULT_DAILY_LIMIT,
): number {
  // Number 而非 parseInt：'1.5' 会被 parseInt 截成 1，小数配置必须回退而非静默取整。
  const parsed = Number((raw ?? '').trim());
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * 本次请求是否应被日限额拦截。
 *
 * 口径：`recordRequest` **先落账再判定**（被拒请求也计入 attempt，便于观察滥用形态），
 * 因此传入的是**含本次请求**的当日计数；`count > limit` 即本次是超额的第 (limit+1) 次。
 * 单 IP 覆盖（override）优先于全局默认；白名单在上游短路（不进本函数）。
 */
export function isDailyLimitExceeded(
  countIncludingThisRequest: number,
  limit: number,
): boolean {
  return countIncludingThisRequest > Math.max(1, Math.floor(limit));
}
