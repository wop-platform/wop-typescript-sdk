'use strict';

/**
 * dist 产物冒烟——共享场景（维度 1：发布产物消费兼容）。
 *
 * 只依赖 dist 公共导出面（src/index.ts），不 import 任何 src/ 文件：
 * 商户消费的是产物，CI 其余环节测的是源码，本场景补上「发布物从未被消费」的洞。
 *
 * 由 tests/smoke.cjs（require dist/*.cjs）与 tests/smoke.mjs（import dist/*.js）
 * 分别注入两种模块格式的 SDK 命名空间后执行——同一断言集覆盖 ESM + CJS × 双入口。
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const vectors = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'crypto-vectors.json'), 'utf8'),
);

// 商户密钥对 = rsa3072 向量；平台密钥对 = rsa4096（异钥防串联错位，与 client.spec.ts 同构）
const K = vectors.keys;
const MERCH_PRIV = K.rsa3072.privatePkcs8B64;
const MERCH_PUB = K.rsa3072.publicSpkiB64;
const PLAT_PRIV = K.rsa4096.privatePkcs8B64;
const PLAT_PUB = K.rsa4096.publicSpkiB64;

const BODY = JSON.stringify({ orderId: '20260829001', amount: 100 });
const PATH = '/v1/order/create';

/** 从 draft/sign 头重建 canonical 并以指定公钥验签（网关视角，仅用 dist 导出原语） */
function verifyDraftCanonical(sdk, draftHeaders, method, pathName, queryString, pub) {
  const sign = draftHeaders['x-wop-sign'];
  const seg = sign.slice(sign.indexOf(' ') + 1).split('/');
  const hmap = {};
  for (const n of (seg[2] || '').split(';')) hmap[n] = draftHeaders[n];
  const canonical = sdk.canonicalRequest({
    authString: `${seg[0]}/${seg[1]}`,
    method,
    path: pathName,
    queryString,
    headers: hmap,
  });
  return sdk.rsaVerify(pub, sdk.fromBase64Url(seg[3] || ''), sdk.utf8Encode(canonical));
}

/** 模拟平台出站（L2）：平台私钥加签、商户公钥包 DEK、AES-GCM 加密 body（仅用 dist 导出原语） */
async function platformRespond(sdk, plainBody) {
  const headers = {
    'x-wop-nonce': 'nonce-from-platform',
    'x-wop-timestamp': '1770000000000',
  };
  const key = sdk.fromBase64Url(vectors.inputs.aesKeyB64u);
  const iv = sdk.fromBase64Url(vectors.inputs.aesIvB64u);
  const ct = await sdk.aesGcmEncrypt(key, iv, sdk.utf8Encode(plainBody));
  const wireBody = JSON.stringify({ encrypted: sdk.toBase64Url(ct) });
  const payload = sdk.buildDekPayload('AES-256-GCM', key, iv);
  const wrapped = await sdk.oaepWrap(sdk.fromBase64(MERCH_PUB), sdk.utf8Encode(payload));
  headers['x-wop-encrypt'] = `L2;dek=${sdk.toBase64Url(wrapped)}`;
  headers['x-wop-content-digest'] = await sdk.computeDigestHeader(wireBody);
  const signedNames = Object.keys(headers).sort();
  const canonical = sdk.canonicalRequest({
    authString: 'v1/1800',
    method: 'POST',
    path: PATH,
    queryString: '',
    headers,
  });
  const sig = await sdk.rsaSign(sdk.fromBase64(PLAT_PRIV), sdk.utf8Encode(canonical));
  headers['x-wop-sign'] = `WOP-RSA4096-SHA256 v1/1800/${signedNames.join(';')}/${sdk.toBase64Url(sig)}`;
  return { headers, body: wireBody };
}

/**
 * @param {object} sdk  dist 主入口命名空间（. 或 dist/index.cjs）
 * @param {object} ax   dist axios 入口命名空间（./axios 或 dist/axios.cjs）
 */
async function runSmoke(sdk, ax) {
  // —— 传输适配器：双入口各自可实例化（fetch 内置 / axios peer）
  assert.ok(new sdk.FetchTransport(), 'FetchTransport 实例化失败');
  assert.ok(new ax.AxiosTransport(), 'AxiosTransport 实例化失败');

  const client = new sdk.WopClient({
    appKey: 'smoke-app-key',
    suite: 'WOP-RSA3072-SHA256',
    merchantPrivateKey: MERCH_PRIV,
    platformPublicKey: PLAT_PUB,
  });

  // —— 出站 L0：头集合完整、digest 对 wire body、签名定长 512 字符 b64url
  const l0 = await client.buildRequest('POST', PATH, BODY, {
    timestamp: 1770000000000,
    nonce: 'abcdef0123456789abcdef0123456789',
  });
  assert.equal(l0.wireBody, BODY);
  assert.equal(l0.headers['x-wop-appkey'], 'smoke-app-key');
  assert.equal(l0.headers['x-wop-content-digest'], await sdk.computeDigestHeader(BODY));
  assert.ok(!('x-wop-encrypt' in l0.headers), 'L0 不应携带 x-wop-encrypt');
  assert.match(
    l0.headers['x-wop-sign'],
    /^WOP-RSA3072-SHA256 v1\/1800\/x-wop-appkey;x-wop-content-digest;x-wop-nonce;x-wop-timestamp\/[A-Za-z0-9_-]{512}$/,
  );

  // —— L0 签名可被网关侧公钥验回（互操作闭环）
  assert.equal(
    await verifyDraftCanonical(sdk, l0.headers, 'POST', PATH, '', sdk.fromBase64(MERCH_PUB)),
    true,
    'L0 签名网关侧验签失败',
  );

  // —— 出站 L2：全文数字信封（wireBody 密文 + x-wop-encrypt DEK 头）
  const l2 = await client.buildRequest('POST', PATH, BODY, {
    level: 'L2',
    timestamp: 1770000000000,
    nonce: 'abcdef0123456789abcdef0123456789',
  });
  assert.match(l2.wireBody, /^\{"encrypted":"[A-Za-z0-9_-]+"\}$/, 'L2 wireBody 非密文形态');
  assert.match(l2.headers['x-wop-encrypt'], /^L2;dek=/, 'L2 缺 x-wop-encrypt DEK 头');
  assert.equal(l2.headers['x-wop-content-digest'], await sdk.computeDigestHeader(l2.wireBody));

  // —— 回程 L2：平台响应（私钥签名 + 公钥包 DEK）→ 验签 + 解包 + 解密全链通过
  const plain = JSON.stringify({ code: 'SUCCESS', msg: 'ok' });
  const resp = await platformRespond(sdk, plain);
  const okResult = await client.verifyResponse(resp.headers, resp.body, PATH);
  assert.equal(okResult.ok, true, `verifyResponse 失败: ${okResult.reason}`);
  assert.equal(okResult.plaintext, plain, '回程明文不一致');

  // —— 回程负向：签名截断一位 → 定长校验前置 → 模糊失败（I7，不泄露细节）
  const badHeaders = { ...resp.headers, 'x-wop-sign': resp.headers['x-wop-sign'].slice(0, -1) };
  const badResult = await client.verifyResponse(badHeaders, resp.body, PATH);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.reason, '签名验证失败');
}

module.exports = { runSmoke };
