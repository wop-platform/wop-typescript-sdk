import { WopError } from './error';

/**
 * 线上二进制编码工具：base64url 无填充（严格模式，F6/F7）、小写 hex、utf-8。
 * 零依赖，浏览器与 Node ≥18 通用。
 */

/** 明确以 ArrayBuffer 为底的字节类型（WebCrypto BufferSource 兼容） */
export type Bytes = Uint8Array<ArrayBuffer>;

/** base64url 字母表预检(无填充,故不含 =) */
const B64URL_RE = /^[A-Za-z0-9_-]*$/;
/** 标准 base64 字母表(密钥材料,含 padding) */
const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64url 字母表(线上编码,+/ → -_) */
const B64U_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url 无填充编码 */
export function toBase64Url(bytes: Uint8Array): string {
  return encodeWith(bytes, B64U_ALPHABET);
}

/**
 * base64url 无填充**严格**解码：带 `=`、非法字符、不可能长度（%4==1）、非规范尾随位一律拒绝。
 */
export function fromBase64Url(s: string): Bytes {
  if (!B64URL_RE.test(s)) {
    throw new WopError('base64url 解码失败：输入含非法字符或填充符 "="', 'parse');
  }
  const rem = s.length % 4;
  if (rem === 1) {
    throw new WopError(`base64url 解码失败：长度非法（${s.length} % 4 == 1）`, 'parse');
  }
  // 非规范尾随位显式校验（RFC 4648 §3.5，语义锚 = Go base64.RawURLEncoding.Strict()）：
  // %4==2（8 数据位）→ 尾字符低 4 位须零；%4==3（16 数据位）→ 尾字符低 2 位须零
  if (rem === 2 || rem === 3) {
    const lastIndex = B64U_ALPHABET.indexOf(s[s.length - 1]!)!;
    if (lastIndex & (rem === 2 ? 0xf : 0x3)) {
      throw new WopError('base64url 解码失败：非规范尾随位', 'parse');
    }
  }
  return decodeWith(s, B64U_ALPHABET);
}

/** 标准 base64 编码（密钥材料，含 padding） */
export function toBase64(bytes: Uint8Array): string {
  return encodeWith(bytes, STD_ALPHABET);
}

/** 标准 base64 解码（容忍 padding） */
export function fromBase64(s: string): Bytes {
  const trimmed = trimBase64Padding(s);
  if (!/^[A-Za-z0-9+/]*$/.test(trimmed)) {
    throw new WopError('base64 解码失败：输入含非法字符', 'parse');
  }
  if (trimmed.length % 4 === 1) {
    throw new WopError(`base64 解码失败：长度非法（${trimmed.length} % 4 == 1）`, 'parse');
  }
  return decodeWith(trimmed, STD_ALPHABET);
}

/**
 * 去掉标准 base64 末尾 `=` 填充，语义与 `/=+$/` 完全一致：JS 正则 `$`
 * 亦匹配末尾单个 `\n` 之前，故 `=` 剥除不吞换行。
 * （code-scanning js/polynomial-redos：改线性扫描，无正则回溯。）
 */
function trimBase64Padding(s: string): string {
  let end = s.length;
  let trailingNl = 0;
  if (end > 0 && s[end - 1] === '\n') {
    trailingNl = 1;
    end -= 1;
  }
  while (end > 0 && s[end - 1] === '=') {
    end -= 1;
  }
  return trailingNl ? s.slice(0, end) + '\n' : s.slice(0, end);
}

/** 小写 hex 编码 */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** hex 解码（小写/大写均收，输出原始字节） */
export function fromHex(s: string): Bytes {
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new WopError('hex 解码失败：非十六进制字符或奇数长度', 'parse');
  }
  const out = new Uint8Array(s.length / 2) as Bytes;
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 进程级复用的 UTF-8 编码器 */
const encoder = new TextEncoder();
/** 进程级复用的 UTF-8 解码器 */
const decoder = new TextDecoder();

/** UTF-8 编码(string → Bytes) */
export function utf8Encode(s: string): Bytes {
  return encoder.encode(s) as Bytes;
}

/** UTF-8 解码(Bytes → string) */
export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** 通用 base64 家族编码（无 padding 输出） */
function encodeWith(bytes: Uint8Array, alphabet: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2]!;
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 === undefined) break;
    out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 === undefined) break;
    out += alphabet[b2 & 0x3f]!;
  }
  return out;
}

/** 通用 base64 家族解码（无 padding 输入；输入合法性由调用方正则预检保证） */
function decodeWith(s: string, alphabet: string): Bytes {
  const len = s.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4)) as Bytes;
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < len; i++) {
    acc = (acc << 6) | alphabet.indexOf(s[i]!)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
