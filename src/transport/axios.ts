import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { WopError } from '../error';
import { MAX_RESPONSE_BYTES } from './fetch';
import type { Transport, TransportRequest, TransportResponse } from './types';

/**
 * axios peer 适配器（独立入口 `@wanlianyida/wop-typescript-sdk/axios`，不污染核心依赖面）。
 * 非 2xx 默认抛错的 axios 行为在此降级为结构化返回，与 FetchTransport 语义对齐。
 */
export class AxiosTransport implements Transport {
  private readonly instance: AxiosInstance;

  constructor(instance?: AxiosInstance) {
    this.instance = instance ?? axios;
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    try {
      const resp = await this.instance.request({
        url: request.url,
        method: request.method,
        headers: request.headers,
        data: request.body,
        responseType: 'text',
        maxContentLength: MAX_RESPONSE_BYTES, // http 适配器流式计数，越限即断流
      });
      return { status: resp.status, headers: flattenHeaders(resp.headers), body: asText(resp.data) };
    } catch (e) {
      const err = e as Error & { response?: { status: number; headers?: unknown; data?: unknown } };
      // axios 流式超限错误（无 response，code=ERR_BAD_RESPONSE）：映射为协议类错误，与 FetchTransport 对齐
      if (/maxContentLength size of \d+ exceeded/.test(err.message ?? '')) {
        throw new WopError(`响应体超过 ${MAX_RESPONSE_BYTES} 字节上限`, 'parse');
      }
      if (err.response) {
        const r = err.response;
        return { status: r.status, headers: flattenHeaders(r.headers), body: asText(r.data) };
      }
      throw new WopError(`请求发送失败：${(e as Error).message ?? e}`, 'system');
    }
  }
}

function flattenHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

function asText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  return JSON.stringify(data);
}
