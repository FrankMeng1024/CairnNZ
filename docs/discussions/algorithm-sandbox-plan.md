# Algorithm Sandbox Validation Plan — Cairn Public Marker Feedback

**Created**: 2026-05-30
**Status**: Plan, awaiting user confirmation
**Scope**: Validate v3.2 public marker feedback algorithm before app implementation
**Owner**: Cairn project

---

## 1. 背景

v3.2 方案 subagent 评 9.55/10，但所有评分都是**理论评分**——基于公式自洽性 + 边界 case 覆盖度。真实算法验证还没做。

用户提出关键洞察：
> "算法本身和位置无关，更多是交互相关。我们要在 Web 沙盘平面模拟，模拟各类认真的 / 过激的 / 模糊的行为。沙盘 100% 通过才推 app。"

进一步升级：
> "不靠假设的用户行为，靠调研真实数据。Playwright 模拟用户走向 + Mock 时间数据 + AI 分析底层数据。"

这是从"产品讨论"升级到"**算法工程**"的层级。

---

## 2. 目标

**核心目标**：在 v3.2 算法被 commit 到生产代码之前，用沙盘 + 真实数据驱动模拟，验证：

1. 公式数学上自洽（所有 case 输出符合预期）
2. 群体行为下算法稳定（不会被刷子或恶意举报破坏）
3. 心跳曝光机制真的让沉底 marker 有复活机会
4. 拥堵处理 + 防刷 + 申诉算法在长期下不退化
5. 参数（τ、续命系数、心跳率、Report 权重）的最优值通过模拟收敛

**不做目标**：
- ❌ 不替代真实用户测试
- ❌ 不验证 UI/UX 转化率
- ❌ 不验证文化差异行为

---

## 3. 三阶段推进

### 阶段 1：数学验证（半天）

**目的**：公式自洽性验证。

**做法**：
- 写 Python 脚本（或 Jupyter notebook）实现 v3.2 完整公式
- 跑 50-100 个 hand-crafted case
- 输出每个 case 的：寿命剩余 / 曝光率 / 状态判定
- 对照 v3.2 §7.5 + §17 38 个 case 表，验证数值一致

**通过标准**：
- 所有 hand-crafted case 输出与文档预期一致
- 边界 case（L=0、Δt=0、冬季冻结、2 年硬上限）行为符合预期
- 公式无除零 / 无穷大 / 数值溢出

**产出**：
```
sandbox/
  ├── stage1_math_verification/
  │   ├── formula.py            ← v3.2 公式实现
  │   ├── test_cases.py         ← 50-100 个 case
  │   ├── run.py                ← 执行测试
  │   └── results.json          ← 输出
  └── docs/discussions/sandbox-stage1-report.md
```

**通过后**：进入阶段 2。
**不通过**：回头修 v3.2 公式 → v3.2.1。

---

### 阶段 2：MVP 群体模拟（2 天）

**目的**：群体行为下算法稳定性验证。

**做法**：
- 单 HTML 文件沙盘（参考项目内 ar_styles_*.html 风格）
- 2D 网格"地图"，N 个 marker 散布
- 5 种 persona 模拟：
  - 普通用户（80%）：随机路过，30% Like 喜欢的，5% Report 不爽的
  - 热情用户（5%）：路过即 Like
  - 严苛用户（5%）：路过即 Report
  - 刷子（5%）：集中刷某 marker，反复 Like/Unlike
  - 恶意举报者（3%）：集中 Report 某 marker
  - 沉默用户（2%）：看不操作
- 加速时间（1 天 = 1 分钟模拟时间）
- 跑 365 天看长期行为
- 实时图表 + summary
- AI 分析（调 Claude API）：自动找漏洞、异常分布

**通过标准（具体指标）**：
- ✅ 好 marker（高 Like 低 Report）30 天内沉底率 < 5%
- ✅ 坏 marker（低 Like 高 Report）30 天内沉底率 > 90%
- ✅ 刷子集中刷票后，软权重识别率 > 80%
- ✅ 心跳机制下，沉底 marker 复活样本数 > 0（即真有可能复活）
- ✅ 拥堵区 K=20 选择算法不偏向单一 persona
- ✅ 参数稳定区间：τ ±20% 不影响核心行为
- ✅ 长期模拟（365 天）系统不崩溃 / 不发散

**产出**：
```
sandbox/
  ├── stage2_mvp/
  │   ├── algorithm_sandbox.html  ← 单文件沙盘
  │   ├── personas.js             ← 5 种 persona
  │   ├── simulator.js            ← 时间循环 + 状态机
  │   ├── charts.js               ← 实时图表
  │   └── ai_analyzer.js          ← Claude API 分析输出
  └── docs/discussions/sandbox-stage2-report.md
```

**通过后**：v3.2 文档锁死为 v3.3，进入开发，或升级到阶段 3。
**不通过**：回头修 v3.2/v3.3 公式或参数。

---

### 阶段 3：完整版 — 真实数据驱动 + Playwright（5+ 天）

**目的**：用真实世界数据分布验证算法，最接近"真实就绪"。

**触发条件**：
- 阶段 2 发现需要更精细验证
- 或用户量预期短期上千，需更高信心
- 当前阶段不强制做，可作为 backlog

**做法**：

#### 3.1 调研真实数据

```
docs/research/marker-feedback-real-data/
  ├── alltrails_review_distribution.md
  │   ← 收集 AllTrails review 行为分布 (论文 + 数据爬取)
  ├── reddit_voting_pattern.md
  │   ← 公开数据集分析投票/Report 比例
  ├── strava_kudos_pattern.md
  │   ← 段位投票分布
  ├── nz_doc_visitor_data.md
  │   ← DOC 公开报告：步道访问量
  └── synthesized_personas.md
      ← AI 综合上述数据生成的真实分布 persona
```

#### 3.2 Playwright 自动化模拟

```
sandbox/
  ├── stage3_full/
  │   ├── personas/
  │   │   ├── normal_user.js     ← 真实分布行为
  │   │   ├── enthusiast.js
  │   │   ├── critic.js
  │   │   ├── spammer.js
  │   │   └── malicious_reporter.js
  │   ├── scenarios/
  │   │   ├── 365_day_simulation.js
  │   │   ├── popular_marker.js
  │   │   └── crowded_area.js   ← 好牧羊人场景
  │   ├── mock_layer/
  │   │   ├── time_controller.js  ← jest fake timer / Playwright clock
  │   │   ├── gps_simulator.js    ← 复用 useTrackingStore
  │   │   └── network_simulator.js
  │   └── runner.js              ← Playwright orchestrator
  └── docs/discussions/sandbox-stage3-report.md
```

#### 3.3 AI 评估管道

```
模拟跑完 → simulation_results.json
  ↓
Claude API 分析:
  prompt: "分析此次模拟。哪些 marker 行为异常?
          公式参数是否合理? 推荐调整方向?"
  ↓
ai_analysis_report.md
  ↓
开发者调参 → 再跑（迭代）
```

**通过标准**：
- 阶段 2 全部指标
- 真实数据分布下算法表现一致
- 跨 persona 比例（NZ 老 tramper vs 国际游客）行为差异可解释
- 长期模拟结果通过 LLM 评估"产品方向一致性"

**产出**：
- `sandbox/stage3_full/` 完整代码
- `docs/research/marker-feedback-real-data/`
- `docs/discussions/sandbox-stage3-report.md`
- v3.x 文档最终锁定参数

---

## 4. 模拟覆盖的算法清单

阶段 2 + 3 必须覆盖的 v3.2 算法：

| # | 算法 | 来源章节 | 必测指标 |
|---|---|---|---|
| 1 | 寿命公式（双时钟 + Like 衰减） | §6 | 6 case 全通过 |
| 2 | per-type 半衰期 τ | §6.3 | 5 类型行为差异符合预期 |
| 3 | 心跳曝光算法 | 你 Q3 / v3.3 新增 | 沉底→复活样本 > 0 |
| 4 | Report 原因权重 | v3.3 新增 | "不喜欢" 不轻易杀死内容 |
| 5 | 拥堵处理 4 层 | §7 | 好牧羊人 200 marker 压缩到 ~20 |
| 6 | 防刷软权重 | §11 | 刷子识别率 > 80% |
| 7 | 申诉 4 case | §12 | Case A/B/C/D 各自通过 |
| 8 | 反复刷限制 | v3.3 新增 | 10 分钟 5 次切换上限生效 |
| 9 | 推送延迟 10 分钟 | v3.3 新增 | 作者通知延迟正确 |
| 10 | 季节冻结 | §6 | 冬季 marker 状态冻结 |

---

## 5. 通过标准（量化指标汇总）

### 阶段 1 必过

- [ ] 50+ hand-crafted case 公式输出与文档一致
- [ ] 边界 case 无异常（L=0、Δt=0、2 年上限、冬季冻结）
- [ ] 数值范围合理（无 NaN、无 Inf、无负寿命）

### 阶段 2 必过

- [ ] 好 marker 30 天沉底率 < 5%
- [ ] 坏 marker 30 天沉底率 > 90%
- [ ] 中性 marker（无人理）按基础寿命衰减
- [ ] 刷子识别率 > 80%
- [ ] 心跳机制复活样本 > 0
- [ ] 长期 365 天系统稳定
- [ ] 参数 ±20% 鲁棒性

### 阶段 3 必过（如启动）

- [ ] 阶段 2 全部
- [ ] 真实数据分布下行为一致
- [ ] LLM 评估 "产品方向一致性"通过

---

## 6. 时间线建议

```
Day 0  (今天):  本计划讨论 + 拍板
Day 1  (半天):  阶段 1 数学验证脚本 + 跑 case
Day 1.5:        阶段 1 报告 + 是否过关决策
Day 2-3:        阶段 2 MVP 沙盘开发
Day 4:          阶段 2 跑模拟 + AI 分析
Day 4.5:        阶段 2 报告 + v3.3 锁定决策
Day 5+:         (可选) 阶段 3 完整版
```

如果阶段 1 + 2 通过，**总投入 4-5 天**。
如果加阶段 3，**8-10 天**。

---

## 7. 与 v3.x 文档的关系

```
当前: v3.2 评分 9.55 (理论)
  ↓
阶段 1 通过 → v3.2.1 (数学验证)
  ↓
阶段 2 通过 → v3.3 (群体行为验证, 锁定参数)
  ↓ (可选)
阶段 3 通过 → v3.4 (真实数据验证, 生产就绪)
```

每阶段产出报告作为 v3.x 文档的**附录证据**。

---

## 8. 风险与限制

### 已知限制

1. **沙盘不能完全替代真实**
   - 模拟通过 ≠ 真实通过
   - 但模拟不通过 = 真实一定不通过
   - 价值在于"过滤掉一定会失败的版本"

2. **persona 设计依赖假设**
   - 阶段 2 用开发者假设的分布
   - 阶段 3 用真实数据缓解但仍不完美
   - 解决：明示局限，不过度宣称"100% 验证"

3. **算法和 UI 耦合**
   - 算法决定"显示什么"
   - UI 决定"用户多容易点击 Like"
   - 沙盘只验证算法层

### 失败兜底

- 沙盘开发本身失败（写不出来）→ 退回 v3.2 文档作为最终方案，接受理论评分
- 模拟暴露重大漏洞 → 修文档，可能延期 1-2 周
- 阶段 3 数据调研拿不到关键数据 → 仅做阶段 2，明示限制

---

## 9. 待用户拍板的 5 件事

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 是否启动此计划？ | 是 |
| Q2 | 推进到哪个阶段？ | 至少阶段 1+2，阶段 3 看结果决定 |
| Q3 | 阶段 1 现在做还是先讨论文档？ | 现在做（半天），快速验证基础 |
| Q4 | 通过标准的具体数字（§5）是否合理？ | 接受，A/B 调整 |
| Q5 | 沙盘代码放哪里？ | `C:/ClaudeCodeProjects/Cairn/sandbox/` 同级于现有 ar_styles |

---

## 10. 这个计划与 Cairn 整体路线的关系

```
Cairn 当前: v117 OTA 迭代 (AR 视觉 + bug fix)
   ↓
此沙盘: 不影响主线开发, 单独 track
   ↓
沙盘通过后: v3.x 文档 → PRD4 → Sprint Planning
   ↓
PRD4 进入正式 Sprint: Phase 3 public marker 反馈机制开发
```

→ 沙盘不阻塞 OTA / 不阻塞当前 Sprint，是**未来 Phase 3 实施前的算法保险**。

---

## 11. 总结

| 维度 | 决定 |
|---|---|
| 思路 | ✅ 用模拟验证算法，不靠真实用户当小白鼠 |
| 数据 | ✅ 调研真实分布 + AI 分析，不靠开发者主观假设 |
| 工具 | ✅ Playwright + Mock + Claude API |
| 阶段 | 3 阶段，每阶段独立通过标准 |
| 投入 | 阶段 1+2 = 4-5 天，阶段 3 = 多 5 天 |
| 产出 | 沙盘代码 + 验证报告 + 锁定参数 |
| 与文档关系 | 验证 v3.2 → 锁定 v3.3 → 可选 v3.4 |

**核心价值**：把 v3.2 的"理论 9.55 分"升级为"工程验证后 9.5 分"。差别是：

- 9.55 理论 = 公式自洽 + 文档完整
- 9.5 工程验证 = 真的跑过 365 天群体行为，参数是模拟收敛出来的，不是开发者拍的

后者才是真正能 ship 的算法。

---

**等用户拍板 Q1-Q5 后启动。**
