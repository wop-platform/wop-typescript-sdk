# 变异测试幸存体归档：12 个等价变异证明（2026-08-29 第五轮）

> 击杀率 95.31%（244/256，门禁 ≥90% 通过）。以下 12 个幸存体均为**黑盒行为等价**——
> 即不存在任何不改 src 语义的测试能区分它们（证明附后）。它们不是测试缺口，
> 而是（a）防御性冗余代码、（b）I7 模糊化纪律的固有代价、（c）环境等价。
> 本轮为第四轮（250/263，95.06%）之后的复测：第四轮 #13（suite.ts SUPPORTED 表
> RSA 项被 SUITE_CACHE 短路的冗余信号）已由"算法支持表并入密码族单一事实源"重构
> 关闭，该变异点随 `true` 字面量一并消失，幸存体 13 → 12。

| # | 位置 | 算子 | 等价原因 |
|---|------|------|---------|
| 1 | client.ts:347 | cond-lt `dekIdx < 0` → `<= 0` | `dekIdx === 0` 不可达：进入该分支要求头以 `l2` 开头（`startsWith`），而 `indexOf('dek=') === 0` 要求头以 `dek=` 开头，二者互斥。`<=` 仅在 0 处与 `<` 不同，故无差异 |
| 2 | client.ts:322 | bool `sigOk = true` → `false` | 初值唯一读取点在 `rsaVerify` 返回后立即覆盖；rsaVerify 抛错路径经 catch 显式赋 `false`。两种初值在所有路径下终值一致 |
| 3 | client.ts:262 | string `'parse'` category 追加 | `verifyResponse` 捕获 WopError 后仅外显 `e.message`；内部 category 无任何可观测通道（对外契约是 VerifyResult{ok,reason}） |
| 4 | client.ts:368 | string `'consistency'` category 追加 | 同上 |
| 5 | crypto.ts:146 | cond-lt `len < 16` → `<= 16` | 16B 输入：短路路径抛 `DECRYPT_FAILED`；非短路走 WebCrypto GCM（空明文+16B tag）tag 校验失败同抛 `DECRYPT_FAILED`（I7 模糊化使两路径文案恒同） |
| 6 | crypto.ts:146 | numeric `16` → `17` | 15/16B 输入两路径同文案（同上）；17B+ 输入不受阈值影响 |
| 7 | crypto.ts:146 | stmt-del 删除短路 if | 15B 输入走 WebCrypto 失败 → 同文案（同上） |
| 8 | crypto.ts:28 | stmt-del 删除 `if (g?.subtle) return g` | Node ≥19 中 `globalThis.crypto` 与 `node:crypto.webcrypto` 为同一对象，快路径与回退路径返回值不可区分（`toBe` 已断言通过）；浏览器目标中该 if 生效，但 vitest 无法在 Node 下构造区分 |
| 9 | encode.ts:72 | cond-lt `i < out.length` → `<=` | 多出的一次迭代对 `out[out.length]` 赋值，Uint8Array 越界写静默丢弃，输出不变 |
| 10 | encode.ts:113 | cond-lt `i < len` → `<=` | 同上：污染的 acc 产出的字节写入 `out[pos]`（pos 已达上限）被静默丢弃 |
| 11 | encode.ts:12 | string STD_ALPHABET 追加 | 追加在索引 ≥64 处，编码只用 0-63；解码表反向索引不受尾部影响；非法字符已被 B64URL_RE/正则预检拒绝 |
| 12 | encode.ts:13 | string B64U_ALPHABET 追加 | 同上 |

## 击杀资产说明

- 击杀资产 = vitest 全量套件（13 文件 175 测试；Node 18 下快路径 identity 用例按 skipIf 跳过，由回退契约用例覆盖），不含 cucumber-js BDD（独立运行器）。
- 门禁：`npm run test:mutation`，击杀率 < 90% 时 exit 1。
- 每轮报告：`tests/mutation/report.json`；src 恢复完整性由脚本末尾字节校验保证。
