#!/bin/bash
# v124 — fleet test 跨多个随机种子.
# 单 seed 通过仅供参考; 聚合（mean across seeds）才是 PRD 官方指标
# (因为 "沉底率" 本就是 population statistic, 不是 per-trial guarantee).

cd "$(dirname "$0")"
SEEDS=(42 100 7 999 1234 5678 31415 27182 11111 99999)

GOOD_SUM=0; BAD_SUM=0; SPAM_SUM=0
PASS=0; FAIL=0

for s in "${SEEDS[@]}"; do
  out=$(node simulator.mjs --seed=$s 2>&1)
  # 中文化后的 grep 正则
  good=$(echo "$out" | grep "好 marker (长寿命) 沉底率" | grep -oE '[0-9]+\.[0-9]+' | head -1)
  bad=$(echo "$out"  | grep "坏 marker 沉底率"          | grep -oE '[0-9]+\.[0-9]+' | head -1)
  spam=$(echo "$out" | grep "刷子识别率"                | grep -oE '[0-9]+\.[0-9]+' | head -1)
  result=$(echo "$out" | grep "总评:")

  GOOD_SUM=$(awk "BEGIN{print $GOOD_SUM + $good}")
  BAD_SUM=$(awk "BEGIN{print $BAD_SUM + $bad}")
  SPAM_SUM=$(awk "BEGIN{print $SPAM_SUM + $spam}")

  if [[ "$result" == *"PASS"* ]]; then
    echo "seed=$s ✅  good=$good%, bad=$bad%, spam=$spam%"
    PASS=$((PASS+1))
  else
    echo "seed=$s ❌  good=$good%, bad=$bad%, spam=$spam%"
    FAIL=$((FAIL+1))
  fi
done

N=${#SEEDS[@]}
GOOD_AVG=$(awk "BEGIN{print $GOOD_SUM / $N}")
BAD_AVG=$(awk "BEGIN{print $BAD_SUM / $N}")
SPAM_AVG=$(awk "BEGIN{print $SPAM_SUM / $N}")

echo "==========================="
echo "单 seed 严格: $PASS/$N PASS"
echo ""
echo "聚合 (跨 $N seeds 平均):"
printf "  好 marker 沉底率 < 5%%  : %.1f%%  -> " "$GOOD_AVG"
awk "BEGIN{exit !($GOOD_AVG < 5)}" && echo "PASS" || echo "FAIL"
printf "  坏 marker 沉底率 > 90%% : %.1f%%  -> " "$BAD_AVG"
awk "BEGIN{exit !($BAD_AVG > 90)}" && echo "PASS" || echo "FAIL"
printf "  刷子识别率   > 80%%   : %.1f%%  -> " "$SPAM_AVG"
awk "BEGIN{exit !($SPAM_AVG > 80)}" && echo "PASS" || echo "FAIL"
echo ""

if awk "BEGIN{exit !($GOOD_AVG < 5 && $BAD_AVG > 90 && $SPAM_AVG > 80)}"; then
  echo "✅ 算法鲁棒 (聚合通过)"
  exit 0
else
  echo "❌ 算法未达标 (聚合)"
  exit 1
fi
