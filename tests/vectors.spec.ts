import { describe, it, expect } from 'vitest';
import {
  rsaSign,
  rsaVerify,
  oaepWrap,
  oaepUnwrap,
  aesGcmEncrypt,
  aesGcmDecrypt,
  randomBytes,
} from '../src/crypto';
import { buildDekPayload, parseDekPayload } from '../src/envelope';
import { fromBase64, fromBase64Url, utf8Encode, utf8Decode } from '../src/encode';
import { WopError } from '../src/error';
import vectors from './fixtures/crypto-vectors.json';

const V = vectors.inputs;
const K = vectors.keys;
const MSG = utf8Encode(V.message!);

const priv3072 = fromBase64(K.rsa3072!.privatePkcs8B64);
const pub3072 = fromBase64(K.rsa3072!.publicSpkiB64);
const priv4096 = fromBase64(K.rsa4096!.privatePkcs8B64);
const pub4096 = fromBase64(K.rsa4096!.publicSpkiB64);

describe('A1 黄金向量：RSA 签名字节级一致', () => {
  it('rsa3072-sign：SHA256withRSA 恒 384B / 512 字符', async () => {
    const vec = vectors.signature.find((s) => s.id === 'rsa3072-sign')!;
    const sig = await rsaSign(priv3072, MSG);
    expect(sig.length).toBe(vec.sigLenBytes);
    expect(sig.length).toBe(384);
    const b64u = vec.expectedSigB64u!;
    expect(b64u.length).toBe(vec.b64uLen);
    // 字节级：与向量逐字节一致
    expect(Buffer.from(sig).toString('base64url')).toBe(b64u);
  });

  it('rsa4096-sign：恒 512B / 683 字符', async () => {
    const vec = vectors.signature.find((s) => s.id === 'rsa4096-sign')!;
    const sig = await rsaSign(priv4096, MSG);
    expect(sig.length).toBe(vec.sigLenBytes);
    expect(Buffer.from(sig).toString('base64url')).toBe(vec.expectedSigB64u);
  });

  it('rsaVerify：正向量验证通过，篡改一字节即失败（A2）', async () => {
    const vec = vectors.signature.find((s) => s.id === 'rsa3072-sign')!;
    const sig = fromBase64Url(vec.expectedSigB64u!);
    expect(await rsaVerify(pub3072, sig, MSG)).toBe(true);
    const tampered = new Uint8Array(sig);
    tampered[10]! ^= 0x01;
    expect(await rsaVerify(pub3072, tampered, MSG)).toBe(false);
    // 消息被改也失败
    const tamperedMsg = new Uint8Array(MSG);
    tamperedMsg[0]! ^= 0x01;
    expect(await rsaVerify(pub3072, sig, tamperedMsg)).toBe(false);
  });

  it('跨密钥：4096 签名用 3072 公钥验证失败', async () => {
    const vec = vectors.signature.find((s) => s.id === 'rsa4096-sign')!;
    const sig = fromBase64Url(vec.expectedSigB64u!);
    expect(await rsaVerify(pub3072, sig, MSG)).toBe(false);
  });
});

describe('A1 黄金向量：RSA-OAEP（显式双 SHA-256 + 空 label）', () => {
  it('oaep3072-unwrap：解包 == 明文 DEK 载荷', async () => {
    const vec = vectors.keyEncrypt.find((k) => k.id === 'oaep3072-unwrap')!;
    const plain = await oaepUnwrap(priv3072, fromBase64Url(vec.cipherB64u!));
    expect(utf8Decode(plain)).toBe(vec.expectedPlaintext);
  });

  it('oaep4096-unwrap：解包 == 明文 DEK 载荷', async () => {
    const vec = vectors.keyEncrypt.find((k) => k.id === 'oaep4096-unwrap')!;
    const plain = await oaepUnwrap(priv4096, fromBase64Url(vec.cipherB64u!));
    expect(utf8Decode(plain)).toBe(vec.expectedPlaintext);
  });

  it('oaep3072-mgf1sha1-trap：错误 MGF1 包装的密文必须解包失败（F2 钉子）', async () => {
    const vec = vectors.keyEncrypt.find((k) => k.id === 'oaep3072-mgf1sha1-trap')!;
    await expect(oaepUnwrap(priv3072, fromBase64Url(vec.cipherB64u!))).rejects.toThrowError(WopError);
  });

  it('oaep3072-wrap-roundtrip：包装→解包 == 明文（OAEP 随机化无法字节钉）', async () => {
    const vec = vectors.keyEncrypt.find((k) => k.id === 'oaep3072-wrap-roundtrip')!;
    const wrapped = await oaepWrap(pub3072, utf8Encode(vec.plaintext!));
    const plain = await oaepUnwrap(priv3072, wrapped);
    expect(utf8Decode(plain)).toBe(vec.plaintext);
  });

  it('unwrap 篡改密文 → 解密失败（I7：对外模糊）', async () => {
    const vec = vectors.keyEncrypt.find((k) => k.id === 'oaep3072-unwrap')!;
    const cipher = fromBase64Url(vec.cipherB64u!);
    cipher[20]! ^= 0x01;
    try {
      await oaepUnwrap(priv3072, cipher);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WopError);
      const err = e as WopError;
      expect(err.category).toBe('decrypt');
      expect(err.message).toBe('解密失败'); // I7 模糊化，不泄露细节
    }
  });
});

describe('A1 黄金向量：AES-256-GCM（ct||tag 尾拼，128bit tag）', () => {
  it('aesgcm-encrypt：固定 key/iv 字节级一致', async () => {
    const vec = vectors.messageEncrypt.find((m) => m.id === 'aesgcm-encrypt')!;
    const out = await aesGcmEncrypt(fromBase64Url(vec.keyB64u!), fromBase64Url(vec.ivB64u!), MSG);
    expect(Buffer.from(out).toString('base64url')).toBe(vec.cipherTagB64u);
  });

  it('aesgcm 解密 roundtrip', async () => {
    const vec = vectors.messageEncrypt.find((m) => m.id === 'aesgcm-encrypt')!;
    const plain = await aesGcmDecrypt(
      fromBase64Url(vec.keyB64u!),
      fromBase64Url(vec.ivB64u!),
      fromBase64Url(vec.cipherTagB64u!),
    );
    expect(utf8Decode(plain)).toBe(V.message);
  });

  it('GCM tag 篡改 → 解密失败（I7 模糊）', async () => {
    const vec = vectors.messageEncrypt.find((m) => m.id === 'aesgcm-encrypt')!;
    const ct = fromBase64Url(vec.cipherTagB64u!);
    ct[ct.length - 1]! ^= 0x01; // 末字节属 tag
    try {
      await aesGcmDecrypt(fromBase64Url(vec.keyB64u!), fromBase64Url(vec.ivB64u!), ct);
      expect.unreachable();
    } catch (e) {
      expect((e as WopError).category).toBe('decrypt');
      expect((e as WopError).message).toBe('解密失败');
    }
  });

  it('密文篡改 → 解密失败', async () => {
    const vec = vectors.messageEncrypt.find((m) => m.id === 'aesgcm-encrypt')!;
    const ct = fromBase64Url(vec.cipherTagB64u!);
    ct[0]! ^= 0x01;
    await expect(
      aesGcmDecrypt(fromBase64Url(vec.keyB64u!), fromBase64Url(vec.ivB64u!), ct),
    ).rejects.toThrowError(/解密失败/);
  });

  it('SM4-GCM 向量段不消费：AES-GCM 入口对 16B key 拒绝（负测试锚）', async () => {
    const vec = vectors.messageEncrypt.find((m) => m.id === 'sm4gcm-encrypt')!;
    const sm4Key = fromBase64Url(vec.keyB64u!);
    expect(sm4Key.length).toBe(16); // SM4 密钥 16B，非 AES-256 的 32B
    await expect(aesGcmEncrypt(sm4Key, fromBase64Url(vec.ivB64u!), MSG)).rejects.toThrowError(WopError);
  });
});

describe('DEK 载荷（§6.1：alg$key$iv）', () => {
  it('dek-rsa 向量：组装 == expected，parse roundtrip', () => {
    const vec = vectors.dekPayload.find((d) => d.id === 'dek-rsa')!;
    const payload = buildDekPayload(vec.alg!, fromBase64Url(vec.keyB64u!), fromBase64Url(vec.ivB64u!));
    expect(payload).toBe(vec.expected);
    const parsed = parseDekPayload(payload);
    expect(parsed.alg).toBe('AES-256-GCM');
    expect(parsed.key.length).toBe(32);
    expect(parsed.iv.length).toBe(12);
  });

  it('dek-sm2 向量（SM 段不消费）：RSA 族期望下 SM4-GCM 属一致性拒绝材料', () => {
    const vec = vectors.dekPayload.find((d) => d.id === 'dek-sm2')!;
    expect(vec.alg).toBe('SM4-GCM');
    const parsed = parseDekPayload(vec.expected!);
    expect(parsed.alg).toBe('SM4-GCM'); // parse 层不判族，族比对在解包后、bulk 前（D8）
  });

  it('负格式：非 3 段/空段/非 base64url 拒绝', () => {
    for (const bad of [
      'AES-256-GCM$key',
      'AES-256-GCM$key$iv$extra',
      '$key$iv',
      'AES-256-GCM$$iv',
      'AES-256-GCM$ab!c$iv',
    ]) {
      expect(() => parseDekPayload(bad), bad).toThrowError(WopError);
    }
  });

  it('key/iv 长度非法拒绝（AES-256-GCM 须 32B key / 12B iv）', () => {
    expect(() => parseDekPayload('AES-256-GCM$AAECAwQFBgc$EBESExQVFhcYGRob')).toThrowError(/密钥长度/);
    expect(() => parseDekPayload('AES-256-GCM$' + V.aesKeyB64u + '$AAECAwQF')).toThrowError(/IV 长度/);
  });
});

describe('CSPRNG', () => {
  it('randomBytes：长度正确且两次不同（F9）', async () => {
    const a = await randomBytes(32);
    const b = await randomBytes(32);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
