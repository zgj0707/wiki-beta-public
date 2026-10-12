/**
 * 机制观察「三段式内容」的唯一口径（列表页与详情页共用）。
 *
 * 2026-09-20 改向：Base 不再把一条机制拆成多维子项，改为三段概括
 * （机制 / 优点 / 利用方法）。Base 列名 → DTO 字段名的对应关系只在这里写一次，
 * 列表与详情都从这里取标题，两处口径不会分叉。
 *
 * key 一律用 DTO 字段名字符串（对应 MechanismDetailData 的字段名），
 * 页面据此做白名单渲染：表外的列一律不出现。
 *
 * 本文件无 React / DOM 依赖，服务端也会一起编译。
 */

/** 段落 key：与 DTO 字段名逐字一致，页面用 `item[key]` 取值。 */
export type MechanismDimensionKey = 'coreHook' | 'buyValue' | 'reuseNote';

export interface MechanismDimension {
  key: MechanismDimensionKey;
  /** 内容来源的 Base 列名（便于对表核对）。 */
  baseColumn: string;
  /** 段落标题。 */
  title: string;
  /** 白话副标题：一句话解释这一段在读什么。 */
  hint: string;
}

export const MECHANISM_DIMENSIONS: MechanismDimension[] = [
  {
    key: 'coreHook',
    baseColumn: '机制',
    title: '机制',
    hint: '这条机制怎么转：玩家依次做什么，深度从哪来',
  },
  {
    key: 'buyValue',
    baseColumn: '优点',
    title: '优点',
    hint: '跟同类比强在哪：上手成本、反馈速度、成长与复玩',
  },
  {
    key: 'reuseNote',
    baseColumn: '利用方法',
    title: '利用方法',
    hint: '换题材后还剩什么能用：可复用骨架与投放切入点',
  },
];

/** 段落总数：详情页页脚「已标注 X/N 段」的 N。 */
export const MECHANISM_DIMENSION_TOTAL = MECHANISM_DIMENSIONS.length;

/** 页级「字段说明」折叠块条目。 */
export interface MechanismFieldGlossaryEntry {
  term: string;
  definition: string;
}

/**
 * 术语表必须覆盖全部段落标题，不得手工维护 —— 直接从 `MECHANISM_DIMENSIONS`
 * 派生（title + hint）。手写一份就会和维度表分叉。
 */
export const MECHANISM_FIELD_GLOSSARY: MechanismFieldGlossaryEntry[] =
  MECHANISM_DIMENSIONS.map((dimension) => ({
    term: dimension.title,
    definition: dimension.hint,
  }));
