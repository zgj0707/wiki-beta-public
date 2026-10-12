BEGIN;

-- 实体详情页会按实体、文档和审核状态筛选关联关系；这些组合索引避免在关系表与内容表上反复全表扫描。
CREATE INDEX IF NOT EXISTS content_entity_entity_doc_active_idx
  ON content_entity (entity_id, doc_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS content_entity_doc_entity_active_idx
  ON content_entity (doc_id, entity_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS content_doc_review_lookup_idx
  ON content (doc_id, review_status, is_archived);

COMMIT;
