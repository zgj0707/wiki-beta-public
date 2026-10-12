-- 028: 实体/关系快照表（P2a2）
-- 目的：detail()/list() 热路径零 Base 读——60s 进程内 TTL 过期后的冷请求
-- 需拉 2 次 Base 全表（实体词典 61 行 / 实体关系 0 行），首字加载秒级。
-- 快照由 EntityMentionProjectionService 在 sweepAll / rematchAllFromCache
--（两个全量路径）整体替换写入；词典变更 workflow → rematchAllFromCache →
-- 快照秒级刷新，cron(*/30) 兜底。entity_row_cache 为空 = 快照未构建，
-- 读取侧回退 Base 直读（兜底永久保留）。
-- row 列存完整 typed 行（jsonb，抗 Base 字段漂移）；updateTime 为 ISO 字符串，
-- 读取侧 revive 为 Date。详见 docs/p2-execution.md §1A。

CREATE TABLE IF NOT EXISTS entity_row_cache (
  base_record_id text PRIMARY KEY,
  name text NOT NULL,
  status text,
  row jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_relation_cache (
  base_record_id text PRIMARY KEY,
  row jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
