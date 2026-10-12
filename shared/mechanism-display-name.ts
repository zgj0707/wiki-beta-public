import { decodeHtmlEntities } from './base-text';

/**
 * Base「中文名」列里试译值统一以该后缀结尾（官方中文名不带该后缀）。
 * 渲染时拆成独立标签，避免读者把试译误当官方定名。
 */
export const TENTATIVE_SUFFIX = '（试译）';

export interface MechanismDisplayName {
  /** 去掉试译后缀的纯中文名；空串 = 未填中文名。 */
  nameCn: string;
  /** 该中文名是否为试译。 */
  tentative: boolean;
  /** 主标题：中文名 → 游戏名 → 稳定键。 */
  primary: string;
  /** 副标题：有中文名且与游戏名不同时给英文原名，否则 null（不重复渲染）。 */
  secondary: string | null;
}

/**
 * 显示名派生**只有这一处实现**，客户端（列表卡片、详情页 Hero、A-Z 排序）与
 * 服务端（chat 机制来源的引用标题）共用。
 *
 * 放在 `shared/` 的原因：chat 引用标题必须与机制页主标题逐字一致——引用显示
 * 「Sandustry」、点进去标题是「沙金工业」，读者会以为是两条内容。此前该逻辑只在
 * `client/`，服务端取不到就只能复刻一份，而复刻必然漏掉「（试译）后缀剥离」与
 * 「HTML 实体解码」这两步（游戏名上线实测会存成 `Fell &amp; Sell`）。
 *
 * 历史上列表与详情各自取值会导致「列表显示中文名、详情显示英文名」这类口径分叉；
 * 且排序若用 `gameName` 而卡片用中文名，会出现「排到 Z 的条目显示名以 A 开头」。
 * 因此任何显示名需求都必须经过本函数，不得就地 `item.nameCn ?? item.gameName`。
 */
export function displayNameOf(item: {
  /** Base「中文名」原文（可能带「（试译）」后缀、可能含 HTML 实体）。 */
  nameCn?: string | null;
  /** Base「游戏名」原文。 */
  gameName?: string | null;
  stableKey: string;
}): MechanismDisplayName {
  const raw = decodeHtmlEntities(item.nameCn ?? '').trim();
  const hasSuffix = raw.endsWith(TENTATIVE_SUFFIX);
  const nameCn = hasSuffix ? raw.slice(0, -TENTATIVE_SUFFIX.length).trim() : raw;
  const gameName = decodeHtmlEntities(item.gameName ?? '').trim();
  return {
    nameCn,
    tentative: hasSuffix && Boolean(nameCn),
    primary: nameCn || gameName || item.stableKey,
    secondary: nameCn && gameName && gameName !== nameCn ? gameName : null,
  };
}
