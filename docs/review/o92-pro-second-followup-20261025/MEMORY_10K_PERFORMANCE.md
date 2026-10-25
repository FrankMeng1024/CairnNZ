# 10k Memory 性能复核

环境：macOS 12.7.6 (21H1320)、Intel x86_64、Node v24.11.1。#17 `059c792f` 与 #18 `adcb638e` 的 `FogLayer.tsx` blob 都是 `0442c694...`，10k 测试 blob 都是 `dcb9bd3f...`，所以 #18 的 216ms 不是这两个版本之间的代码变化。

| Run | total ms | slice p50 / p95 / max ms | 最慢阶段 | tile | items | event-loop p95 / max ms |
|---:|---:|---:|---|---|---:|---:|
| 1 | 8,248.17 | 0 / 8 / 18 | select_points | — | 10,000 | 9.53 / 18.56 |
| 2 | 8,420.21 | 0 / 8 / 19 | select_points | — | 10,000 | 9.74 / 18.58 |
| 3 | 8,343.62 | 0 / 8 / 20 | select_points | — | 10,000 | 9.58 / 20.44 |
| 4 | 8,432.96 | 0 / 8 / 97 | tile_geometry | `97103|-22896` | 8 | 9.64 / 98.29 |
| 5 | 10,311.83 | 0 / 9 / 51 | tile_geometry | `97100|-22926` | 8 | 11.12 / 53.92 |

五次均低于冻结的 150ms budget。第 4/5 次最慢 tile 只有 8 items，却分别与约 98/54ms event-loop delay 同时出现；这不符合稳定的 item-count 算法退化，更符合 wall-clock 计时包含运行时/OS 暂停。旧 216ms 收据没有同一时刻的 event-loop 明细，故只能说“未复现、证据支持偶发暂停”，不能断言是 GC、OS 或某一具体进程。

唯一测试改动是把诊断 JSON 写入移到冻结预算 assertion 前：将来真的超预算时仍保存 p50/p95/tile/itemCount，而不是在写收据前抛出。没有提高预算、减少 10k fixture、重试到绿或修改 geometry 算法。

原始五份 JSON 位于交付 ZIP `EVIDENCE/performance/`。
