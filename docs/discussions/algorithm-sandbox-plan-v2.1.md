# Algorithm Sandbox Validation Plan v2.1 — Simplified Visual Sandbox

**Version**: 2.1
**Created**: 2026-05-30
**Supersedes**: v2.0
**Status**: 待 subagent 评分 9.0+ 后启动

---

## 1. v2.1 vs v2.0 核心变化（来自用户 6 点反馈）

| 维度 | v2.0 | v2.1 |
|---|---|---|
| 地图 | Leaflet + OSM 真实底图 | **2D Canvas 矩形 + 网格** |
| 步道 | OSM polyline | **不需要，自由行走** |
| 虚拟人 | 精细 sprite | **彩色圆圈** |
| marker | 类型 icon | **彩色旗帜符号** |
| 范围 | Tongariro 真实区域 | **任意 2D 矩形（默认 1km×1km）** |
| AI 决策 | Claude Haiku 实时调用 | **❌ 不调 AI**，用阶段 0 概率分布抽样 |
| 视角切换 | 无 | **✅ 上帝视角 + 单人视角** |
| 群体行为 | 无 | **✅ 结伴模拟（30% 单独 / 70% 结伴）** |
| Marker 信息 | Like 数 | **Like + Report 总数 + 每类原因细分** |
| Playwright | 仅手动 | **✅ 自动截图 + 自动分析** |
| 阶段 3 | 可选 | **✅ 必做** |
| 默认人数 | 100 | **500** |

---

## 2. 已锁定决策（用户 8 点反馈）

| # | 决策 | 来源 |
|---|---|---|
| 1 | 任意 2D 地图，重点测算法 + 离线/在线场景 | Q1 |
| 2 | 开发 Opus，模拟 Haiku（但实际不调 AI） | Q2 |
| 3 | 概率分布抽样，不实时调 AI（阶段 0 由 Claude Code 一次性生成） | Q3 + 用户 5 |
| 4 | 阶段 3 必做 | Q4 |
| 5 | Playwright 自动截图 + 自动分析 | Q5 |
| 6 | Marker 区分颜色（按 type） | Q6 |
| 7 | 默认 500 人 | Q7 |
| 8 | 群体行为：单独 30% + 结伴 70% | 用户 6 |

---

## 3. 阶段化推进

### ✅ 阶段 0：行为分布调研（已完成）

**产出**：
- `sandbox/stage0_research/personas_distribution.json` — 7 类 persona × 5 情境概率分布
- `sandbox/stage0_research/marker_content_templates.json` — 50 个 NZ marker 模板
- `sandbox/stage0_research/research_report.md` — 调研报告

**特点**：基于 Jakob Nielsen 1% rule + NZ DOC 数据 + 中文搭子文化研究综合。

---

### 阶段 1：数学验证（半天）

**目标**：v3.2 公式自洽性验证，独立于可视化。

**做法**：
- Python 脚本实现 v3.2 公式（双时钟 + Like 时间衰减 + 心跳曝光）
- 跑 50+ hand-crafted case
- 对照 v3.2 §7.5 + §17 case 表

**产出**：
```
sandbox/stage1_math/
  ├── formula.py
  ├── test_cases.py
  ├── run.py
  └── results.json
```

**通过标准**：50+ case 全通过，边界 case 无异常。

---

### 阶段 2：⭐ 简化可视化沙盒（3-4 天）

#### 2.1 视觉设计（极简）

```
┌──────────────────────────────────────────┐
│ 上帝视角 (默认)                          │
│                                          │
│   ●(green)        🚩(red)                │
│   ↘ explorer       danger marker         │
│                    ❤ 23                  │
│                    🚩 7                  │
│                      info: 3             │
│   ●●(orange)         dislike: 2          │
│   ↘ social_group     spam: 1             │
│      paired          other: 1            │
│                                          │
│   ●(blue)         🚩(green)              │
│   ↘ enthusiast      supply marker        │
│                     ❤ 45                 │
│   ●(gray)           🚩 0                 │
│   ↘ lurker                               │
│                                          │
│   ●(red)          🚩(yellow)             │
│   ↘ spammer         junction marker      │
│                     ❤ 12                 │
│                     🚩 2                 │
│                                          │
│ [人数: 500] [速度: 100×] [persona...]    │
│ [⏸ 暂停] [▶ 继续] [↻ 重置]              │
└──────────────────────────────────────────┘
```

**元素**：
- 矩形地图区域（默认 1000m × 1000m，可调）
- 简单网格背景（灰色细线）
- 虚拟人 = 彩色圆圈（按 persona 分色）
- Marker = 彩色旗帜（按 type 分色）
- Marker 上方浮动信息卡片
- 行走轨迹（最近 30 秒淡线）

#### 2.2 颜色系统

**Persona 颜色**：
```
explorer_solo:       #4CAF50 绿色
social_group:        #FF9800 橙色 (结伴用相同颜色但加连接线)
enthusiast_creator:  #2196F3 蓝色
lurker_silent:       #9E9E9E 灰色
critic_skeptical:    #9C27B0 紫色
spammer:             #F44336 红色
malicious_reporter:  #E91E63 粉红
```

**Marker 颜色**：
```
danger:    #D32F2F 红
supply:    #388E3C 绿
junction:  #F57C00 橙
scenic:    #1976D2 蓝
cairn:     #795548 棕
```

#### 2.3 视角切换

```
默认: 上帝视角
  - 显示所有 500 人
  - 显示所有 marker
  - 显示所有移动 + 行为

点击某虚拟人圆圈:
  - 切换单人视角
  - 其他人 完全隐藏 (不是变灰)
  - 显示该人完整移动轨迹
  - 标记该人路过 30m 内的 marker (高亮)
  - 显示该人对每个 marker 的决策 (Like/Report/Ignore icon)
  - 顶部显示该人 persona 信息卡

返回:
  - 按 ESC 或点击右上角"上帝视角"按钮
```

#### 2.4 群体行为（结伴模拟）

```
启动时根据分布生成虚拟人:
  - 30% 单独行走
  - 70% 结伴 (按团队大小分布: 2人 50%, 3-4人 35%, 5+人 15%)

结伴成员:
  - 始终在 50m 内同步移动
  - 60% 概率第二人跟随第一人决策
  - 视觉: 同色 + 之间一条细线连接

Cairn 内部影响:
  - 结伴成员之间自动是 group marker 可见
  - 路过同 marker 时按群体动态决策
```

#### 2.5 静默计算

```
启动后无需人为操作:
  - 时间速度可调 (1× - 10000×)
  - 算法静默运行
  - 用户只观察 + 截图

人为可操作:
  - 滑块调节 (人数 / 速度 / 算法参数)
  - 切换视角 (点击虚拟人)
  - 暂停 / 继续 / 重置
  - 导出当前状态 (JSON)
```

#### 2.6 调节面板（右侧固定）

```
┌────────────────┐
│ 控制面板       │
├────────────────┤
│ 人数:    [500] │
│ 速度:  [100×]  │
│                │
│ Persona 分布:  │
│ explorer  [30] │
│ social    [40] │
│ enth.     [ 5] │
│ lurker    [20] │
│ critic    [ 4] │
│ spammer   [.5] │
│ malicious [.5] │
│                │
│ 算法参数:      │
│ τ_supply [30]  │
│ τ_report [30]  │
│ heartbeat[20%] │
│                │
│ ⏸ 暂停         │
│ ▶ 继续         │
│ ↻ 重置         │
│ 📷 截图        │
│ 💾 导出 JSON   │
└────────────────┘
```

#### 2.7 子任务（拆解到天）

##### Day 1: 基础渲染
```
✅ HTML + Canvas 2D
✅ 矩形地图 + 网格背景
✅ 虚拟人 = 彩色圆圈渲染
✅ 多人同屏 (500 人 60fps)
✅ 简单随机游走 (无路径约束)
✅ requestAnimationFrame 主循环
✅ 时间加速控制 (1×-10000×)
```

##### Day 2: Marker + 路过事件
```
✅ Marker = 彩色旗帜渲染
✅ Marker 上方信息卡片 (Like / Report 细分)
✅ 虚拟人 plant marker 动画 (落点 + 涟漪)
✅ 路过检测 (30m 半径)
✅ 路过触发: 调用 persona.decide() 函数
✅ 决策结果: Like / Report (含原因) / Ignore
✅ 视觉反馈: marker 数字 +1 + 短动画
```

##### Day 3: Persona 系统 + 群体行为
```
✅ 加载 stage0_research/personas_distribution.json
✅ 启动时按分布生成虚拟人
✅ 实现 5 种情境判断:
   - see_high_like_low_report
   - see_low_like_high_report
   - see_neutral_no_data
   - matches_personal_judgment (需要 persona 内置"认知"模型, 简化为 type 偏好)
   - contradicts_personal_judgment
✅ persona.decide(marker_state) → action 概率抽样
✅ 群体行为:
   - 30% 单独, 70% 结伴
   - 团队大小分布
   - 同步移动 + 决策跟随
✅ 调节面板 persona 比例滑块
```

##### Day 4: 算法 + 视角切换 + 截图导出
```
✅ 接入 v3.2 算法 (从 stage1 复用):
   - 寿命公式 (双时钟 + Like 衰减)
   - 心跳曝光算法
   - per-type 半衰期
✅ Marker 状态实时更新:
   - 颜色编码 (健康/衰退/沉底/心跳)
   - 寿命剩余 tooltip
✅ 视角切换:
   - 点击虚拟人 → 单人视角
   - 隐藏其他人, 显示轨迹
   - ESC / 按钮返回上帝视角
✅ Playwright 友好:
   - DOM 节点带 data-* 属性
   - 截图触发 (右上角按钮)
   - 状态导出 JSON
✅ 调节面板算法参数滑块 (实时生效, 不回溯)
```

#### 2.8 通过标准

**视觉确认**：
- ✅ 500 人在 1km×1km 区域行走，60fps
- ✅ 看到 plant 动画 + 涟漪
- ✅ 看到路过决策 icon 浮现
- ✅ Marker 颜色随状态变化
- ✅ 视角切换流畅
- ✅ 调节面板实时生效

**算法确认**：
- ✅ 好 marker 30 天沉底率 < 5%
- ✅ 坏 marker 30 天沉底率 > 90%
- ✅ 心跳机制复活样本 > 0
- ✅ 参数 ±20% 鲁棒
- ✅ 长期稳定 365 天

---

### 阶段 3：⭐ Playwright 自动测试（2-3 天，必做）

#### 3.1 自动化测试场景

```javascript
// playwright-test/sandbox.spec.js

test('Default scenario - 500 users 365 days', async ({ page }) => {
  await page.goto('file:///.../sandbox/stage2_visual/index.html');
  
  // 设置参数
  await page.locator('[data-control="user-count"]').fill('500');
  await page.locator('[data-control="speed"]').selectOption('1000x');
  
  // 启动
  await page.locator('[data-action="start"]').click();
  
  // 等待模拟 365 天 (约 1 分钟实时)
  await page.waitForFunction(() => 
    window.simState.simulatedDays >= 365
  , { timeout: 120_000 });
  
  // 自动截图
  await page.screenshot({ path: 'reports/default-final.png' });
  
  // 导出状态
  const state = await page.evaluate(() => window.simState.export());
  fs.writeFileSync('reports/default-state.json', JSON.stringify(state));
  
  // 自动分析
  const analysis = analyzeResults(state);
  expect(analysis.goodMarkerSurvivalRate).toBeGreaterThan(0.95);
  expect(analysis.badMarkerSinkRate).toBeGreaterThan(0.90);
  expect(analysis.heartbeatRevivals).toBeGreaterThan(0);
});

test('High spammer ratio scenario', async ({ page }) => {
  // 调高 spammer 比例到 5%, 验证防刷
  ...
});

test('Crowded area scenario', async ({ page }) => {
  // 集中 200 marker 在 100m 范围, 验证拥堵
  ...
});

test('Single user view switching', async ({ page }) => {
  // 切换视角验证
  ...
});
```

#### 3.2 自动分析脚本

```javascript
// 接入 Claude API 一次性分析最终结果
async function analyzeWithLLM(stateJson) {
  const summary = computeSummary(stateJson);
  
  const prompt = `这次模拟跑了 365 天, 用了以下分布:
  ${summary.personaDist}
  
  最终统计:
  - 好 marker 沉底率: ${summary.goodSink}
  - 坏 marker 沉底率: ${summary.badSink}
  - 刷子识别率: ${summary.spammerDetected}
  - 心跳复活样本: ${summary.heartbeatRevivals}
  - 报告原因分布: ${summary.reportDist}
  
  评估: 算法表现是否符合 v3.2 文档预期?
  推荐参数调整方向?`;
  
  return await callClaude(prompt);
}
```

#### 3.3 测试场景清单

| # | 场景 | 验证 |
|---|---|---|
| 1 | 默认 500 人 365 天 | 基础算法稳定性 |
| 2 | 高 spammer 比例 (5%) | 防刷有效性 |
| 3 | 高 malicious_reporter (5%) | 恶意举报防御 |
| 4 | 拥堵区 (200 marker / 100m) | 拥堵处理 4 层 |
| 5 | 冷门区 (10 marker / 1km, 5 人/天) | 长 τ 保护 |
| 6 | 全 lurker (90%) | 低参与度算法表现 |
| 7 | 全 enthusiast (50%) | 高参与度过载测试 |
| 8 | 离线/在线切换模拟 | voteQueue 验证 |
| 9 | 季节冻结模拟 (突然 30 天无人) | 冻结正确性 |
| 10 | 视角切换功能性 | UI 测试 |

#### 3.4 通过标准

```
10 个场景全部通过:
  - 截图正常 (无渲染错误)
  - 状态 JSON 导出成功
  - 量化指标达标
  - LLM 评估 verdict ≥ 8/10

最终输出:
  reports/
    ├── default-final.png
    ├── default-state.json
    ├── high-spammer-final.png
    ├── ...
    └── final_validation_report.md (LLM 综合评估)
```

---

## 4. 文件结构

```
C:/ClaudeCodeProjects/Cairn/sandbox/
├── stage0_research/  ✅ 已完成
│   ├── personas_distribution.json
│   ├── marker_content_templates.json
│   └── research_report.md
├── stage1_math/
│   ├── formula.py
│   ├── test_cases.py
│   ├── run.py
│   └── results.json
├── stage2_visual/
│   ├── index.html               ← 主沙盒 (单文件)
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── algorithm.js         ← v3.2 公式
│   │   ├── persona.js           ← Persona 决策
│   │   ├── walker.js            ← 虚拟人 + 群体动态
│   │   ├── marker.js            ← Marker 渲染 + 状态
│   │   ├── renderer.js          ← Canvas 2D 渲染
│   │   ├── ui_panel.js          ← 调节面板
│   │   ├── view_switcher.js     ← 上帝/单人视角
│   │   └── exporter.js          ← Playwright API + 截图
│   └── data/                    ← 复用 stage0 数据
└── stage3_playwright/
    ├── playwright.config.js
    ├── tests/
    │   ├── default-scenario.spec.js
    │   ├── crowded-area.spec.js
    │   ├── high-spammer.spec.js
    │   ├── ... (10 场景)
    └── reports/                 ← 自动生成
        ├── *.png
        ├── *-state.json
        └── final_validation_report.md
```

---

## 5. 时间线

```
Day 0         本计划拍板
Day 0.5       ✅ 阶段 0 调研 (已完成)
Day 1         阶段 1 数学验证 (半天)
Day 2-5       阶段 2 沙盒 (3-4 天)
Day 6-8       阶段 3 Playwright (2-3 天)

总投入: 6-8 天
```

---

## 6. 与 v3.x 文档关系

```
v3.2 (理论 9.55, subagent 评分)
  ↓
阶段 0+1 通过 → v3.2.1 (调研 + 数学验证)
  ↓
阶段 2 通过 → v3.3 (沙盒视觉 + 群体行为验证)
  ↓
阶段 3 通过 → v3.4 (Playwright 自动测试 + 锁定参数)
  ↓
PRD4 进入 Sprint Planning
```

---

## 7. 风险与限制

### 已知风险

1. **概率分布数据精度有限**
   - Stage 0 基于公开知识 + 类比，非真实 Cairn 数据
   - 缓解：沙盒后 calibrate

2. **结伴行为简化**
   - 实际结伴比 50m 同步复杂得多
   - 缓解：先做最小可用版本，迭代

3. **静默计算可能漏掉边界 case**
   - 用户不参与决策，可能漏看
   - 缓解：Playwright 10 场景覆盖关键边界

4. **500 人 Canvas 性能**
   - 60fps 在低端机可能吃力
   - 默认 500 人，性能不达标时降级到 100
   - **必须在 Day 1 加路过检测空间索引（quadtree 或 grid bucket）**
   - 否则 500 × 30 × 60Hz = 90 万次距离运算/秒会爆

### 不能验证

- 真实用户对 UI 的反应
- 跨文化行为差异
- 网络异常等技术问题

---

## 9. 实施细节澄清（修复 subagent 漏洞）

### 9.1 "type 偏好"具体定义

每个 persona 的"认知模型"用一个简单的 `type_preference` 矩阵实现：

```json
"explorer_solo": {
  "type_preference": {
    "danger": 0.85,    // 倾向相信 danger 信息
    "supply": 0.80,
    "junction": 0.75,
    "scenic": 0.50,
    "cairn": 0.40
  }
}
```

`matches_personal_judgment` 触发条件：
- marker.type 在该 persona type_preference > 0.7 → 视为"事实与认知一致"
- < 0.3 → 视为"矛盾"
- 0.3-0.7 → 视为"中性"，落到 `see_neutral_no_data` 分支

### 9.2 算法参数实时生效语义

```
τ_supply / τ_report 改变:
  - 仅影响下一 tick 的计算
  - 不重新计算历史 marker 寿命
  - 已沉底 marker 不会因参数变大而瞬间复活
  - 已健康 marker 不会因参数变小而瞬间死亡

heartbeat 率改变:
  - 立即影响下一次心跳曝光抽样

人数 / 速度 / persona 比例:
  - 人数减少: 现有 walker 淡出消失
  - 人数增加: spawn 新 walker
  - persona 比例改变: 仅影响新增 walker 分配
  - 速度: 立即生效
```

### 9.3 跟随链规则（结伴）

```
3+ 人小组采用"中心跟随"，不是链式跟随:
  - 团队第 1 人 (leader) 自由决策
  - 其他成员: 60% 概率跟随 leader 决策
  - 不跟随时按 persona 自己的概率决策

避免链式跟随的"鬼步"和振荡。
```

### 9.4 视角切换时其他人状态

```
切到单人视角时:
  - 其他人后台继续模拟（不冻结）
  - 仅渲染层隐藏其他人
  - 切回上帝视角时立即看到所有人最新状态

理由: 算法验证不能因为切视角就暂停, 否则数据不准
```

### 9.5 Playwright timeout

```
单场景 timeout: 240s (从 120s 上调)
理由: 365 天 × 1000× = 31.5s 模拟 + 渲染开销 + DOM 抓取 + 截图 ≈ 100-180s
240s 给 30% buffer
```

### 9.6 LLM 评估的 4 维加权

```
prompt 中明确告知 4 维及权重:
  - 沉底准确性 (好不沉/坏沉) 30%
  - 防刷有效性 25%
  - 心跳机制合理性 20%
  - 参数鲁棒性 (±20%) 25%

每维 0-10 分, 加权平均 ≥ 8 才算通过。
不再是单一阈值。
```

### 9.7 Stage 1 ↔ Stage 2 算法一致性

```
Stage 2 的 algorithm.js 完成后:
  - 必须用 Stage 1 同样的 50+ test cases 跑一遍
  - 输出 results.json
  - diff Stage 1 results.json
  - 必须完全一致 (浮点 ±0.001 内)
  - 才能进入 Stage 2 沙盒模拟
```

### 9.8 随机 seed

```
exporter 接受 seed 参数:
  - 默认 seed = Date.now()
  - 测试时可固定 seed 复现 bug
  - Playwright 10 场景每个用固定 seed
  - state.json 包含使用的 seed
```

### 9.9 Day 4 拆解为 Day 4a + Day 4b

```
原 Day 4 工作量过大, 拆为:

Day 4a (半天):
  ✅ 接入 v3.2 算法 (从 stage1 复用)
  ✅ Marker 状态实时更新 + 颜色编码
  ✅ Stage 1 ↔ Stage 2 一致性验证

Day 4b (半天):
  ✅ 视角切换实现
  ✅ Playwright DOM 钩子 (data-* 属性)
  ✅ 截图 + 状态导出 API
  ✅ 调节面板算法参数滑块

总时间: 阶段 2 仍是 3-4 天 (Day 4 = 1 天分两块完成)
```

---

## 10. 总结

```
v2.1 核心:
  - 极简 2D, 圆圈 + 旗帜
  - 不调 AI, 用阶段 0 概率分布
  - 上帝视角 + 单人视角切换
  - Playwright 自动测试 10 场景
  - LLM 仅在最后评估一次
  - 群体行为 + 结伴模拟
  - 全程零成本 (除 LLM 评估 ~$1)
  - 6-8 天投入
```

---

**等 subagent 评分 9.0+ 后启动阶段 1。**
