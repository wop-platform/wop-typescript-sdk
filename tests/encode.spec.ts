import { describe, it, expect } from 'vitest';
import {
  toBase64Url,
  fromBase64Url,
  toHex,
  fromHex,
  toBase64,
  fromBase64,
  utf8Encode,
  utf8Decode,
} from '../src/encode';
import vectors from './fixtures/crypto-vectors.json';

describe('base64url 编解码', () => {
  it('roundtrip：空/1B/2B/3B/全 256 字节值', () => {
    expect(toBase64Url(new Uint8Array(0))).toBe('');
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    for (const bytes of [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([0, 1]), new Uint8Array([0, 1, 2]), all]) {
      const s = toBase64Url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      expect(Array.from(fromBase64Url(s))).toEqual(Array.from(bytes));
    }
  });

  it('已知向量：32 字节密钥', () => {
    const key = fromBase64Url(vectors.inputs.aesKeyB64u);
    expect(toBase64Url(key)).toBe(vectors.inputs.aesKeyB64u);
  });

  it('严格模式：拒收带 = 的输入（F6）', () => {
    expect(() => fromBase64Url('abc=')).toThrowError(/base64url/);
    expect(() => fromBase64Url('AB==')).toThrowError(/base64url/);
  });

  it('严格模式：拒收非法字符（F6）', () => {
    expect(() => fromBase64Url('ab+c')).toThrowError(/base64url/);
    expect(() => fromBase64Url('ab/c')).toThrowError(/base64url/);
  });

  it('严格模式：拒收长度 %4==1', () => {
    expect(() => fromBase64Url('a')).toThrowError(/base64url/);
  });

  it('空串解码为空字节', () => {
    expect(fromBase64Url('')).toEqual(new Uint8Array(0));
  });
});

describe('hex 编解码', () => {
  it('toHex 输出小写', () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa5, 0xff]))).toBe('000fa5ff');
  });

  it('SHA-256 摘要向量 hex 一致（32B → 64 字符小写）', () => {
    const hex = vectors.digest[0]!.expectedHex;
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(toHex(fromHex(hex))).toBe(hex);
  });

  it('fromHex 拒绝非 hex 字符与奇数长度', () => {
    expect(() => fromHex('0g')).toThrowError(/hex/);
    expect(() => fromHex('abc')).toThrowError(/hex/);
  });
});

describe('标准 base64（密钥材料）', () => {
  it('roundtrip 含 padding', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const s = toBase64(bytes);
    expect(s).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(fromBase64(s)).toEqual(bytes);
  });

  it('解析向量 RSA SPKI 密钥', () => {
    const spki = fromBase64(vectors.keys.rsa3072!.publicSpkiB64);
    expect(spki.length).toBeGreaterThan(300);
  });
});

describe('utf8', () => {
  it('中文与 emoji roundtrip', () => {
    const s = 'WOP 跨语言测试向量 2026-08-28 — The quick brown fox';
    const bytes = utf8Encode(s);
    expect(utf8Decode(bytes)).toBe(s);
  });
});
