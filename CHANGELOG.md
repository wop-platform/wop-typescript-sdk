# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.0](https://github.com/wop-platform/wop-typescript-sdk/compare/v0.1.3...v0.3.0) (2026-11-18)

### ✨ 新功能

* **client:** 支持 ISV 子商户身份头 x-wop-sub-mch-id 入签 ([a68dfc9](https://github.com/wop-platform/wop-typescript-sdk/commit/a68dfc9b6943fbb131bd4df7c8334d34a56383dc))
* **config:** 实现 config-spec P0 配置层 ([20d4c2d](https://github.com/wop-platform/wop-typescript-sdk/commit/20d4c2db64458591e68967cf5fe6a8379dd507b8))
* 支持RSA2048套件与x-wop-request-id透传头 ([f061107](https://github.com/wop-platform/wop-typescript-sdk/commit/f061107f5afd46a4521dd1d64bf2e9dd97993a3d))
* 黄金向量改钉版拉取（对齐 java-sdk 构建期模式） ([031da14](https://github.com/wop-platform/wop-typescript-sdk/commit/031da1482a1b219ed2567390f8d1a4c9babdebba))

### 🐛 Bug 修复

* **ci:** 等价变异清单锚点随 client.ts 位移重定位 ([e75e88d](https://github.com/wop-platform/wop-typescript-sdk/commit/e75e88d20ccf02fd6810ad845f7a3f1f0a57b661))
* CLI 直跑判定改跨平台路径比较（windows 下 file:// 拼接不匹配） ([db9a1b6](https://github.com/wop-platform/wop-typescript-sdk/commit/db9a1b6602a27f62ee0896f23b0380df53862e20))
* config chain bugs; branch coverage 99.5 ([5da77ec](https://github.com/wop-platform/wop-typescript-sdk/commit/5da77ec1c845cb8ae7520b662eca79cea1bf37dd))
* **docs:** TSDoc 中点明 Tab 而非转义 \t，消除 api-extractor tsdoc-unnecessary-backslash 警告 ([6180b63](https://github.com/wop-platform/wop-typescript-sdk/commit/6180b63dca1bad2fbfad04fadaaad02e743c37be))
* **mutation:** 修正等价变异清单 [#22](https://github.com/wop-platform/wop-typescript-sdk/issues/22) 锚点误指 ([50224be](https://github.com/wop-platform/wop-typescript-sdk/commit/50224bee57058675ce1f6d8cecab6b0f7b4f1392))
* requestId trim 改线性扫描（CodeQL 正则回溯面） ([186c112](https://github.com/wop-platform/wop-typescript-sdk/commit/186c11200c1cd27ba95f06f0b434b8a669443e2d))
* typecheck 前置拉取（静态 import 在 CI 独立步骤先于 vitest 拉取） ([fcf12bc](https://github.com/wop-platform/wop-typescript-sdk/commit/fcf12bcda3533cacb07b1a7d33411de84dda0a5f))
* windows 腿测试平台中性与类型哨兵对齐 ([b8ec626](https://github.com/wop-platform/wop-typescript-sdk/commit/b8ec6262ce65f9fd37e6bf17fd49ad43c9baab5a)), references [#1](https://github.com/wop-platform/wop-typescript-sdk/issues/1)
* 响应 CR 评审——配置解析器严格逗号语法与 path 类型防护 ([da10a4b](https://github.com/wop-platform/wop-typescript-sdk/commit/da10a4bfd925dbe583fde7b863589aecb7391708))
* 响应外部审查——注入面、超时与向量缺口 ([f42b697](https://github.com/wop-platform/wop-typescript-sdk/commit/f42b6975035c2b9888d92d959f908fa16aa42907))
* 拉取前建 fixtures 目录（副本出库后 clone 无空目录） ([9f9fb1b](https://github.com/wop-platform/wop-typescript-sdk/commit/9f9fb1b2bd4e960a7fb457d7c7853414203ccf0e))
* 拉取器移出 fixtures 目录（目录可整体重建）+ 拉取前 mkdir ([83ff344](https://github.com/wop-platform/wop-typescript-sdk/commit/83ff3443e5aa0c4ad64cb638006d1e06497ef1fe))
* 模板与示例默认套件改为 RSA2048 ([2c172fb](https://github.com/wop-platform/wop-typescript-sdk/commit/2c172fb53ba7cc4c0a2eb47785c3dc1efe75c961))

### ⚡ 性能

* **test:** 向量夹具离线命中、产物门禁按平台拆分、preinstall 去 npx ([9bdf581](https://github.com/wop-platform/wop-typescript-sdk/commit/9bdf581b8dc0b442386749df2de4a33ea6bbbdf8))

### 📝 文档

* 中英 README 覆盖率与安装命令对齐 ([1661024](https://github.com/wop-platform/wop-typescript-sdk/commit/1661024bd898c3c5c3a0765e48c8b738f51e4989))
* 区分库运行时与测试工具链的 Node 版本下界 ([b77fec0](https://github.com/wop-platform/wop-typescript-sdk/commit/b77fec0d12364ac53509f4eaa4dc7b0af86f997b))
* 命令统一为 pnpm，修正覆盖率实测值 ([a746811](https://github.com/wop-platform/wop-typescript-sdk/commit/a7468110380943a7a567f5cc2f224c0ab0242917))
* 补黄金向量钉版升级流程，修正「全量副本」失真措辞 ([d9122d2](https://github.com/wop-platform/wop-typescript-sdk/commit/d9122d280a09e98096c52044fb594492fe4513c5))
* 补齐英文版示例与预留字段披露(重审残留) ([9548c6b](https://github.com/wop-platform/wop-typescript-sdk/commit/9548c6b8e56822bdf285ef530c51c6e7daff0728))
* 覆盖率排除项补 src/**/types.ts（与 vitest.config.ts 对齐） ([a76a284](https://github.com/wop-platform/wop-typescript-sdk/commit/a76a284adb1f216667ed722ab4c76440c868f2de))
* 覆盖率改为门禁口径，去掉点时刻数字 ([50a8d2c](https://github.com/wop-platform/wop-typescript-sdk/commit/50a8d2cdf5735d803ae43172166619319b9962ba))

### ✅ 测试

* **bdd:** S11 重放全等补固定 requestId；CI 补 BDD 腿（Node 20 跳过，cucumber 需 ≥22） ([2f10a5d](https://github.com/wop-platform/wop-typescript-sdk/commit/2f10a5d03ce20a1e82f5391a91a148d05cd8c607))
* fixture 字节级对齐真源 PR [#25](https://github.com/wop-platform/wop-typescript-sdk/issues/25)(_meta v0.4-draft + rsa2048 节就位) ([823d7a6](https://github.com/wop-platform/wop-typescript-sdk/commit/823d7a6466debf75d89f5caa40afe87e0d2fcc8e))
* mutation 门禁基线重置——增量击杀 7 变异并归档 37 等价证明（91.29%） ([e18621c](https://github.com/wop-platform/wop-typescript-sdk/commit/e18621c6663718c99598e1f78ec4f1afec2c0a0a))
* 击杀 11 条伪等价变异并修复 Windows 断言与锚点漂移（93.88%） ([d428d79](https://github.com/wop-platform/wop-typescript-sdk/commit/d428d79247e39fd08ec328444464c28824f9ddb5))
