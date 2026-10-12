BEGIN;

-- 027_entity_doc_cache_meta：文章元数据落 PG（P2a 详情页提速）。
--
-- 背景：实体详情页 /api/entities/:id 的「关联文章」链路原先每次请求都要
-- listArticleRows() 拉 Base 全表（FeishuBaseReader 仅 60s 进程内 TTL，冷请求秒级）。
-- 本迁移给 entity_doc_cache 补 4 个元数据列，让投影在 sweep/重算时顺手把
-- Base 行上已有的标题/日期/链接/审批状态写进 PG；读取侧改为
-- entity_mention JOIN entity_doc_cache 的纯 PG 查询。
--
-- 设计要点见 docs/p2-execution.md §1：
--   * 全部 nullable：历史行与回填前为 NULL；回填不靠迁移脚本，首轮 sweep
--     的 meta 同步（与内存 cache 四值比对，变才写）自然补齐，零正文读取。
--   * meta 与正文解析解耦：meta 变化只触发轻量 UPDATE，不影响 L1/L2 跳过语义。
--   * 审批门禁仍以投影计算时的 Base 行为准；此处 approval_status 只是
--     读取侧的防御性过滤（mention 行本身已随门禁增删）。

ALTER TABLE entity_doc_cache
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS source_date text,
  ADD COLUMN IF NOT EXISTS doc_link text,
  ADD COLUMN IF NOT EXISTS approval_status text;

COMMIT;
