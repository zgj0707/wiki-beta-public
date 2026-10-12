-- 搜索加速：短字段 pg_trgm GIN 索引（ilike '%kw%' 走索引，避免全表顺序扫描）。
-- 说明：
--   1. 只覆盖短文本列；body_markdown 故意不建（体积大、维护贵，且平台 DB 对多字节
--      文本的底层语义存在 dev/online 不一致，风险不做无谓放大）。
--   2. 索引不影响结果语义，仅改变执行计划；线上由 db-env-migrate 同步。
--   3. pg_trgm 扩展已在 dev 建立探针确认可用（scripts/probe-db-text-semantics.sql）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_content_title_trgm ON content USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_summary_trgm ON content USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_reason_trgm ON content USING gin (reason gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_product_trgm ON content USING gin (product gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_vendor_trgm ON content USING gin (vendor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_genre_trgm ON content USING gin (genre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_platform_trgm ON content USING gin (platform gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_region_trgm ON content USING gin (region gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_board_trgm ON content USING gin (board gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_source_author_trgm ON content USING gin (source_author gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_content_source_publisher_trgm ON content USING gin (source_publisher gin_trgm_ops);
