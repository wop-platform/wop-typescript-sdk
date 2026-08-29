import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * webcrypto() fallback 失败分支（onErr）的隔离测试。
 *
 * 独立 spec 文件原因：vi.mock 为文件级 hoist，会拦截本文件内所有
 * import('node:crypto')——与「全局缺失→真实 node:crypto 回退成功」的
 * 回归锚测试（tests/edge.spec.ts）互斥，必须分文件。
 * vitest 默认 per-file 模块隔离，本文件拿到的是 loader 未缓存的 fresh 模块。
 */
vi.mock('node:crypto', () => {
  throw new Error('blocked: no node crypto in this sandbox');
});

describe('webcrypto()：全局与 node:crypto 均不可用', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('import 被拒 → 系统类错误（含重试语义：失败不缓存 loader）', async () => {
    vi.stubGlobal('crypto', undefined);
    const { webcrypto } = await import('../src/crypto');
    await expect(webcrypto()).rejects.toThrowError(/WebCrypto/);
    // loader 失败置空不缓存：再次调用仍走 import 路径并再次抛系统类错误
    await expect(webcrypto()).rejects.toThrowError(/WebCrypto/);
  });

  it('连带 randomBytes 同样抛系统类错误', async () => {
    vi.stubGlobal('crypto', undefined);
    const { randomBytes } = await import('../src/crypto');
    await expect(randomBytes(16)).rejects.toThrowError(/WebCrypto/);
  });
});
