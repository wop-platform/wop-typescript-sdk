/**
 * BDD 平台模拟器与验签探针（cucumber-js 步骤支撑）。
 *
 * D5 纪律：入向校验测试的"平台响应"构造不得复用被测 SDK 的出向编排代码——
 * 本文件仅使用密码原语（rsaSign/oaepWrap/aesGcmEncrypt）与 canonicalRequest 纯函数
 * 手工组装平台出站报文，与仓库既有惯例（client.spec.ts）同一边界。
 */
import { readFileSync } from 'node:fs';
import { canonicalRequest } from '../../../src/canonical';
import { computeDigestHeader } from '../../../src/digest';
import { aesGcmDecrypt, aesGcmEncrypt, oaepUnwrap, oaepWrap, rsaSign, rsaVerify } from '../../../src/crypto';
import { buildDekPayload } from '../../../src/envelope';
import { fromBase64, fromBase64Url, toBase64Url, utf8Encode, utf8Decode } from '../../../src/encode';
const vectors = JSON.parse(
  readFileSync(new URL('../../fixtures/crypto-vectors.json', import.meta.url), 'utf8'),
) as typeof import('../../fixtures/crypto-vectors.json');

export const K = vectors.keys;
export const MERCH_PRIV = K.rsa3072!.privatePkcs8B64;
export const MERCH_PUB = K.rsa3072!.publicSpkiB64;
export const PLAT_PRIV = K.rsa3072!.privatePkcs8B64;
export const PLAT_PUB = K.rsa3072!.publicSpkiB64;
export const AES_KEY = fromBase64Url(vectors.inputs.aesKeyB64u!);
export const AES_IV = fromBase64Url(vectors.inputs.aesIvB64u!);
export type Tamper = 'none' | 'signature' | 'digest' | 'dek' | 'tag' | 'sm4alg';

/** 模拟平台出站：平台私钥加签、商户公钥包 DEK，构造 L0/L2 响应（canonical method = POST） */
export async function platformRespond(
  path: string,
  plainBody: string,
  opts: { level?: 'L0' | 'L2'; tamper?: Tamper } = {},
): Promise<{ headers: Record<string, string>; body: string }> {
  const level = opts.level ?? 'L0';
  const tamper = opts.tamper ?? 'none';
  const headers: Record<string, string> = {
    'x-wop-nonce': 'nonce-from-platform',
    'x-wop-timestamp': '1770000000000',
  };
  let wireBody = plainBody;
  if (level === 'L2') {
    const ct = await aesGcmEncrypt(AES_KEY, AES_IV, utf8Encode(plainBody));
    if (tamper === 'tag') ct[ct.length - 1]! ^= 0x01;
    wireBody = JSON.stringify({ encrypted: toBase64Url(ct) });
    const payload =
      tamper === 'sm4alg' ? vectors.inputs.dekPayloadSm2! : buildDekPayload('AES-256-GCM', AES_KEY, AES_IV);
    const wrapped = await oaepWrap(fromBase64(MERCH_PUB), utf8Encode(payload));
    if (tamper === 'dek') wrapped[5]! ^= 0x01;
    headers['x-wop-encrypt'] = `L2;dek=${toBase64Url(wrapped)}`;
  }
  if (wireBody.length > 0) {
    headers['x-wop-content-digest'] =
      tamper === 'digest' ? 'sha-256 ' + '0'.repeat(64) : await computeDigestHeader(wireBody);
  }
  const signedNames = Object.keys(headers).sort();
  const canonical = canonicalRequest({
    authString: 'v1/1800',
    method: 'POST',
    path,
    queryString: '',
    headers,
  });
  const sig = await rsaSign(fromBase64(PLAT_PRIV), utf8Encode(canonical));
  let signHeader = `WOP-RSA3072-SHA256 v1/1800/${signedNames.join(';')}/${toBase64Url(sig)}`;
  if (tamper === 'signature') {
    const sp = signHeader.lastIndexOf('/');
    const flip = signHeader[sp + 1] === 'A' ? 'B' : 'A';
    signHeader = signHeader.slice(0, sp + 1) + flip + signHeader.slice(sp + 2);
  }
  headers['x-wop-sign'] = signHeader;
  return { headers, body: wireBody };
}

/** 网关侧探针：以商户公钥验 draft 签名（F3 出向互操作闭环） */
export async function gatewayVerifyDraft(
  draftHeaders: Record<string, string>,
  method: string,
  path: string,
  queryString: string,
): Promise<boolean> {
  const sign = draftHeaders['x-wop-sign']!;
  const seg = sign.slice(sign.indexOf(' ') + 1).split('/');
  const hmap: Record<string, string> = {};
  for (const n of (seg[2] ?? '').split(';')) hmap[n] = draftHeaders[n]!;
  const canonical = canonicalRequest({
    authString: `${seg[0]}/${seg[1]}`,
    method,
    path,
    queryString,
    headers: hmap,
  });
  return rsaVerify(fromBase64(MERCH_PUB), fromBase64Url(seg[3] ?? ''), utf8Encode(canonical));
}

/** 网关侧探针：解包 L2 draft 的 DEK 并解密 wireBody 回环（F5 出向互操作闭环） */
export async function gatewayDecryptDraft(
  draftHeaders: Record<string, string>,
  wireBody: string,
): Promise<string> {
  const dekB64u = draftHeaders['x-wop-encrypt']!.slice('L2;dek='.length);
  const payload = utf8Decode(await oaepUnwrap(fromBase64(PLAT_PRIV), fromBase64Url(dekB64u)));
  const parts = payload.split('$');
  const ct = fromBase64Url(JSON.parse(wireBody).encrypted);
  return utf8Decode(await aesGcmDecrypt(fromBase64Url(parts[1]!), fromBase64Url(parts[2]!), ct));
}
