/**
 * dist 产物冒烟——ESM 消费路径。
 *
 * 商户侧 `import { WopClient } from '@wanlianyida/wop-typescript-sdk'` 与
 * `import { AxiosTransport } from '…/axios'` 走的就是 dist/index.js 与
 * dist/axios.js：本脚本以 Node 原生 ESM 加载两个入口后执行共享场景
 * （build 之后运行，见 npm run test:dist）。
 */

import { runSmoke } from './smoke-scenario.cjs';
import * as sdk from '../dist/index.js';
import * as ax from '../dist/axios.js';

runSmoke(sdk, ax).then(
  () => console.log('[smoke:mjs] dist ESM 双入口 OK — L0/L2 出站 + 回程验签解密 roundtrip'),
  (err) => {
    console.error('[smoke:mjs] FAILED');
    console.error(err);
    process.exit(1);
  },
);
