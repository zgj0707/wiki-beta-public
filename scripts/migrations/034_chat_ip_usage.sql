BEGIN;

-- 034_chat_ip_usage：站点默认 LLM 配置的按 IP 用量台账（监控台数据源）。
--
-- 背景（见 docs/ai-default-config-plan.md）：站点默认配置上线后，默认 key 的
-- 消耗方是匿名访客，唯一身份可用信号是 IP（与限流同一套解析规则）。
-- 本表只记「消耗站点 key 的请求」：BYO-Key（访客自带 key）不走站点成本，不入账。
--
-- 设计要点：
--   * 粒度 = IP 一行，upsert 累加（单条 ON CONFLICT 原子，无事务依赖）。
--   * token 数由网关 usage 回调驱动：计数在请求进入时落，token 在 usage
--     事件到达时补加 —— 中途断连的请求保留计数、token 不虚增。
--   * note 为运营备注（监控台行内编辑），与任何自动化字段无关。
--   * 不写 sync_run_log、不进 Base、不参与 cron：纯台账表，落库即完备。

CREATE TABLE IF NOT EXISTS chat_ip_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 客户端 IP（ChatController.resolveIp 同源口径），唯一业务键。
  ip varchar(64) NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  -- 运营备注：标记内部同事 / 已知爬虫 / 已沟通用户等。
  note text,
  first_seen_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT chat_ip_usage_counts_ck CHECK (
    request_count >= 0 AND prompt_tokens >= 0 AND completion_tokens >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_ip_usage_ip_uidx
  ON chat_ip_usage (ip);
-- 监控台默认视图：最近活跃在前。
CREATE INDEX IF NOT EXISTS chat_ip_usage_last_seen_idx
  ON chat_ip_usage (last_seen_at DESC);

ALTER TABLE chat_ip_usage ENABLE ROW LEVEL SECURITY;

-- 应用后台以 authenticated 角色连库（与 033_chat_feedback 同款，缺 authenticated
-- 策略会导致 INSERT/UPDATE 被 RLS 拒成 42501，且被服务层 try/catch 吞成 warn）。
DROP POLICY IF EXISTS service_role_bypass_policy ON chat_ip_usage;
CREATE POLICY service_role_bypass_policy ON chat_ip_usage TO service_role USING (true);
DROP POLICY IF EXISTS "台账后台读取" ON chat_ip_usage;
CREATE POLICY "台账后台读取" ON chat_ip_usage FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "台账后台创建" ON chat_ip_usage;
CREATE POLICY "台账后台创建" ON chat_ip_usage FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "台账后台更新" ON chat_ip_usage;
CREATE POLICY "台账后台更新" ON chat_ip_usage FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;
