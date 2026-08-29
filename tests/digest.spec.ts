import { describe, it, expect } from 'vitest';
import { computeDigestHeader, verifyDigestHeader } from '../src/digest';
import { parseSecurityReq } from '../src/suite';
import { WopError } from '../src/error';
import { utf8Encode, fromBase64Url, utf8Decode } from '../src/encode';
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

describe('formatRules 全量消费（三件套：循环全量 + 未知 id 哨兵 + 条数哨兵）', () => {
  type Rule = { id: string; value: string; expect: string; suite?: string; note?: string };
  const rules = vectors.formatRules as Rule[];

  it('条数哨兵：formatRules 必须为 12 条（fixture 与真源漂移即炸）', () => {
    expect(rules).toHaveLength(12);
  });

  it('循环全量：每条向量被消费且向量自述 expect 与本仓实际行为一致（未知 id 即炸）', () => {
    for (const r of rules) {
      let outcome: 'accept' | 'reject';
      switch (r.id) {
        case 'header-rsa-ok': {
          const parsed = verifyDigestHeader(r.value, RSA_SUITE);
          expect(parsed!.hex, r.id).toBe(r.value.slice('sha-256 '.length));
          outcome = 'accept';
          break;
        }
        case 'header-sm2-ok':
          // Q7：TS 首版无 SM2 套件——套件解析必须显式拒（本仓行为 reject；向量自述 accept 为 SM2 仓语义）
          expect(() => parseSecurityReq(r.suite!), r.id).toThrowError(/SM2-SM3 套件暂未支持/);
          outcome = 'reject';
          break;
        case 'header-crossfamily': {
          let caught: unknown;
          try {
            verifyDigestHeader(r.value, RSA_SUITE);
          } catch (e) {
            caught = e;
          }
          expect(caught, r.id).toBeInstanceOf(WopError);
          expect((caught as WopError).category, r.id).toBe('unsupported');
          expect((caught as WopError).message, r.id).toContain('跨族');
          outcome = 'reject';
          break;
        }
        case 'header-double-space':
        case 'header-wrong-hex-len':
          expect(() => verifyDigestHeader(r.value, RSA_SUITE), r.id).toThrowError(WopError);
          outcome = 'reject';
          break;
        case 'header-uppercase-hex': {
          let caught: unknown;
          try {
            verifyDigestHeader(r.value, RSA_SUITE);
          } catch (e) {
            caught = e;
          }
          expect(caught, r.id).toBeInstanceOf(WopError);
          expect((caught as WopError).category, r.id).toBe('parse');
          expect((caught as WopError).message, r.id).toContain('小写');
          outcome = 'reject';
          break;
        }
        case 'b64url-with-padding':
        case 'b64url-illegal-char':
        case 'b64url-trailing-bits-noncanonical-2': // D10/F6 严格性补钉（spec 升格向量）
        case 'b64url-trailing-bits-noncanonical-3':
          expect(() => fromBase64Url(r.value), r.id).toThrowError(/base64url/);
          outcome = 'reject';
          break;
        case 'b64url-trailing-bits-canonical-2': {
          const bytes = fromBase64Url(r.value);
          expect(Array.from(bytes), r.id).toEqual([0x00]); // 1 字节 0x00
          outcome = 'accept';
          break;
        }
        case 'b64url-trailing-bits-canonical-3': {
          const bytes = fromBase64Url(r.value);
          expect(Array.from(bytes), r.id).toEqual([0x4d, 0x61]);
          expect(utf8Decode(bytes), r.id).toBe('Ma'); // 2 字节 "Ma"
          outcome = 'accept';
          break;
        }
        default:
          throw new Error(`未预期 formatRules 向量：${r.id}（真源升级后须同步补消费分支）`);
      }
      expect(outcome, `${r.id}（${r.note ?? r.value}）`).toBe(r.id === 'header-sm2-ok' ? 'reject' : r.expect);
    }
  });
});

describe('digest header 校验（D2 格式钉）', () => {

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
