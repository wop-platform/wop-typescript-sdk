/**
 * HTTP 适配层抽象（Q1 定稿：协议核心 + 可插拔传输）。
 * 商户自带栈时可直接消费 RequestDraft，不经此层。
 */

/** 出站请求四要素:method、完整 url、headers、body(空串 = 无体) */
export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}
/** 入站响应三要素:status、小写化 headers、body 文本 */
export interface TransportResponse {
  status: number;
  /** header 名已小写化的键值表 */
  headers: Record<string, string>;
  body: string;
}

/** HTTP 适配层接口:send 一进一出,异常语义由实现方定义 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}
