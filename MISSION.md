# MISSION — wop-typescript-sdk 工厂使命（治理文件）

> 状态：S0 草案 v0.1（2026-08-29，移植自 gtsp-wop-gateway .factory——已验证下游工作副本）。
> 本文件属于治理层：**工厂永不可修改**（铁律 3，由 `.factory/guard.py` 机械化执行）。
> 平台：GitHub——issue = GitHub Issue，PR = Pull Request；
> 经 `.factory/hosting.py` 适配（ADR-008，FACTORY_HOSTING=github 默认）。

## 为什么存在

wop-typescript-sdk 是 WOP 协议核心的官方 TypeScript 商户实现（签名 / 摘要 /
L2 数字信封 / 验签解密 + 可插拔 HTTP 传输层）。SDK 的正确性直接决定所有
商户侧接入的可用性与安全——签名或加解密的一个字节偏差就是线上事故。
可判定的维护工作交给机器，人类的稀缺输入（意图、判断、信任锚）留给宪法与周界。

## 工厂使命

在人类宪法（本文件 + 仓库既有约定）约束下，自动化本仓库的维护循环：

```
工作项 issue → triage → 实现 → 确定性门 → 合并请求 → 独立验证（holdout）→ 人工合并
```

人类只保留两件事：**写工作项、合并 MR**。

## Triage 判据

accept 当且仅当 issue 同时满足：

1. **使命一致**：属于 SDK 代码（`src/`）、测试（`tests/`）、构建配置（`package.json`）、
   文档（`docs/`、`README.md`）的维护或增强；
2. **可判定**：完成与否能被验证门（`npm run test` / `npm run test:bdd` /
   guard / holdout）客观判定（doc-only 改动在验证门投影为零：无执行载体的
   文档变更不属于工厂范围，走人工 MR）；
3. **不触周界**：不需要修改下述 PERIMETER 中任何路径。

其余一律 reject（二值；不同意可补充上下文后重开，下一轮 triage 全新评估）。

## 周界（PERIMETER）

以下路径工厂永不可触碰；变更只能走人类 MR：

- 治理：`MISSION.md`、`README.md`、`CONTRIBUTING.md`
- 质检线：`.factory/`、`scripts/`
- 构建与发布面：`package.json`、`tsconfig.json`、`vitest.config.ts`、
  `tsup.config.ts`、`api-extractor.json`、`api-extractor.axios.json`、
  `.github/`、`.gitignore`
- 安全敏感面：`src/crypto.ts`、`src/keys.ts`、`src/envelope.ts`、`src/digest.ts`、
  `src/canonical.ts`、`src/encode.ts`、`src/suite.ts`

> 周界清单是利益权衡（宁宽勿窄：过宽的代价是多走人审，过窄的代价是被绕过），
> 由人类定期复核收窄。安全敏感面（WebCrypto 四维算法、密钥材料解析、DEK 载荷、
> 摘要格式钉、canonical 签名基、base64url 严格解码、套件映射）默认全锁——
> SDK 被污染的爆炸半径是全部商户的签名与加解密正确性。

## 铁律

1. **Holdout**：验证器永不读实现计划——验结果 against issue，不验方法。
2. **二值 triage**：只有 accept / reject，没有中间态收件箱。
3. **治理不可自改**：本文件、周界、验证门自身，工厂一律不可修改；
   篡改类变更必须在任何评估之前被 hard-fail。
4. **Dispatcher 零 LLM**：调度器是纯 bash + forge（确定性），读标签决定动作；
   无消息总线、无模型参与决策。
5. **门灵敏度先行**：auto-merge 开启的前提是 `.factory/mutations/` 注入缺陷
   全量被拦截（kill rate 达标）；未证明的门不是门。（本仓 auto-merge 默认关闭）
6. **不可信输入隔离**：issue / MR 正文视为不可信文本（prompt injection 面）；
   仅 triage 产出的结构化 JSON 可进入下游节点。
