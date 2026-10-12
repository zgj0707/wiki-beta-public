-- Chatbot 检索加速（Phase C）：entity_doc_cache 标题列 trgm GIN 索引。
-- 背景：ChatRetrieverService.findKeywordDocIds 对 title/body 做 ILIKE '%kw%'，
-- body_markdown 依既有决策（add-content-trgm-indexes.sql 注释 1）不建索引；
-- title 走 GIN 后 ILIKE 前缀通配查询可走索引，数据量增长后避免全表扫。
-- 注意：
--   1. 已于 2026-09-17 经 dev +db-execute → +db-env-diff → +db-env-migrate 应用到 online；
--      本文件是可复现记录（表小时 planner 会选 Seq Scan，属正常）。
--   2. 平台 DB 对多字节文本的底层语义 dev/online 存在不一致风险（见
--      probe-db-text-semantics.sql），索引只加速不改变结果语义。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_edc_title_trgm ON entity_doc_cache USING gin (title gin_trgm_ops);
