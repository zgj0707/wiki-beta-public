BEGIN;

-- 025_insight_projection: 机制观察/实体词典/文章实体关系/文章主张 四张多维表格的 PG 投影。
-- 文本列一律 text，避免 varchar 截断；uuid 主键由应用生成；updated_at 记录最近同步时间。

-- 1. 机制观察投影，upsert target: stable_key。
CREATE TABLE IF NOT EXISTS mechanism_observation (
  id uuid NOT NULL PRIMARY KEY,
  stable_key text NOT NULL,
  entry_type text,
  mechanism_title text,
  game_name text,
  core_hook text,
  generic_formula text,
  operation_threshold text,
  growth_drive text,
  drama_source text,
  multiplayer_value text,
  ad_moment text,
  buy_value text,
  visual_degree text,
  visual_evidence text,
  reuse_note text,
  migration_note text,
  trial_loop text,
  diff_summary text,
  open_questions text,
  review_status text,
  source_status text,
  current_published boolean,
  source_version integer,
  source_title text,
  source_link text,
  source_doc_id text,
  source_block_id text,
  review_time timestamptz,
  updated_at timestamptz
);

-- 2. 实体词典投影，upsert target: base_record_id。
CREATE TABLE IF NOT EXISTS entity_dictionary (
  id uuid NOT NULL PRIMARY KEY,
  base_record_id text NOT NULL,
  entity_name text,
  normalized_name text,
  entity_type text,
  aliases text,
  match_rules text,
  description text,
  status text,
  updated_at timestamptz
);

-- 3. 文章实体关系投影，upsert target: base_record_id。
CREATE TABLE IF NOT EXISTS content_entity_rel (
  id uuid NOT NULL PRIMARY KEY,
  base_record_id text NOT NULL,
  doc_id text,
  article_title text,
  entity_name text,
  entity_type text,
  relation_type text,
  relation_status text,
  evidence text,
  source_field text,
  entity_dict_record_id text,
  updated_at timestamptz
);

-- 4. 文章主张投影，upsert target: base_record_id。
CREATE TABLE IF NOT EXISTS knowledge_claim (
  id uuid NOT NULL PRIMARY KEY,
  base_record_id text NOT NULL,
  doc_id text,
  article_title text,
  claim text,
  excerpt text,
  evidence text,
  auto_claim text,
  review_status text,
  impact_level integer,
  published_at timestamptz,
  updated_at timestamptz
);

-- 唯一索引（upsert 依赖）。
CREATE UNIQUE INDEX IF NOT EXISTS mechanism_observation_stable_key_uidx
  ON mechanism_observation (stable_key);

CREATE UNIQUE INDEX IF NOT EXISTS entity_dictionary_base_record_id_uidx
  ON entity_dictionary (base_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS content_entity_rel_base_record_id_uidx
  ON content_entity_rel (base_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_claim_base_record_id_uidx
  ON knowledge_claim (base_record_id);

-- 公开 API 查询辅助索引。
CREATE INDEX IF NOT EXISTS mechanism_observation_gate_idx
  ON mechanism_observation (review_status, current_published);

CREATE INDEX IF NOT EXISTS entity_dictionary_status_idx
  ON entity_dictionary (status);

CREATE INDEX IF NOT EXISTS content_entity_rel_entity_dict_record_id_idx
  ON content_entity_rel (entity_dict_record_id);

CREATE INDEX IF NOT EXISTS content_entity_rel_entity_name_idx
  ON content_entity_rel (entity_name);

CREATE INDEX IF NOT EXISTS knowledge_claim_review_status_idx
  ON knowledge_claim (review_status, published_at DESC);

COMMIT;
