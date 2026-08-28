import { WopError, SIGNATURE_FAILED } from './error';
import { parseSecurityReq } from './suite';
import type { AlgorithmSuite } from './suite';
import { canonicalRequest } from './canonical';
import { computeDigestHeader, verifyDigestHeader } from './digest';
import { keyMaterialToDer } from './keys';
import {
  rsaSign,
  rsaVerify,
  oaepWrap,
  oaepUnwrap,
  aesGcmEncrypt,
  aesGcmDecrypt,
  randomBytes,
} from './crypto';
import { buildDekPayload, parseDekPayload } from './envelope';
import { toHex, toBase64Url, fromBase64Url, utf8Encode, utf8Decode } from './encode';
import type { Bytes } from './encode';
import type { Transport } from './transport/types';
import { FetchTransport } from './transport/fetch';

/**
 * WopClient：商户侧协议编排（spec §2 概念 API 的 TS 映射）。
 *
 * - buildRequest：canonicalRequest → 商户私钥加签 → RequestDraft（L0/L2）
 * - verifyResponse / verifyCallback：F6 固定顺序
 *   验签 → digest 复核 → DEK 解包 → alg 族比对（bulk 前）→ bulk 解密
 * - I7：验签/解密失败对外模糊，其余（解析/支持/完整性/一致性）语义明确
 * - 确定性：同输入同输出，CSPRNG 项（nonce/IV/DEK）与时间戳可注入（测试/重放）
 */

export interface WopConfig {
  appKey: string;
  /** securityReq，如 WOP-RSA3072-SHA256 */
  suite: string;
  /** 商户私钥（PKCS#8，PEM 或 Base64 单行）——请求加签 / 响应 DEK 解包 */
  merchantPrivateKey: string;
  /** 平台公钥（X.509 SPKI，PEM 或 Base64 单行）——响应/回调验签 / 请求 DEK 包装 */
  platformPublicKey: string;
  gatewayBaseUrl?: string;
}

export interface RequestOptions {
  /** L0 明文（默认）/ L2 数字信封 */
  level?: 'L0' | 'L2';
  /** 签名有效窗口（秒），默认 1800 */
  expiredSeconds?: number;
  /** 测试注入点：生产留空走系统时钟 */
  timestamp?: number;
  /** 测试注入点：生产留空走 CSPRNG（16B → 32 hex） */
  nonce?: string;
  /** 测试注入点：L2 数据密钥（32B），生产留空 CSPRNG */
  dek?: Uint8Array;
  /** 测试注入点：L2 IV（12B），生产留空 CSPRNG（I4：同 key 下永不复用） */
  iv?: Uint8Array;
}

export interface RequestDraft {
  method: string;
  path: string;
  /** 含 x-wop-sign 在内的全部请求头 */
  headers: Record<string, string>;
  /** 线上请求体：L0 原文 / L2 {"encrypted":…} */
  wireBody: string;
}

export interface VerifyResult {
  ok: boolean;
  /** L0 为原文 body，L2 为解密明文 */
  plaintext?: string;
  /** 失败原因：验签/解密类模糊（I7），其余明确 */
  reason?: string;
}

export interface SendResult extends VerifyResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_EXPIRED_SECONDS = 1800;
const ENCRYPT_HEADER_PREFIX = 'l2';

export class WopClient {
  readonly config: WopConfig;
  readonly suite: AlgorithmSuite;
  private readonly merchantPriv: Bytes;
  private readonly platformPub: Bytes;
  private transport: Transport | null = null;

  constructor(config: WopConfig) {
    if (!config || typeof config !== 'object') {
      throw new WopError('WopConfig 不能为空', 'parse');
    }
    if (!config.appKey || !config.appKey.trim()) {
      throw new WopError('appKey 不能为空', 'parse');
    }
    this.suite = parseSecurityReq(config.suite); // 空值/非法/SM2-SM3 在此明确抛错
    if (!config.merchantPrivateKey || !config.merchantPrivateKey.trim()) {
      throw new WopError('merchantPrivateKey 不能为空（PKCS#8，PEM 或 Base64 单行）', 'parse');
    }
    if (!config.platformPublicKey || !config.platformPublicKey.trim()) {
      throw new WopError('platformPublicKey 不能为空（X.509 SPKI，PEM 或 Base64 单行）', 'parse');
    }
    this.config = config;
    this.merchantPriv = keyMaterialToDer(config.merchantPrivateKey);
    this.platformPub = keyMaterialToDer(config.platformPublicKey);
  }

  /** 注入 HTTP 适配层；默认 fetch 原生适配器 */
  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  /**
   * 构造请求（F2–F5/F9）：产出 (headers, wireBody)，零网络 IO。
   * 有 body 必产 digest 且必入 signedHeaders（I1）；L2 时 encrypt 头同样入签。
   */
  async buildRequest(
    method: string,
    path: string,
    body?: string,
    options: RequestOptions = {},
  ): Promise<RequestDraft> {
    const level = options.level ?? 'L0';
    const expired = options.expiredSeconds ?? DEFAULT_EXPIRED_SECONDS;
    const hasBody = body !== undefined && body !== '';

    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new WopError(`请求路径 "${path}" 须以 / 开头`, 'parse');
    }
    if (level === 'L2' && !hasBody) {
      throw new WopError('L2 加密需要非空 body', 'parse');
    }

    const queryIdx = path.indexOf('?');
    const rawPath = queryIdx >= 0 ? path.slice(0, queryIdx) : path;
    const queryString = queryIdx >= 0 ? path.slice(queryIdx + 1) : '';

    // 1. 线上请求体与 L2 信封（§3.3②③/§6）：摘要对象 = wire 原始字节
    let wireBody = '';
    const nonce = options.nonce ?? toHex(await randomBytes(16));
    const headers: Record<string, string> = {
      'x-wop-appkey': this.config.appKey,
      'x-wop-nonce': nonce,
      'x-wop-timestamp': String(options.timestamp ?? Date.now()),
    };
    if (level === 'L2') {
      const dek = options.dek ?? (await randomBytes(32));
      const iv = options.iv ?? (await randomBytes(12));
      const cipherTag = await aesGcmEncrypt(dek, iv, utf8Encode(body!));
      wireBody = JSON.stringify({ encrypted: toBase64Url(cipherTag) });
      const wrapped = await oaepWrap(
        this.platformPub,
        utf8Encode(buildDekPayload('AES-256-GCM', dek, iv)),
      );
      headers['x-wop-encrypt'] = `L2;dek=${toBase64Url(wrapped)}`;
    } else {
      wireBody = body ?? '';
    }
    if (hasBody || level === 'L2') {
      headers['x-wop-content-digest'] = await computeDigestHeader(utf8Encode(wireBody));
    }

    // 2. canonicalRequest → 商户私钥加签（F3）
    const authString = `v1/${expired}`;
    const canonical = canonicalRequest({
      authString,
      method,
      path: rawPath,
      queryString,
      headers,
    });
    const signature = toBase64Url(await rsaSign(this.merchantPriv, utf8Encode(canonical)));
    const signedNames = Object.keys(headers).sort().join(';');
    headers['x-wop-sign'] = `${this.suite.securityReq} ${authString}/${signedNames}/${signature}`;

    return { method: method.toUpperCase(), path: rawPath, headers, wireBody };
  }

  /**
   * 校验网关同步响应（F6）。requestPath = 发起请求的 API path（canonical 的 URI 段）。
   */
  async verifyResponse(
    headers: Record<string, string>,
    body: string,
    requestPath: string,
  ): Promise<VerifyResult> {
    return this.verifyIncoming(headers, body, requestPath);
  }

  /**
   * 校验平台异步回调（F6）。callbackPath 接受完整回调 URL（取 pathname）或纯 path。
   */
  async verifyCallback(
    headers: Record<string, string>,
    body: string,
    callbackPath: string,
  ): Promise<VerifyResult> {
    const path = /^https?:\/\//i.test(callbackPath) ? new URL(callbackPath).pathname : callbackPath;
    return this.verifyIncoming(headers, body, path);
  }

  /**
   * 发送请求并校验响应（Transport 编排便利入口）。
   * 响应含 x-wop-sign 头时自动执行 F6 校验。
   */
  async send(
    method: string,
    path: string,
    body?: string,
    options: RequestOptions = {},
  ): Promise<SendResult> {
    if (!this.config.gatewayBaseUrl) {
      throw new WopError('gatewayBaseUrl 未配置，无法发送（或直接消费 buildRequest 的 RequestDraft）', 'system');
    }
    const transport = this.ensureTransport();
    const draft = await this.buildRequest(method, path, body, options);
    const base = this.config.gatewayBaseUrl.replace(/\/+$/, '');
    const resp = await transport.send({
      method: draft.method,
      url: `${base}${path}`,
      headers: draft.headers,
      body: draft.wireBody,
    });
    if (resp.headers['x-wop-sign'] !== undefined) {
      const verified = await this.verifyResponse(resp.headers, resp.body, draft.path);
      return { ...verified, status: resp.status, headers: resp.headers, body: resp.body };
    }
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, headers: resp.headers, body: resp.body };
  }

  /** F6 固定顺序：验签 → digest 复核 → DEK 解包 → alg 族比对 → bulk 解密 */
  private async verifyIncoming(
    rawHeaders: Record<string, string>,
    body: string,
    path: string,
  ): Promise<VerifyResult> {
    try {
      const headers = lowercaseHeaders(rawHeaders);
      const signHeader = headers['x-wop-sign'];
      if (signHeader === undefined) {
        throw new WopError('响应缺少 x-wop-sign 头', 'parse');
      }

      // —— 解析结构化签名头（§7.3）——
      const spaceIdx = signHeader.indexOf(' ');
      if (spaceIdx <= 0) {
        throw new WopError('x-wop-sign 格式错误：缺少 securityReq 与后续段的空格分隔', 'parse');
      }
      const securityReq = signHeader.slice(0, spaceIdx);
      const suite = parseSecurityReq(securityReq);
      const seg = signHeader.slice(spaceIdx + 1).split('/');
      if (seg.length !== 4) {
        throw new WopError(
          `x-wop-sign 格式错误：应为 <protocolVersion>/<expiredSeconds>/<signedHeaders>/<signature> 四段，实际 ${seg.length} 段`,
          'parse',
        );
      }
      const [protocolVersion, expiredSeconds, signedNamesRaw, sigB64u] = seg as [string, string, string, string];
      if (protocolVersion !== 'v1' || !/^\d+$/.test(expiredSeconds)) {
        throw new WopError('x-wop-sign 格式错误：authString 应为 v1/<expiredSeconds>', 'parse');
      }

      // signedHeaders 声明的头必须齐备（canonical 重建材料）
      const signedNames = signedNamesRaw.split(';').map((s) => s.trim()).filter(Boolean);
      const signedValues: Record<string, string> = {};
      for (const name of signedNames) {
        const value = headers[name];
        if (value === undefined) {
          throw new WopError(`signedHeaders 声明了未提供的头：${name}`, 'parse');
        }
        signedValues[name] = value;
      }

      // —— F6① 验签（平台公钥；定长前置校验 §3.3①）——
      let sigOk = sigB64u.length === suite.signatureB64uLength;
      let canonical = '';
      if (sigOk) {
        canonical = canonicalRequest({
          authString: `${protocolVersion}/${expiredSeconds}`,
          method: 'POST', // 响应/回调出站语义固定 POST（与网关 SignFilter 对齐）
          path,
          queryString: '',
          headers: signedValues,
        });
        try {
          sigOk = await rsaVerify(this.platformPub, fromBase64Url(sigB64u), utf8Encode(canonical));
        } catch {
          sigOk = false;
        }
      }
      if (!sigOk) {
        // I7：对外模糊，不区分密钥不符/格式/值错
        return { ok: false, reason: SIGNATURE_FAILED };
      }

      // —— F6② digest 复核（摘要对象 = wire 原始字节；L2 即密文载体）——
      const hasBody = body.length > 0;
      const digestHeader = headers['x-wop-content-digest'];
      if (hasBody) {
        if (digestHeader === undefined) {
          throw new WopError('有 body 但缺少 x-wop-content-digest 头（D2/I1）', 'integrity');
        }
        verifyDigestHeader(digestHeader, suite); // 格式/跨族 → 明确抛错
        const computed = await computeDigestHeader(body);
        if (computed !== digestHeader) {
          throw new WopError('摘要不匹配：body 可能被篡改或传输不完整', 'integrity');
        }
      }

      // —— L2：F6③ DEK 解包 → F6④ alg 族比对（bulk 前，D8）→ F6⑤ bulk 解密 ——
      const encryptHeader = headers['x-wop-encrypt'];
      if (encryptHeader !== undefined && encryptHeader.toLowerCase().startsWith(ENCRYPT_HEADER_PREFIX)) {
        const dekIdx = encryptHeader.indexOf('dek=');
        if (dekIdx < 0) {
          throw new WopError('x-wop-encrypt 格式错误：L2 须携带 dek=', 'parse');
        }
        const wrapped = fromBase64Url(encryptHeader.slice(dekIdx + 4).trim()); // 失败 → parse 明确
        let payload: string;
        try {
          payload = utf8Decode(await oaepUnwrap(this.merchantPriv, wrapped)); // 失败 → 模糊
        } catch (e) {
          return { ok: false, reason: (e as WopError).message };
        }
        let dek;
        try {
          dek = parseDekPayload(payload); // 格式 → parse 明确
        } catch (e) {
          return { ok: false, reason: (e as WopError).message };
        }
        if (dek.alg !== suite.expectedDekAlg) {
          throw new WopError(
            `DEK alg 与套件族不符：载荷 ${dek.alg}，${suite.securityReq} 期望 ${suite.expectedDekAlg}（I5/I3）`,
            'consistency',
          );
        }
        let wire: { encrypted?: unknown };
        try {
          wire = JSON.parse(body) as { encrypted?: unknown };
        } catch {
          throw new WopError('L2 响应 body 不是合法 JSON（期望 {"encrypted":…}）', 'parse');
        }
        if (typeof wire.encrypted !== 'string' || wire.encrypted === '') {
          throw new WopError('L2 响应 body 缺少 encrypted 字段', 'parse');
        }
        let cipherTag;
        try {
          cipherTag = fromBase64Url(wire.encrypted);
        } catch (e) {
          return { ok: false, reason: (e as WopError).message };
        }
        let plain: Bytes;
        try {
          plain = await aesGcmDecrypt(dek.key, dek.iv, cipherTag); // tag 失败 → 模糊
        } catch (e) {
          return { ok: false, reason: (e as WopError).message };
        }
        return { ok: true, plaintext: utf8Decode(plain) };
      }

      return { ok: true, plaintext: body };
    } catch (e) {
      if (e instanceof WopError) {
        return { ok: false, reason: e.message };
      }
      return { ok: false, reason: '系统繁忙，请稍后重试' }; // SYS 模糊 + 可重试
    }
  }

  private ensureTransport(): Transport {
    if (!this.transport) {
      this.transport = new FetchTransport();
    }
    return this.transport;
  }
}

function lowercaseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.trim().toLowerCase()] = String(v).trim();
  }
  return out;
}
