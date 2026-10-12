// 「便捷工具」数据源（#便捷工具 Base 化）。
//
// 服务端把 Base「便捷工具表」中 启用=☑ 的行投影成 /api/quick-tools，
// 返回 { tools: QuickToolItem[] }，已按「日期」降序排列（最新在上，无日期沉底）。
//
// 必须走 backendGet：生产环境 API 带 CLIENT_BASE_PATH 前缀且要求
// X-Suda-Csrf-Token 头（window.csrfToken），裸 fetch 会 403/404。
// backendGet 失败会 throw，由调用方 try/catch 处理。

import { backendGet } from '@client/src/api/backend';
import { withClientBasePath } from '@client/src/lib/base-path';
import {
  quickToolTarget,
  type QuickToolItem,
} from '@shared/quick-tools';

export async function fetchQuickTools(): Promise<QuickToolItem[]> {
  const data = await backendGet<{ tools?: QuickToolItem[] }>('/api/quick-tools');
  return data?.tools ?? [];
}

/**
 * 打开一枚便捷工具卡片（shared/quick-tools.ts 打开契约的执行者）。
 *
 * 外链：直接新标签打开。附件：**必须在用户手势上下文内同步** window.open
 * 空白窗（fetch 是异步的，等它回来再开窗会被弹窗拦截），随后 fetch
 * /api/quick-tools/attachment/:recordId（带 CSRF 头与登录 cookie）→
 * Blob(text/html) → win.location.replace(objectURL) 渲染。
 *
 * 🔴 不能改回 URL 直开（<a href>）：/media 顶导航被平台转交对象存储、
 * /api 直链被 CSRF 拦、多段深链也被平台转交 TOS——三轮实测详见
 * shared/quick-tools.ts 头注释。
 *
 * @throws 附件拉取失败时 reject（调用方负责错误提示）；空白窗被拦截时
 *         静默返回（浏览器级拦截无法绕过，罕见于点击场景）。
 */
export async function openQuickTool(item: QuickToolItem): Promise<void> {
  const target = quickToolTarget(item);
  if (!target) return;
  if (target.kind === 'external') {
    window.open(target.url, '_blank', 'noopener,noreferrer');
    return;
  }
  // 手势内同步开窗；about:blank 同源，后续可安全导航到 blob URL
  const win = window.open('about:blank', '_blank');
  try {
    const html = await backendGet<string>(
      `/api/quick-tools/attachment/${encodeURIComponent(item.id)}`,
    );
    if (!win) return;
    if (typeof html !== 'string' || !html.trim()) {
      win.close();
      throw new Error('附件内容为空');
    }
    const url = URL.createObjectURL(
      new Blob([withReturnBar(html, item.name)], {
        type: 'text/html; charset=utf-8',
      }),
    );
    win.location.replace(url);
  } catch (cause) {
    win?.close();
    throw cause;
  }
}

/** HTML 转义（返回条标题用，防止工具名中的特殊字符破坏注入结构）。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 附件 HTML 注入顶部返回条：**非 fixed**（不遮内容、随页面滚动），置于
 * <body> 开标签之后；无 body 标签时前置。关闭 = window.close()（脚本开的
 * 窗可关），被浏览器拒绝时降级跳回工具箱页。（原 p3c 文章附件实现迁移至此，
 * 互动内容区 2026-10-09 起统一走便捷工具表通道。）
 */
function withReturnBar(html: string, title: string): string {
  const backUrl = withClientBasePath('/quick-tools');
  const bar = `<div style="all:initial;display:block;position:static;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:10px 16px;border-bottom:1px solid #e5e7eb;background:#fff;font-size:13px;color:#374151;z-index:2147483647"><a href="${escapeHtml(backUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600">← 返回工具箱</a><span style="margin:0 10px;color:#d1d5db">|</span><span style="color:#6b7280">${escapeHtml(title)}</span><button type="button" onclick="window.close()" style="all:initial;float:right;cursor:pointer;font-family:inherit;font-size:13px;color:#6b7280;border:0;background:none;padding:0">关闭此页 ✕</button></div>`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}${bar}`);
  }
  return `${bar}${html}`;
}