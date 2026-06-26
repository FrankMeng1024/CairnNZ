# Spike X — Dual-Precision Path Display on One Map (避免用户 confuse)

**问题**: Cairn 同一张 Memory 地图要画两种精度路径——hiking 高精度 25m 细线/紧密圆点，被动 SLC/AR 100-300m 粗块——视觉上如何不让用户困惑？

---

## 业界 5 个 app 实际处理方式

### 1. Google Maps Timeline (黄金参考)
- **粗数据 (Wi-Fi/cell/SLC 后台)** = 灰色不规则斑块标记的 **"Visited Place"**（圆形 pin + 半径 ~50-200m 模糊圈），点击才展开
- **细数据 (导航 / 步行 segment)** = **蓝色实心 polyline**，街道级吸附
- **共存方式**：按 **时间段** 分层，一天的时间线竖排显示——粗块标注"在 X 停留了 2 小时"，细线显示"步行 800m 到 Y"。地图视图上同时画，但**视觉语义完全分开**：点 vs 线。
- Source: https://support.google.com/maps/answer/6258979

### 2. Strava (双层共存最成熟)
- **个人 heatmap (粗，聚合)** = 半透明橙红色 raster tile，像热雾
- **单条 Activity (细)** = 实线 polyline 叠在 heatmap 之上
- **关键设计**：**raster (背景) + vector (前景)** 双层，**永远 heatmap 在下、线在上**，颜色不冲突（橙红雾 + 主题色细线）
- Source: https://blog.strava.com/galleries/heatmap/ + https://www.strava.com/heatmap

### 3. Pokemon GO (Adventure Sync 例)
- **精确游戏时段** = 玩家头像移动 + 25m 圆圈持续 reveal
- **Adventure Sync 后台里程** = **不画地图，只显示数字**（"本周走了 8.5km"作为 stat），蛋孵化只用距离计数
- **设计选择**：**完全不混合**——粗数据降级为非空间的 KPI，避免视觉冲突
- Source: https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1297-adventure-sync/

### 4. Arc App (iOS 时间线)
- **Visit (停留点，SLC 粗)** = 命名彩色圆点 / pill 标签（"Home"、"Office"）
- **Trip (移动 segment，高精度)** = 实线，按交通方式着色（步行绿、骑车蓝、车红）
- **共存方式**：每个 Visit 是 **节点**，每个 Trip 是 **连接节点的边** —— 图论模型，粗数据是 node、细数据是 edge，**语义上互补不重叠**
- Source: https://arcapp.net/ + https://bigpaw.tech/posts/arc-update/

### 5. Wandrer.earth (探索游戏化)
- **已走过的路 (精确 GPS)** = 高亮蓝/紫色 polyline
- **未走的路 (公共 OSM 数据)** = 默认灰色底图
- **设计选择**：**只有一种精度**——没有粗数据。把 100m 级数据直接丢弃或用作 stat。
- Source: https://wandrer.earth/help

### 6. (补充) Foursquare Swarm
- 完全把 SLC checkpoint 当 **POI 点**渲染，不画路径，连线都不画。粗 = 点，根本不试图表达"路径"。
- Source: https://www.swarmapp.com/

---

## 设计模式总结 (Material/HIG 隐含规则)
1. **数据精度 ≠ 视觉权重**：粗数据降级为 raster/halo/点，细数据保持 vector/line
2. **层级永远 raster 在下 vector 在上**（Mapbox/Material data viz 规范）
3. **不同精度用不同视觉原语**：粗 = 区域 (blob/heatmap/pin)，细 = 线 (polyline)，**绝不混用**
4. Source: https://docs.mapbox.com/help/tutorials/visualize-data-points-with-a-heatmap/

---

## 4 个候选方案

| 方案 | 视觉 | 优点 | 缺点 |
|---|---|---|---|
| **A. 双层叠加** (Strava 派) | 粗 = 奶油色低透 raster heatmap (下层) + 细 = 奶油色实线 (上层) | 信息完整；探索感强；视觉一致 | 数据重叠区域要 raster 透明度调到 30%，否则压住细线 |
| **B. 模式切换** (Wandrer 派) | toggle: "精确模式 = 只画 hiking" / "概览模式 = 只画 SLC" | 单视图永远只有一种精度，0 confuse | 用户要切换；少了"走过的总图景" |
| **C. 同色异透** (Cairn 当前) | 都用奶油，粗低透 + 细高透 + 不同形状 (块 vs 线) | 主题统一；柔和 | 边界模糊时仍 confuse，需配合形状区分 |
| **D. 语义分离 (node + edge)** (Arc 派) | SLC = 点 pin + 半径圈 ("我在这停留"); hiking = 实线 ("我从这走到那") | 语义清晰，用户大脑自动区分 stay vs move | 实现成本最高 |
| **E. 降级为非空间** (Pokemon GO 派) | SLC 不画地图，只算总里程 / 经过区域计数 | 0 confuse | 浪费数据；丢失"在城市里走过哪些区"的探索感 |

---

## 推荐: **方案 A + D 混合 (Strava 双层 + Arc 语义)**

**最不 confuse**: 方案 D (Arc 派) —— 粗 = pin/blob 节点，细 = line 边，语义本身就不同，用户秒懂。

**最游戏感**: 方案 A (Strava 派) —— 双层奶油色，hiking 像精雕的金线绣在通勤的奶油雾上，"fog of war"探索感最强。

**Cairn 落地建议** (一句话):
> SLC 数据画成**奶油色 100-200m 半径 blob (低透 25%)** 作为"模糊探索区"底层；hiking 数据画成**奶油色实线 + 圆点** (高透 80%) 作为"精雕足迹"上层。**双层都用奶油色保持一致主题**，但**形状语言完全不同 (面 vs 线)**，用户大脑自动区分"我经过过这块" vs "我精确走过这条道"——这是 Strava heatmap + Arc Trip 的合体。

---

## Sources (6 个真实链接)
1. https://support.google.com/maps/answer/6258979 — Google Maps Timeline 官方说明
2. https://www.strava.com/heatmap — Strava personal heatmap (raster) 双层叠加
3. https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1297-adventure-sync/ — Pokemon GO Adventure Sync 非空间化处理
4. https://arcapp.net/ — Arc App Visit + Trip node/edge 模型
5. https://wandrer.earth/help — Wandrer 单精度策略
6. https://docs.mapbox.com/help/tutorials/visualize-data-points-with-a-heatmap/ — Mapbox 双层 raster+vector 官方教程
