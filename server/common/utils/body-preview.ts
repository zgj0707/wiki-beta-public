/**
 * 正文预览统一截断入口。
 * 红线：平台 DB 的 online 环境 left()/substring() 按字节截断多字节中文（dev 是字符语义），
 * SQL 层对中文列截断必产生非法 UTF8。所有 body_preview 的生成必须走本函数（JS slice 按 UTF-16 码元，安全）。
 */
export const BODY_PREVIEW_LENGTH = 300;

export function sliceBodyPreview(body: string | null | undefined): string | null {
  if (!body) return null;
  return body.slice(0, BODY_PREVIEW_LENGTH);
}
