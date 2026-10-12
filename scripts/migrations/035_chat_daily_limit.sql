BEGIN;

-- 035_chat_daily_limit：chatbot 日限额（批 nav-tasks-p3a）。
--
-- 背景（docs/nav-tasks-redesign-plan.md §4.3）：宽限额防滥用 —— 团队内网是
-- 可信场景，防的是爬虫/脚本滥用而非正常用户。默认 100 次/日/IP（env
-- CHAT_DAILY_LIMIT 可调），软提示非硬断（BYO-Key 不受限、不经配额）。
--
-- 与 034 的关系：034 是**累计口径**台账（成本监控视角，无日期维度）；
-- 日限额需要**按日口径**，另立 chat_ip_usage_daily（ip × 日唯一键），
-- 不动 034 表结构语义。白名单与单 IP 阈值覆盖以**加列**方式挂在 034 表上
-- （该表本就是「按 IP 的运营属性」挂载点，note 列同理）。
--
-- 设计要点：
--   * daily 表 upsert 累加（ON CONFLICT 原子，无事务依赖），与 034 同款规则：
--     请求进入时计数 +1（含被限额拒绝的 attempt），token 由 usage 事件补加。
--   * 日界 = Asia/Shanghai（应用侧计算 usage_date 字符串，数据库只存 date）。
--   * whitelisted = 日限额豁免（监控台开关，行不存在时 upsert 空行）。
--   * daily_limit_override = 单 IP 阈值覆盖（NULL = 用全局默认）。
--   * 纯台账表：不写 sync_run_log、不进 Base、不参与 cron。

ALTER TABLE chat_ip_usage
  ADD COLUMN IF NOT EXISTS whitelisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_limit_override integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_ip_usage_daily_limit_ck'
  ) THEN
    ALTER TABLE chat_ip_usage
      ADD CONSTRAINT chat_ip_usage_daily_limit_ck
      CHECK (daily_limit_override IS NULL OR daily_limit_override >= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_ip_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 客户端 IP（ChatController.resolveIp 同源口径）。
  ip varchar(64) NOT NULL,
  -- 归账日（Asia/Shanghai 日界，应用侧算好 YYYY-MM-DD）。
  usage_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  first_seen_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT chat_ip_usage_daily_counts_ck CHECK (
    request_count >= 0 AND prompt_tokens >= 0 AND completion_tokens >= 0
  ),
  -- 同一日界内 last_seen 单调推进由应用侧保证（每次 upsert 带 now）。
  CONSTRAINT chat_ip_usage_daily_ip_day_uidx UNIQUE (ip, usage_date)
);

CREATE INDEX IF NOT EXISTS chat_ip_usage_daily_date_idx
  ON chat_ip_usage_daily (usage_date DESC, request_count DESC);

ALTER TABLE chat_ip_usage_daily ENABLE ROW LEVEL SECURITY;

-- 与 034/033 同款：应用后台以 authenticated 角色连库，缺策略会 42501 且被吞成 warn。
DROP POLICY IF EXISTS service_role_bypass_policy ON chat_ip_usage_daily;
CREATE POLICY service_role_bypass_policy ON chat_ip_usage_daily TO service_role USING (true);
DROP POLICY IF EXISTS "台账后台读取" ON chat_ip_usage_daily;
CREATE POLICY "台账后台读取" ON chat_ip_usage_daily FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "台账后台创建" ON chat_ip_usage_daily;
CREATE POLICY "台账后台创建" ON chat_ip_usage_daily FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "台账后台更新" ON chat_ip_usage_daily;
CREATE POLICY "台账后台更新" ON chat_ip_usage_daily FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;
