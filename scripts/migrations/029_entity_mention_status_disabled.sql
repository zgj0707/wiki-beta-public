-- 迁移 029：entity_mention.status 约束扩展 'disabled'（P2d3）
-- disabled = 报告停用（确认错误），与 inactive（正文修订淘汰）语义区分：
-- 读取侧 G5 降级需要 active+disabled 完整出现集合，停用行不能写成 inactive。
ALTER TABLE entity_mention DROP CONSTRAINT entity_mention_status_ck;
ALTER TABLE entity_mention
  ADD CONSTRAINT entity_mention_status_ck CHECK (status IN ('active', 'inactive', 'disabled'));
