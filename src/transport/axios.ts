import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { WopError } from '../error';
import type { Transport, TransportRequest, TransportResponse } from './types';

/**
 * axios peer 适配器（独立入口 `wop-typescript-sdk/axios`，不污染核心依赖面）。
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
      });
      return { status: resp.status, headers: flattenHeaders(resp.headers), body: asText(resp.data) };
    } catch (e) {
      const withResponse = e as { response?: { status: number; headers?: unknown; data?: unknown } };
      if (withResponse.response) {
        const r = withResponse.response;
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
