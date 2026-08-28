import { WopError } from './error';
import { fromBase64 } from './encode';
import type { Bytes } from './encode';

/**
 * 密钥材料解析（D12）。
 *
 * 入参为字符串：PEM（`-----BEGIN/END…-----` 包装）或单行 Base64/Base64url。
 * RSA 公钥 = X.509 SPKI DER，私钥 = PKCS#8 DER；解析结果供 WebCrypto importKey。
 */

/** 剥离 PEM 头尾与全部空白后解码为 DER 字节 */
export function keyMaterialToDer(input: string): Bytes {
  if (typeof input !== 'string') {
    throw new WopError('密钥材料须为字符串（PEM 或单行 Base64）', 'parse');
  }
  const compact = input
    .replace(/-----(BEGIN|END)[^-]*-----/g, '')
    .replace(/\s+/g, '');
  if (compact.length < 40) {
    throw new WopError('密钥内容为空或过短', 'parse');
  }
  // 统一字母表：base64url（-_）归一为标准 base64（+/），padding 交由 fromBase64 容错；
  // 非法字符由 fromBase64 以解析类错误拒绝
  const der = fromBase64(compact.replace(/-/g, '+').replace(/_/g, '/'));
  if (der.length < 40) {
    throw new WopError('密钥 DER 内容过短，非合法 SPKI/PKCS8 材料', 'parse');
  }
  return der;
}
