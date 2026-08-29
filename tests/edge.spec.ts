import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { fromBase64, fromBase64Url, toBase64Url, toHex, utf8Encode } from '../src/encode';
import { keyMaterialToDer } from '../src/keys';
import { computeDigestHeader } from '../src/digest';
import { canonicalRequest } from '../src/canonical';
import { WopClient } from '../src/client';
import { aesGcmDecrypt, aesGcmEncrypt, oaepWrap, randomBytes, rsaSign, webcrypto } from '../src/crypto';
import { AxiosTransport } from '../src/transport/axios';
import { FetchTransport } from '../src/transport/fetch';
import { WopError } from '../src/error';
import vectors from './fixtures/crypto-vectors.json';

const KEY = fromBase64Url(vectors.inputs.aesKeyB64u!);
const IV = fromBase64Url(vectors.inputs.aesIvB64u!);

describe('encode 边界', () => {
  it('fromBase64：非法字符拒绝', () => {
    expect(() => fromBase64('ab*c')).toThrowError(/base64/);
  });

  it('fromBase64：长度 %4==1 拒绝', () => {
    expect(() => fromBase64('abcde')).toThrowError(/长度非法/);
  });
});

describe('keys 边界', () => {
  it('合法 base64 但 DER 解码后过短 → 拒绝（40 字符 b64 = 30 字节 DER）', () => {
    expect(() => keyMaterialToDer('A'.repeat(40))).toThrowError(/过短/);
  });
});

describe('crypto 边界', () => {
  it('aesGcmDecrypt：密文短于 16 字节（不足 tag）→ 解密失败（I7 模糊）', async () => {
    await expect(aesGcmDecrypt(KEY, IV, new Uint8Array(15))).rejects.toThrowError(/解密失败/);
  });

  it('assertAesGcmParams：IV 非 12 字节 → 解析类拒绝', async () => {
    await expect(aesGcmEncrypt(KEY, new Uint8Array(13), new Uint8Array(1))).rejects.toThrowError(/IV 长度/);
    await expect(aesGcmDecrypt(KEY, new Uint8Array(0), new Uint8Array(32))).rejects.toThrowError(/IV 长度/);
  });

  it('webcrypto()：Node 18 路径——全局缺失时回退 node:crypto.webcrypto（CI 根因回归锚）', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const c = await webcrypto();
      expect(typeof c.subtle.digest).toBe('function');
      const n = await randomBytes(16);
      expect(n.length).toBe(16);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

});

describe('client 边界（F6/L2 深层分支）', () => {
  function makeClient(): WopClient {
    return new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa3072!.publicSpkiB64,
    });
  }

  it('verifyResponse：headers 为 null → SYS 模糊"系统繁忙"', async () => {
    const r = await makeClient().verifyResponse(null as unknown as Record<string, string>, '', '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('系统繁忙，请稍后重试');
  });

  it('L2 头存在但缺 dek= → 明确格式错误', async () => {
    const body = 'plain';
    const headers: Record<string, string> = {
      'x-wop-encrypt': 'L2',
      'x-wop-nonce': 'n',
      'x-wop-timestamp': '1',
      'x-wop-content-digest': await computeDigestHeader(body),
    };
    const names = Object.keys(headers).sort();
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'POST',
      path: '/p',
      queryString: '',
      headers,
    });
    const sig = await rsaSign(
      fromBase64(vectors.keys.rsa3072!.privatePkcs8B64),
      utf8Encode(canonical),
    );
    headers['x-wop-sign'] = `WOP-RSA3072-SHA256 v1/1800/${names.join(';')}/${toBase64Url(sig)}`;
    const r = await makeClient().verifyResponse(headers, body, '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('dek=');
  });

  it('L2 encrypted 值带 = 填充 → base64url 严格拒绝', async () => {
    const body = '{"encrypted":"ab="}';
    const headers: Record<string, string> = {
      'x-wop-encrypt': 'L2;dek=' + toBase64Url(await oaepWrap(fromBase64(vectors.keys.rsa3072!.publicSpkiB64), utf8Encode('AES-256-GCM$' + vectors.inputs.aesKeyB64u + '$' + vectors.inputs.aesIvB64u))),
      'x-wop-nonce': 'n',
      'x-wop-timestamp': '1',
      'x-wop-content-digest': await computeDigestHeader(body),
    };
    const names = Object.keys(headers).sort();
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'POST',
      path: '/p',
      queryString: '',
      headers,
    });
    const sig = await rsaSign(
      fromBase64(vectors.keys.rsa3072!.privatePkcs8B64),
      utf8Encode(canonical),
    );
    headers['x-wop-sign'] = `WOP-RSA3072-SHA256 v1/1800/${names.join(';')}/${toBase64Url(sig)}`;
    const r = await makeClient().verifyResponse(headers, body, '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('base64url');
  });

  it('L2 body 非法 JSON → 明确格式错误', async () => {
    const body = 'not-json';
    const headers: Record<string, string> = {
      'x-wop-encrypt': 'L2;dek=' + toBase64Url(await oaepWrap(fromBase64(vectors.keys.rsa3072!.publicSpkiB64), utf8Encode('AES-256-GCM$' + vectors.inputs.aesKeyB64u + '$' + vectors.inputs.aesIvB64u))),
      'x-wop-nonce': 'n',
      'x-wop-timestamp': '1',
      'x-wop-content-digest': await computeDigestHeader(body),
    };
    const names = Object.keys(headers).sort();
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'POST',
      path: '/p',
      queryString: '',
      headers,
    });
    const sig = await rsaSign(
      fromBase64(vectors.keys.rsa3072!.privatePkcs8B64),
      utf8Encode(canonical),
    );
    headers['x-wop-sign'] = `WOP-RSA3072-SHA256 v1/1800/${names.join(';')}/${toBase64Url(sig)}`;
    const r = await makeClient().verifyResponse(headers, body, '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('JSON');
  });
});


describe('client 深层分支补测', () => {
  function makeClient(): WopClient {
    return new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa3072!.publicSpkiB64,
    });
  }

  it('x-wop-sign 无空格分隔 → 明确格式错误', async () => {
    const r = await makeClient().verifyResponse({ 'x-wop-sign': 'WOP-RSA3072-SHA256' }, '', '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('空格');
  });

  it('签名段含 = 填充 → 协议类明确拒绝（b64url 非法结构，interop n06 裁决）', async () => {
    const r = await makeClient().verifyResponse(
      { 'x-wop-sign': `WOP-RSA3072-SHA256 v1/1800/x-wop-nonce/${'A'.repeat(511)}=`, 'x-wop-nonce': 'n' },
      '',
      '/p',
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('base64url'); // 公开结构知识，明确语义
    expect(r.reason).not.toBe('签名验证失败'); // 非验签模糊（I7）
  });



  it('L2 默认 CSPRNG 生成 DEK/IV（不注入）成功出签', async () => {
    const c = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa3072!.publicSpkiB64,
    });
    const draft = await c.buildRequest('POST', '/p', '{"a":1}', { level: 'L2' });
    expect(draft.headers['x-wop-encrypt']).toMatch(/^L2;dek=[A-Za-z0-9_-]+$/);
    expect(draft.wireBody).toMatch(/^\{"encrypted":"/);
  });
  it('DEK 解包成功但载荷格式坏（无 $ 分隔）→ 解密类模糊（I7 保守默认，interop n13 裁决）', async () => {
    const wrapped = await oaepWrap(
      fromBase64(vectors.keys.rsa3072!.publicSpkiB64),
      utf8Encode('garbage-no-delimiter'),
    );
    const body = '';
    const headers: Record<string, string> = {
      'x-wop-encrypt': 'L2;dek=' + toBase64Url(wrapped),
      'x-wop-nonce': 'n',
      'x-wop-timestamp': '1',
    };
    const names = Object.keys(headers).sort();
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'POST',
      path: '/p',
      queryString: '',
      headers,
    });
    const sig = await rsaSign(fromBase64(vectors.keys.rsa3072!.privatePkcs8B64), utf8Encode(canonical));
    headers['x-wop-sign'] = `WOP-RSA3072-SHA256 v1/1800/${names.join(';')}/${toBase64Url(sig)}`;
    const r = await makeClient().verifyResponse(headers, body, '/p');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('解密失败'); // 载荷结构解包后才可见，对外模糊
    expect(r.reason).not.toMatch(/alg\$key\$iv/); // 不泄漏载荷结构细节
  });

  it('WopConfig 为 null → 立即抛错', () => {
    expect(() => new WopClient(null as unknown as never)).toThrowError(WopError);
  });

  it('verifyCallback：非法 URL → 直接抛出（不吞非协议异常）', async () => {
    await expect(
      makeClient().verifyCallback({}, '', 'http://'),
    ).rejects.toThrowError();
  });
});
describe('transport 边界', () => {
  it('AxiosTransport 默认构造（不注入 instance）可用', () => {
    expect(new AxiosTransport()).toBeInstanceOf(AxiosTransport);
  });

  it('AxiosTransport：网络错误无 message 字段 → 仍产出系统类错误', async () => {
    const request = vi.fn(async () => {
      throw {};
    });
    const t = new AxiosTransport({ request } as unknown as import('axios').AxiosInstance);
    await expect(t.send({ method: 'GET', url: 'https://x', headers: {}, body: '' })).rejects.toThrowError(
      /请求发送失败/,
    );
  });

  it('AxiosTransport 错误响应 headers/data 缺失时容错', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('e'), {
        response: { status: 502, headers: undefined, data: null },
      });
    });
    const t = new AxiosTransport({ request } as unknown as AxiosInstance);
    const resp = await t.send({ method: 'GET', url: 'https://x', headers: {}, body: '' });
    expect(resp.status).toBe(502);
    expect(resp.headers).toEqual({});
    expect(resp.body).toBe('');
  });

  it('FetchTransport：fetch 抛非 Error 对象（无 message）→ 仍产出系统类错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw 'boom-string';
    }));
    await expect(
      new FetchTransport().send({ method: 'GET', url: 'https://x', headers: {}, body: '' }),
    ).rejects.toBeInstanceOf(WopError);
  });
});

describe('toHex 消费键材料校验', () => {
  it('向量密钥 hex 形态稳定', () => {
    expect(toHex(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
