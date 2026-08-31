/**
 * canonicalRequest 构造（F2）。
 *
 * 与网关 CanonicalRequestBuilder 逐字节对齐（联调工具 docs/tools/rsa-keygen.html 同源）：
 * - 5 段以 `\n` 连接：authString \n METHOD \n path \n queryString \n canonicalHeaders
 * - header 值编码 = Java-URLEncoder 语义：encodeURIComponent 为基，`!'()~` 补编码为大写 %XX
 *   （结果：字母数字与 `.-_*` 保留；空格 → %20，非 + ）
 * - header 名小写化、trimall（去首尾 + 折叠内部空白）、按 ASCII 升序排序
 */

/** Java URLEncoder 语义编码（空格→%20；保留 A-Za-z0-9 . - _ *） */
export function javaUrlEncode(s: string | null | undefined): string {
  if (s == null) return '';
  return encodeURIComponent(s).replace(
    /[!'()~]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** 首尾去空白、内部连续空白折叠为单空格 */
export function trimall(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

/** canonical headers 段：名小写排序，`encode(name):encode(trimall(value))` 每行一个 */
export function canonicalHeaders(headers: Record<string, string>): string {
  const lowered: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    lowered[trimall(key).toLowerCase()] = headers[key]!;
  }
  return Object.keys(lowered)
    .sort()
    .map((k) => `${javaUrlEncode(k)}:${javaUrlEncode(trimall(lowered[k]))}`)
    .join('\n');
}
/** canonicalRequest 五要素入参:authString、METHOD、path、queryString、headers */
export interface CanonicalRequestInput {
  authString: string;
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, string>;
}

/** 5 段 `\n` 连接；method 大写化 */
export function canonicalRequest(input: CanonicalRequestInput): string {
  return [
    input.authString,
    input.method.toUpperCase(),
    input.path,
    input.queryString,
    canonicalHeaders(input.headers),
  ].join('\n');
}
