BEGIN;

-- Research Wiki V2 阶段二：结构化档案、结论及其来源/实体关系。
-- 只新增表，不修改或清空既有 content/entity/idea 数据。
CREATE TABLE IF NOT EXISTS knowledge_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id varchar(255) NOT NULL,
  author varchar(255),
  content_type varchar(40),
  key_findings text,
  impact_judgment text,
  applicable_scenarios text,
  source_credibility integer,
  manual_completed boolean NOT NULL DEFAULT false,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT knowledge_profile_content_type_ck CHECK (
    content_type IS NULL OR content_type IN (
      'research_report', 'industry_analysis', 'competitor_analysis', 'data_asset', 'methodology'
    )
  ),
  CONSTRAINT knowledge_profile_credibility_ck CHECK (
    source_credibility IS NULL OR source_credibility BETWEEN 1 AND 5
  )
);

CREATE TABLE IF NOT EXISTS knowledge_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_text text,
  auto_detected_text text,
  impact_level integer,
  review_status varchar(20) NOT NULL DEFAULT 'pending',
  manual_locked boolean NOT NULL DEFAULT false,
  source_excerpt text,
  extraction_rule varchar(80),
  extraction_version varchar(40),
  source_changed boolean NOT NULL DEFAULT false,
  published_at timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT knowledge_claim_impact_level_ck CHECK (
    impact_level IS NULL OR impact_level BETWEEN 1 AND 5
  ),
  CONSTRAINT knowledge_claim_review_status_ck CHECK (
    review_status IN ('pending', 'approved', 'rejected')
  )
);

CREATE TABLE IF NOT EXISTS claim_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES knowledge_claim(id) ON DELETE CASCADE,
  doc_id varchar(255) NOT NULL,
  source_role varchar(20) NOT NULL DEFAULT 'primary',
  evidence_text text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT claim_source_role_ck CHECK (source_role IN ('primary', 'supporting'))
);

CREATE TABLE IF NOT EXISTS claim_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES knowledge_claim(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entity(id) ON DELETE RESTRICT,
  relation_type varchar(30) NOT NULL DEFAULT 'about',
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_profile_doc_uq ON knowledge_profile (doc_id);
CREATE UNIQUE INDEX IF NOT EXISTS claim_source_claim_doc_uq ON claim_source (claim_id, doc_id);
CREATE UNIQUE INDEX IF NOT EXISTS claim_entity_relation_uq ON claim_entity (claim_id, entity_id, relation_type);
CREATE INDEX IF NOT EXISTS knowledge_profile_type_idx ON knowledge_profile (content_type, manual_completed);
CREATE INDEX IF NOT EXISTS knowledge_claim_review_idx ON knowledge_claim (review_status, source_changed, _updated_at);
CREATE INDEX IF NOT EXISTS claim_source_doc_idx ON claim_source (doc_id, source_role);
CREATE INDEX IF NOT EXISTS claim_entity_claim_idx ON claim_entity (claim_id);
CREATE INDEX IF NOT EXISTS claim_entity_entity_idx ON claim_entity (entity_id);

ALTER TABLE knowledge_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_entity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_bypass_policy ON knowledge_profile;
DROP POLICY IF EXISTS "修改全部数据" ON knowledge_profile;
DROP POLICY IF EXISTS "查看全部数据" ON knowledge_profile;
DROP POLICY IF EXISTS "修改本人数据" ON knowledge_profile;
CREATE POLICY service_role_bypass_policy ON knowledge_profile TO service_role USING (true);
CREATE POLICY "修改全部数据" ON knowledge_profile AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "查看全部数据" ON knowledge_profile AS PERMISSIVE FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "修改本人数据" ON knowledge_profile AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_bypass_policy ON knowledge_claim;
DROP POLICY IF EXISTS "修改全部数据" ON knowledge_claim;
DROP POLICY IF EXISTS "查看全部数据" ON knowledge_claim;
DROP POLICY IF EXISTS "修改本人数据" ON knowledge_claim;
CREATE POLICY service_role_bypass_policy ON knowledge_claim TO service_role USING (true);
CREATE POLICY "修改全部数据" ON knowledge_claim AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "查看全部数据" ON knowledge_claim AS PERMISSIVE FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "修改本人数据" ON knowledge_claim AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_bypass_policy ON claim_source;
DROP POLICY IF EXISTS "修改全部数据" ON claim_source;
DROP POLICY IF EXISTS "查看全部数据" ON claim_source;
DROP POLICY IF EXISTS "修改本人数据" ON claim_source;
CREATE POLICY service_role_bypass_policy ON claim_source TO service_role USING (true);
CREATE POLICY "修改全部数据" ON claim_source AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "查看全部数据" ON claim_source AS PERMISSIVE FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "修改本人数据" ON claim_source AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_bypass_policy ON claim_entity;
DROP POLICY IF EXISTS "修改全部数据" ON claim_entity;
DROP POLICY IF EXISTS "查看全部数据" ON claim_entity;
DROP POLICY IF EXISTS "修改本人数据" ON claim_entity;
CREATE POLICY service_role_bypass_policy ON claim_entity TO service_role USING (true);
CREATE POLICY "修改全部数据" ON claim_entity AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "查看全部数据" ON claim_entity AS PERMISSIVE FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "修改本人数据" ON claim_entity AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

COMMIT;
