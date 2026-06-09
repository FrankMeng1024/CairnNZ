# SPIKE-066-B: 自实现 Dijkstra 性能基线 — 实测报告

**Date**: 2026-06-07
**Spike ID**: SPIKE-066-B
**Story**: STORY-00502

---

## 目标

验证自实现 Dijkstra + BinaryHeap 在 RN/Hermes 引擎上对 corridor query (typically 300 nodes) 是否够快。

避免引入 `ngraph.path` 依赖（保持纯 OTA-able 代码）。

## VIABLE 标准

**300-node corridor query P95 < 100ms on iPhone 12 Hermes**

由于无法直接在 Hermes 上跑 benchmark，采用 Node.js V8 baseline + Hermes 保守估算（×3）。

## 实现草稿

`~/.claude/sprint-66-workspace/graph-draft/`：
- `BinaryHeap.ts` (TypeScript) / `benchmark.mjs` (内联 JS)
  - Min-heap with index map for O(log n) decreaseKey
  - ~140 LOC（与 Plan v3.1 估计 50 LOC 比偏多 — 因为加了 indexMap，质量更好）
- `Dijkstra.ts`
  - Standard adjacency list + early exit on target
  - ~80 LOC
- `benchmark.mjs`
  - Synthetic graph 生成器 + P50/P95/P99 测量

## 实测结果（Node.js v25.8.2，Windows）

| 节点数 | Runs | P50 | P95 | P99 | Avg |
|---|---|---|---|---|---|
| **300** | 200 | 0.13ms | **0.29ms** | 1.12ms | 0.15ms |
| 500 | 100 | 0.19ms | 0.33ms | 1.17ms | 0.19ms |
| 1000 | 100 | 0.42ms | 0.70ms | 1.21ms | 0.40ms |
| 5000 | 50 | 2.55ms | 5.55ms | 7.36ms | 2.61ms |
| 10000 | 30 | 6.64ms | 11.43ms | 11.83ms | 6.49ms |

## Hermes 估算

Hermes 通常比 V8 慢 2-3x。保守估算 ×3：

| 节点数 | Estimated Hermes P95 | vs 100ms 标准 |
|---|---|---|
| **300** | **~0.9ms** | **100x 余量** ✅ |
| 500 | ~1.0ms | 100x 余量 ✅ |
| 1000 | ~2.1ms | 47x 余量 ✅ |
| 5000 | ~16.7ms | 6x 余量 ✅ |
| 10000 | **~34.3ms** | 3x 余量 ✅ |

## VIABLE 判定

**SPIKE-066-B: VIABLE ✅** —— 远超标准。

300 节点 Hermes 估算 < 1ms，标准是 < 100ms，**100x 余量**。即便 10000 节点（极端 corridor 大数据量）也保持 ~34ms < 100ms。

**结论**：
- 自实现 Dijkstra **完全够用**，**不需要 ngraph 依赖**
- 保持纯 OTA-able 代码路径
- v3.1 §18 SPIKE-B NOT VIABLE Plan B（节点上限/A*/flag-off）**不会被触发**

## 影响与决策

**对 Plan v3.1 影响**：
- ✅ 自实现 Dijkstra + BinaryHeap 设计确认（实际代码已完成草稿）
- ✅ 不需要 ngraph 依赖，不需要 EAS native build 加包（虽然反正要 native build 等 Unity）
- ✅ 拖动单次 Dijkstra reroute 在 corridor 内 (~300 节点) 在 Hermes 上 < 1ms，满足 30/60fps 拖动响应
- ✅ Plan v3.1 §7 性能预算 "Dijkstra <50ms P95" 实测远低于此（< 1ms）

**对 Plan v3.1 修订**：
- §7 性能预算 "Dijkstra <50ms P95" 可以收紧到 "<10ms P95"
- §18 SPIKE-B NOT VIABLE 段落保留作为风险缓冲，但极不可能触发

## 草稿代码搬入计划

等独立 codebase 准备好后，搬入：
- `~/.claude/sprint-66-workspace/graph-draft/BinaryHeap.ts` → `app/src/services/routing/graph/BinaryHeap.ts`
- `~/.claude/sprint-66-workspace/graph-draft/Dijkstra.ts` → `app/src/services/routing/graph/Dijkstra.ts`
- `~/.claude/sprint-66-workspace/graph-draft/benchmark.mjs` → `app/src/services/routing/graph/__benchmark__/benchmark.mjs` (作为内部 perf regression test)

## 待补：真机 Hermes 验证

Wave 0 实质开发开始后，把 BinaryHeap + Dijkstra + benchmark 集成进 codebase，写一个 dev 模式按钮触发 benchmark，在 iPhone 12 真机/模拟器上跑一次得到真实 Hermes 数据。

预期：300 节点 P95 < 5ms（远低于估算的 0.9ms 安全余量），完全 VIABLE。

---

End of SPIKE-066-B report.
