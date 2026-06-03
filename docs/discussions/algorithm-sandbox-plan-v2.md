# Algorithm Sandbox Validation Plan v2 — AI-Driven Visual Sandbox

**Version**: 2.0
**Created**: 2026-05-30
**Supersedes**: algorithm-sandbox-plan.md (v1)
**Status**: Plan, awaiting user confirmation
**Scope**: AI 驱动 + 可视化沙盒，验证 Cairn public marker 反馈算法

---

## 1. 方向修正（vs v1）

### v1 评分 6.5/10 的问题

v1 是"批处理模拟"思路：跑 365 天加速 → 出图表。
你要的是"**沙盒模拟**"：地图 + 虚拟人行走 + 实时可见 plant / 路过 / Like/Report。

### v2 核心定位

```
不是 算法工程师的 simulation tool
而是 产品验证的 sandbox game

可视化第一. 用户看着虚拟人在 NZ 真实地图上活动,
看着 marker 被 plant, 看着别人路过反应, 看着算法
实时调整曝光/寿命. 这才是"验证"。

AI 驱动: 行为不是开发者写死的概率, 是 LLM 实时决策。
零人工: 调研真实数据 + AI 模拟人 + AI 评估结果, 闭环。
```

---

## 2. 三个核心需求（用户原话拆解）

| # | 需求 | 实现 |
|---|---|---|
| 1 | 全程 AI 驱动零人工 | 阶段 0 AI 调研 + 阶段 2 LLM 决策 + 阶段 2.5 LLM 评估 |
| 2 | AI 搜索真实人类行为分布 | 阶段 0 web_search + LLM 综合 |
| 3 | HTML 可视化沙盒 | 阶段 2 Leaflet + Canvas + 调节面板 |
| 3a | - 地图作为背景 | Leaflet + OpenStreetMap NZ tile |
| 3b | - 可调节人数/行为/时间 | dat.GUI 风格右侧面板 |
| 3c | - 实时可见虚拟人行走 | Canvas overlay 插值动画 |
| 3d | - 实时可见 plant 动作 | 落点动画 + 涟漪 |
| 3e | - 实时可见路过+行为 | 人物停顿 + 行为 icon 浮现 |
| 3f | - 后续人看到 marker 状态 | marker 颜色编码 + 实时数据 tooltip |

---

## 3. 阶段化推进（4 阶段）

### 阶段 0：AI 真实数据调研（半天，前置）

**目标**：用 AI 找到真实社交平台行为分布，不靠开发者拍脑袋。

**做法**：

```
Prompt to Claude (with web_search):

"你是社交产品数据分析师。基于公开论文/平台数据/学术研究, 
估计户外/UGC 平台用户路过一个 marker 时的行为分布:

1. 主动 Like 的比例
2. 主动 Report 的比例 (按 6 类原因分布: 信息错误/危险错误/广告/仇恨/隐私/不喜欢)
3. 完全不互动的比例
4. 不同 persona 的差异:
   - 老用户 vs 新用户
   - 热情用户 vs 严苛用户
   - 刷子 / 恶意举报者比例

每个数字必须有来源引用 (论文 / 公开数据 / 类比产品)。

参考数据源:
- AllTrails review 行为论文
- Reddit r/Hiking 投票统计
- Stack Overflow voting paper
- TripAdvisor review behavior research  
- Strava engagement report

输出 JSON 格式:
{
  'normal_user': { 'like_rate': 0.30, 'report_rate': 0.05, 'ignore_rate': 0.65, 'sources': [...] },
  'enthusiast': { ... },
  ...
}"
```

**产出**：

```
sandbox/data/
  ├── personas_distribution.json    ← AI 调研出的真实分布 (带 sources)
  ├── marker_content_templates.json ← LLM 生成的 50 个 NZ 风格 marker 内容
  └── research_report.md            ← AI 调研过程 + 数据来源
```

**通过标准**：
- ✅ 每个 persona 行为数字有 ≥3 个独立来源引用
- ✅ 来源白名单（修复 v2 阻塞）：
  - 同行评审论文（Google Scholar, arXiv）
  - 平台官方报告（AllTrails / Strava annual report）
  - 政府/学术机构数据（DOC, NZ Stats）
  - **不算**：博客、Medium 文章、SEO 内容农场
- ✅ 50 个 marker 内容覆盖 5 个 type，符合 NZ 户外语境

**失败回退**：
- AI 调研失败（数据源不足、API 限制）
- 降级方案：用文献综述 + 最少 1 个权威来源 + 开发者标注"低置信度"
- 不阻塞阶段 1+2 推进，但报告里明示局限

**时间**：半天

---

### 阶段 1：数学验证（保留 v1，半天）

**目标**：公式自洽性验证，独立于可视化。

**做法**（同 v1）：
- Python 脚本实现 v3.2 完整公式
- 跑 50-100 hand-crafted case
- 对照 v3.2 §7.5 + §17 表

**产出**：
```
sandbox/stage1_math/
  ├── formula.py
  ├── test_cases.py
  ├── run.py
  └── results.json
```

**通过标准**（同 v1）：
- 50+ case 全通过
- 边界 case 无异常（L=0、Δt=0、2 年上限、冬季冻结）

**时间**：半天

---

### 阶段 2：⭐ 可视化沙盒（4-5 天，核心）

**目标**：你能在浏览器里看到虚拟人在 NZ 地图上活动，实时验证算法行为。

#### 2.1 技术栈选型

| 层 | 选择 | 理由 |
|---|---|---|
| **地图** | Leaflet + OpenStreetMap | 免费 / 无 API key / 本地 HTML 即用 |
| **底图区域** | NZ Tongariro 或 Routeburn | 真实场景 + 步道复杂度合适 |
| **虚拟人渲染** | Canvas 2D overlay | 100-500 人 Canvas 够用 |
| **行走路径** | 真实 OSM 步道 polyline | 沿真实 track 插值移动 |
| **调节面板** | dat.GUI 或手写 HTML | 右侧固定 panel |
| **AI 决策** | Claude Haiku API（快+便宜） | 每次 encounter 调用 |
| **状态管理** | Vanilla JS + Map<id, marker> | 无需框架 |

#### 2.2 子任务（拆解到天）

##### Day 1：地图与基础动画
```
✅ Leaflet 加载 NZ tongariro 区域
✅ OSM 步道数据获取 (确定方案):
   方法: 用 Overpass turbo 一次性查询 Tongariro 区域,
        下载 GeoJSON 并 commit 到 data/tongariro_tracks.geojson
   查询: [out:json];
        (way["highway"="path"](around:50000, -39.1576, 175.6453);
         way["highway"="footway"](around:50000, -39.1576, 175.6453);
         way["highway"="track"](around:50000, -39.1576, 175.6453););
        out geom;
   预期文件大小: < 2 MB
   兜底: 缺失支线用 QGIS 手动补 1-2 条
   不依赖运行时 API (避免 Overpass 限流/503)
✅ Canvas overlay 在 Leaflet 上 (Leaflet.canvas-markers 或自写)
✅ 虚拟人对象 + 路径插值 + 行走动画 (60fps)
✅ 多个虚拟人同屏 (默认 100 人, 上限 200, 压测 500)
✅ 性能优化:
   - 空间索引 quadtree
   - encounter 命中检测降频到 1Hz (不是 60Hz)
   - requestAnimationFrame 而非 setInterval
   - 视口剔除: 屏幕外的 walker 跳过 render
```

##### Day 2：marker plant + 路过事件
```
✅ 虚拟人到达预设位置 → plant 动画 (落点涟漪)
✅ marker 在地图上渲染 (icon + 类型颜色)
✅ 其他虚拟人路过 marker 30m 内 → 触发 encounter event
✅ encounter 触发动画 (人物停顿 + 思考 icon)
✅ encounter 结果 (Like / Report / Ignore) → 行为 icon 浮现
```

##### Day 3：AI persona 决策 + 调节面板
```
✅ 启动时 LLM 批量生成 N 个 persona profile (人格 + 偏好描述)
✅ 每次 encounter 调 Claude Haiku:
   prompt: "你是 [persona description], 路过一个 marker 写着
           [marker content]. 你已走 [duration], 看到了 [N] 个其他 marker.
           你会 Like / Report (选哪类原因) / Ignore?"
   output: {action, reason}
✅ 决策缓存 4 维 key (扩维, 解决 v2 漏洞):
   key = (persona_id, marker_id, duration_bucket, seen_count_bucket)
   duration_bucket: 0-1h / 1-3h / 3-6h / 6h+
   seen_count_bucket: 0 / 1-5 / 6-15 / 16+
   防止简化成 2 维导致行为失真
✅ API 成本控制:
   - daily budget cap (默认 $3/天)
   - 并发 rate limit (5 req/s)
   - 时间速度 > 1000× 自动切死规则模式 (用阶段 0 分布抽样, 不调 LLM)
   - 重置按钮加二次确认防误烧
✅ 调节面板:
   - 人数滑块 (10-200, 上限 500 压测模式)
   - 5 persona 比例滑块 (归一化)
   - 时间速度滑块 (0.1× - 10000×, log scale)
   - 算法参数滑块 (τ_supply, τ_report, 心跳率)
   - 暂停/单步/重置
```

##### Day 3.5：调节参数生效语义表 (新增, 解决 v2 阻塞)
```
所有调节参数生效策略:

| 参数 | 增加时 | 减少时 | 是否回溯历史 |
|------|--------|--------|-------------|
| 人数 | spawn 新 walker (淡入) | 现有 walker 淡出消失 | 否 |
| persona 比例 | 影响新增 walker 分配 | 同左 | 否 (避免行为撕裂) |
| 时间速度 | 立即生效 | 立即生效 | 不适用 |
| τ_supply / τ_report | 仅影响 t+1 计算 | 同左 | ❌ 不回溯 |
| 心跳率 | 仅影响 t+1 曝光抽样 | 同左 | ❌ 不回溯 |
| Report 权重 | 仅影响 t+1 算法 | 同左 | ❌ 不回溯 |

核心原则: 算法参数仅影响后续, 不回溯历史 marker 状态
理由: 回溯会让用户看到 marker 状态跳变, 失去观察价值
```

##### Day 4：算法状态可视化 + LLM 评估
```
✅ 每个 marker 实时显示:
   - Like 数 (徽章)
   - 颜色编码: 绿(健康) / 黄(衰退) / 红(沉底) / 蓝(心跳曝光)
   - 点击弹出详细 panel (寿命剩余 / 当前热度 / Report 原因分布)
✅ 全局统计面板 (右上角):
   - 当前 marker 总数 / 健康 / 沉底 / 心跳
   - 累计 Like / Report
   - 模拟时间 (年/月/日)
✅ 模拟跑完触发 LLM 评估:
   prompt: "这次模拟跑了 [模拟时长], 用了 [persona 比例].
           最终: 好 marker 沉底率 X%, 坏 marker 沉底率 Y%,
           刷子识别率 Z%, 心跳复活样本 N 个.
           你的评估: 算法表现是否符合 v3.2 文档预期?
           推荐参数调整?"
✅ 输出 verdict + suggested adjustments
```

#### 2.3 关键设计

**Mode 切换**（同 codebase 双模式）：

```
Mode A: Visual Sandbox (用户看)
  - 5-50 虚拟人
  - AI 实时决策 (慢但真实)
  - 时间速度可调 (能看到行走)
  - 用户观察 + 截图 + 调参

Mode B: Batch Validator (算法验证)  
  - 1000+ 虚拟人, headless
  - 用 Mode A 收敛出的分布做模板
  - 跑 100 次 Monte Carlo
  - 出统计报告
  - 阶段 3 用
```

**Marker 内容生成**：

```
不能让 AI 对抽象 ID 决策. 每个 marker 必须有:
  - 类型 (danger/scenic/supply/junction/cairn)
  - 标题 (LLM 生成的 NZ 风格, 如 "陡坡碎石, 建议有登山杖")
  - 创建者 persona 描述

阶段 0 已经生成 50 个模板, 沙盒启动时随机分配给虚拟人 plant
```

**AI 决策成本控制**：

```
单次 Claude Haiku call ≈ $0.0001 (input) + $0.0005 (output) ≈ $0.0006
模拟 100 人 × 30 次 encounter = 3000 calls = ~$1.8 / 次模拟
缓存命中后 50% calls 不再调 → ~$0.9 / 次

可接受成本. 未来 batch 可换更便宜模型.
```

#### 2.4 通过标准

```
视觉确认 (用户主观):
  ✅ 能看到虚拟人在地图上行走
  ✅ 能看到 marker 被 plant + 涟漪
  ✅ 能看到路过时人物停顿 + 行为 icon
  ✅ 能看到 marker 颜色随状态变化
  ✅ 调节面板实时影响模拟

算法确认 (LLM 评估):
  ✅ verdict ≥ 8/10
  ✅ 好 marker 30 天沉底率 < 5%
  ✅ 坏 marker 30 天沉底率 > 90%
  ✅ 心跳机制复活样本 > 0
  ✅ 参数 ±20% 鲁棒
```

**时间**：4-5 天（修正 v2 偏紧估算）

---

### 阶段 3：Batch Monte Carlo（2 天，可选）

**目标**：阶段 2 视觉验证通过后，跑大规模统计验证。

**做法**（修复 v2 Mode B 成本阻塞）：
- 同 codebase 提取核心引擎，去掉渲染
- **Mode B 不调 LLM API**（避免 $200+/次成本爆炸）
- 用 Mode A 收敛出的"persona × marker_type → action 概率分布表"做加权抽样
- 收敛过程：Mode A 跑 5-10 次 → 统计每个 persona 对每类 marker 的实际行为分布 → 写入 `persona_action_distribution.json`
- 1000 虚拟人 × 365 天 × 100 次 Monte Carlo
- LLM 仅在最后调用一次评估 final report (Sonnet, 一次 ≤ $0.5)

**LLM 评估输入裁剪**（修复 v2 漏洞）：
- 不传完整事件流（10 万+ 事件超 context）
- 先做统计 summary：每 persona 行为分布 / 每类 marker 沉底率 / 参数敏感度
- 仅传 summary + key insights 给 LLM

**产出**：
- `sandbox/stage3_batch/` 完整代码
- `sandbox/reports/final_validation.md`

**通过标准**：
- 阶段 2 全部
- 100 次 Monte Carlo 标准差 < 10%
- 参数 ±20% 鲁棒

**时间**：2 天

---

## 4. 时间线

```
Day 0       本计划拍板
Day 0.5     阶段 0 AI 调研 (半天)
Day 1       阶段 1 数学验证 (半天)
Day 2-6     阶段 2 可视化沙盒 (4-5 天)
Day 7-8     阶段 3 batch (可选, 2 天)

不含阶段 3: 6-7 天
含阶段 3:   8-9 天
```

---

## 5. 文件结构

```
C:/ClaudeCodeProjects/Cairn/sandbox/
├── stage0_research/
│   ├── personas_distribution.json
│   ├── marker_content_templates.json
│   └── research_report.md
├── stage1_math/
│   ├── formula.py
│   ├── test_cases.py
│   └── results.json
├── stage2_visual/
│   ├── index.html              ← 主沙盒页面 (单文件)
│   ├── lib/
│   │   ├── leaflet.js
│   │   └── leaflet.css
│   ├── data/
│   │   ├── tongariro_tracks.geojson  ← OSM 步道数据
│   │   └── nz_bounds.json
│   ├── src/
│   │   ├── walker.js           ← 虚拟人 + 路径插值
│   │   ├── marker.js           ← marker 渲染 + 状态
│   │   ├── algorithm.js        ← v3.2 公式 (复用阶段 1 逻辑)
│   │   ├── ai_persona.js       ← Claude API 决策
│   │   ├── ui_panel.js         ← 调节面板
│   │   └── stats.js            ← 全局统计
│   └── config.json             ← 算法参数 + 默认人数
├── stage3_batch/
│   ├── headless_runner.js
│   └── monte_carlo.js
└── reports/
    └── final_validation.md

docs/discussions/
└── algorithm-sandbox-plan-v2.md  ← 本文档
```

---

## 6. 与 v3.x 文档关系

```
v3.2 (理论 9.55) 
  ↓
阶段 0 + 1 通过 → v3.2.1 (数据 + 数学验证)
  ↓
阶段 2 通过 → v3.3 (可视化群体行为验证, 锁定参数)
  ↓ (可选)
阶段 3 通过 → v3.4 (大规模 Monte Carlo, 生产就绪)
```

每阶段产出报告作为 v3.x 文档附录。

---

## 7. 关键决策点（待你拍板）

| # | 决策 | 默认建议 |
|---|---|---|
| Q1 | NZ 默认底图区域? | Tongariro Crossing (热门, 步道多) |
| Q2 | 阶段 2 用 Claude Haiku 还是 Sonnet? | Haiku (快+便宜, 行为决策足够) |
| Q3 | AI 决策成本上限? | 单次模拟 ≤ **$3**（更安全，从 $5 降低） |
| Q4 | 是否纳入阶段 3 batch? | 阶段 2 看效果再决定 |
| Q5 | 沙盒功能优先级 (Day 1-4 顺序)? | 接受默认 |
| Q6 | 调节参数实时生效 vs 重启生效? | 实时 (更直观) |
| Q7 | 单沙盒模拟最大虚拟人数? | **默认 100, 上限 200, 压测 500**（统一口径） |

---

## 8. 风险与限制

### 已知风险

1. **AI 决策不稳定**：LLM 输出可能漂移，同一 (persona, marker) 不同时间得到不同结果
   - 缓解：缓存 + temperature 0
2. **OSM 步道数据缺失**：偏远区域 polyline 可能不全
   - 缓解：选 Tongariro 这种 well-mapped 区域；预存 GeoJSON 兜底
3. **API 成本失控**：调节速度过快可能触发大量并发 API
   - 缓解：rate limit + 上限警告
4. **Canvas 性能**：500 虚拟人 + 1000 marker 可能掉帧
   - 缓解：空间索引 + 视口剔除 + WebGL fallback

### 验证局限（明示）

- 沙盒不能验证：真实用户对 UI 的反应、跨文化差异、网络异常
- 沙盒能验证：公式数学、群体行为、参数敏感度、AI 模拟下的算法表现

---

## 9. 与 v1 计划差异总结

| 维度 | v1 | v2 |
|---|---|---|
| 核心定位 | 批处理算法工程 | 可视化产品沙盒 |
| 阶段 0 | 阶段 3 才做 | 提前到前置 |
| 阶段 2 形态 | 图表 + summary | 地图 + 虚拟人 + 实时动画 |
| AI 角色 | 仅分析输出 | 调研 + 决策 + 评估 (闭环) |
| persona 行为 | 死规则 (if random) | LLM 实时决策 |
| 调节能力 | 无 | 5+ 滑块实时调整 |
| 时间预算 | 4-5 天 | 6-7 天 (不含阶段 3) |
| 评分 | 6.5/10 | 待 subagent 评 |

---

## 10. 总结

**核心变化**：从"算法跑数据出报告"变成"AI 驱动的可视化产品验证沙盒"。

**3 个 AI 节点闭环**：
1. **入口** — AI 调研真实行为分布
2. **运行** — AI 模拟每个虚拟人的决策
3. **出口** — AI 评估算法表现 + 推荐参数

**用户能看到的**：
- 虚拟人在 NZ Tongariro 地图上沿真实步道行走
- 某个人在某点 plant marker，落点涟漪
- 其他人路过 30m 时停顿，思考 icon 浮现
- 浮现 Like/Report 行为 icon，marker Like 数 +1 或颜色变化
- 调节滑块改变人数 / 比例 / 速度，看到长期演化
- 跑完一轮 LLM 自动给出评估报告

**这是用户要的"沙盒"**。

---

**等用户拍板 §7 七个决策点后启动。**
