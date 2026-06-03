# v168 — 6 distinct ritual marker designs (planned, not yet shipped)

设计原则: 每个 type 不仅颜色不同,**几何骨架** 和 **动作行为** 也不同。
用户在 v157→v167 反复说"5 个一样只是颜色变",必须打破。

## 共用 base
所有 type 都基于:
- 地面 ritual_circle (RITUAL_TEX[type]) — 已有
- TeleportRune sparkle particles + crown particles — 已有
- 各自的 FlowDS material(已修复 NaN) — 已有

## 6 个 type 的独特结构

### 1. DANGER (危险红 — 警示火焰)
- 1 中央 vertical polyline (高 4.5m, 粗 0.10)
- **2 倾斜 polylines**: 从地面起点 [±0.4, 0, ±0.2] → 顶端 [±0.6, 3.5, ±0.3] (向外八字)
- 顶部红色 crown particles (急速上升)
- 唯一辨识符: **倾斜+八字**(像火苗外张)

### 2. SUPPLY/WATER (绿 — 生命圆环)
- 8 条围圆 polylines (半径 0.30, 高 3.5m, 粗 0.025)
- **整体放在 ViroNode 慢旋转**(`ringSpinSlow` 60s/圈)
- 中央 1 条细 polyline (高 4.0m)
- 唯一辨识符: **整圈缓慢旋转**

### 3. JUNCTION (橙 — 十字信标)
- 1 中央 vertical polyline (高 3.8m, 粗 0.08)
- **4 条地面放射 polyline** (使用 plain `junctionFlow` 防 crash, 长 1.5m)
- 顶部少量 crown(短)
- 唯一辨识符: **地面十字 + 中柱**

### 4. SCENIC (蓝 — 静谧光柱)
- **仅 1 条粗 polyline** (高 5.0m, 粗 0.18) — 无阵列
- 飘升 particles (慢)
- **没有 strand array** — 极简
- 唯一辨识符: **单柱孤立**

### 5. CAIRN (金 — 神圣金字阵)
- **4 角立方体阵列**: 4 条 polylines 在 [±0.3, 0, ±0.3] (正方形 4 角)
- 中央 1 条粗高 polyline (高 5.5m, 粗 0.16)
- **每个角柱有自己 sway delay**(各错开 800ms)
- 顶部金色 crown(慢上升)
- 唯一辨识符: **方阵 4 角 + 中央**(立体感)

### 6. HUT (橙红 — 灯笼)
- 1 短粗 polyline (高 2.4m, 粗 0.20)
- **3 道横向 ember 粒子带**(高度 0.4 / 1.0 / 1.6, 横向 box spawn)
- 横向 UV scroll(shader horizontal_flow=1)
- 唯一辨识符: **矮 + 横向粒子带**

## 编码模式

不再用 TeleportRune 一刀切。每个 type 用自己的 JSX。共享 SparkleCloud helper。

## 测试顺序
1. 第一波: 仅 danger + cairn (验证倾斜 polyline 和方阵 polyline 不崩)
2. 第二波: + supply (验证旋转父节点)
3. 第三波: + junction (验证地面 polyline 用 plain mat)
4. 第四波: + scenic (单柱)
5. 第五波: + hut (横向 shader)

如果某波崩,知道哪个新增的几何模式是问题。
