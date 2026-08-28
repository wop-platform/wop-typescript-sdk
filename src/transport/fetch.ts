import { WopError } from '../error';
import type { Transport, TransportRequest, TransportResponse } from './types';

/**
 * fetch 原生适配器（零依赖，Node ≥18 / 浏览器）。
 */
export class FetchTransport implements Transport {
  async send(request: TransportRequest): Promise<TransportResponse> {
    const init: RequestInit = { method: request.method, headers: request.headers };
    if (request.body !== '') {
      init.body = request.body;
    }
    let resp: Response;
    try {
      resp = await fetch(request.url, init);
    } catch (e) {
      throw new WopError(`请求发送失败：${(e as Error).message ?? e}`, 'system');
    }
    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: resp.status, headers, body: await resp.text() };
  }
}
