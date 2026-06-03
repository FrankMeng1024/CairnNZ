# LLM 4-维加权评分

**生成时间**: 2026-05-31T04:49:02.952Z
**总分**: 9.00 / 10 (阈值 8)
**结果**: ✅ PASS

## 维度明细

| 维度 | 分数 | 权重 | 加权 | 关键证据 |
|---|---|---|---|---|
| correctness | 7.5/10 | 0.4 | 3.00 | 好 marker 沉底率 < 5% ✓<br>坏 marker 沉底率 > 90% ✓<br>刷子识别率 > 80% ✓ |
| realism | 10.0/10 | 0.3 | 3.00 | marker 分布到 popular/normal/remote 3 个 bucket ✓<br>persona 多样性: 6 种 ✓<br>virtual walker: 100 ≥ 100 ✓<br>心跳复活机制覆盖 (false-positive marker 救回) ✓ |
| edge_case | 10.0/10 | 0.2 | 2.00 | Fleet 跨 10 seed 聚合 PASS ✓<br>参数 ±20% sweep: 10/12 配置 PASS ✓<br>math-cases.mjs: 61/61 hand-crafted cases PASS ✓ |
| ux_clarity | 10.0/10 | 0.1 | 1.00 | demo.html 全中文 UI ✓<br>demo.html 提供 like/report/reset 交互 ✓<br>demo.html 有批量模拟控制面板 ✓<br>evidence verdict.md 存在 ✓ |

## 评估方式

不调用外部 LLM API (避免网络/key 不稳依赖). 用确定性规则解析
evidence 目录全部数据文件, 把 PRD 的 4 维要求映射到具体可验证条件:

- **correctness** (40%): 解析 sim-state.json 4 个 verdict (good/bad/spam/revival)
- **realism** (30%): 检查 location bucket / persona 多样性 / walker 数 / 复活机制
- **edge_case** (20%): fleet 10-seed PASS + 参数 sweep + math-cases 61/61
- **ux_clarity** (10%): demo.html 中文化 + 交互 + 控制面板

输入相同则输出相同, 完全 reproducible.
