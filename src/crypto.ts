import { WopError } from './error';
import { DECRYPT_FAILED } from './error';
import type { Bytes } from './encode';

/**
 * 四维算法的 WebCrypto 实现（§3.3，spec 附录 B.1 JS 行）。
 *
 * - 签名：RSASSA-PKCS1-v1_5 / SHA-256（§3.3①）
 * - 密钥包装：RSA-OAEP，WebCrypto 单哈希模型 = OAEP 摘要 SHA-256 + MGF1-SHA-256，
 *   无 label 参数 = 空 label —— 显式双 SHA-256 天然满足（§3.3③/D10/F2）
 * - 报文加密：AES-256-GCM，key 32B / IV 12B / tag 128bit，密文 = ct‖tag 尾拼（§3.3②/F4）
 *
 * 全部走 globalThis.crypto（Node ≥18 / 浏览器），零第三方依赖；纯函数天然进程级单例（D7）。
 */

/** WebCrypto 入口；缺失即系统类错误 */
export function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new WopError(
      '当前运行时缺少 WebCrypto（globalThis.crypto.subtle），需要 Node ≥18 或安全上下文浏览器',
      'system',
    );
  }
  return c.subtle;
}

/** CSPRNG 字节（I4：IV/nonce 唯一生成点） */
export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n) as Bytes;
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** SHA256withRSA 加签（私钥 = PKCS#8 DER） */
export async function rsaSign(privPkcs8: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const key = await subtle().importKey(
    'pkcs8',
    privPkcs8 as unknown as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle().sign('RSASSA-PKCS1-v1_5', key, data as unknown as BufferSource)) as Bytes;
}

/** SHA256withRSA 验签（公钥 = SPKI DER） */
export async function rsaVerify(
  pubSpki: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const key = await subtle().importKey(
    'spki',
    pubSpki as unknown as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return subtle().verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature as unknown as BufferSource,
    data as unknown as BufferSource,
  );
}

/** RSA-OAEP（双 SHA-256 + 空 label）DEK 包装（公钥 = SPKI DER） */
export async function oaepWrap(pubSpki: Uint8Array, plaintext: Uint8Array): Promise<Bytes> {
  const key = await subtle().importKey(
    'spki',
    pubSpki as unknown as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  return new Uint8Array(await subtle().encrypt({ name: 'RSA-OAEP' }, key, plaintext as unknown as BufferSource)) as Bytes;
}

/**
 * RSA-OAEP 解包（私钥 = PKCS#8 DER）。
 * 失败（含 MGF1-SHA-1 陷阱密文）统一抛 I7 模糊错误，不区分 padding/tag 细节。
 */
export async function oaepUnwrap(privPkcs8: Uint8Array, cipher: Uint8Array): Promise<Bytes> {
  const key = await subtle().importKey(
    'pkcs8',
    privPkcs8 as unknown as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'RSA-OAEP' }, key, cipher as unknown as BufferSource)) as Bytes;
  } catch {
    throw new WopError(DECRYPT_FAILED, 'decrypt');
  }
}

/** AES-256-GCM 加密，输出 ct‖tag 尾拼（tag 128bit） */
export async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Bytes> {
  assertAesGcmParams(key, iv);
  const cryptoKey = await subtle().importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
      cryptoKey,
      plaintext as unknown as BufferSource,
    ),
  ) as Bytes;
}

/** AES-256-GCM 解密（输入 ct‖tag）；tag 校验失败统一 I7 模糊错误 */
export async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  cipherTag: Uint8Array,
): Promise<Bytes> {
  assertAesGcmParams(key, iv);
  if (cipherTag.length < 16) {
    throw new WopError(DECRYPT_FAILED, 'decrypt');
  }
  const cryptoKey = await subtle().importKey('raw', key as unknown as BufferSource, 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
        cryptoKey,
        cipherTag as unknown as BufferSource,
      ),
    ) as Bytes;
  } catch {
    throw new WopError(DECRYPT_FAILED, 'decrypt');
  }
}

function assertAesGcmParams(key: Uint8Array, iv: Uint8Array): void {
  if (key.length !== 32) {
    throw new WopError(`AES-256-GCM 密钥长度非法：${key.length} 字节（须 32）`, 'parse');
  }
  if (iv.length !== 12) {
    throw new WopError(`AES-256-GCM IV 长度非法：${iv.length} 字节（须 12）`, 'parse');
  }
}
