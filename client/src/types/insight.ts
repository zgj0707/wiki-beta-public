// 机制观察 / 实体 / 结论 / 数据覆盖公开 DTO（新 insight 契约）。
// 后端序列化 Date 字段为 ISO 字符串，前端一律按 string 处理。

/** 机制观察列表条目（GET /api/mechanisms）。 */
export interface MechanismListItem {
  stableKey: string;
  entryType: string | null;
  gameName: string | null;
  /** Base「机制」列：这条机制怎么转。 */
  coreHook: string | null;
  sourceLink: string | null;
  /**
   * 条目最后修改时间（Base 系统「更新时间」）。ISO 字符串；未取到为 null。
   * ⚠️ 2026-09-29 前该字段为「审核时间」，Base 侧该列已删除 ⇒ 语义已变，
   * 字段名同步由 `reviewTime` 改为 `updatedAt`。
   */
  updatedAt: string | null;
  /** 市场认可指数（0.70–0.97）；未填为 null。排序时 null 沉底。 */
  marketScore?: number | null;
  /** 核心创新指数（0.09–2.24）；未填为 null。排序时 null 沉底。 */
  innovationScore?: number | null;
  /**
   * 机制流程图站内代理地址（/media/mechanisms/:stableKey/flowchart?v=…）；
   * 来源是 Base「机制流程图」附件字段，未上传或未建列时为 null。
   * 无图时不渲染图位，不留空洞。
   */
  figureUrl?: string | null;
  /**
   * 中文显示名，来源 Base「中文名」列（2026-09-20 新增）。官方中文名与试译
   * 混排，试译值以 `（试译）` 结尾，渲染时拆成独立标签；未填为 null，
   * 前端回退到 `gameName`。
   */
  nameCn?: string | null;
  /**
   * 方形图标站内代理地址（/media/mechanisms/:stableKey/icon?v=…），
   * 来源 Base「游戏图标」附件字段（128×128 PNG）。未上传时为 null，
   * 前端渲染占位方块，不留空洞。
   */
  iconUrl?: string | null;
}

/** 机制观察类型供给趋势（GET /api/mechanisms/trends）。 */
export interface MechanismTrendItem {
  type: string;
  count: number;
}

/** 机制观察详情（GET /api/mechanisms/:stableKey）。 */
export interface MechanismDetailData extends MechanismListItem {
  /** Base「优点」列。 */
  buyValue: string | null;
  /** Base「利用方法」列。 */
  reuseNote: string | null;
  reviewStatus: string | null;
}

// v2 实体链路退场（2026-10-09）：实体浏览 UI 及 /api/entities 系列接口已下线，
// EntityListItem / EntityRelationItem / EntityRelatedItem / EntityDetailData
// 四个类型随之移除；实体数据仍在后台经投影服务喂 chatbot 检索。

/** 数据覆盖统计（GET /api/research/coverage）。 */
export interface CoverageData {
  totals: {
    articles: number;
    mechanisms: number;
    entities: number;
    relations: number;
  };
  articlesByMonth: Array<{ month: string; count: number }>;
}
