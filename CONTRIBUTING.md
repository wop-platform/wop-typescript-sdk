# 贡献指南（CONTRIBUTING）

感谢关注 WOP 商户 TypeScript SDK！本仓库是 WOP 商户侧**官方** SDK，实现协议核心（结构化签名 / 报文摘要 / L2 数字信封 / 验签解密）+ 可插拔 HTTP 适配层（fetch 内置、axios peer 可选），对齐 [《WOP 商户 SDK 统一规格》v1.0-ratified](../gtsp-wop-gateway/docs/wop-sdk-spec.md)（网关仓 `gtsp-wop-gateway` 的 `docs/wop-sdk-spec.md`）。任何协议行为的改动都必须以该 spec 为准绳，本仓库不做 spec 之外的"自由发挥"。

## 开发环境

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20（CI 矩阵验证 20 / 22 / 24，与 `package.json` `engines.node` 一致） |
| 操作系统 | Linux / macOS / Windows（CI `test` job 三 OS × 三 Node 全矩阵；测试脚本已跨平台化：无 POSIX-only shell 语法、路径经 `node:path`/`fileURLToPath`、子进程以 `process.execPath` 直跑 JS 入口） |
| TypeScript | ^5.9（`tsc --noEmit` 类型检查）；**消费方类型下界 TS 5.0**（CI `types-floor` job 以 5.0.4 + 最新双跑 `tests/type-consumer` 验证）；`typecheck-latest` job 以 typescript@latest 跑主仓 typecheck，作 devDeps 升级前的**前瞻雷达**（当前 latest = 7.0，主仓已验证兼容） |
| 测试 | vitest ^3.2 + `@vitest/coverage-v8` |
| peer 下界 | axios ≥1.0.0（CI `axios-matrix` job 以 1.0.0 + latest 换装验证 transport 测试与 dist 冒烟） |
| 构建 | tsup ^8.5（ESM/CJS 双格式 + dts，target es2022） |
| 密码学 | 全部走 WebCrypto（`globalThis.crypto`），**零运行时依赖**，不得引入 polyfill 或第三方 crypto 库 |

克隆后安装依赖：

```bash
git clone https://github.com/wop-platform/wop-typescript-sdk
cd wop-typescript-sdk
npm install
```

## 构建与测试

命令与 [.github/workflows/ci.yml](.github/workflows/ci.yml) 完全一致，提交前请在本地全部跑绿：

```bash
npm ci              # 干净安装（CI 同款）
npm run typecheck   # tsc --noEmit，全仓类型检查
npm run coverage    # vitest run --coverage，全量测试 + 覆盖率门禁
npm run build       # tsup 产物构建（dist/ ESM+CJS+dts，index 与 axios 双入口）
npm run test:dist   # 产物门禁：publint + attw 四解析模式 + API 快照严格校验 + dist 双格式冒烟（须先 build）
npm run api:snapshot # 重新生成 etc/*.api.md 快照（API 变更后必须运行并提交快照 diff）
npm test            # 仅跑测试（vitest run，不出覆盖率）
```

**覆盖率门禁**：`vitest.config.ts` 设定行 / 分支 / 函数 / 语句四项阈值均为 **98%**（统计范围 `src/**`，排除 `index.ts` 纯转发文件）。CI 中 `npm run coverage` 任一维度低于 98% 即失败。当前仓库处于 **100%**，新增代码请保持不回退——新分支是稀释覆盖率的最常见原因，提交前请自查。

## 黄金向量纪律（最重要）

`tests/fixtures/crypto-vectors.json` 是协议黄金向量的全量只读副本，是**唯一正确性锚**：

- **禁止手改、禁止裁剪、禁止按实现"就地修正"向量**。任何"向量与实现不一致"都默认实现错，先对照 spec 与网关真源排查。
- 新增协议行为必须：① 同步网关侧真源（向量由网关生成）；② 本仓更新为全量副本；③ 补全消费测试（`tests/vectors.spec.ts` 字节级断言）。
- **负向量必须拒**：篡改（tamper）、跨族（如 RSA 套件喂 SM 密钥/向量）、错格式（digest 多空格、大写 hex、base64url 带填充、MGF1-SHA-1 陷阱等）都要有"必须拒绝"的断言，且失败类别符合 I7 模糊化要求（见下）。
- SM2-SM3 段向量在 TS 仓体现为"暂未支持必须抛错"的负测试（Q7 裁决：首版仅 RSA 套件）。

## API 快照纪律（0.x 起生效）

`etc/wop-typescript-sdk.api.md` 与 `etc/wop-typescript-sdk-axios.api.md` 是 api-extractor 生成的公共 API 报告：

- `npm run test:dist` 内含快照**严格校验**：API 变更后未同步快照即失败。更新快照用 `npm run api:snapshot`，快照 diff 必须出现在同一 PR 中——reviewer 以快照 diff 作为 API 变更清单。
- `tests/type-consumer/index.ts` 是消费方哨兵：`noUnusedLocals` 强制覆盖全部导出符号，新增导出请同步登记，移除/改形既有导出会在此立即编译失败。
- breaking change（0.x 阶段 = 主版本位不变下的导出面收缩/改形）必须在 PR 描述中显式声明，并评估商户升级成本。

## 编码规范

**TypeScript 惯例**：

- `"type": "module"` ESM 优先；对外 API 同时交付 ESM/CJS（tsup 双格式），不要引入仅单一格式可用的写法。
- WebCrypto 异步 API（`crypto.subtle`）——协议入口全部 `async`，不引入同步阻塞或 Node 专有 `crypto` 模块（保持浏览器兼容）。
- 密钥材料按 D12 约定接受 PKCS#8 / X.509 SPKI DER 的 Base64（PEM 自动剥离）；错误信息面向集成者可自查。
- 新源码进 `src/`，测试进 `tests/*.spec.ts`；`src/index.ts` / `src/transport/axios.ts` 之外的文件不得新增运行时导出面，导出统一收敛到入口。
- 覆盖率统计排除 `index.ts` 转发，但**不排除任何逻辑代码**——不要用 `/* v8 ignore */` 逃逸门禁。

**spec 功能面对齐**（改动相关模块时先重读对应条款）：

| 功能面 | 模块 | 要点 |
|---|---|---|
| F1 算法套件 | `src/suite.ts` | 套件推导与矩阵，未支持套件明确抛错 |
| F2 canonicalRequest | `src/canonical.ts` | 规范化字符串逐字节一致 |
| F3 结构化签名 | `src/crypto.ts` | SHA256withRSA，定长 base64url |
| F4 报文摘要 | `src/digest.ts` | digest header 格式（D2：恰一空格/小写 hex；GET 无 body 自动缺席） |
| F5 L2 数字信封 | `src/envelope.ts` | AES-256-GCM + RSA-OAEP（双 SHA-256）包 DEK |
| F6 校验顺序 | `src/client.ts` | 先验签后解密等固定顺序，不得调换 |
| F7 线上字节格式 | `src/encode.ts` | base64url 严格无填充等字节级规则 |
| F9 防重放 | `src/client.ts` | nonce/timestamp 头部纪律 |
| I7 错误模糊化 | `src/error.ts` | 验签/解密失败统一模糊文案（防 oracle），解析/一致性类明确；`WopError.category` 分类正确 |

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，类型限 `feat` / `fix` / `test` / `docs` / `chore`（涉及协议行为的变更只允许 `feat`/`fix`）：

```
feat(envelope): L2 信封支持 4096 套件 IV 重放保护

body 用中文说明动机与 spec 条款依据（如 F5/F9），
涉及向量变更必须注明"已同步网关真源全量副本"。
```

## PR 流程

1. 基于 `main` 分支拉特性分支，PR 目标为 `main`。
2. CI 必须全绿：`npm ci` → `npm run typecheck` → `npm run coverage`（≥98% 门禁）→ `npm run build` → `npm run test:dist`；Node 20/22/24 × Linux/macOS/Windows 三矩阵 + `types-floor`（TS 5.0.4/latest）+ `axios-matrix`（axios 1.0.0/latest）。
3. **向量合规全绿**：触碰 `tests/fixtures/crypto-vectors.json` 或协议路径的 PR，reviewer 必须复核向量来源（网关真源）与负向量覆盖。
4. 至少一名 reviewer 通过后合并；spec 条款与实现冲突时**上报裁决**，不得以"既有实现"为由顺延 spec。

## 发布流程

发布由 tag 触发，流程定义在 [.github/workflows/release.yml](.github/workflows/release.yml)：

1. 版本号变更（`package.json` 的 `version`）经 PR 合入 `main`，提交信息如 `chore(release): v<version>`（占位符替换为实际版本，如 `v0.1.2`）。
2. 打 tag 并推送：`git tag v<version> && git push origin v<version>`（tag 须与 `package.json` 版本一致，否则发布标识错位）。
3. release workflow 自动执行：checkout → Node 22 → `npm ci` → `npm run typecheck` → `npm run coverage` → `npm run build` → `npm publish --access public`（scoped 包必须 public）。
4. npm 凭证走 GitHub Secret `NODE_AUTH_TOKEN`（`registry.npmjs.org`），**任何凭证不得出现在仓库明文**；发布步骤位于全部测试与构建之后，失败不会留下半发布状态。

发布后验证：`npm view @wanlianyida/wop-typescript-sdk@<version>` 确认版本与 `dist` 产物完整。
