/** Base-sync resource IDs — must be provided via environment variables. */

export function baseSyncBaseToken(): string {
  const token =
    process.env.WIKI_BETA_SYNC_BASE_TOKEN?.trim() ||
    process.env.WIKI_BETA_BASE_TOKEN?.trim();
  if (!token) {
    throw new Error('WIKI_BETA_SYNC_BASE_TOKEN or WIKI_BETA_BASE_TOKEN is not configured');
  }
  return token;
}

export function insightMechanismTable(): string {
  const table =
    process.env.WIKI_BETA_SYNC_MECHANISM_TABLE?.trim() ||
    process.env.WIKI_BETA_MECHANISM_TABLE_ID?.trim();
  if (!table) {
    throw new Error(
      'WIKI_BETA_SYNC_MECHANISM_TABLE or WIKI_BETA_MECHANISM_TABLE_ID is not configured',
    );
  }
  return table;
}

/**
 * 「机制观察」表需要拉取的中文字段名。
 *
 * 2026-09-20 精简：Base 侧删掉 27 列、新增「机制 / 优点 / 利用方法」三列，
 * 内容从多维子项改为三段式概括；快照见 `snapshots/2026-09-20-mech-slim/`。
 * 「机制流程图」不走这里（由 `FeishuBaseReader.listMechanismRows` 单独读取）；
 * 「原始正文」「内容哈希」无运行时消费方，不请求。
 *
 * 2026-09-20 追加「中文名」：chat 引用与机制页主标题需要同一口径的显示名，
 * 而检索热路径不能实时读 Base（冷启动 1.8–2.9s），故改由同步进 PG
 * （落在已下线的 `mechanism_title` 列，零 DDL，见 base-sync-insight.service.ts）。
 */
/**
 * 两个指数列的 Base 字段名（**唯一字面量来源**，2026-09-29）。
 *
 * 除同步读取外，机制页的悬停提示也要按这两个名字去取**字段描述**
 * （`FeishuBaseReader.listMechanismFieldDescriptions`）⇒ 改列名只改这里。
 */
export const MECHANISM_MARKET_SCORE_FIELD = '市场认可指数' as const;
export const MECHANISM_INNOVATION_SCORE_FIELD = '核心创新指数' as const;

export const MECHANISM_FIELD_NAMES = [
  '稳定键',
  '条目类型',
  '游戏名',
  '中文名',
  '机制',
  '优点',
  '利用方法',
  '审核状态',
  '当前发布',
  '来源链接',
  MECHANISM_MARKET_SCORE_FIELD,
  MECHANISM_INNOVATION_SCORE_FIELD,
  // 注意：'审核时间' 已从 Base 删除（2026-09-29 实测），继续请求会每轮撞
  // 1254045 FieldNameNotFound → 走 fetchAllRecords 的自愈探测（多付 N 次请求 +
  // 常驻 warn 噪音）。时间维度改取 Base 系统字段「更新时间」。
  // 注意：也不请求「更新时间」——它是 updated_at 系统字段，records/search 的
  // field_names 不接受系统字段名（同样报 1254045）；改为请求体带
  // `automatic_fields: true`，从记录级 `last_modified_time` 取（见 base-sync.service.ts）。
] as const;

