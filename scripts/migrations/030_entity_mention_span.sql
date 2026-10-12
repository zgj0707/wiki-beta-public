-- P4b 批1：entity_mention 补命中区间（raw markdown 偏移），供渲染侧零匹配消费。
-- 历史行 NULL，由下一轮 sweep / rematchAllFromCache 自然回填（无需数据迁移）。
ALTER TABLE entity_mention ADD COLUMN match_start integer;
ALTER TABLE entity_mention ADD COLUMN match_end integer;
