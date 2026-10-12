import { withClientBasePath } from '@client/src/lib/base-path';

/**
 * 站内媒体地址归一化：服务端下发的 `/media/...` 是**根相对路径**，而应用挂在
 * `CLIENT_BASE_PATH`（`/app/:appId`）下，直接塞进 `<img src>` 会打到站点根而
 * 404 —— 线上表现为**图片全部裂开**。绝对 URL（含 `//cdn...` 协议相对）原样返回。
 *
 * ⚠️ 铁律：凡消费服务端下发根相对路径的 `<img src>` / `<a href>`，必须过本函数。
 * 严禁就地写 `src={item.xxxUrl}`。同一缺陷已复发三次：
 *   ① 文章封面图（09-10，P0.1：`/api/articles/:id/cover` 打到站点根）
 *   ② ChatWidget 引用链接（09-17，裸 `<a href="/article/...">` 绕过 router basename）
 *   ③ 机制观察卡片图标（09-20，`src={item.iconUrl}` 打在 `/media/...` 根路径）
 * 三处修复最终都收敛到同一个函数，故提取到此处作为唯一实现。
 */
export function resolveMediaSrc(src?: string | null): string | null {
  const value = src?.trim();
  if (!value) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(value)) return value;
  return withClientBasePath(value);
}
