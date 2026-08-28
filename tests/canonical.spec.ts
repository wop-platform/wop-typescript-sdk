import { describe, it, expect } from 'vitest';
import { canonicalRequest, javaUrlEncode, trimall, canonicalHeaders } from '../src/canonical';

describe('javaUrlEncode（Java URLEncoder 语义，F2）', () => {
  it('字母数字与 .-_ * 不编码', () => {
    expect(javaUrlEncode('abcXYZ019.-_*')).toBe('abcXYZ019.-_*');
  });

  it('空格 → %20（非 +）', () => {
    expect(javaUrlEncode('a b')).toBe('a%20b');
  });

  it("encodeURIComponent 默认保留的 ! ' ( ) ~ 补编码为大写 %XX（* 保留）", () => {
    expect(javaUrlEncode("!*'()~")).toBe('%21*%27%28%29%7E');
  });

  it('中文与全角字符编码为大写 %XX', () => {
    expect(javaUrlEncode('密')).toBe('%E5%AF%86');
    expect(javaUrlEncode('—')).toBe('%E2%80%94');
  });

  it('digest/encrypt header 值：空格→%20、;→%3B、$→%24、=→%3D', () => {
    expect(javaUrlEncode('sha-256 ab')).toBe('sha-256%20ab');
    expect(javaUrlEncode('L2;dek=x')).toBe('L2%3Bdek%3Dx');
    expect(javaUrlEncode('a$b')).toBe('a%24b');
  });

  it('null/undefined 按空串处理', () => {
    expect(javaUrlEncode(null as unknown as string)).toBe('');
    expect(javaUrlEncode(undefined as unknown as string)).toBe('');
  });
});

describe('trimall（header 值规范化）', () => {
  it('首尾去空白、内部连续空白折叠为单空格', () => {
    expect(trimall('  a   b  ')).toBe('a b');
    expect(trimall('a\t\nb')).toBe('a b');
  });

  it('null/undefined → 空串', () => {
    expect(trimall(null)).toBe('');
    expect(trimall(undefined)).toBe('');
  });
});

describe('canonicalHeaders', () => {
  it('header 名小写化并按 ASCII 升序排序，k:urlencode(v) 每行一个', () => {
    const out = canonicalHeaders({
      'X-Wop-Timestamp': '1770000000000',
      'x-wop-appkey': 'ak',
      'X-Wop-Nonce': 'n1',
    });
    expect(out).toBe('x-wop-appkey:ak\nx-wop-nonce:n1\nx-wop-timestamp:1770000000000');
  });

  it('header 名与值均 trimall 后编码', () => {
    const out = canonicalHeaders({ '  X-A ': '  v  1  ' });
    expect(out).toBe('x-a:v%201');
  });

  it('空对象 → 空串', () => {
    expect(canonicalHeaders({})).toBe('');
  });
});

describe('canonicalRequest（5 段 \\n 连接，F2）', () => {
  it('authString \\n METHOD \\n path \\n queryString \\n canonicalHeaders', () => {
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'post',
      path: '/v1/order/create',
      queryString: '',
      headers: {
        'x-wop-appkey': 'ak',
        'x-wop-nonce': 'n',
        'x-wop-timestamp': '1',
      },
    });
    expect(canonical).toBe(
      [
        'v1/1800',
        'POST',
        '/v1/order/create',
        '',
        'x-wop-appkey:ak\nx-wop-nonce:n\nx-wop-timestamp:1',
      ].join('\n'),
    );
  });

  it('method 大写化；queryString 原样占位（POST 为空串）', () => {
    const canonical = canonicalRequest({
      authString: 'v1/60',
      method: 'GET',
      path: '/p',
      queryString: 'a=1&b=2',
      headers: {},
    });
    expect(canonical).toBe('v1/60\nGET\n/p\na=1&b=2\n');
  });
});
