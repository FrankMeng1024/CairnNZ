# Cairn Route Editor — 走过的路 + 受限编辑

## Vision in one sentence

> "Cairn 不让你凭空画路，但允许你微调你已经走过的路 — 因为我们尊重真实走过的痕迹胜过虚构的可能。"

---

## Context（为什么这样做）

经过和用户深度讨论，确定了 Cairn 的 route 创建哲学：

**"实地走过 → 自动转 route → 受限微调 → 重走"**

这个哲学回应了三类用户矛盾：
1. **用户想要灵活性**（"我走错那段想换条路"）
2. **用户怕规划虚构路**（"地图上看着可走的路实际过不去"）
3. **App 想要数据安全性**（不引导用户走 OSM 上不存在但 Mapbox 显示的路）

通过限制编辑范围（只允许拖 3 个 node 距离）+ 保守文案（"建议先探路"）+ 单次 API 调用，我们做到：
- 给用户**有用**的编辑能力（修小错误，避开雨天积水的那段）
- 不给用户**危险**的能力（凭空画路，规划没走过的山道）
- API 成本和响应速度都在可预测范围

这也跟 Cairn 的产品名字契合 — cairn（石堆路标）是**前人留下的真实痕迹**，不是地图工程师画的曲线。

---

## 核心约束（产品级硬规则）

| 约束 | 数值 | 为什么 |
|---|---|---|
| **触发场景** | 仅在 Activity Detail → "Edit Route" | 必须先有真实走过的轨迹，否则不允许编辑 |
| **API 调用** | 每个 activity-to-route 编辑会话最多 1 次 Tilequery | 成本可控（一次拉 graph，本地编辑） |
| **API 范围** | route bounding box + 200m buffer | 不拉用户没走过的远处道路 |
| **拖拽距离上限** | 拖到的目标 node 距离原 node 不超过 3 跳 graph 距离 OR 500m 直线距离 | 阻止用户拖出"飞跃式"路径 |
| **超距离 UX** | 显示提示 "We can't extend the route this far — try walking that section first." 拒绝 snap | 不安全 / 不真实 |
| **节点性质** | 只能拖到 intersection（路口），不允许 off-road | 保证可走性 |
| **OSM 数据缺失** | hiking trail 模式下，如果 graph 不连通：fallback 到"只能 trim/删除节点"，不允许 snap-edit | trail 数据稀缺，硬 snap 会出错 |

---

## 用户流程（end-to-end）

```
Activity Detail (走完一次 hike)
  ↓ [Save as Route] 按钮
保存 dialog: 名字 + 模式（hiking/running/cycling）
  ↓ [Save]
Routes 列表
  ↓ 点击 route
Route Detail (新建屏)
  ↓ [Edit] 按钮
Edit Route 屏幕
  ├── 一次性拉 Tilequery（route bbox + 200m buffer）
  ├── 构建本地 graph（intersection 作 node，segment 作 edge）
  ├── 对原 trackPoints 做 Douglas-Peucker → 8-15 个骨架节点
  ├── 显示：
  │     - 半透明灰色：原始走过的轨迹（无法删）
  │     - 实线绿色：当前 path
  │     - 圆点：可拖动的骨架节点（高亮 intersection node）
  ├── 用户操作：
  │     A. 拖节点 → snap 到 nearest intersection（限 3 跳/500m 内）
  │     B. 长按节点 → 删除（前后用 graph Dijkstra 自动连）
  │     C. 长按 edge → 在那段中间加一个新 anchor
  ├── 拒绝场景：
  │     - 拖出范围 → toast "Too far — try walking that section first"
  │     - 拒绝路径 → toast "No connected path between these points"
  └── [Save] 写回 Routes
  ↓
Route Detail (更新后)
  ↓ [Start hiking with this route]
回到 HikingScreen，加载这条 route 作 selectedRoute
```

---

## 技术栈

| 组件 | 选型 |
|---|---|
| 道路数据 | **Mapbox Tilequery API** (`/v4/mapbox.mapbox-streets-v8/tilequery/...`) — 已在 Mapbox stack 内，免费额度 100k/月 |
| 路径算法 | **Dijkstra**（手写 ~50 行 JS）或 **A*** — 用来"自动连接"删除/插入操作后的段 |
| 节点空间索引 | **kdbush** (~5kb) — KD-tree，拖动时找最近 intersection 性能 O(log n) |
| 几何工具 | **@turf/turf** — 已在依赖里，line-intersect / nearest-point-on-line / simplify |
| 图渲染 | **@rnmapbox/maps** — ShapeSource + LineLayer + PointAnnotation，已熟悉 |
| 拖拽手势 | **react-native-reanimated** v4 + **react-native-gesture-handler** — 已在依赖里 |

**新增依赖**：仅 `kdbush` (~5kb)。其它都已在项目中。

---

## API 用量预估

| 操作 | 调用 | 成本 |
|---|---|---|
| Activity → Route 转换（自动 simplify，无 API） | 0 | 0 |
| 用户进入 Edit Route | 1 Tilequery | 免费额度内 |
| 拖动节点 | 0 | 0（本地算） |
| 删除节点 + Dijkstra | 0 | 0（本地算） |
| 添加节点 | 0 | 0 |
| 保存 route | 0 | 0 |

**100 用户/月，每人 5 次编辑 = 500 次 Tilequery**。距离免费 100k 上限有 200x 的 headroom。

---

## 拒绝场景的精确判定（防 edge cases）

### 场景 1：拖太远

```
distance(originalNode, targetNode) > 500m  →  REJECT
graphHopCount(originalNode, targetNode) > 3  →  REJECT
```

文案：**"Too far from your original path. Cairn respects routes you've actually walked — try walking that section first to extend it."**

### 场景 2：图上不连通

```
Dijkstra(prev, target) returns null  →  REJECT
```

文案：**"No connected road between those points."**

### 场景 3：trail 模式 + OSM 数据缺失

```
graphHopCount < 3 但 segment.surface ∉ ['paved','unpaved','dirt','trail']  →  显示警告但允许
```

文案（warning，不阻止）：**"Limited road data here. Save with caution."**

### 场景 4：编辑后 path 不连贯

不可能发生（每次操作前都验证）。但加防御性检查：保存前扫一遍 `for i in path: assert hasEdge(path[i], path[i+1])`。任何 fail → 回滚到上次有效状态 + 提示用户。

---

## 落地阶段（按周）

### Week 1 — Foundation（最小可用）

**目标**：用户能从 activity 转 route，并对 route 做最简单编辑（trim + 删节点直线连），完全不依赖 Tilequery。

**输出**：
- `Save as Route` dialog（命名 + 模式）— 已有入口，加 dialog
- Route Detail 屏（新建）— 显示 route + Edit 按钮
- Edit Route 屏 v1：
  - 显示原始 trackPoints + 简化后的骨架节点
  - 操作：trim 起止 / 长按节点删除（前后直线连）
- API 调用：**0**

**人天**：3-4 天

### Week 2 — Graph data layer

**目标**：拉 Tilequery，构建 graph，可视化但不让编辑。

**输出**：
- 进 Edit Route → 一次 Tilequery（bbox + 200m）
- 解析 GeoJSON → 构建本地 graph（nodes + edges + KD-tree 索引）
- 在地图上显示所有 intersection 节点（debug 模式）
- 验证：graph 是否连通？覆盖到 trackPoints 多少％？
- **必要的边缘情况调研**：
  - hiking trail（OSM 数据稀缺地区）的 Tilequery 返回什么？
  - 大型 route（10km+）拉一次 Tilequery 多大？(~500KB-2MB)
  - bbox 太大怎么办？切片？

**人天**：2-3 天

### Week 3 — Snap edit

**目标**：用户能拖节点到 nearest intersection，受 3 跳 / 500m 限制。

**输出**：
- 拖动手势（PanGesture）
- 拖动时：本地 KD-tree 找 nearest intersection node
- 释放时：
  - 如果在限制内 → 跑 Dijkstra 验证 prev→target→next 连通 → 替换
  - 如果超距离 → toast 拒绝
  - 如果不连通 → toast 拒绝
- 视觉：拖动时半透明，吸附时变实色 + 震动
- 修过的段在地图上 highlight（蓝色线）跟原来的（绿色）区分

**人天**：3 天

### Week 4 — Add / delete edge / 抛光

**输出**：
- 长按 edge → 在那段中间加 anchor（必须在 edge 上）
- 删除节点的 Dijkstra 自动重连（不只是直线）
- 不连贯检测 + 防御性 rollback
- Save 时把 path（[nodeId, ...]）+ 几何（LineString）写回 useRouteStore

**人天**：2-3 天

### Week 5 — Bug fix + edge cases + 测试

**人天**：2-3 天

---

## 数据模型变化

### `Route` 扩展（向后兼容）

```typescript
interface Route {
  // 已有
  id: string;
  name: string;
  activityMode: 'hiking' | 'running';
  points: TrackPoint[];      // 几何（细粒度，地图上画用）
  distanceM: number;
  elevationGainM: number;
  // 新增（可选）
  graph?: {
    bbox: [number, number, number, number];  // 编辑时拉过的 Tilequery bbox
    nodes: Array<{ id: string; lat: number; lng: number; isIntersection: boolean }>;
    edges: Array<{ from: string; to: string; geometry: [number, number][]; distanceM: number }>;
    pathNodeIds: string[];   // path 经过的 node 序列
  };
  // 没有 graph 字段的 route = 用户没编辑过的，保留旧逻辑
}
```

**migration**：旧 route 没 graph 字段 → 进入 Edit Route 时实时构建。

---

## UI 文案（决定产品调性）

| 场景 | 文案 |
|---|---|
| Edit Route 屏标题 | "Edit your route" |
| 副标题（永久） | "Cairn respects routes you've actually walked. Make small adjustments here — for new ground, try walking it first." |
| 拖太远 toast | "Too far from your path. Cairn doesn't draw routes you haven't walked yet." |
| 不连通 toast | "No connected road between those points." |
| OSM 数据稀缺警告 | "Limited road data here. Edit with caution." |
| Trail 模式说明 | "On trails, edits are limited to keep routes safe and walkable." |
| Save 成功 | "Route updated" |

文案的姿态：**克制、保守、尊重真实走过的痕迹**。这本身是 Cairn 品牌的一部分。

---

## 关键调研问题（Week 2 必须验证）

| 问题 | 怎么验证 | 决定后续 |
|---|---|---|
| Tilequery 在中国 / 新西兰 trail 区域返回什么？ | curl 几个真实点试 | 数据稀缺 → 只允许 trim/删除，不让 snap |
| 大 route（10km）的 Tilequery 响应大小？ | 实测 | > 2MB → 切多次调用 |
| Mapbox tile 的 road geometry 是 raw segment 还是已 routable graph？ | 看 GeoJSON properties | 不 routable → 自己构建 graph |
| Intersection 怎么从 raw segments 识别？ | 找 endpoint 共享的 segments | 直接用 `@turf/line-intersect` |
| Hiking trail（path/trail/footway）vs road 区分？ | 看 properties.class / properties.type | 用 properties 给路染不同颜色 |
| KD-tree 在 1000+ 节点拖动是否流畅？ | benchmark | 不够 → 改 grid hash |

---

## 失败回退（如果 Week 2 调研发现 Tilequery 不够用）

**Plan B**：放弃 graph snap，回到更简单的方案：
- 只做 Week 1（trim + 删节点直线连）
- 不引入 Tilequery
- 不 snap to road
- "Edit Route" 改名 "Trim Route"，文案改成"You can trim or simplify your route, but not extend or redirect it to roads you haven't walked"

这个 Plan B **永远可上线**，作为 Plan A 失败后的兜底。

---

## 关键文件清单

新建：
- `app/src/screens/RouteDetailScreen.tsx` — 单条 route 详情，带 Edit 按钮
- `app/src/screens/RouteEditScreen.tsx` — 编辑屏（替代旧 RouteEditorScreen 在编辑场景下的角色）
- `app/src/services/routeGraph.ts` — Tilequery 调用 + graph 构建 + KD-tree 索引
- `app/src/utils/dijkstra.ts` — 最短路径算法（~50 行）
- `app/src/utils/routeSimplify.ts` — Douglas-Peucker 包装

修改：
- `app/src/screens/MapHistoryScreen.tsx` — Save as Route 加命名 dialog
- `app/src/store/useRouteStore.ts` — Route 类型加 graph 字段
- `app/src/navigation/RootNavigator.tsx` — 加 RouteDetail / RouteEdit 路由

旧 `RouteEditorScreen.tsx` 的"从 0 画"模式：本阶段**保留**，但藏到 Settings 的 Expert 模式里。新用户默认看不到。

---

## 验收标准

落地后用户能完成：
1. ✅ 走完一次 hike → 一键转成 route，自动命名"Hike May 22 evening"
2. ✅ 进 route 详情，看到地图 + 距离 + 海拔
3. ✅ 点 Edit → 进编辑屏，看到骨架节点
4. ✅ 拖一个错误转弯的节点到 100m 外的正确路口 → 路径自动用 Dijkstra 重连
5. ✅ 长按某节点删除 → 前后段用图上最短路径自动连
6. ✅ 试着拖到 1km 外 → toast 拒绝 + 文案告诉他原因
7. ✅ 保存 → 回 Routes 列表，新版本生效
8. ✅ Hiking 屏选这条 route 重走

OTA-deliverable（不需要新 build），全部用现有依赖 + kdbush 一个新 5kb 包（5kb 不算原生模块，OTA 也能带）。

---

## 时间表

- **Week 1**：Foundation（trim + 删节点直线连，不依赖 graph）→ 这部分**就算后面 Plan B 也能用**
- **Week 2**：Graph data layer 调研 + 实现
- **Week 3**：Snap edit（核心交互）
- **Week 4**：Add/delete + Dijkstra 重连
- **Week 5**：抛光 + bug

**总投入**：12-16 工日

**MVP 可用点**：Week 1 末（已经能 trim + 删节点）
**完整可用**：Week 4 末
**用户能感知到的"哇"瞬间**：Week 3 拖动节点 snap 到路口的丝滑体验

---

## 我现在等你确认

我会从 **Week 1 开始**做（Save as Route dialog + RouteDetail 屏 + 简单 trim/删节点），等你 OK 我就开干。

这个 Week 1 的工作：
- 不依赖 Tilequery
- 不依赖 kdbush
- 不依赖 Dijkstra
- 不依赖任何新概念
- 已有的代码可以复用 80%

**3-4 天可以推一个 v11 让你测试**。等你试用后，再决定是否继续投入 Week 2-4。
