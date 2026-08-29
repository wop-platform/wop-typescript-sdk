#!/usr/bin/env bash
# 工厂测试门（移植四步之四：测试门命令本地化）——vitest 全量 + BDD 商户旅程。
# 用法: scripts/run_tests.sh [--no-lock]（其余参数不支持：双套件门，参数转发语义二义）
#   --no-lock 为工厂链约定旗标（上游 run_tests.sh 的锁语义），本仓无锁，消费并忽略。
# 证据形态：vitest 逐文件输出 + cucumber 场景汇总；rc 域 0/1（npm 测试失败即 1）。
set -euo pipefail
for a in "$@"; do
  if [ "$a" = "--no-lock" ]; then
    continue
  fi
  echo "scripts/run_tests.sh: 不支持的参数: $a（仅支持 --no-lock）" >&2
  exit 2
done
npm run test
npm run test:bdd
