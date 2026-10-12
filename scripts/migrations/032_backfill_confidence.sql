-- 032 置信度回填（一次性数据修复，非 DDL）。
--
-- 背景：`ai_compile_unit.confidence` 是 save 时由代码算好落库的值。原规则是
-- 「独立来源数 ≥3 → high」，而锚定修复后实测来源数分布为 7–12（中位 9），
-- 绝对值恒 ≥7 → 20/20 全 high，分档失去意义（见 2026-09-18 复盘）。
--
-- 代码侧已把规则改为「证据充分度 × 时效」二维（见
-- server/modules/compile/compile-calibration.ts 的 judgeConfidence）。
-- 本 SQL 把已落库的历史行按同一规则回填，否则面板文案与数据不一致。
--
-- ⚠️ 规则必须与 judgeConfidence 保持同步。改任一侧都要同步改另一侧。
-- 阈值来源：sufficientMinSources=8 / thinMinSources=4 / freshDays=30 / agingDays=90
--
-- ⚠️ 口径必须用 `ai_compile_unit.source_count`，**不是** evidence 行数。
-- 代码侧 judgeConfidence 收到的是「kept claims 实际引用过的 docId 去重数」，
-- 落库为 source_count；而 evidence 表装的是**入选的全部资料**（含未被任何 claim
-- 引用的）。实测两者确有差异（如 三七互娱 source_count=7 / evidence=12），
-- 若误用 evidence 行数会把「证据偏薄」的主体错判为「证据充分」。
-- 时效则取 evidence 的 max(source_date)，与代码侧 input.latestSourceDate 对齐
-- （入选规则是按 source_date DESC 取前 N，故「入选 max」== 「全量关联 max」）。
--
-- 用法（dev 与 online 各跑一次）：
--   lark-cli apps +db-execute --app-id app_EXAMPLE0000001 --environment <dev|online> \
--     --file scripts/migrations/032_backfill_confidence.sql --yes

UPDATE ai_compile_unit u
SET confidence = CASE
      -- 证据充分：新鲜 → 高；渐旧 → 中；陈旧 → 低
      WHEN u.source_count >= 8 AND e.age <= 30 THEN 'high'
      WHEN u.source_count >= 8 AND e.age <= 90 THEN 'medium'
      WHEN u.source_count >= 8 THEN 'low'
      -- 证据偏薄：渐旧及以内 → 中；陈旧 → 低
      WHEN u.source_count >= 4 AND e.age <= 90 THEN 'medium'
      ELSE 'low'
    END,
    _updated_at = now()
FROM (
  SELECT unit_id,
         COALESCE(now()::date - max(source_date)::date, 100000) AS age
  FROM ai_compile_evidence
  GROUP BY unit_id
) e
WHERE e.unit_id = u.id;
