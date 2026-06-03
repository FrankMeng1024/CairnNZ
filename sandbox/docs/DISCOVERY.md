# DISCOVERY — Cairn Algorithm Sandbox

**Project Type**: Web-based Algorithm Validation Sandbox
**Parent Project**: Cairn (NZ outdoor app)
**Independence**: 子项目独立运行，不影响父项目 OTA 节奏

---

## Why This Subproject Exists

Cairn 父项目正在设计 public marker 反馈机制（v3.2，subagent 评分 9.55/10）。但所有评分都是**理论评分**，没有真实算法验证。

用户明确要求：
> "我们不应该靠实际数据来测试算法。我们应该在 web 上平面模拟算法。算法本身和位置无关，更多的是交互相关的。"

→ 用沙盒验证算法 → 通过后才推 app。

---

## UI Intent

**视觉极简，重点测算法**：
- 2D Canvas 矩形地图（不是真实 NZ 地图）
- 圆圈代表人，旗帜代表 marker
- 不要炫酷动画
- 为 Playwright 自动截图设计
- 调节面板足够清晰

---

## User Persona

### Primary：算法验证者（即用户本人）
- 不参与技术细节
- 看 demo 选风格
- 看最终通过/不通过结果

### Secondary：Playwright 自动化（AI agent）
- 能 query DOM 元素
- 能截图
- 能导出 state JSON

---

## Feature Priority (MoSCoW)

### Must Have
1. ✅ 阶段 0 调研已完成（personas_distribution.json）
2. Python 数学验证脚本（阶段 1）
3. Canvas 2D 沙盒，500 虚拟人渲染
4. 路过检测（quadtree 空间索引）
5. Persona 决策（概率抽样，不调 AI）
6. v3.2 算法实现（JS 版）
7. Marker 颜色编码 + 信息卡片
8. 上帝视角 + 单人视角切换
9. 调节面板（人数/速度/persona 比例/算法参数）
10. Playwright 测试 10 场景
11. LLM 自动评估（最终一次）

### Should Have
- 群体行为（30% 单独 / 70% 结伴）
- 算法参数实时生效（不回溯历史）
- State 导出 JSON（Playwright 用）
- 截图按钮

### Could Have
- 多种 demo 风格选择（CP1）
- 离线/在线场景切换模拟
- 季节冻结模拟

### Won't Build
- 真实 NZ 地图底图（OpenStreetMap）
- 实时 AI 决策调用
- 复杂 sprite 动画
- 用户登录/账号
- 后端服务

---

## What We Will NOT Build

- **不依赖真实地图数据**（任意 2D 矩形即可）
- **不调实时 LLM 做决策**（只用阶段 0 概率分布）
- **不做精细动画**（圆圈+旗帜足够）
- **不做手机端**（Web only）

---

## Acceptance Mode

`acceptance_mode: auto`

- Sprint 0 的 CP1 (style demo 选择) 用户参与
- Sprint 0 的 CP2 (技术方案确认) 用户参与
- Sprint 1+ 全自主，VU 验收

---

## Project Type Decision

**Web App (Vanilla JS + HTML5 Canvas)**

理由：
- 沙盒不需要框架（React/Vue 是过度设计）
- 单 HTML 文件 + JS 模块化即可
- Playwright 友好
- 部署简单（file://）

---

## Confidence Level

- 阶段 0 调研：MEDIUM（需后续 calibrate）
- 算法实现：HIGH（v3.2 公式已 9.55/10）
- 可视化：HIGH（Canvas 2D 是成熟技术）
- Playwright：HIGH（已在父项目用过）
