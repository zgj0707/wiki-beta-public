/** Serialize data for an inline script without allowing HTML parser escapes. */
export function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}
