BEGIN;

-- 033_chat_feedback：站内问答的用户反馈（bad case 采集）。
--
-- 背景（见 docs/chat-badcase-plan.md）：chat 此前零采集 —— Nest 日志只记
-- qLen/citations/answerLen/docIds，不记问题与回答正文；且 B 路线下 LLM 由浏览器
-- 直连网关，回答正文根本不经过后端 ⇒ 坏例"留不下来"，修完不沉淀用例，同类改动必复发。
--
-- 设计要点（两条硬约束，实现时不可越界）：
--   * 分子/分母分离，且**好评不落文本**：差评率需要分母（总反馈数），但只收差评
--     拿不到分母。故好评只写一行 {turn_id, rating='up'}，问题/回答/引用/上下文
--     全部为 NULL。隐私约束由 CHECK 强制（见 chat_feedback_privacy_ck），
--     不依赖应用层自觉。
--   * 归因层在写入时由纯函数算出（chat-feedback-attribution.ts），不信任上报端。
--     其中 zero_recall（零召回）刻意**不**直接判成 corpus 或 retrieval ——
--     关键词检索下两因不可从反馈数据区分，猜一个当真值会误导后续工作
--     （铁律：拿不到数据不猜原因）。留待人工/eval 定性后可改为 corpus 或 retrieval。
--
-- 不写 sync_run_log、不进 Base、不参与 cron 投影：纯反馈表，落库即完备。

CREATE TABLE IF NOT EXISTS chat_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 前端为每轮问答生成的 uuid（crypto.randomUUID），唯一键 + upsert = 天然幂等，
  -- 同时支持用户改选差评理由（同一轮最终态）。
  turn_id varchar(64) NOT NULL,
  rating varchar(10) NOT NULL,
  -- 仅差评：4 个业务选项（前端只问业务语言，不暴露技术概念）。
  reason varchar(30),
  -- 仅差评：用户**原始输入**（非改写后的检索词）。改写产物单独存 search_query，
  -- 两者语义漂移即可定位"查询改写把问题带偏"这类目前完全不可见的缺陷。
  question text,
  search_query text,
  answer text,
  -- 仅差评：[{docId,title,source,sourceDate,url}]，最多 20 条。
  -- url 必须留 —— 「引用打不开」的归因证据就在它上面。
  citations jsonb,
  -- 仅差评：信号快照 {external,truncated,stopped,deep,historyTurns,snippetLens,model,usage}。
  -- snippetLens 是片段长度的**数组**而非片段全文：判断是否顶格 SNIPPET_TOTAL(1800) 只需长度，
  -- 要修片段层时凭 citations[].docId 事后重取即可，不在此冗余 18KB/轮 的正文。
  context jsonb,
  attribution varchar(20),
  -- boundary = 已知边界（如机制条目本身不含完整正文），**不计入缺陷池**。
  status varchar(20) NOT NULL DEFAULT 'new',
  resolution_note text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT chat_feedback_rating_ck CHECK (rating IN ('up', 'down')),
  CONSTRAINT chat_feedback_reason_ck CHECK (
    reason IS NULL
    OR reason IN ('off_target', 'wrong', 'shallow', 'citation_broken')
  ),
  CONSTRAINT chat_feedback_attribution_ck CHECK (
    attribution IS NULL
    OR attribution IN (
      'zero_recall', 'corpus', 'retrieval', 'snippet',
      'generation', 'presentation', 'boundary'
    )
  ),
  CONSTRAINT chat_feedback_status_ck CHECK (
    status IN ('new', 'confirmed', 'fixed', 'wontfix', 'boundary')
  ),
  -- 差评必带理由与问题原文（没有这两项就无法归因，属于写入方 bug，应由数据库拦下）。
  CONSTRAINT chat_feedback_down_required_ck CHECK (
    rating <> 'down' OR (reason IS NOT NULL AND question IS NOT NULL)
  ),
  -- 🔴 隐私约束：好评行不得携带任何文本。
  -- llmConfig（用户 BYO-Key）与问题同在一个请求体，前端若整包透传会把 Key 写进库；
  -- 这条 CHECK 让"误传 Key 到好评行"在数据库层直接失败，而不是静默落库。
  CONSTRAINT chat_feedback_privacy_ck CHECK (
    rating = 'down'
    OR (
      reason IS NULL AND question IS NULL AND search_query IS NULL
      AND answer IS NULL AND citations IS NULL AND context IS NULL
      AND attribution IS NULL
    )
  )
);

-- 唯一键 = 幂等键 + 改单键（ON CONFLICT DO UPDATE）。
CREATE UNIQUE INDEX IF NOT EXISTS chat_feedback_turn_uidx
  ON chat_feedback (turn_id);
-- 周度归因统计：按状态 + 归因层取窗口内的行。
CREATE INDEX IF NOT EXISTS chat_feedback_triage_idx
  ON chat_feedback (status, attribution, _created_at DESC);
CREATE INDEX IF NOT EXISTS chat_feedback_recent_idx
  ON chat_feedback (_created_at DESC);

ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;

-- 与 ai_compile_* 一致：反馈只经应用后台读写，浏览器不直连（公开面走 Nest 接口）。
DROP POLICY IF EXISTS service_role_bypass_policy ON chat_feedback;
DROP POLICY IF EXISTS "问答反馈后台读取" ON chat_feedback;
DROP POLICY IF EXISTS "问答反馈创建" ON chat_feedback;
DROP POLICY IF EXISTS "问答反馈更新" ON chat_feedback;
DROP POLICY IF EXISTS "问答反馈删除" ON chat_feedback;
CREATE POLICY service_role_bypass_policy ON chat_feedback TO service_role USING (true);
CREATE POLICY "问答反馈后台读取" ON chat_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "问答反馈创建" ON chat_feedback FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "问答反馈更新" ON chat_feedback FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- 取消评分是物理删除（用户撤回的评级不应留在分母里）。
CREATE POLICY "问答反馈删除" ON chat_feedback FOR DELETE TO authenticated USING (true);

COMMIT;
