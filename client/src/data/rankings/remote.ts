// 榜单远端数据源（#榜单数据源 Base 化）。
//
// 服务端把「文章工作台」中 内容类型=榜单 的行投影成 /api/rankings 两接口；
// 本模块负责拉取并在任何失败时返回 null，调用方据此回退到静态兜底数据
// （AUTO-GENERATED 的 index.ts），保证已上线榜单始终可展示。
//
// 必须走 backendGet：生产环境 API 带 CLIENT_BASE_PATH 前缀且要求
// X-Suda-Csrf-Token 头（window.csrfToken），裸 fetch 会 403/404。
//
// 响应口径与静态数据一致：
//   meta.boards[key] = { title, type, periods }（sourceUrl 仍以静态数据为准）
//   content = { html }（Steam 为完整文档，其余为 inner body 片段）

import { backendGet } from '@client/src/api/backend';
import type { BoardData, BoardKey } from './index';

export type RemoteBoardsMeta = Partial<Record<BoardKey, BoardData>>;

export async function fetchBoardsMeta(): Promise<RemoteBoardsMeta | null> {
  try {
    const data = await backendGet<{ boards?: RemoteBoardsMeta }>(
      '/api/rankings/meta',
    );
    return data?.boards && typeof data.boards === 'object'
      ? data.boards
      : null;
  } catch {
    return null;
  }
}

export async function fetchBoardContent(
  board: BoardKey,
  slug: string,
): Promise<string | null> {
  try {
    const data = await backendGet<{ html?: unknown }>(
      `/api/rankings/${encodeURIComponent(board)}/${encodeURIComponent(slug)}/content`,
    );
    return typeof data?.html === 'string' && data.html ? data.html : null;
  } catch {
    return null;
  }
}
