'use strict';

/**
 * dist 产物冒烟——CJS 消费路径。
 *
 * 商户侧 `require('@wanlianyida/wop-typescript-sdk')` 与 `require('…/axios')`
 * 走的就是 dist/index.cjs 与 dist/axios.cjs：本脚本以 Node 原生 CJS 加载
 * 两个入口后执行共享场景（build 之后运行，见 npm run test:dist）。
 */

const { runSmoke } = require('./smoke-scenario.cjs');
const sdk = require('../dist/index.cjs');
const ax = require('../dist/axios.cjs');

runSmoke(sdk, ax).then(
  () => console.log('[smoke:cjs] dist CJS 双入口 OK — L0/L2 出站 + 回程验签解密 roundtrip'),
  (err) => {
    console.error('[smoke:cjs] FAILED');
    console.error(err);
    process.exit(1);
  },
);
