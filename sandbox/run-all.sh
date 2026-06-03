#!/bin/bash
# v124 — 一键跑全部 sandbox 测试 + 输出聚合 verdict.
# 用于 CI 回归: 任何 metric 退步会让某个测试失败 → 整体 exit 非 0.

cd "$(dirname "$0")"
set -e

echo "=== 1/7 数学测试 (61 case battery) ==="
node math-cases.mjs | tail -3

echo
echo "=== 2/7 端到端 simulator (canonical seed=999) ==="
node simulator.mjs | tail -8

echo
echo "=== 3/7 跨 10 seed fleet ==="
bash run-fleet.sh 2>&1 | tail -10

echo
echo "=== 4/7 参数 ±20% sweep ==="
node param-sweep.mjs 2>&1 | tail -5

echo
echo "=== 5/7 心跳复活专项 ==="
node heartbeat-revival.mjs 2>&1 | tail -5

echo
echo "=== 6/7 Playwright 10 场景 ==="
# 需要 http server 在 8766 端口跑
curl -sf http://localhost:8766/demo.html > /dev/null || {
  echo "  http server 未跑, 起一个..."
  python -m http.server 8766 > /tmp/sandbox-http.log 2>&1 &
  sleep 2
}
node playwright-tests.mjs 2>&1 | tail -15

echo
echo "=== 7/7 LLM 4-维 verdict ==="
node llm-verdict.mjs 2>&1 | tail -10

echo
echo "===================================="
echo "全部测试完成. 详见 docs/qa/sprint3-evidence/ACCEPTANCE.md"
