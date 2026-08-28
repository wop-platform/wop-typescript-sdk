import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchTransport } from '../src/transport/fetch';
import type { Transport } from '../src/transport/types';
import { WopClient } from '../src/client';
import { rsaSign } from '../src/crypto';
import { canonicalRequest } from '../src/canonical';
import { computeDigestHeader } from '../src/digest';
import { fromBase64, toBase64Url, utf8Encode } from '../src/encode';
import vectors from './fixtures/crypto-vectors.json';

const PLAT_PRIV = vectors.keys.rsa4096!.privatePkcs8B64;

describe('FetchTransport（原生 fetch 适配器）', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('透传 method/url/headers/body，响应头小写化', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'X-Wop-Sign': 'WOP-RSA3072-SHA256 v1/1/a/AAAA', 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const t = new FetchTransport();
    const resp = await t.send({
      method: 'POST',
      url: 'https://gw.example.com/v1/x',
      headers: { 'x-wop-appkey': 'ak' },
      body: '{"a":1}',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.example.com/v1/x');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'x-wop-appkey': 'ak' });
    expect(init.body).toBe('{"a":1}');
    expect(resp.status).toBe(200);
    expect(resp.headers['x-wop-sign']).toBe('WOP-RSA3072-SHA256 v1/1/a/AAAA');
    expect(resp.body).toBe('{"ok":true}');
  });

  it('空 body 时不携带 body 字段（GET 语义）', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const resp = await new FetchTransport().send({
      method: 'GET',
      url: 'https://gw.example.com/p',
      headers: {},
      body: '',
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]!;
    expect(init.body).toBeUndefined();
    expect(resp.status).toBe(204);
    expect(resp.body).toBe('');
  });

  it('网络错误 → 系统类 WopError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new FetchTransport().send({ method: 'GET', url: 'https://x', headers: {}, body: '' }),
    ).rejects.toThrowError(/请求发送失败/);
  });
});

describe('AxiosTransport（peer 适配器，mock axios）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('透传请求并归一响应（2xx）', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: { 'X-Wop-Sign': 's', Set_Cookie: ['a=1', 'b=2'] },
      data: 'raw-text',
    }));
    const { AxiosTransport } = await import('../src/transport/axios');
    const t = new AxiosTransport({ request } as unknown as import('axios').AxiosInstance);
    const resp = await t.send({ method: 'POST', url: 'https://gw/v1', headers: { k: 'v' }, body: 'b' });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://gw/v1', method: 'POST', responseType: 'text' }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers['x-wop-sign']).toBe('s');
    expect(resp.headers['set_cookie']).toBe('a=1, b=2');
    expect(resp.body).toBe('raw-text');
  });

  it('非 2xx（axios 抛错带 response）降级为结构化返回', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500, headers: { 'X-Trace-Id': 't1' }, data: 'boom' },
      });
    });
    const { AxiosTransport } = await import('../src/transport/axios');
    const t = new AxiosTransport({ request } as unknown as import('axios').AxiosInstance);
    const resp = await t.send({ method: 'GET', url: 'https://gw/e', headers: {}, body: '' });
    expect(resp.status).toBe(500);
    expect(resp.headers['x-trace-id']).toBe('t1');
    expect(resp.body).toBe('boom');
  });

  it('网络错误（无 response）→ 系统类错误', async () => {
    const request = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const { AxiosTransport } = await import('../src/transport/axios');
    const t = new AxiosTransport({ request } as unknown as import('axios').AxiosInstance);
    await expect(t.send({ method: 'GET', url: 'https://x', headers: {}, body: '' })).rejects.toThrowError(
      /请求发送失败/,
    );
  });

  it('非字符串 data（transformResponse 被绕过时）序列化为文本', async () => {
    const request = vi.fn(async () => ({ status: 200, headers: {}, data: { a: 1 } }));
    const { AxiosTransport } = await import('../src/transport/axios');
    const t = new AxiosTransport({ request } as unknown as import('axios').AxiosInstance);
    const resp = await t.send({ method: 'GET', url: 'https://x', headers: {}, body: '' });
    expect(resp.body).toBe('{"a":1}');
  });
});

describe('WopClient.send（Transport 编排）', () => {
  it('gatewayBaseUrl 未配置 → 系统类错误', async () => {
    const client = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa4096!.publicSpkiB64,
    });
    await expect(client.send('POST', '/p', '{"a":1}')).rejects.toThrowError(/gatewayBaseUrl/);
  });

  it('默认 FetchTransport：全链路 send→verify（mock fetch 返回已签名响应）', async () => {
    const client = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa4096!.publicSpkiB64,
      gatewayBaseUrl: 'https://gw.example.com',
    });
    const PATH = '/v1/order/create';
    const respBody = JSON.stringify({ code: 'SUCCESS' });
    // 平台侧签名响应
    const headers: Record<string, string> = {
      'x-wop-nonce': 'pn',
      'x-wop-timestamp': '1',
      'x-wop-content-digest': await computeDigestHeader(respBody),
    };
    const signed = Object.keys(headers).sort();
    const canonical = canonicalRequest({
      authString: 'v1/1800',
      method: 'POST',
      path: PATH,
      queryString: '',
      headers,
    });
    const sig = await rsaSign(fromBase64(PLAT_PRIV), utf8Encode(canonical));
    headers['x-wop-sign'] = `WOP-RSA4096-SHA256 v1/1800/${signed.join(';')}/${toBase64Url(sig)}`;

    const fetchMock = vi.fn(async () =>
      new Response(respBody, { status: 200, headers }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await client.send('POST', PATH, '{"orderId":"o1"}', { timestamp: 1, nonce: 'n' });
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.plaintext).toBe(respBody);
      const [url] = (fetchMock.mock.calls[0] as unknown as [string, RequestInit]);
      expect(url).toBe(`https://gw.example.com${PATH}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('自定义 Transport 注入 + 非 2xx 无签名响应 → ok=false 不抛', async () => {
    const client = new WopClient({
      appKey: 'ak',
      suite: 'WOP-RSA3072-SHA256',
      merchantPrivateKey: vectors.keys.rsa3072!.privatePkcs8B64,
      platformPublicKey: vectors.keys.rsa4096!.publicSpkiB64,
      gatewayBaseUrl: 'https://gw',
    });
    const mockTransport: Transport = {
      send: async () => ({ status: 503, headers: {}, body: 'service unavailable' }),
    };
    client.setTransport(mockTransport);
    const result = await client.send('GET', '/health');
    expect(result.status).toBe(503);
    expect(result.ok).toBe(false);
    expect(result.body).toBe('service unavailable');
  });
});
