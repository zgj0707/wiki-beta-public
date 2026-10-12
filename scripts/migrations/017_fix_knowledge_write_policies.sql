BEGIN;

-- 修复阶段二知识结构化表的运行时写入策略。
-- 线上后端连接以 authenticated 身份执行 API 写入，原迁移将其 WITH CHECK 设为 false，
-- 导致报告档案、手动结论及其来源/实体关系在 INSERT 时触发 42501。
-- 仅开放当前 API 实际需要的动作，不开放无关的 UPDATE / DELETE / INSERT 操作。
DROP POLICY IF EXISTS "修改全部数据" ON knowledge_profile;
DROP POLICY IF EXISTS "应用接口创建档案" ON knowledge_profile;
DROP POLICY IF EXISTS "应用接口更新档案" ON knowledge_profile;
CREATE POLICY "应用接口创建档案" ON knowledge_profile AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "应用接口更新档案" ON knowledge_profile AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "修改全部数据" ON knowledge_claim;
DROP POLICY IF EXISTS "应用接口创建结论" ON knowledge_claim;
DROP POLICY IF EXISTS "应用接口更新结论" ON knowledge_claim;
CREATE POLICY "应用接口创建结论" ON knowledge_claim AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "应用接口更新结论" ON knowledge_claim AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "修改全部数据" ON claim_source;
DROP POLICY IF EXISTS "应用接口新增来源" ON claim_source;
DROP POLICY IF EXISTS "应用接口删除来源" ON claim_source;
CREATE POLICY "应用接口新增来源" ON claim_source AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "应用接口删除来源" ON claim_source AS PERMISSIVE FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "修改全部数据" ON claim_entity;
DROP POLICY IF EXISTS "应用接口新增实体关系" ON claim_entity;
DROP POLICY IF EXISTS "应用接口删除实体关系" ON claim_entity;
CREATE POLICY "应用接口新增实体关系" ON claim_entity AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "应用接口删除实体关系" ON claim_entity AS PERMISSIVE FOR DELETE TO authenticated USING (true);

COMMIT;
