BEGIN;

-- 031_ai_compile_layer：AI 编译层（结论卡）派生表。
--
-- 背景（见 docs/ai-compile-layer-plan.md）：现有链路只有"提问 → 检索 → LLM 现翻 →
-- 答案即焚"，知识从不沉淀。本迁移新增一层「编译层」：把某个实体的全部关联文章
-- 一次编译成「结论 + 证据 + 未知项」，落 PG 全库共享，读取时零 LLM 调用。
--
-- 设计边界（三条硬约束，实现时不可越界）：
--   * 派生层，非 SSOT：Base 仍是人工 source-of-truth，本层产物带 status=draft，
--     人工采纳（Phase 2）后才回写 Base。因此表前缀统一 ai_compile_，与同步链路
--     的 knowledge_* 表彻底隔离，不污染人工数据。
--   * 输入指纹即失效判据：input_hash = sha256(排序后的 docId:contentHash) + prompt_version。
--     正文一变产物自动失效（content_hash 复用 entity_doc_cache，不新增指纹逻辑）。
--   * 引用白名单由代码校验：claim.source_doc_ids 必须 ⊆ 本次送入的 docId 集，
--     越界整条丢弃并留痕（dropped/drop_reason），不信任模型自称。
--
-- LLM 调用方在服务端之外（BYO-Key 浏览器直连 / WorkBuddy 批跑），后端出网被沙箱拦，
-- 因此服务端只负责"组装输入 + 校验产物 + 落库"，模型名与用量由调用方回传。

-- 1. 编译产物主体。唯一键 (subject_type, subject_id, model_fingerprint)：
--    同一主体同一模型一行，重编译 upsert 覆盖；不同模型产物并存互不覆盖
--    （WorkBuddy 与网关接入点若模型标识不同，产物不可混用）。
CREATE TABLE IF NOT EXISTS ai_compile_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 首期恒 'entity'，预留给 Phase 3 的 'mechanism'。
  subject_type varchar(20) NOT NULL DEFAULT 'entity',
  -- 实体 Base record_id（与 entity_mention.entity_id 同口径）。
  subject_id varchar(255) NOT NULL,
  -- 前端路由用 slug（/ai/e/:slug）。
  subject_slug varchar(255) NOT NULL,
  subject_name varchar(255) NOT NULL,
  -- 输入集指纹 + prompt 版本：任一变化即视为过期（不自动重编，避免成本失控）。
  input_hash varchar(120) NOT NULL,
  prompt_version varchar(20) NOT NULL,
  -- 模型标识（调用方回传，如 'deepseek-v4.1-flash'）。
  model_fingerprint varchar(120) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  -- 一句话结论（卡片主标题下的首行）。
  headline text NOT NULL,
  summary_md text,
  -- 代码判定，非模型自称（见 compile.service.ts judgeConfidence）。
  confidence varchar(10) NOT NULL DEFAULT 'low',
  source_count integer NOT NULL DEFAULT 0,
  -- 来源日期区间（字符串原样，Base「飞书来源日期」口径）。
  source_span_start varchar(40),
  source_span_end varchar(40),
  -- 未知项：让用户看见边界，比多说一句更有价值。
  gaps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 来源矛盾点（Phase 2 起产出）。
  conflict_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- token 预估区间（触发前）+ 实测值（usage 回传）。
  -- ⚠️ actual_* 是校准表唯一数据源，必须来自真实 usage，不得填估算值。
  est_tokens_low integer,
  est_tokens_high integer,
  actual_prompt_tokens integer,
  actual_completion_tokens integer,
  -- 成本归因。
  generated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by varchar(120),
  -- 人工采纳回写 Base（Phase 2）。
  adopted_at timestamptz(3),
  adopted_by varchar(120),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT ai_compile_unit_subject_ck CHECK (subject_type IN ('entity', 'mechanism')),
  CONSTRAINT ai_compile_unit_status_ck CHECK (status IN ('draft', 'published', 'rejected', 'stale')),
  CONSTRAINT ai_compile_unit_conf_ck CHECK (confidence IN ('high', 'medium', 'low'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_compile_unit_identity_uidx
  ON ai_compile_unit (subject_type, subject_id, model_fingerprint);
CREATE INDEX IF NOT EXISTS ai_compile_unit_slug_idx
  ON ai_compile_unit (subject_slug, model_fingerprint);
CREATE INDEX IF NOT EXISTS ai_compile_unit_recent_idx
  ON ai_compile_unit (generated_at DESC);

-- 2. 结论条目。dropped=true 的行是"引用越界被代码丢弃"的留痕，便于事后审计
--    与验收（验收项 3：注入越界 docId → 该 claim 被丢弃且日志有记录）。
CREATE TABLE IF NOT EXISTS ai_compile_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES ai_compile_unit(id) ON DELETE CASCADE,
  claim_text text NOT NULL,
  claim_type varchar(20) NOT NULL DEFAULT 'fact',
  -- 支撑本条的 docId 数组（编号已由服务端映射回 docId）。
  source_doc_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 支撑原文片段（模型摘录，仅供人工快速核对，非可点击定位）。
  source_quote text,
  sort_order integer NOT NULL DEFAULT 0,
  dropped boolean NOT NULL DEFAULT false,
  drop_reason varchar(80),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT ai_compile_claim_type_ck CHECK (claim_type IN ('fact', 'judgment', 'metric'))
);

CREATE INDEX IF NOT EXISTS ai_compile_claim_unit_idx
  ON ai_compile_claim (unit_id, sort_order);
-- 幂等替换键：平台运行时禁用 transaction，重编译时用「先 upsert 全集（按 sort_order）
-- → 再删 sort_order 超出的陈旧行」保证原子性，本唯一索引是其前提。
-- 被丢弃的 claim 从 1000 起编号，避免与保留条目抢占同一序位。
CREATE UNIQUE INDEX IF NOT EXISTS ai_compile_claim_order_uidx
  ON ai_compile_claim (unit_id, sort_order);

-- 3. 证据来源。字段直接取自 entity_doc_cache 快照（title/source_date），零额外读 Base。
CREATE TABLE IF NOT EXISTS ai_compile_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES ai_compile_unit(id) ON DELETE CASCADE,
  doc_id varchar(255) NOT NULL,
  title text,
  source_date varchar(40),
  -- 站内路由 /article/:docId；文档链接留空时兜底用它。
  url varchar(500) NOT NULL,
  external_url varchar(1000),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_compile_evidence_identity_uidx
  ON ai_compile_evidence (unit_id, doc_id);

-- 4. 结论变更史（append-only）。周报「本周结论变化」直接读本表，0 次 LLM 调用。
CREATE TABLE IF NOT EXISTS ai_compile_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES ai_compile_unit(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  -- created | updated | headline_changed | confidence_downgraded | superseded
  change_type varchar(30) NOT NULL,
  change_note text,
  diff_json jsonb,
  -- 快照：周报无需 join 主表即可渲染"当时说了什么"。
  headline text,
  confidence varchar(10),
  source_count integer,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT ai_compile_revision_no_ck CHECK (revision_no >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_compile_revision_identity_uidx
  ON ai_compile_revision (unit_id, revision_no);
CREATE INDEX IF NOT EXISTS ai_compile_revision_recent_idx
  ON ai_compile_revision (_created_at DESC);

-- 5. 编译任务（断点续跑 + 幂等）。唯一键 (subject_type, subject_id)：
--    一个主体一行状态机，天然去重，杜绝并发重复产物（验收项 7）。
CREATE TABLE IF NOT EXISTS ai_compile_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type varchar(20) NOT NULL DEFAULT 'entity',
  subject_id varchar(255) NOT NULL,
  subject_slug varchar(255) NOT NULL,
  subject_name varchar(255),
  input_hash varchar(120),
  state varchar(20) NOT NULL DEFAULT 'pending',
  -- 租约：调用方取走任务后置 running + lease_until；过期未回填视为失败可重取。
  lease_until timestamptz(3),
  retry_count integer NOT NULL DEFAULT 0,
  error text,
  batch_id varchar(64),
  requested_by varchar(120),
  est_tokens_low integer,
  est_tokens_high integer,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT ai_compile_job_state_ck CHECK (state IN ('pending', 'running', 'done', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_compile_job_identity_uidx
  ON ai_compile_job (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS ai_compile_job_state_idx
  ON ai_compile_job (state, _updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_compile_job_batch_idx
  ON ai_compile_job (batch_id);

-- 6. 预算校准（回答"预计如何保证高稳健性"）。
--    scope 按模型分区（'model:<fingerprint>'）：不同模型 tokenizer 不同，
--    混算会让线上预估系统性偏错。
--    char_factor = EMA(Σ实测 prompt_tokens / Σ字符数)，滚动校准，不用理论系数
--    （实证：cl100k 中文经验值 1.6 比实测 1.16 高估 20.9%）。
CREATE TABLE IF NOT EXISTS ai_compile_calibration (
  scope varchar(120) PRIMARY KEY,
  sample_count integer NOT NULL DEFAULT 0,
  total_chars bigint NOT NULL DEFAULT 0,
  total_prompt_tokens bigint NOT NULL DEFAULT 0,
  total_completion_tokens bigint NOT NULL DEFAULT 0,
  -- EMA 系数：新样本权重 0.2，首样本直接取实测。
  char_factor numeric(12, 6),
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

ALTER TABLE ai_compile_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compile_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compile_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compile_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compile_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compile_calibration ENABLE ROW LEVEL SECURITY;

-- 派生层只经应用后台读写；浏览器不直连（公开面全部走 Nest 接口）。
DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_unit;
DROP POLICY IF EXISTS "编译产物后台读取" ON ai_compile_unit;
DROP POLICY IF EXISTS "编译产物创建" ON ai_compile_unit;
DROP POLICY IF EXISTS "编译产物更新" ON ai_compile_unit;
CREATE POLICY service_role_bypass_policy ON ai_compile_unit TO service_role USING (true);
CREATE POLICY "编译产物后台读取" ON ai_compile_unit FOR SELECT TO authenticated USING (true);
CREATE POLICY "编译产物创建" ON ai_compile_unit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "编译产物更新" ON ai_compile_unit FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_claim;
DROP POLICY IF EXISTS "编译结论后台读取" ON ai_compile_claim;
DROP POLICY IF EXISTS "编译结论创建" ON ai_compile_claim;
DROP POLICY IF EXISTS "编译结论更新" ON ai_compile_claim;
CREATE POLICY service_role_bypass_policy ON ai_compile_claim TO service_role USING (true);
CREATE POLICY "编译结论后台读取" ON ai_compile_claim FOR SELECT TO authenticated USING (true);
CREATE POLICY "编译结论创建" ON ai_compile_claim FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "编译结论更新" ON ai_compile_claim FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_evidence;
DROP POLICY IF EXISTS "编译证据后台读取" ON ai_compile_evidence;
DROP POLICY IF EXISTS "编译证据创建" ON ai_compile_evidence;
DROP POLICY IF EXISTS "编译证据更新" ON ai_compile_evidence;
CREATE POLICY service_role_bypass_policy ON ai_compile_evidence TO service_role USING (true);
CREATE POLICY "编译证据后台读取" ON ai_compile_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "编译证据创建" ON ai_compile_evidence FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "编译证据更新" ON ai_compile_evidence FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_revision;
DROP POLICY IF EXISTS "变更史后台读取" ON ai_compile_revision;
DROP POLICY IF EXISTS "变更史创建" ON ai_compile_revision;
DROP POLICY IF EXISTS "变更史更新" ON ai_compile_revision;
CREATE POLICY service_role_bypass_policy ON ai_compile_revision TO service_role USING (true);
CREATE POLICY "变更史后台读取" ON ai_compile_revision FOR SELECT TO authenticated USING (true);
CREATE POLICY "变更史创建" ON ai_compile_revision FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "变更史更新" ON ai_compile_revision FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_job;
DROP POLICY IF EXISTS "编译任务后台读取" ON ai_compile_job;
DROP POLICY IF EXISTS "编译任务创建" ON ai_compile_job;
DROP POLICY IF EXISTS "编译任务更新" ON ai_compile_job;
CREATE POLICY service_role_bypass_policy ON ai_compile_job TO service_role USING (true);
CREATE POLICY "编译任务后台读取" ON ai_compile_job FOR SELECT TO authenticated USING (true);
CREATE POLICY "编译任务创建" ON ai_compile_job FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "编译任务更新" ON ai_compile_job FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON ai_compile_calibration;
DROP POLICY IF EXISTS "校准后台读取" ON ai_compile_calibration;
DROP POLICY IF EXISTS "校准创建" ON ai_compile_calibration;
DROP POLICY IF EXISTS "校准更新" ON ai_compile_calibration;
CREATE POLICY service_role_bypass_policy ON ai_compile_calibration TO service_role USING (true);
CREATE POLICY "校准后台读取" ON ai_compile_calibration FOR SELECT TO authenticated USING (true);
CREATE POLICY "校准创建" ON ai_compile_calibration FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "校准更新" ON ai_compile_calibration FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;
