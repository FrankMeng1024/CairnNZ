# PRD — Cairn Algorithm Sandbox

**Product**: Cairn Algorithm Validation Sandbox
**Version**: 1.0
**Created**: 2026-05-30
**PO**: Frank Meng (代理: AI agent)

---

## Vision

构建一个 web 端可视化沙盒，**自主验证 Cairn public marker 反馈算法的正确性**。AI 驱动，零人为决策干预，输出可量化的验证报告。

---

## Epics

### E-001: 数学验证基础
Python 实现 v3.2 公式 + 50+ hand-crafted case 全通过。

### E-002: 沙盒视觉系统
Canvas 2D 矩形地图 + 500 圆圈虚拟人 + 彩色旗帜 marker + 信息卡片。

### E-003: Persona 决策系统
加载阶段 0 概率分布 + 5 情境判断 + 群体行为（30% 单独 / 70% 结伴）。

### E-004: 算法引擎
v3.2 算法 JS 版 + Stage 1 一致性验证 + 实时生效（不回溯）。

### E-005: 视角切换
上帝视角 + 单人视角 + 完整移动轨迹 + 决策回放。

### E-006: 调节面板
人数/速度/persona 比例/算法参数滑块 + 暂停/继续/重置/截图/导出。

### E-007: Playwright 自动化
10 测试场景 + 自动截图 + State JSON 导出 + LLM 评估。

### E-008: Demo 风格选择 (CP1)
3 个静态 HTML 风格 demo 让用户选。

---

## Success Metrics

| 指标 | 目标 |
|---|---|
| 阶段 1 数学测试通过率 | 100% (50+ case) |
| 沙盒 60fps 流畅度 | 500 人下不掉帧 |
| 好 marker 30 天沉底率 | < 5% |
| 坏 marker 30 天沉底率 | > 90% |
| 刷子识别率 | > 80% |
| 心跳机制复活样本 | > 0 |
| 参数 ±20% 鲁棒 | 通过 |
| Playwright 10 场景通过率 | 100% |
| LLM 评估 verdict | ≥ 8/10 (4 维加权) |

---

## NFR

### 性能
- 500 人 60fps
- 路过检测 quadtree 空间索引
- 时间加速 1× ~ 10000×

### 可观测性
- DOM 节点带 data-* 属性供 Playwright query
- State 可一键导出 JSON
- 截图按钮 + 自动截图 API

### 可重现性
- 随机 seed 默认 Date.now()，测试时可固定
- State JSON 包含 seed
- Stage 1 ↔ Stage 2 同 case 输出 ±0.001 一致

### 隐私 / 合规
- 沙盒纯前端，无后端，不收集用户数据
- 不需要 NZ Privacy Act 考虑

---

## Phase 排期

| Phase | Epics | 估计 |
|---|---|---|
| **Sprint 0 (CP1+CP2)** | E-008 + 文档 | 1 天 |
| **Sprint 1 (Spike)** | 关键技术 spike | 半天 |
| **Sprint 2** | E-001 数学验证 | 半天 |
| **Sprint 3** | E-002 + E-004 沙盒视觉 + 算法 | 2 天 |
| **Sprint 4** | E-003 + E-005 + E-006 Persona + 视角 + 调节 | 1.5 天 |
| **Sprint 5** | E-007 Playwright + LLM 评估 | 2-3 天 |

**总投入**: 7-9 天

---

## Confirmation

PRD 全部内容已确认，无需用户每条审核。仅以下 checkpoint 用户参与：
- CP1 风格选择（3 个 demo）
- CP2 Sprint 1 计划确认
