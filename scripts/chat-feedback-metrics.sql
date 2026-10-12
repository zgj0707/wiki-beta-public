-- ============================================================================
-- Chatbot 反馈指标 · 一站式只读查询（Q1–Q9）
--
-- 口径定义、局限声明与回填 SOP 见 docs/chat-feedback-ops.md（唯一权威版本）。
-- 本文件**只读**（SELECT），可在 online 直接跑 —— online 禁 DDL/DML。
--
-- 用法（⚠️ 必须在 repo 根目录执行：lark-cli 的 --file 有 allowlist，
--       只接受 cwd、账户 temp、或 home 下 files 目录，绝对路径 E:/... 会被拒）：
--
--   cd <repo>
--   lark-cli apps +db-execute --app-id app_EXAMPLE0000001 --environment online \
--     --file scripts/chat-feedback-metrics.sql --yes --format json
--
-- 多语句逐条返回（每条一个结果集），故每条都带 section 标签便于对号入座。
-- 为什么走 --file 而不是 --sql：--sql 传长语句会被 UTF8 截断（历史踩坑）。
-- ============================================================================

-- Q1 ── 总览：反馈量、差评率、待处理数 -------------------------------------
-- down_rate_pct 是**反馈样本口径**（自选择偏差使其系统性偏高），不是整体质量。
SELECT
  'Q1 总览' AS section,
  count(*) AS total_rows,
  count(*) FILTER (WHERE rating = 'up')   AS up_cnt,
  count(*) FILTER (WHERE rating = 'down') AS down_cnt,
  round(
    100.0 * count(*) FILTER (WHERE rating = 'down')
    / NULLIF(count(*) FILTER (WHERE rating IN ('up', 'down')), 0), 1
  ) AS down_rate_pct,
  count(*) FILTER (WHERE rating = 'down' AND status = 'new')      AS down_pending,
  count(*) FILTER (WHERE rating = 'down' AND status = 'boundary') AS down_boundary,
  min(_created_at)::text AS first_at,
  max(_created_at)::text AS last_at
FROM chat_feedback;

-- Q2 ── 差评的归因构成 ----------------------------------------------------
-- ⚠️ 这里算的是「差评内部的归因**构成**（各层占比）」，**不是**「分层差评率」。
-- attribution 只在差评行存在（好评行全为 NULL），没有分母 ⇒ 分层差评率在数学上
-- 不可得。要做分层差评率必须先给每轮问答全量打标（本轮不做，见 ops §3 局限 3）。
-- sample_guard：单层 n<10 时**只报绝对数、不报比率**（与 AI 编译层同源原则）。
SELECT
  'Q2 差评归因' AS section,
  coalesce(attribution, '(none 用户主动停止)') AS attribution,
  count(*) AS n,
  CASE WHEN count(*) >= 10
       THEN round(100.0 * count(*) / sum(count(*)) OVER (), 1)::text || '%'
       ELSE 'n<10 只报绝对数'
  END AS pct_of_down
FROM chat_feedback
WHERE rating = 'down'
GROUP BY 2
ORDER BY n DESC;

-- Q3 ── 反馈样本的来源构成（仅在差评行内）----------------------------------
-- external 占比反映语料覆盖度缺口；机制来源占比反映投影层覆盖度。
-- snippet_max_len 用来**监控片段层判据**：SNIPPET_TOTAL=1800 而预算逻辑使实际
-- 长度几乎不可能达标（实测 1716–1793）⇒ snippet_full_cnt 长期为 0 属预期，
-- 说明归因函数第 8 分支（snippet）判据失效，详见 ops §4。
SELECT
  'Q3 来源构成' AS section,
  count(*) AS down_rows,
  count(*) FILTER (WHERE context->>'external' = 'true') AS external_cnt,
  count(*) FILTER (WHERE context->>'truncated' = 'true') AS truncated_cnt,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(citations, '[]'::jsonb)) AS e
    WHERE e->>'docId' LIKE 'mechanism:%'
  )) AS mech_src_cnt,
  count(*) FILTER (WHERE context->>'deep' = 'true') AS deep_cnt,
  round(avg(jsonb_array_length(coalesce(citations, '[]'::jsonb))), 1) AS avg_cites,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(
      coalesce(context->'snippetLens', '[]'::jsonb)
    ) AS v WHERE v::int >= 1800
  )) AS snippet_full_cnt,
  max((
    SELECT max(v::int) FROM jsonb_array_elements_text(
      coalesce(context->'snippetLens', '[]'::jsonb)
    ) AS v
  )) AS snippet_max_len
FROM chat_feedback
WHERE rating = 'down';

-- Q4 ── 闭环率与状态分布 --------------------------------------------------
-- fix_rate_pct = fixed / (confirmed + fixed)：已受理的里面修掉的比例。
-- boundary（已知边界）单列，**不属于缺陷池**，不参与闭环率。
SELECT
  'Q4 闭环' AS section,
  count(*) FILTER (WHERE rating = 'down') AS down_total,
  count(*) FILTER (WHERE rating = 'down' AND status = 'new')       AS st_new,
  count(*) FILTER (WHERE rating = 'down' AND status = 'confirmed') AS st_confirmed,
  count(*) FILTER (WHERE rating = 'down' AND status = 'fixed')     AS st_fixed,
  count(*) FILTER (WHERE rating = 'down' AND status = 'wontfix')   AS st_wontfix,
  count(*) FILTER (WHERE rating = 'down' AND status = 'boundary')  AS st_boundary,
  round(
    100.0 * count(*) FILTER (WHERE rating = 'down' AND status = 'fixed')
    / NULLIF(count(*) FILTER (WHERE rating = 'down'
                              AND status IN ('confirmed', 'fixed')), 0), 1
  ) AS fix_rate_pct
FROM chat_feedback;

-- Q5 ── 待处理坏例明细（人工 triage 的输入）-------------------------------
-- 处理完把 status 改成 confirmed / fixed / wontfix / boundary（见 ops §5）。
-- 注意只读：本文件不改数据，改状态用单独的一条 UPDATE（dev 先验证）。
SELECT
  'Q5 待处理' AS section,
  turn_id,
  reason,
  attribution,
  left(question, 60) AS question_head,
  jsonb_array_length(coalesce(citations, '[]'::jsonb)) AS cites,
  context->>'external' AS external,
  context->>'truncated' AS truncated,
  context->>'model' AS model,
  round(extract(epoch FROM (now() - _created_at)) / 3600)::int AS age_hours
FROM chat_feedback
WHERE rating = 'down' AND status = 'new'
ORDER BY _created_at DESC
LIMIT 50;

-- Q6 ── 生成可直接粘贴的 eval 用例行 ---------------------------------------
-- 输出已做 JS 转义（SQL 按自身规则把单引号写成两个，而 JS 要反斜杠转义，
-- 直接粘 SQL 产物会语法错误）。故此处显式转成 JS 单引号转义。
-- ⚠️ 转义用 chr(39)/chr(92) 拼装、不写字面量：反斜杠+单引号的字面量极易写成
--    「引号不成对」（曾写成 3 个引号的未闭合串，整条语句被吞 → 报
--    syntax error at or near "down"，排查成本很高）。
-- ⚠️ expect 预填 hit；若该问题是**站外越界**（本该零召回）手工改成 miss。
-- ⚠️ 粘进 CASES 后**先跑一遍确认是「红」的**（见 ops §5 第 3 步）。
-- 🔴 本文件的历史坑：注释里若出现**不被成对引号包住的裸单引号**，同样可能让
--    --file 的语句切分错位 ⇒ 注释里一律不写单引号，要提字面量就用中文描述。
SELECT
  'Q6 eval 候选' AS section,
  format(
    '  { q: ''%s'', expect: ''hit'' },',
    replace(
      replace(question, chr(92), chr(92) || chr(92)),
      chr(39),
      chr(92) || chr(39)
    )
  ) AS eval_line,
  attribution,
  status,
  left(coalesce(answer, ''), 40) AS answer_head
FROM chat_feedback
WHERE rating = 'down'
  AND status IN ('confirmed', 'fixed')
  AND attribution IN ('retrieval', 'snippet', 'zero_recall')
ORDER BY _created_at;

-- Q7 ── Key 泄漏自检 ------------------------------------------------------
-- 任何行不得出现 apiKey / sk- / llmConfig 字样。非 0 即为 P0 事故。
-- 注：平台 access log 会逐字记录 POST body（平台行为、非我们可控），
-- 该 log 不在本查询范围内 —— 需另用 +log-list 全量 dump 后 grep（见 ops §6）。
SELECT
  'Q7 Key 自检' AS section,
  count(*) AS suspicious_rows
FROM chat_feedback
WHERE (
  coalesce(question, '') || coalesce(answer, '') || coalesce(search_query, '')
  || coalesce(citations::text, '') || coalesce(context::text, '')
) ~* 'apikey|api_key|sk-|llmconfig|authorization|bearer';

-- Q8 ── 分母健康度 --------------------------------------------------------
-- 好评行必须无文本（DB CHECK 已强制，此处做交叉验证）；差评行必须有 question。
SELECT
  'Q8 分母健康' AS section,
  count(*) FILTER (WHERE rating = 'up') AS up_total,
  count(*) FILTER (WHERE rating = 'up' AND (
    reason IS NOT NULL OR question IS NOT NULL OR search_query IS NOT NULL
    OR answer IS NOT NULL OR citations IS NOT NULL OR context IS NOT NULL
  )) AS up_with_text_violation,
  count(*) FILTER (WHERE rating = 'down' AND question IS NULL) AS down_missing_question
FROM chat_feedback;

-- Q9 ── 周度趋势 ----------------------------------------------------------
-- 周起点为周一。首周与小样本周只报绝对数。
SELECT
  'Q9 周度' AS section,
  to_char(date_trunc('week', _created_at), 'YYYY-MM-DD') AS week_start,
  count(*) FILTER (WHERE rating = 'up')   AS up_cnt,
  count(*) FILTER (WHERE rating = 'down') AS down_cnt,
  CASE WHEN count(*) >= 10
       THEN round(100.0 * count(*) FILTER (WHERE rating = 'down')
                  / NULLIF(count(*), 0), 1)::text || '%'
       ELSE 'n<10 只报绝对数'
  END AS down_rate
FROM chat_feedback
GROUP BY date_trunc('week', _created_at)
ORDER BY date_trunc('week', _created_at) DESC;
