# wop-typescript-sdk 实施报告

> 归档说明：本文为初始交付时点的实施报告（对应提交历史 `feat(suite)`…`docs(readme)` 六个 conventional commits，测试 131 个、覆盖率四指标 100%）。后续演进（Node 18 CI 修复、actions 升级、npm 发布 @wanlianyida/wop-typescript-sdk@0.1.0）见仓库提交历史与 CI 报告；报告内"未推送"等表述以归档时点为准。

- 日期：2026-08-29
- 仓库：本仓库（wop-typescript-sdk）（main，未推送）
- 任务书：/tmp/wop-task-typescript.md（公共段 /tmp/wop-sdk-common.md）
- 依据：wop-sdk-spec v1.0-ratified（Q1/Q7 裁决）、crypto-strategy-spec v0.3-reviewed、crypto-vectors.json
- 开发方式：TDD 红-绿推进（每模块先测试后实现），conventional commits ×6

## 一、交付清单

### 协议核心（src/，零运行时依赖，WebCrypto 走 globalThis.crypto）

| 模块 | 功能 | spec 锚点 |
|---|---|---|
| `suite.ts` | securityReq 解析；RSA3072/4096 ✅；`WOP-SM2-SM3` 抛 `WopError('SM2-SM3 套件暂未支持，见 README 路线图')`；跨族/非法拒绝 | F1、§2、Q7、I5 |
| `canonical.ts` | 5 段 `\n`；Java-URLEncoder 语义（encodeURIComponent + `!'()~` 补编码大写 %XX，空格→%20，`*` 保留）；trimall 折叠空白；名小写排序 | F2 |
| `crypto.ts` | SHA256withRSA（RSASSA-PKCS1-v1_5）；RSA-OAEP（WebCrypto 单哈希模型=双 SHA-256+空 label，天然满足 F2 钉子）；AES-256-GCM ct‖tag 尾拼 128bit；CSPRNG 唯一 IV/nonce 生成点 | §3.3、I4 |
| `digest.ts` | `sha-256 <64 位小写hex>` 计算 + D2 严格校验（恰一空格/小写/64 长/跨族拒） | F4、D2 |
| `envelope.ts` | DEK 载荷 `alg$key$iv` 组装/解析（AES-256-GCM key 32B/iv 12B 校验） | §6.1 |
| `keys.ts` | 密钥材料 PEM/Base64/Base64url → SPKI/PKCS8 DER | D12 |
| `encode.ts` | base64url 严格无填充（拒 `=`/非法字符/长度%4==1）、小写 hex、utf-8 | F6/F7 |
| `error.ts` | `WopError{category}`：parse/unsupported/integrity/consistency 明确；signature/decrypt 模糊（I7） | §10.2 |
| `client.ts` | `WopClient.buildRequest`（I1 digest 必入签；L2 信封；F9 nonce/timestamp/expiredSeconds；CSPRNG 可注入保证幂等）；`verifyResponse`/`verifyCallback`（F6：验签→digest 复核→DEK 解包→alg 族比对→bulk 解密）；`send` 传输编排 | F3/F5/F6/F9、I1/I2/I3/I7 |

### 传输层（同门禁覆盖）

- `transport/fetch.ts`：fetch 原生适配器（主入口导出）
- `transport/axios.ts`：axios peer 适配器，独立入口 `wop-typescript-sdk/axios`（主入口零 axios 引用，已验证 CJS/ESM 产物 grep=0）
- `transport/types.ts`：`Transport` 抽象（商户自带栈可直接消费 RequestDraft）

### 构建

- tsup 双格式（ESM+CJS）+ d.ts + sourcemap；`exports` 规范（`.` 与 `./axios`）
- `package.json`：`wop-typescript-sdk@0.1.0`，MIT，engines node≥18，零 dependencies，axios 为 optional peerDependencies

### 文档与 CI

- `README.md`（中文默认）+ `README.en.md`：四段必备（快速开始/密钥准备 D12/L0+L2 示例/向量自测）+ 国密路线图声明 + I7 错误模糊化说明
- `.github/workflows/ci.yml`：Node 18/20/22 矩阵（npm ci → typecheck → coverage → build）
- 向量 fixture 全量拷贝 `tests/fixtures/crypto-vectors.json`（sha256 与真源一致：0e5b89e5…e8ff48）

## 二、验收自证（命令原文）

### 1. 全量测试绿（含向量 conformance）

```
$ npm run coverage
 ✓ tests/keys.spec.ts (6 tests) 6ms
 ✓ tests/vectors.spec.ts (19 tests) 23ms
 ✓ tests/transport.spec.ts (10 tests) 50ms
 ✓ tests/edge.spec.ts (22 tests) 31ms
 ✓ tests/client.spec.ts (31 tests) 120ms

 Test Files  9 passed (9)
      Tests  131 passed (131)
```

（另有 tests/encode.spec.ts 12、tests/canonical.spec.ts 12、tests/suite.spec.ts 8、tests/digest.spec.ts 10，合计 131。）

### 2. 覆盖率报告原文（行+分支，≥98% 门禁）

```
 % Coverage report from v8
---------------|---------|----------|---------|---------|-------------------
File           | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
---------------|---------|----------|---------|---------|-------------------
All files      |     100 |      100 |     100 |     100 |
 src           |     100 |      100 |     100 |     100 |
  canonical.ts |     100 |      100 |     100 |     100 |
  client.ts    |     100 |      100 |     100 |     100 |
  crypto.ts    |     100 |      100 |     100 |     100 |
  digest.ts    |     100 |      100 |     100 |     100 |
  encode.ts    |     100 |      100 |     100 |     100 |
  envelope.ts  |     100 |      100 |     100 |     100 |
  error.ts     |     100 |      100 |     100 |     100 |
  keys.ts      |     100 |      100 |     100 |     100 |
  suite.ts     |     100 |      100 |     100 |     100 |
 src/transport |     100 |      100 |     100 |     100 |
  axios.ts     |     100 |      100 |     100 |     100 |
  fetch.ts     |     100 |      100 |     100 |     100 |
---------------|---------|----------|---------|---------|-------------------
```

行 100% / 分支 100% / 函数 100% / 语句 100%（vitest thresholds 四指标 98 门禁通过，无 ERROR）。

### 3. README 双语存在性 ls 证据

```
$ ls README.md README.en.md LICENSE
LICENSE
README.en.md
README.md
```

### 4. git log（全部 conventional）

```
$ git log --oneline
47e0876 docs(readme): 双语 README（快速开始/密钥准备/L0L2 示例/向量自测）与国密路线图
d827bb0 feat(client,transport): F6 顺序编排与可插拔传输层
5423e9f feat(crypto,keys,envelope): WebCrypto 四维算法实现，黄金向量字节级一致（A1/A2）
b27aeb0 feat(digest): x-wop-content-digest 计算与 D2 严格校验（F4）
ca336af feat(suite): securityReq 解析与算法套件推导（F1）
845133a chore: 初始化项目脚手架（tsup/vitest/tsc 配置、MIT License、向量 fixture）
```

（ca336af 正文同时载明 feat(canonical) 的交付说明。）

### 5. 构建与类型检查

```
$ npm run build     → DTS ⚡️ Build success（dist/index.{js,cjs,d.ts} + dist/axios.{js,cjs,d.ts}）
$ npm run typecheck → tsc --noEmit 通过（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
$ node -e "require('./dist/index.cjs')"            → CJS 冒烟 OK
$ node --input-type=module -e "import …'./dist/index.js'; import …'./dist/axios.js'" → ESM 冒烟 OK
```

## 三、向量合规明细（A1 正向 / A2 负向）

| 向量 | 断言方式 | 结果 |
|---|---|---|
| rsa3072-sign / rsa4096-sign | 字节级（384/512B，b64url 恒 512/683 字符） | ✅ 一致 |
| oaep3072-unwrap / oaep4096-unwrap | 解包 == 明文 DEK 载荷 | ✅ 一致 |
| oaep3072-mgf1sha1-trap | 错误 MGF1 密文必须解包失败 | ✅ 拒绝 |
| oaep3072-wrap-roundtrip | wrap→unwrap == 明文 | ✅ |
| aesgcm-encrypt | 固定 key/iv 字节级（ct‖tag） | ✅ 一致 |
| digest-sha256 | hex + header 组装 | ✅ 一致 |
| dek-rsa | 载荷组装 == expected | ✅ 一致 |
| formatRules ×8（含 b64url-with-padding / b64url-illegal-char / 双空格 / 大写 hex / 错长 / 跨族） | accept/reject 逐条驱动 | ✅ 全部符合预期 |
| SM 段（digest-sm3 / sm4gcm-encrypt / sm2-* / dek-sm2） | 不消费；作"必须拒"负测试材料：SM 套件抛暂未支持（Q7）、SM4-GCM DEK 载荷在 RSA 套件下一致性拒绝、SM4 16B key 对 AES-GCM 入口拒绝、sm3 digest 头配 RSA 套件跨族拒绝 | ✅ |

协议不变式测试锚点：I1（digest 必入 signedHeaders，签名头正则断言）、I2/F6（签名失败优先且模糊，先于 digest/解密）、I3/D8（SM4-GCM 载荷在 bulk 解密前明确拒绝）、I4（IV/DEK 唯一生成点 randomBytes + 可注入）、I5（跨族三处拒绝）、I7（tag 失败与 DEK 失败同文案"解密失败"，断言不含 OAEP/tag/padding 字样）。

## 四、偏差与说明

1. `verifyResponse(headers, body, requestPath)` 在概念 API 基础上增加第三参 requestPath：canonical 的 URI 段是网关 API 路径，SDK 无隐式状态可取（verifyCallback 同理取回调 path）。spec §2 允许"各语言惯用映射"。
2. L2 出站的确定性：注入 timestamp/nonce/dek/iv 后 wireBody 与 digest 确定；x-wop-encrypt 与 x-wop-sign 含 OAEP 随机化（WebCrypto 不支持 seed 注入），属 spec"除 CSPRNG IV/nonce"同源的例外，测试断言可复现部分全等。
3. `ca336af` 单提交含 suite+canonical 两个 feat 说明（正文载明），标题取 suite；如需逐 feat 拆分历史可 rebase（未推送，无破坏面）。
4. vitest coverage exclude：`src/**/index.ts`（纯 re-export）与 `src/**/types.ts`（纯类型声明，无运行时语句）；其余全部源码计入，包括 axios peer 适配器。

## 五、结论

- 验收标准 A1–A7 全部满足（A7：tsc 零错误、tsup 构建成功、CI 脚本就绪待推送后首跑）
- 首版范围按 Q7 裁决仅 RSA 套件，SM2-SM3 明确拒绝并已在双语 README 声明路线图
- 未推送（任务书纪律）；后续推送后 GitHub Actions 将在 Node 18/20/22 复验全部门禁
