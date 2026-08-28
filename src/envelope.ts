import { WopError } from './error';
import { fromBase64Url, toBase64Url } from './encode';
import type { Bytes } from './encode';

/**
 * DEK 载荷（§6.1）：`alg$base64url(key)$base64url(iv)`。
 *
 * `$` 不在 base64url 字母表中，分隔符无碰撞。alg 与套件族的一致性比对
 * 发生在解包之后、bulk 解密之前（D8 时序），由 client 层执行。
 */

export interface DekPayload {
  alg: string;
  key: Bytes;
  iv: Bytes;
}

/** 组装 DEK 载荷字符串 */
export function buildDekPayload(alg: string, key: Uint8Array, iv: Uint8Array): string {
  return `${alg}$${toBase64Url(key)}$${toBase64Url(iv)}`;
}

/** 解析 DEK 载荷：恰 3 段、base64url 严格、长度随 alg 校验（AES-256-GCM：key 32B / iv 12B） */
export function parseDekPayload(payload: string): DekPayload {
  const parts = payload.split('$');
  if (parts.length !== 3 || parts[0] === '' || parts[1] === '' || parts[2] === '') {
    throw new WopError(`DEK 载荷格式错误："${payload}" 应为 alg$key$iv 三段`, 'parse');
  }
  const [alg, keyB64u, ivB64u] = parts as [string, string, string];
  const key = fromBase64Url(keyB64u);
  const iv = fromBase64Url(ivB64u);
  if (alg === 'AES-256-GCM') {
    if (key.length !== 32) {
      throw new WopError(`DEK 载荷 AES-256-GCM 密钥长度非法：${key.length} 字节（须 32）`, 'parse');
    }
    if (iv.length !== 12) {
      throw new WopError(`DEK 载荷 AES-256-GCM IV 长度非法：${iv.length} 字节（须 12）`, 'parse');
    }
  }
  return { alg, key, iv };
}
