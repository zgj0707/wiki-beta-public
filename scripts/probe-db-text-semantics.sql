-- 探针：验证平台 DB 对多字节文本的 left()/substring 语义与 pg_trgm 可用性
SELECT left('寸游戏测试abc', 7) AS left_probe;
SELECT substring('寸游戏测试abc' from 1 for 7) AS substr_probe;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
