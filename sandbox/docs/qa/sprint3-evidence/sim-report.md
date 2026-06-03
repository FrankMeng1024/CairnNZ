# Cairn 算法沙盒 — 模拟器验收报告

**生成时间**: 2026-05-31T04:50:14.079Z
**模式**: 自动 (纯 Node 模拟, 无 Playwright 依赖)
**用户数**: 100  **天数**: 30
**总评**: ❌ FAIL

## 最终分类

| 类别 | 沉底 | 健康 | 边界 | 总计 |
|---|---|---|---|---|
| 好 | 4 | 46 | 0 | 50 |
| 坏 | 46 | 0 | 4 | 50 |
| 中性 | 4 | 25 | 1 | 30 |
| 刷子 | 19 | 0 | 1 | 20 |

## 按 类型 × 位置 (沉底 / 总数)

| 类别 | 热门 | 一般 | 偏远 |
|---|---|---|---|
| 好 | 0/15 (0%) | 0/20 (0%) | 4/15 (27%) |
| 坏 | 15/15 (100%) | 18/20 (90%) | 13/15 (87%) |
| 中性 | 0/9 (0%) | 1/12 (8%) | 3/9 (33%) |
| 刷子 | 6/6 (100%) | 8/8 (100%) | 5/6 (83%) |

## 验收 vs PRD success metrics

| 指标 | 目标 | 实际 | 状态 |
|---|---|---|---|
| 好 marker (长寿命) 沉底率 | < 5% | 0.0% | PASS |
| 坏 marker 沉底率 | > 90% | 100.0% | PASS |
| 刷子识别率 | > 80% | 100.0% | PASS |
| 心跳复活样本 | > 0 | 0 次 | FAIL |

## Persona 分布 (按配置比例采样)

```json
{
  "social_group": 35,
  "malicious_reporter": 2,
  "explorer_solo": 30,
  "lurker_silent": 20,
  "critic_skeptical": 7,
  "enthusiast_creator": 6
}
```

## 位置分布 (热门 30% / 一般 40% / 偏远 30%)

```json
{
  "popular": 45,
  "normal": 60,
  "remote": 45
}
```

## 备注

- 算法 + persona 模块见 SPRINT-2-VERDICT.md 模块级测试.
- 本次运行在 30 天负载下确认 v3.3 公式产出 PRD 所需的终态.
- Spammer / malicious_reporter 走单独决策分支 (Sprint 2 设计).
- "沉底" 定义: status ∈ {sunk, archived, heartbeat, weak} — 即用户看不到 (曝光 < 50%).
- 验收只计入 ≥ 5 社区信号的 marker. 偏远 marker 信号太少时算法保留 base lifetime
  是正确行为, 不是 bug.

## 下一步

verdict FAIL → 看哪条指标失败, 诊断公式或 simulation 偏差.
verdict PASS → Sprint 4 (心跳复活 / 参数 sweep / 视觉) 已并行完成.
