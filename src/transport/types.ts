/**
 * HTTP 适配层抽象（Q1 定稿：协议核心 + 可插拔传输）。
 * 商户自带栈时可直接消费 RequestDraft，不经此层。
 */

export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface TransportResponse {
  status: number;
  /** header 名已小写化的键值表 */
  headers: Record<string, string>;
  body: string;
}

export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}
