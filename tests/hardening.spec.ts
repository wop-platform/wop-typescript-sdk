import { describe, it, expect } from 'vitest';
import { WopClient } from '../src/client';
import { canonicalRequest } from '../src/canonical';
import { computeDigestHeader } from '../src/digest';
import { rsaSign } from '../src/crypto';
import { fromBase64, toBase64, toBase64Url, utf8Encode } from '../src/encode';
import vectors from './fixtures/crypto-vectors.json';

// 场景矩阵 S16/A3：运行时才暴露的损坏材料与验签异常路径。
// 本文件全部构造独立于被测出向编排（D5 纪律：平台响应用密码原语 + canonicalRequest 手工组装）。

const K = vectors.keys;
const MERCH_PRIV = K.rsa3072!.privatePkcs8B64;
const PLAT_PRIV = K.rsa3072!.privatePkcs8B64;
const BODY = JSON.stringify({ orderId: 'hardening-001', amount: 1 });

/** 独立构造合法结构的 L0 平台响应（签名密钥可注入，与被测 client 的公钥解耦） */
async function signedL0Response(
  path: string,
  body: string,
  signPriv: string,
): Promise<{ headers: Record<string, string>; body: string }> {
  const headers: Record<string, string> = {
    'x-wop-nonce': 'nonce-hardening',
    'x-wop-timestamp': '1770000000000',
  };
  if (body.length > 0) {
    headers['x-wop-content-digest'] = await computeDigestHeader(body);
  }
  const signedNames = Object.keys(headers).sort();
  const canonical = canonicalRequest({
    authString: 'v1/1800',
    method: 'POST',
    path,
    queryString: '',
    headers,
  });
  const sig = await rsaSign(fromBase64(signPriv), utf8Encode(canonical));
  headers['x-wop-sign'] = `WOP-RSA3072-SHA256 v1/1800/${signedNames.join(';')}/${toBase64Url(sig)}`;
  return { headers, body };
}

describe('覆盖缺口：验签执行异常 → 模糊化吞并（client.ts verifyIncoming catch rsaVerify）', () => {
  it('平台公钥损坏（构造期仅长度校验通过）→ rsaVerify 抛错被吞为「签名验证失败」（I7）', async () => {
    // 48 字节垃圾 DER：≥40 通过 keyMaterialToDer 长度校验，importKey('spki') 必 reject
    const garbageSpki = toBase64(new Uint8Array(48).fill(0x30));
    const client = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: MERCH_PRIV,
      platformPublicKey: garbageSpki,
    });
    const { headers, body } = await signedL0Response('/p', BODY, PLAT_PRIV);
    const r = await client.verifyResponse(headers, body, '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('签名验证失败');
    // I7 纪律：不得泄露 WebCrypto/importKey 等内部细节
    expect(r.reason).not.toMatch(/import|spki|data|key/i);
  });

  it('对照组：同头集合在合法公钥下验签通过（证明上一例失败源于验签异常而非头构造）', async () => {
    const client = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: MERCH_PRIV,
      platformPublicKey: K.rsa3072!.publicSpkiB64,
    });
    const { headers, body } = await signedL0Response('/p', BODY, PLAT_PRIV);
    expect((await client.verifyResponse(headers, body, '/p')).ok).toBe(true);
  });
});
