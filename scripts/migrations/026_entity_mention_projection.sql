BEGIN;

-- 026_entity_mention_projection：实体提及投影 + 正文/指纹缓存。
--
-- 背景：文章正文里的实体标注原先每次请求都实时解析（0.3-1s/篇），且「关联文章」
-- 因 Base 提及表下线而恒为空。本迁移把"实体 ↔ 文章"的关系改为算一次落 PG、
-- 读取侧直接查投影。
--
-- 设计要点见 docs/p1-entity-mention-execution.md：
--   * 只有「已批准」文章的正文参与匹配（门禁在计算服务里，不在表约束里）。
--   * source_field='manual' 的行是人工产物，自动重算永不触碰。
--   * entity_doc_cache.parse_status 必须是三值：正文读不到的篇目不能进指纹判定，
--     否则会被永久当作"未变更"而停滞。

-- 1. 提及投影。
--    唯一键 (doc_id, entity_id, entity_term, occurrence_index) 使重算可幂等 upsert：
--    同一篇同一词的多次出现各占一行，occurrence_index 为 1-based 序号（与
--    entityLinksPlugin 的 occurrence 计数器同口径）。
CREATE TABLE IF NOT EXISTS entity_mention (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id varchar(255) NOT NULL,
  entity_id varchar(255) NOT NULL,
  entity_term varchar(255) NOT NULL,
  occurrence_index integer NOT NULL,
  evidence_text text,
  -- 正文区块 ID：首版恒 NULL（blocksToMarkdown 产出的纯 Markdown 不携带块 ID）。
  -- 保留为未来扩展位，定位当前靠 occurrence_index + evidence_text。
  block_id varchar(255),
  status varchar(20) NOT NULL DEFAULT 'active',
  source_field varchar(30) NOT NULL DEFAULT 'dictionary_match',
  computed_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT entity_mention_status_ck CHECK (status IN ('active', 'inactive')),
  CONSTRAINT entity_mention_source_ck CHECK (source_field IN ('dictionary_match', 'manual')),
  CONSTRAINT entity_mention_occ_ck CHECK (occurrence_index >= 1)
);

-- 2. 正文落库 + 指纹。doc_id 直接做主键（一篇一行）。
CREATE TABLE IF NOT EXISTS entity_doc_cache (
  doc_id varchar(255) PRIMARY KEY,
  body_markdown text NOT NULL,
  content_hash varchar(64) NOT NULL,
  body_length integer NOT NULL,
  -- 写入时 Base 记录的 updateTime：L1 预筛用（时间戳一致即跳过，零正文读取）。
  base_updated_at timestamptz(3),
  parse_status varchar(20) NOT NULL DEFAULT 'ready',
  parse_error varchar(80),
  parsed_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT entity_doc_cache_status_ck CHECK (parse_status IN ('ready', 'empty', 'unavailable'))
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_mention_identity_uidx
  ON entity_mention (doc_id, entity_id, entity_term, occurrence_index);
CREATE INDEX IF NOT EXISTS entity_mention_entity_status_idx
  ON entity_mention (entity_id, status);
CREATE INDEX IF NOT EXISTS entity_mention_doc_status_idx
  ON entity_mention (doc_id, status);
CREATE INDEX IF NOT EXISTS entity_doc_cache_parse_status_idx
  ON entity_doc_cache (parse_status);

ALTER TABLE entity_mention ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_doc_cache ENABLE ROW LEVEL SECURITY;

-- 投影只经应用后台读写；浏览器不直连（公开面全部走 Nest 接口）。
DROP POLICY IF EXISTS service_role_bypass_policy ON entity_mention;
DROP POLICY IF EXISTS "实体提及后台读取" ON entity_mention;
DROP POLICY IF EXISTS "实体提及创建" ON entity_mention;
DROP POLICY IF EXISTS "实体提及更新" ON entity_mention;
CREATE POLICY service_role_bypass_policy ON entity_mention TO service_role USING (true);
CREATE POLICY "实体提及后台读取" ON entity_mention FOR SELECT TO authenticated USING (true);
CREATE POLICY "实体提及创建" ON entity_mention FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "实体提及更新" ON entity_mention FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass_policy ON entity_doc_cache;
DROP POLICY IF EXISTS "正文缓存后台读取" ON entity_doc_cache;
DROP POLICY IF EXISTS "正文缓存创建" ON entity_doc_cache;
DROP POLICY IF EXISTS "正文缓存更新" ON entity_doc_cache;
CREATE POLICY service_role_bypass_policy ON entity_doc_cache TO service_role USING (true);
CREATE POLICY "正文缓存后台读取" ON entity_doc_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "正文缓存创建" ON entity_doc_cache FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "正文缓存更新" ON entity_doc_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;
