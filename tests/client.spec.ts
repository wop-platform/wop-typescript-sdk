import { describe, it, expect } from 'vitest';
import { WopClient } from '../src/client';
import { canonicalRequest } from '../src/canonical';
import { computeDigestHeader } from '../src/digest';
import { buildDekPayload } from '../src/envelope';
import { aesGcmDecrypt, aesGcmEncrypt, oaepUnwrap, oaepWrap, rsaSign, rsaVerify } from '../src/crypto';
import { fromBase64, fromBase64Url, toBase64Url, utf8Encode, utf8Decode } from '../src/encode';
import vectors from './fixtures/crypto-vectors.json';

const K = vectors.keys;

// 商户密钥对 = rsa3072 向量；平台密钥对 = rsa4096 向量（异钥防串联错位）
const MERCH_PRIV = K.rsa3072!.privatePkcs8B64;
const MERCH_PUB = K.rsa3072!.publicSpkiB64;
const PLAT_PRIV = K.rsa4096!.privatePkcs8B64;
const PLAT_PUB = K.rsa4096!.publicSpkiB64;

const BODY = JSON.stringify({ orderId: '20260829001', amount: 100 });

function makeClient(): WopClient {
  return new WopClient({
    appKey: 'test-app-key',
    suite: 'WOP-RSA3072-SHA256',
    merchantPrivateKey: MERCH_PRIV,
    platformPublicKey: PLAT_PUB,
  });
}

/** 模拟平台出站：平台私钥加签、商户公钥包 DEK，构造响应头（canonical method = POST） */
async function platformRespond(
  path: string,
  plainBody: string,
  opts: { level?: 'L0' | 'L2'; tamper?: 'none' | 'digest' | 'dek' | 'tag' | 'sm4alg' | 'noencrypted' } = {},
): Promise<{ headers: Record<string, string>; body: string }> {
  const level = opts.level ?? 'L0';
  const headers: Record<string, string> = {
    'x-wop-nonce': 'nonce-from-platform',
    'x-wop-timestamp': '1770000000000',
  };
  let wireBody = plainBody;
  if (level === 'L2') {
    const key = fromBase64Url(vectors.inputs.aesKeyB64u!);
    const iv = fromBase64Url(vectors.inputs.aesIvB64u!);
    if (opts.tamper !== 'noencrypted') {
      const ct = await aesGcmEncrypt(key, iv, utf8Encode(plainBody));
      if (opts.tamper === 'tag') ct[ct.length - 1]! ^= 0x01;
      wireBody = JSON.stringify({ encrypted: toBase64Url(ct) });
    }
    const payload =
      opts.tamper === 'sm4alg'
        ? vectors.inputs.dekPayloadSm2!
        : buildDekPayload('AES-256-GCM', key, iv);
    const wrapped = await oaepWrap(fromBase64(MERCH_PUB), utf8Encode(payload));
    if (opts.tamper === 'dek') wrapped[5]! ^= 0x01;
    headers['x-wop-encrypt'] = `L2;dek=${toBase64Url(wrapped)}`;
  }
  if (wireBody.length > 0) {
    headers['x-wop-content-digest'] =
      opts.tamper === 'digest' ? 'sha-256 ' + '0'.repeat(64) : await computeDigestHeader(wireBody);
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
  headers['x-wop-sign'] = `WOP-RSA4096-SHA256 v1/1800/${signedNames.join(';')}/${toBase64Url(sig)}`;
  return { headers, body: wireBody };
}

/** 网关侧助手：对给定头集合重签（先剥离旧 x-wop-sign，避免其入签） */
async function resign(path: string, headers: Record<string, string>): Promise<Record<string, string>> {
  delete headers['x-wop-sign'];
  const signedNames = Object.keys(headers).sort();
  const canonical = canonicalRequest({
    authString: 'v1/1800',
    method: 'POST',
    path,
    queryString: '',
    headers,
  });
  const sig = await rsaSign(fromBase64(PLAT_PRIV), utf8Encode(canonical));
  headers['x-wop-sign'] = `WOP-RSA4096-SHA256 v1/1800/${signedNames.join(';')}/${toBase64Url(sig)}`;
  return headers;
}

/** 从 draft/sign 头重建 canonical 并以指定公钥验签 */
async function verifyDraftCanonical(
  draftHeaders: Record<string, string>,
  method: string,
  path: string,
  queryString: string,
  pub: Uint8Array,
): Promise<boolean> {
  const sign = draftHeaders['x-wop-sign']!;
  const rest = sign.slice(sign.indexOf(' ') + 1);
  const seg = rest.split('/');
  const hmap: Record<string, string> = {};
  for (const n of (seg[2] ?? '').split(';')) hmap[n] = draftHeaders[n]!;
  const canonical = canonicalRequest({
    authString: `${seg[0]}/${seg[1]}`,
    method,
    path,
    queryString,
    headers: hmap,
  });
  return rsaVerify(pub, fromBase64Url(seg[3] ?? ''), utf8Encode(canonical));
}

describe('WopClient 构造校验', () => {
  it('appKey 空 / suite 非法 / 密钥空 → 立即抛错（fail-fast）', () => {
    expect(() => new WopClient({ appKey: '', suite: 'WOP-RSA3072-SHA256', merchantPrivateKey: MERCH_PRIV, platformPublicKey: PLAT_PUB })).toThrowError(/appKey/);
    expect(() => new WopClient({ appKey: 'ak', suite: 'WOP-RSA9999-SHA256', merchantPrivateKey: MERCH_PRIV, platformPublicKey: PLAT_PUB })).toThrowError(/不支持的算法/);
    expect(() => new WopClient({ appKey: 'ak', suite: 'WOP-SM2-SM3', merchantPrivateKey: MERCH_PRIV, platformPublicKey: PLAT_PUB })).toThrowError(/SM2-SM3 套件暂未支持/);
    expect(() => new WopClient({ appKey: 'ak', suite: 'WOP-RSA3072-SHA256', merchantPrivateKey: '', platformPublicKey: PLAT_PUB })).toThrowError(/merchantPrivateKey/);
    expect(() => new WopClient({ appKey: 'ak', suite: 'WOP-RSA3072-SHA256', merchantPrivateKey: MERCH_PRIV, platformPublicKey: ' ' })).toThrowError(/platformPublicKey/);
  });

  it('密钥内容非法在构造时抛出（DER 解析 fail-fast）', () => {
    expect(() => new WopClient({ appKey: 'ak', suite: 'WOP-RSA3072-SHA256', merchantPrivateKey: 'not-a-key!!', platformPublicKey: PLAT_PUB })).toThrowError(/密钥/);
  });
});

describe('buildRequest（F3/F4/F5/F9）', () => {
  it('L0：头集合完整、digest 对 wire body、signedNames 排序且含 digest（I1）', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('POST', '/v1/order/create', BODY, {
      timestamp: 1770000000000,
      nonce: 'abcdef0123456789abcdef0123456789',
    });
    expect(draft.method).toBe('POST');
    expect(draft.wireBody).toBe(BODY);
    expect(draft.headers['x-wop-appkey']).toBe('test-app-key');
    expect(draft.headers['x-wop-timestamp']).toBe('1770000000000');
    expect(draft.headers['x-wop-nonce']).toBe('abcdef0123456789abcdef0123456789');
    expect(draft.headers['x-wop-content-digest']).toBe(await computeDigestHeader(BODY));
    expect(draft.headers).not.toHaveProperty('x-wop-encrypt');
    expect(draft.headers['x-wop-sign']).toMatch(
      /^WOP-RSA3072-SHA256 v1\/1800\/x-wop-appkey;x-wop-content-digest;x-wop-nonce;x-wop-timestamp\/[A-Za-z0-9_-]{512}$/,
    );
  });

  it('L0 签名可被网关侧公钥验签通过（互操作闭环）', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('POST', '/v1/order/create', BODY, {
      timestamp: 1,
      nonce: 'n',
    });
    expect(await verifyDraftCanonical(draft.headers, 'POST', '/v1/order/create', '', fromBase64(MERCH_PUB))).toBe(true);
  });

  it('幂等（可重放生成）：注入 timestamp/nonce 后两次输出全等', async () => {
    const client = makeClient();
    const opts = { timestamp: 1770000000000, nonce: 'fixednonce' };
    const a = await client.buildRequest('POST', '/p', BODY, opts);
    const b = await client.buildRequest('POST', '/p', BODY, opts);
    expect(a).toEqual(b);
  });

  it('默认 CSPRNG：nonce 为 32 位 hex 且两次不同（F9）', async () => {
    const client = makeClient();
    const a = await client.buildRequest('POST', '/p', BODY);
    const b = await client.buildRequest('POST', '/p', BODY);
    expect(a.headers['x-wop-nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(a.headers['x-wop-nonce']).not.toBe(b.headers['x-wop-nonce']);
  });

  it('GET 无 body：digest 头缺席、signedHeaders 不含 digest（D2）', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('GET', '/v1/order/query', undefined, {
      timestamp: 1,
      nonce: 'n',
    });
    expect(draft.wireBody).toBe('');
    expect(draft.headers).not.toHaveProperty('x-wop-content-digest');
    expect(draft.headers['x-wop-sign']).toMatch(/v1\/1800\/x-wop-appkey;x-wop-nonce;x-wop-timestamp\//);
  });

  it('空串 body 等同无 body（不定义空串摘要中间态）', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('POST', '/p', '', { timestamp: 1, nonce: 'n' });
    expect(draft.headers).not.toHaveProperty('x-wop-content-digest');
  });

  it('path 带 query string：拆分后分别入 canonical', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('GET', '/list?status=PAID&page=2', undefined, {
      timestamp: 1,
      nonce: 'n',
    });
    expect(draft.path).toBe('/list');
    expect(await verifyDraftCanonical(draft.headers, 'GET', '/list', 'status=PAID&page=2', fromBase64(MERCH_PUB))).toBe(true);
  });

  it('path 不以 / 开头 → 解析类拒绝', async () => {
    const client = makeClient();
    await expect(client.buildRequest('POST', 'v1/x', BODY)).rejects.toThrowError(/路径/);
  });

  it('L2：wireBody={"encrypted":…}、digest 对密文载体、encrypt 头入签', async () => {
    const client = makeClient();
    const dek = fromBase64Url(vectors.inputs.aesKeyB64u!);
    const iv = fromBase64Url(vectors.inputs.aesIvB64u!);
    const draft = await client.buildRequest('POST', '/v1/order/create', BODY, {
      level: 'L2',
      timestamp: 1,
      nonce: 'n',
      dek,
      iv,
    });
    expect(draft.wireBody).toMatch(/^\{"encrypted":"[A-Za-z0-9_-]+"\}$/);
    expect(draft.headers['x-wop-content-digest']).toBe(await computeDigestHeader(draft.wireBody));
    expect(draft.headers['x-wop-encrypt']).toMatch(/^L2;dek=[A-Za-z0-9_-]+$/);
    expect(draft.headers['x-wop-sign']).toMatch(
      /x-wop-appkey;x-wop-content-digest;x-wop-encrypt;x-wop-nonce;x-wop-timestamp\//,
    );
    // 网关视角：解包 DEK（平台私钥 4096）→ 解密回环
    const dekB64u = draft.headers['x-wop-encrypt']!.slice('L2;dek='.length);
    const payload = utf8Decode(await oaepUnwrap(fromBase64(PLAT_PRIV), fromBase64Url(dekB64u)));
    expect(payload).toBe(buildDekPayload('AES-256-GCM', dek, iv));
    const parts = payload.split('$');
    const ct = fromBase64Url(JSON.parse(draft.wireBody).encrypted);
    expect(utf8Decode(await aesGcmDecrypt(fromBase64Url(parts[1]!), fromBase64Url(parts[2]!), ct))).toBe(BODY);
  });

  it('L2 无 body → 拒绝', async () => {
    const client = makeClient();
    await expect(client.buildRequest('POST', '/p', undefined, { level: 'L2' })).rejects.toThrowError(/body/);
  });

  it('method 大小写容忍', async () => {
    const client = makeClient();
    const draft = await client.buildRequest('post', '/p', undefined, { timestamp: 1, nonce: 'n' });
    expect(draft.method).toBe('POST');
  });

  it('注入随机源后 L2 可复现部分确定（wireBody/digest；OAEP 包装天然随机化）', async () => {
    const client = makeClient();
    const opts = {
      level: 'L2' as const,
      timestamp: 1770000000000,
      nonce: 'nonce',
      dek: fromBase64Url(vectors.inputs.aesKeyB64u!),
      iv: fromBase64Url(vectors.inputs.aesIvB64u!),
    };
    const a = await client.buildRequest('POST', '/p', BODY, opts);
    const b = await client.buildRequest('POST', '/p', BODY, opts);
    expect(a.wireBody).toBe(b.wireBody); // AES-GCM 注入 key/iv 后确定
    expect(a.headers['x-wop-content-digest']).toBe(b.headers['x-wop-content-digest']);
    expect(a.headers['x-wop-nonce']).toBe(b.headers['x-wop-nonce']);
    expect(a.headers['x-wop-timestamp']).toBe(b.headers['x-wop-timestamp']);
  });
});

describe('verifyResponse / verifyCallback（F6 顺序 + I7 模糊化）', () => {
  const PATH = '/v1/order/create';

  it('L0 正向：验签→digest 复核通过，plaintext == body', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, JSON.stringify({ code: 'SUCCESS' }));
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(true);
    expect(result.plaintext).toBe(body);
  });

  it('headers 大小写不敏感', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    const lifted: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lifted[k.toUpperCase()] = v;
    expect((await client.verifyResponse(lifted, body, PATH)).ok).toBe(true);
  });

  it('L2 正向：解包 DEK→alg 比对→bulk 解密', async () => {
    const client = makeClient();
    const plain = JSON.stringify({ code: 'SUCCESS', model: { orderId: 'x' } });
    const { headers, body } = await platformRespond(PATH, plain, { level: 'L2' });
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(true);
    expect(result.plaintext).toBe(plain);
  });

  it('F6① 签名失败 → 模糊 reason，优先于 digest 复核与解密（I2 先验签）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { tamper: 'digest' });
    const sp = headers['x-wop-sign']!.lastIndexOf('/');
    headers['x-wop-sign'] =
      headers['x-wop-sign']!.slice(0, sp + 1) +
      String.fromCharCode(headers['x-wop-sign']!.charCodeAt(sp + 1) === 65 ? 66 : 65) +
      headers['x-wop-sign']!.slice(sp + 2);
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('签名验证失败');
  });

  it('F6② digest 复核失败 → 明确"摘要不匹配"（签名本身有效）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { tamper: 'digest' });
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('摘要不匹配');
  });

  it('F6② 有 body 但 digest 头缺席 → 明确拒绝（签名对缺席后头集有效）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    delete headers['x-wop-content-digest'];
    const h2 = await resign(PATH, headers);
    const result = await client.verifyResponse(h2, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('x-wop-content-digest');
  });

  it('F6③ DEK 解包失败 → 模糊"解密失败"（与 tag 失败同文案，I7）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { level: 'L2', tamper: 'dek' });
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('解密失败');
    expect(result.reason).not.toMatch(/OAEP|tag|padding/i);
  });

  it('F6④ alg 族比对（SM4-GCM 载荷）→ 明确一致性拒绝（I3，bulk 解密前）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { level: 'L2', tamper: 'sm4alg' });
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SM4-GCM');
    expect(result.reason).not.toBe('解密失败'); // 一致性类语义明确，非模糊
  });

  it('F6⑤ GCM tag 失败 → 模糊"解密失败"（I7：与 DEK 失败同文案）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { level: 'L2', tamper: 'tag' });
    const result = await client.verifyResponse(headers, body, PATH);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('解密失败');
  });

  it('签名头缺失/格式坏 → 明确 reason', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    delete headers['x-wop-sign'];
    expect((await client.verifyResponse(headers, body, PATH)).reason).toContain('x-wop-sign');
    headers['x-wop-sign'] = 'WOP-RSA3072-SHA256 v1/1800/only-three';
    expect((await client.verifyResponse(headers, body, PATH)).reason).toContain('/');
    headers['x-wop-sign'] = 'WOP-RSA3072-SHA256 v2/1800/x-wop-nonce/AAAA';
    expect((await client.verifyResponse(headers, body, PATH)).reason).toContain('v1');
  });

  it('签名定长校验前置：长度不符 → 验签失败（模糊）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    headers['x-wop-sign'] = headers['x-wop-sign']!.slice(0, -1);
    const r = await client.verifyResponse(headers, body, PATH);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('签名验证失败');
  });

  it('signedHeaders 声明的头缺失 → 明确 reason', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    delete headers['x-wop-nonce'];
    const r = await client.verifyResponse(headers, body, PATH);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('x-wop-nonce');
  });

  it('响应套件为 SM2-SM3 → 明确"暂未支持"（Q7）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY);
    headers['x-wop-sign'] = headers['x-wop-sign']!.replace('WOP-RSA4096-SHA256', 'WOP-SM2-SM3');
    const r = await client.verifyResponse(headers, body, PATH);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('SM2-SM3 套件暂未支持');
  });

  it('无 body 的 L0 响应：跳过 digest 复核', async () => {
    const client = makeClient();
    const { headers } = await platformRespond(PATH, '');
    expect((await client.verifyResponse(headers, '', PATH)).ok).toBe(true);
  });

  it('L2 响应 body 缺 encrypted 字段 → 明确 parse reason（digest/签名对该 body 有效）', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond(PATH, BODY, { level: 'L2', tamper: 'noencrypted' });
    const r = await client.verifyResponse(headers, body, PATH);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('encrypted');
  });

  it('verifyCallback：完整 URL 取 pathname 作 canonical path', async () => {
    const client = makeClient();
    const CB = 'https://merchant.example.cn/callback/order?src=async';
    const { headers, body } = await platformRespond('/callback/order', BODY);
    expect((await client.verifyCallback(headers, body, CB)).ok).toBe(true);
    const { headers: h2 } = await platformRespond('/callback/other', BODY);
    expect((await client.verifyCallback(h2, body, CB)).ok).toBe(false);
  });

  it('verifyCallback：纯 path 直接使用', async () => {
    const client = makeClient();
    const { headers, body } = await platformRespond('/cb', BODY);
    expect((await client.verifyCallback(headers, body, '/cb')).ok).toBe(true);
  });
});
