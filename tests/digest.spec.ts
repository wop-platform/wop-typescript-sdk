import { describe, it, expect } from 'vitest';
import { computeDigestHeader, verifyDigestHeader } from '../src/digest';
import { parseSecurityReq } from '../src/suite';
import { WopError } from '../src/error';
import { utf8Encode } from '../src/encode';
import vectors from './fixtures/crypto-vectors.json';

const RSA_SUITE = parseSecurityReq('WOP-RSA3072-SHA256');
const digestVector = vectors.digest.find((d) => d.id === 'digest-sha256')!;

describe('x-wop-content-digest 计算（F4，向量字节级）', () => {
  it('sha-256 <64 位小写hex> 与黄金向量一致（A1）', async () => {
    const header = await computeDigestHeader(utf8Encode(digestVector.input));
    expect(header).toBe(digestVector.expectedHeader);
    expect(header).toBe(`sha-256 ${digestVector.expectedHex}`);
  });

  it('对字节（非字符串）计算：同一 UTF-8 字节结果一致', async () => {
    const asString = await computeDigestHeader(digestVector.input);
    const asBytes = await computeDigestHeader(utf8Encode(digestVector.input));
    expect(asBytes).toBe(asString);
  });
});

describe('digest header 校验（D2 格式钉 + formatRules 向量）', () => {
  type Rule = { id: string; value: string; expect: string; suite?: string; note?: string };

  it('header-rsa-ok：合法值通过（A1）', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-rsa-ok') as Rule;
    const parsed = verifyDigestHeader(rule.value, RSA_SUITE)!;
    expect(parsed.hex).toBe('23592263765cf506d07cc8614c09067e6de38e64c53e5b672c022532d01737cf');
  });

  it('header-sm2-ok：SM2 套件在 TS 首版必须拒（Q7 负测试）', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-sm2-ok') as Rule;
    expect(rule.suite).toBe('WOP-SM2-SM3');
    expect(() => parseSecurityReq(rule.suite!)).toThrowError(/SM2-SM3 套件暂未支持/);
  });

  it('header-crossfamily：sm3 标签配 RSA 套件拒绝（I5）', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-crossfamily') as Rule;
    expect(() => verifyDigestHeader(rule.value, RSA_SUITE)).toThrowError(WopError);
    try {
      verifyDigestHeader(rule.value, RSA_SUITE);
    } catch (e) {
      expect((e as WopError).category).toBe('unsupported');
      expect((e as WopError).message).toContain('跨族');
    }
  });

  it('header-double-space：恰一空格，多余空白拒绝（D2）', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-double-space') as Rule;
    expect(() => verifyDigestHeader(rule.value, RSA_SUITE)).toThrowError(WopError);
  });

  it('header-uppercase-hex：大写 hex 拒绝（F5 小写钉）', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-uppercase-hex') as Rule;
    try {
      verifyDigestHeader(rule.value, RSA_SUITE);
      expect.unreachable();
    } catch (e) {
      expect((e as WopError).category).toBe('parse');
      expect((e as WopError).message).toContain('小写');
    }
  });

  it('header-wrong-hex-len：长度非 64 拒绝', () => {
    const rule = vectors.formatRules.find((r) => r.id === 'header-wrong-hex-len') as Rule;
    expect(() => verifyDigestHeader(rule.value, RSA_SUITE)).toThrowError(WopError);
  });

  it('更多负格式：缺空格/未知标签/非 hex 字符/空值', () => {
    for (const bad of [
      'sha-256',
      'sha-256 ',
      ' sha-256 ab'.slice(1),
      'sha256 ' + '0'.repeat(64),
      'sha-256 ' + 'g'.repeat(64),
      'sha-256 ' + '0'.repeat(63),
      'sha-256 ' + '0'.repeat(65),
      '',
    ]) {
      expect(() => verifyDigestHeader(bad, RSA_SUITE), `value="${bad}"`).toThrowError(WopError);
    }
  });

  it('undefined（无 body 场景缺席）：返回 null 而非抛错', () => {
    expect(verifyDigestHeader(undefined, RSA_SUITE)).toBeNull();
  });
});
