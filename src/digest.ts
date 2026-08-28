import { WopError } from './error';
import { toHex } from './encode';
import { webcrypto } from './crypto';
import type { AlgorithmSuite } from './suite';

/**
 * x-wop-content-digest（F4，D2 格式钉）。
 *
 * - 值结构 = 算法标记 + **恰好一个**半角空格 + 小写十六进制；多余空白拒绝而非容忍
 * - 标签与套件族强耦合：sha-256 仅 RSA 族、sm3 仅 SM2 族（I5）
 * - 摘要对象 = 线上原始报文字节（wire body 整体，L2 时即密文载体）
 * - 无 body（GET）→ header 缺席；有 body 必传必入 signedHeaders（I1，由 client 保证）
 */

/** 计算 wire body 的 SHA-256 摘要并组装 header 值：`sha-256 <64 位小写 hex>` */
export async function computeDigestHeader(body: Uint8Array | string): Promise<string> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const { subtle } = await webcrypto();
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes as unknown as BufferSource));
  return `sha-256 ${toHex(digest)}`;
}

export interface ParsedDigestHeader {
  alg: string;
  hex: string;
}

/**
 * 严格校验 digest header 值格式。undefined（无 body 缺席）返回 null。
 * 格式错误 → parse；跨族标签 → unsupported。
 */
export function verifyDigestHeader(
  value: string | undefined,
  suite: AlgorithmSuite,
): ParsedDigestHeader | null {
  if (value === undefined) return null;
  const m = /^(sha-256|sm3) ([0-9a-f]+)$/.exec(value);
  if (!m) {
    // 双空格/大小写/长度错误统一归格式错误，但给出可自查的明确语义
    if (/^sha-256\s{2,}/.test(value) || /^sm3\s{2,}/.test(value)) {
      throw new WopError(`digest header "${value}" 格式错误：算法标记与 hex 之间须恰好一个空格`, 'parse');
    }
    if (/^sha-256 [0-9A-F]+$/.test(value) || /^sm3 [0-9A-F]+$/.test(value)) {
      throw new WopError(`digest header "${value}" 格式错误：hex 须为小写`, 'parse');
    }
    throw new WopError(
      `digest header "${value}" 格式错误：期望 <alg> <64 位小写 hex>，alg 随套件族（D2）`,
      'parse',
    );
  }
  const [, alg, hex] = m as unknown as [string, string, string];
  if (hex.length !== 64) {
    throw new WopError(`digest header "${value}" 格式错误：hex 长度须为 64（SHA-256）`, 'parse');
  }
  if (alg !== suite.digestLabel) {
    throw new WopError(
      `digest header "${value}" 与套件 ${suite.securityReq} 跨族：期望 ${suite.digestLabel}（I5）`,
      'unsupported',
    );
  }
  return { alg, hex };
}

