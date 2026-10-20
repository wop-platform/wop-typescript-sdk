# PR #50 审查报告（2026-10-19）

PR: wop-platform/wop-typescript-sdk#50 test(bdd): S11 重放全等补固定 requestId + CI 补 BDD 腿
Head: 8eb6ddf2968732c7e8e499010e3c3255cab7d4cd（1 commit，基于 4d15dd5=#48 merge，落后 main 3 commits）

## 1. CI 失败根因（已证实，推翻既有假设）

- 3 个失败 check：Node 20 × ubuntu/macos/windows（run 39151290259）；Node 22/24 全绿；CodeQL/sourcery/CodeRabbit/Snyk 绿。
- 根因（CI 日志原文）：`Cucumber can only run on Node.js versions 22 || 24 || >=26. This Node.js version is v20.20.2`
- 机制：本 PR 给矩阵 job 无条件加 `pnpm test:bdd` 腿；矩阵含 Node 20；devDep @cucumber/cucumber@^13.2.1 engines 要求 Node ≥22。Node 20 腿必挂（9 腿中 3 腿）。
- **假设检验**：`git merge-base --is-ancestor d428d79 origin/fix/bdd-s11-request-id` → NOT ancestor（确未 rebase），但 d428d79/2b63790/e18621c（#49/#51）均不触 cucumber/矩阵，**rebase 不能修复本失败**。main 的 ci.yml 矩阵仍为 [20,22,24]。
- 修复建议（供裁决，未动任何文件）：矩阵 step 加 `if: matrix.node-version != '20'`（一行），或矩阵剔除 20（不可取，package.json engines=>=20）。

## 2. 本地验证（worktree /tmp/pr50-review，node v26.12.0，pnpm 10.28.1，已清理）

- `pnpm install --frozen-lockfile` ✓
- `pnpm coverage`：Statements 99.87% / Branches 99.04% / Functions 100% / Lines 99.86%，≥98 阈值全过 ✓
- `pnpm test:bdd`：15 scenarios / 49 steps 全绿 ✓（日志可见 S11 两次 `req-bdd-s11-fixed-000000000000001`；GET 等步仍走随机缺省路径，两路径均覆盖）
- 未做 rebase（前提被证伪），未 push。

## 3. Diff 逐行审查（+4 -2，2 文件）

- steps.ts：S11_REQUEST_ID 常量（30 ASCII 字符，过 I2 校验：无控制字符、≤128B）；两个 When 步显式透传。requestId 在签名落盘之后写入、不入 signedHeaders（src/client.ts:333 注释+实现），PR body「不影响 S4 验签断言」成立。共享步（S4 也用）透传后额外覆盖显式传参路径，缺省随机路径由 GET 步+单测覆盖，无覆盖损失。**非硬编码假测试**：断言仍是对 draft 全量 deepEqual（含签名/头），固定 requestId 正是「同参重放」的规范语义（附录 I）。
- ci.yml：意图正确（补 BDD 腿防 S11 再度静默失守），但缺 Node 20 条件门 → 即本次 CI 红的唯一起因。

## 4. 变更行覆盖核查

vitest coverage include 仅 `src/**/*.ts`；本 PR 0 行 src 变更（纯测试+CI）。「变更行覆盖≥98%」对 src 度量口径为空集/空真；CI coverage 腿（3 平台）全绿即门槛通过。

## 5. PR 交互

- 既有评论：changeset-bot（No changeset，测试/CI-only 无需版本 bump，可忽略）、CodeRabbit（<10 stars 未自动评审）、sourcery-ai（APPROVED）。reviews：sourcery APPROVED + im47cn APPROVED。无 inline 未解决线程。
- 已发新评论：CI 根因+证据+修复建议+本地验证结论。

## 6. 待用户裁决

1. 是否按 `if: matrix.node-version != '20'` 补丁（一行 CI 改动）——需新 commit 推分支（force push 不需要，追加 commit 即可）。
2. 是否顺带 rebase main（落后 3 commits：e18621c/2b63790/d428d79；mergeable=MERGEABLE 无冲突；rebase 与 CI 红无关，纯卫生）。rebase+测试全绿后 force push 由用户执行。
- 既有：dependabot #33/#35/#36 已知告警，未处理。

## 7. 关键路径

- 仓：/Users/dreambt/sources/open-platform/wop-typescript-sdk
- CI run: https://github.com/wop-platform/wop-typescript-sdk/actions/runs/39151290259
- 签名后写头证据：src/client.ts:333（I3 注释）
