BEGIN;

-- 023_base_sync_extension: 服务端自建飞书多维表格同步所需的结构扩展。

ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS source_date text;
ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS content_type text;
ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS gameplay_category text;
ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS source_author text;
ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS source_publisher text;
ALTER TABLE wiki_beta_content ADD COLUMN IF NOT EXISTS structured_status text;

-- 文章结构化投影：directory_record_id 对应 wiki_beta_content.base_record_id。
CREATE TABLE IF NOT EXISTS article_structure (
  id uuid NOT NULL PRIMARY KEY,
  directory_record_id varchar(255) NOT NULL,
  doc_id text,
  key_findings text,
  impact text,
  scenarios text,
  credibility text,
  structure_status text,
  gameplay_category text,
  article_type text,
  updated_at timestamptz
);

-- 同步执行日志。
CREATE TABLE IF NOT EXISTS sync_run_log (
  id uuid NOT NULL PRIMARY KEY,
  trigger text NOT NULL,
  status text NOT NULL,
  directory_count integer,
  structure_count integer,
  error text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz
);

-- 唯一索引前先去重：每组 base_record_id 只保留最新一条（ctid 最大即最后写入），
-- 避免 71 条存量数据中存在重复记录导致唯一索引创建失败。
DELETE FROM wiki_beta_content AS a
  USING wiki_beta_content AS b
  WHERE a.base_record_id = b.base_record_id
    AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS wiki_beta_content_base_record_id_uidx
  ON wiki_beta_content (base_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS article_structure_directory_record_id_uidx
  ON article_structure (directory_record_id);

CREATE INDEX IF NOT EXISTS wiki_beta_content_source_date_idx
  ON wiki_beta_content (source_date DESC);

COMMIT;
