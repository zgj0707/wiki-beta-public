BEGIN;

-- 024_drop_publish_to_site: 下线 publish_to_site 列，公开发布门禁统一由 approval_status='已批准' 承担。

ALTER TABLE wiki_beta_content DROP COLUMN IF EXISTS publish_to_site;

COMMIT;
