import { describe, it, expect } from 'vitest';
import { keyMaterialToDer } from '../src/keys';
import { WopError } from '../src/error';
import vectors from './fixtures/crypto-vectors.json';

describe('密钥材料解析（D12：PEM / 单行 Base64 / base64url）', () => {
  it('单行标准 base64（向量 SPKI/PKCS8）→ DER 定长', () => {
    const spki = keyMaterialToDer(vectors.keys.rsa3072!.publicSpkiB64);
    expect(spki.length).toBe(422); // RSA-3072 SPKI DER
    const pkcs8 = keyMaterialToDer(vectors.keys.rsa3072!.privatePkcs8B64);
    expect(pkcs8.length).toBe(1793); // RSA-3072 PKCS#8 DER
  });

  it('PEM 包装 → 与裸 base64 同字节', () => {
    const b64 = vectors.keys.rsa3072!.publicSpkiB64;
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64.replace(/(.{64})/g, '$1\n').trim()}\n-----END PUBLIC KEY-----\n`;
    expect(keyMaterialToDer(pem)).toEqual(keyMaterialToDer(b64));
  });

  it('base64url 字母表密钥兼容', () => {
    const b64 = vectors.keys.rsa3072!.publicSpkiB64;
    const b64u = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(keyMaterialToDer(b64u)).toEqual(keyMaterialToDer(b64));
  });

  it('容忍 PEM 头尾变体与内部换行空白', () => {
    const b64 = vectors.keys.rsa4096!.publicSpkiB64;
    const pem = `-----BEGIN PUBLIC KEY-----\r\n${b64.slice(0, 100)}\r\n ${b64.slice(100)}\r\n-----END PUBLIC KEY-----`;
    expect(keyMaterialToDer(pem)).toEqual(keyMaterialToDer(b64));
  });

  it('空/过短/非 base64 → 解析类拒绝', () => {
    for (const bad of ['', '   ', 'ab!c', 'short']) {
      try {
        keyMaterialToDer(bad);
        expect.unreachable(`应拒绝：${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(WopError);
        expect((e as WopError).category).toBe('parse');
      }
    }
  });

  it('非字符串入参 → 解析类拒绝', () => {
    expect(() => keyMaterialToDer(null as unknown as string)).toThrowError(WopError);
  });
});
