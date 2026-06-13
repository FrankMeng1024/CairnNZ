# v6.2.2 开发 Plan(brush-edit 业务驱动重写)

**版本**:v6.2.2
**状态**:待 4 眼独立 review
**Review 流程**:Plan + Code 必须经 **R3 + R4(全新 context,不复用)双双 PASS 才推**

---

## 0. 业务理解(锁定,所有技术决策服从这一节)

### 0.1 用户行为分布(80/15/5)

| 频率 | 用户行为 | 系统应该 |
|---|---|---|
| **80%** | 城市 + 沿路画 + ±5-10m 飘 | **必须 snap 干净** |
| **15%** | 城市 + 一段斜穿小区(≤20m) | 接住,bearing 容差 |
| **<2%** | 故意穿楼 / 乱画 | 拒(看得出就行) |
| **<3%** | 几笔模糊不准 | 拒(用户重画)或勉强 snap |
| **NZ 主战场** | 山区沿真 trail | 现阶段拒("无数据")— 未来 LINZ 补 |

### 0.2 用户接受 / 不接受清单

✅ 接受:
- 系统 snap 偏一条平行小路 → 用户 Preview 一眼看出 → undo
- 山区拒收 + 文案"未识别"
- 模糊笔被拒 + 提示重画
- FA 真实场景下 < 2%(用户兜底 undo)

❌ 不接受:
- 沿路画却被拒(误拒主流场景)
- 等待超过 3 秒
- 误接受穿楼且无声无息(用户跟着错路走)

### 0.3 v6.2 真正要做的事

1. **80% 主流"沿路画"必须顺**(包括飘 ±10m)
2. **极端 case 不要无声接受**(让用户 Preview 一眼能看出 → undo)
3. **山区诚实拒**
4. **响应 ≤ 3s**
5. **可灰度,出问题能关回来**(v249-v255 失败的根因之一)

**FA = 1.7% 完全可接受**(用户主流场景不会触发,触发了也是"小区平行路 / 草坪 / 寺院"这种 user 视觉一眼能看出的 case,undo 兜底)。

---

## 1. 算法(基于 250 case 实测,数据撑)

### 1.1 调用参数

```ts
// services/routing/mapmatch/MapMatchingClient.ts (重写参数)
profile: 'walking'
radiuses: per coord = 8m  // (不是 plan v6.2 写错的 3m;实测 8m 是 80% 主流接受最优)
bearings: per coord = computedBearing ± 25°  // input bearing,允许容差
annotations: 'distance'
tidy: false
geometries: 'geojson'
overview: 'full'
```

**bearings 必须真接进 URL** — `MapMatchingClient.ts buildUrl()` 加 `&bearings=` query。每个 stroke 入口前 `computeBearings(stroke.points)` 得到 `[B,25;B,25;...]`,跟 radiuses 同长。

### 1.2 接受门(ALL pass)

| 门 | 规则 | 数据来源 |
|---|---|---|
| **G1 锚点** | 笔起或终至少一个在原线 50m 内 | 实测防 267m 直线 bug |
| **G2 几何偏移** | 笔每个点离 snap 路 max-perp ≤ **10m** | 250 case Pareto 最优 |
| **G3 朝向一致** | 笔总体方向 vs snap 总体方向 ≤ **15°** | spike-final-NT 杀 3/4 FA |
| **G4 Mapbox 自报错** | 仅 `code === 'Ok'` 进 G1-G3;其他全拒 | 包括 NoMatch / NoSegment / 4xx / 5xx / timeout |

**G2 / G3 的"max-perp"和"方向"明确定义**:
- max-perp:`max(perpDistanceM(stroke.points[i], snapPolyline))` for i = 0..N-1
- 方向:`bearing(stroke.points[0], stroke.points[last])` vs `bearing(snap[0], snap[last])`,差值取 [0, 180]

### 1.3 删除以下旧判据(v249-v255 错误)

- ❌ confidence ≥ 0.5(目标地区噪音)
- ❌ tracepoint distance ≤ 8m(无区分能力)
- ❌ null tracepoint ratio
- ❌ alternatives_count
- ❌ matched_len 比例 50%-150%
- ❌ snapDisplacementStats(fracBad / maxDispM)
- ❌ Catmull-Rom fallback(歪扭根因)
- ❌ smoothCatmullRom 函数(及所有调用点 — R1 指出 3 处仍在 fallback 分支用)

### 1.4 已知边界(诚实声明)

- **J2-039 类型**:小区平行马路 ≈ 6° + ≈ 9m perp → 4 门全过 → FA。无算法解,UX 兜底(Preview + undo)。
- **J4-SH-010**:plaza 边界(15° 边界)— G3 用 `<` 而非 `≤`,接受边界保守。

---

## 2. 数据层

### 2.1 LngLat 类型扩展(R1 / R2 都警告了)

```ts
// services/routing/corridor/PolylineSampler.ts
export interface LngLat {
  lng: number;
  lat: number;
  alt?: number | null;  // v6.2.2 新加
}
```

涉及 14 个 import 文件。所有传 `LngLat[]` 的位置都 carry alt 通过。

### 2.2 alt 保留(完整路径,~60 LOC)

| 路径 | 修法 |
|---|---|
| Save-as-route 不编辑 | `RouteEditorScreen` 6 个 strip 点全部去掉 |
| 原 GPS 段(splice 头尾)| `lerpLocal` / `originalUpTo` / `originalFrom` 4 函数 carry alt(线性插值)|
| Mapbox snap 段 | `MapView.queryTerrainElevation([lng,lat])` 本地查 |
| `spliceMatched` dedupe / despike | 去重时**保留两点中非 null 的那个 alt** |

### 2.3 Terrain 启用(必修,~10 LOC)

```tsx
<MapView ref={mapViewRef} ...>
  <RasterDemSource id="mapbox-dem"
    url="mapbox://mapbox.mapbox-terrain-dem-v1"
    tileSize={514} maxZoomLevel={14} />
  <Terrain sourceID="mapbox-dem" exaggeration={1} />
  ...
</MapView>
```

**DEM 加载竞态**:
- snap 完成时 DEM 可能未加载 → `queryTerrainElevation` 返回 null
- 处理:先尝试查询;null 时**重试 200ms 一次,最多 3 次**
- 仍 null → 该点 `alt = null`(graceful);UX:海拔图显示"部分缺失"
- **不阻塞 Preview / Save**,海拔是辅助数据

### 2.4 backwards compat

| 现存 route 类型 | 加载行为 |
|---|---|
| v249-v255 saved | route.points 无 alt → 加载正常,海拔图显示 0 |
| v6.2.2 saved | route.points 有 alt → 海拔图显示真实 |
| 路上没 alt 的字段 | 全代码 null-safe(`a != null` 守卫,已有)|

### 2.5 distanceM / elevationGainM 重算

Save 时基于最终 polyline:
- distanceM:haversine sum(简化,够用)
- elevationGainM:对 alt 序列求"上升累计"(已有 `calculateElevationGain`)

---

## 3. 状态管理修复(v249-v255 遗留 bug 全清单)

| Bug | 修法 |
|---|---|
| undo 不重建 walkedIndex | undo 时 `buildWalkedIndex(last.matchedPoints)` |
| UndoEntry 类型不含 walkedIndex | 类型扩展 + 5 处 push 站点更新 |
| resetEdits 不清 cache / warning / activeStrokeId | 全清 |
| eraseAt / removeStroke / beginTrimDrag undo push 缺字段 | 同步扩展 |
| sticky lastWarning 跨 stroke 残留 | beginStroke 清 lastWarning |
| editOpSeq fence + 中途 hardware-back / 后台 | Mapbox await 期间 fence 触发 → 静默 abort,不写半状态 |
| BackHandler / app-background 中 | 持久化 EditSessionPersistence 在 commit 时(不是中途) |

### 3.1 多笔顺序与 walkedIndex 同步

**v6.2.2 锁定**:多笔在一次 Preview 中**并发独立判**(每笔与原 walkedIndex 比较)。锚点门只查**编辑会话开始时的 walkedIndex**(原 GPS),不被前一笔影响。

理由:用户画 4 笔时,他想象的是"4 笔都基于原线",不是"第 4 笔基于前 3 笔修过的线"。

---

## 4. UX(单行 XOR 三态)

### 4.1 错误显示

`EditOverlayV236.tsx` statusRow 唯一 1 行:

```
isComputing → "Computing…"(优先)
lastError   → 红 pill(非空且非 computing)
默认        → "N/8 brush strokes"
```

**lastWarning 这次不展示**(R1/R2 发现 warning 与 error 同时出现会 race)。简化:**任何 v6.2.2 拒收都用 lastError**,没有 warning。

### 4.2 顶部 pill 全删

- BrushOverlay 顶部 lastError pill → 删
- EditOverlayV236 顶部 lastWarning banner → 删

### 4.3 Hint text

`hint = "Tap the pencil and draw a detour..."` 在 lastError 时**完全隐藏**。lastError 清(setTimeout 2.5s)后**重新显示**。

### 4.4 拒收笔处理

Preview 后任何 stroke 拒收:
- **整笔从画布消失**(brushStrokes 数组移除)
- lastError 红字提示(2.5s 自动消失)
- **多笔时**:通过的笔保留 sage 显示,拒收的消失;lastError 显示"X strokes rejected"

### 4.5 按钮位置(全局)

- Cancel / Delete **永远左**
- Save / Edit / Done **永远右**
- v255 已修过,本期再 verify 不动

### 4.6 拒收文案

- G1 不在路 / 起点不对:"画笔起点必须在原路线上"
- G2 偏离:"笔没在路上 — 试着贴近路画"
- G3 方向不一致:"笔的方向跟路不一致 — 试着沿路画"
- G4 Mapbox NoMatch:"未识别到这条路"

### 4.7 Save-as-route 名字

- 必须用户填(无默认)
- view-mode 进入 existing route 自动填 route.name
- canSaveView = name.trim() !== '' && !saving(改名也允许 save)

### 4.8 起笔规则

- 第 1 笔起点必须在原线 50m 内
- 后续笔可从已存 stroke 接(eraser-split 后续画支持)
- G1 锚点门保证不脱链

---

## 5. **Feature Flag + Telemetry + 灰度发布**(v6.2.2 关键防灾)

### 5.1 Feature flag

```ts
// config/featureFlags.ts (扩展)
brushEditV62: boolean  // default false in production
```

启动时读 remote config(已有机制):
- false → 走 v255 旧逻辑(不动)
- true → 走 v6.2.2 新算法

**问题出现 → remote config flip false → 全网回退,无需新 OTA**。

### 5.2 Telemetry 埋点

通过现有 `editAnalytics`:

```
brush_preview_started   { stroke_count }
brush_preview_completed { stroke_count, accepted, rejected, ms_taken }
brush_gate_failure      { gate: 'G1'|'G2'|'G3'|'G4', stroke_idx }
brush_undo              { from_state }
brush_save_committed    { stroke_count, distance_m, has_alt }
brush_mapbox_error      { reason, ms_to_error }
brush_alt_dem_null      { points_with_null_alt, total_points }
```

监控 dashboard:
- FA proxy:用户 Preview 后 undo 比例(如果 > 20%,可能 FA 高)
- 主流 FR:G2 拒收率(如果 > 30%,可能阈值太严)
- Mapbox 错误率
- DEM 缺失率

### 5.3 灰度发布

| 阶段 | flag | 范围 |
|---|---|---|
| Day 0 | brushEditV62 = false | 全网 100% v255(无变化) |
| Day 1 | flag = true for `dev_users` | 内部测,验证 telemetry 正常 |
| Day 2-3 | flag = true for **1%** users | 监控 FA-proxy / FR / 错误率 |
| Day 4-7 | 一切正常 → **10%** | 同上 |
| Day 8+ | 一切正常 → **100%** | 全网 ship |

任一阶段任一指标异常 → flip flag false 立刻回滚。

---

## 6. 测试(单元 + 集成 + 真机)

### 6.1 单元测试(必加)

| 测试 | 验证 |
|---|---|
| G1 锚点 | 起终点都 50m 外 → 拒;起点 30m 内 → 通 |
| G2 偏移 | 模拟 stroke 离 snap 路 12m → 拒;5m → 通 |
| G3 朝向 | stroke 方向 vs snap 方向 30° → 拒;10° → 通 |
| G4 Mapbox 错误 | mock NoMatch → 拒;mock 5xx → 拒;mock 超时 → 拒 |
| spliceMatched alt 保留 | 头尾段 alt 不丢 |
| dedupe / despike alt | 保留非 null 的 alt |
| undo walkedIndex 重建 | undo 后 walkedIndex 反映 last.matchedPoints |
| resetEdits 全清 | walkedIndex/cache/warning/activeStrokeId 清 |
| save-as-route 不 strip alt | route.points[0].alt === sessionTrackPoints[0].alt |
| densify 后 alt 线性插值 | 中间插点 alt 在两端之间 |
| backwards compat | v255 saved route(无 alt)加载不崩 |
| feature flag false | 走 v255 路径 |
| feature flag true | 走 v6.2.2 路径 |

### 6.2 集成测试(用 250 case)

加载 `spike-jury-J*.json` 250 笔,mock Mapbox 响应 跑算法,验:
- 城市 ACCEPT bucket pass 率 ≥ 70%(实测 84%)
- 城市 REJECT bucket FA ≤ 1.7%(已知边界)
- NZ 山区 NoMatch 全拒
- 多笔无 267m bug
- Eraser-split A1/A2 各自独立判

### 6.3 真机测试矩阵(灰度 1% 前必跑)

| # | 场景 | 期望 |
|---|---|---|
| 1 | 沿主路画 200m + ±5m 飘 | sage,Preview 干净 |
| 2 | 沿主路 + 50m 斜穿小区 | 接住 |
| 3 | 穿楼直线 200m | 拒("画笔不在路上") |
| 4 | 250m 外乱画 | 拒("超出范围") |
| 5 | 起点 70m 外 | 拒("起点必须在原线") |
| 6 | 4 笔多笔(主路 + 斜路 + 主路 + 斜路) | 各笔独立,无 267m 直线 |
| 7 | eraser 切中段 → 各半笔 Preview | 各半独立判 |
| 8 | Preview 后 undo 再画 | walkedIndex 正确 |
| 9 | reset 后起点 30m 离 reset 前 commit | 拒(walkedIndex 已回原线) |
| 10 | 编辑后 save → 进 RouteDetail | alt 保留 |
| 11 | NZ Tongariro 上画 | 拒("未识别")|
| 12 | UI 检查:Cancel 左 / Save 右 / 单行红字 | 符合 |
| 13 | App 后台中途 → 回前台 | 状态恢复或 graceful 重置 |
| 14 | hardware back 中途 | 同上 |
| 15 | iOS + Android 同测 | 关键路径无差异 |

### 6.4 监控真机指标(灰度阶段)

- 沿路画 ACCEPT 率(主流场景必须 ≥ 70%)
- Preview 平均 latency(必须 ≤ 3s)
- DEM tile load 失败率
- Mapbox 错误率

---

## 7. 文件改动(基于 R1/R2 修订)

### 7.1 修改文件

| 文件 | 改动 | LOC 估 |
|---|---|---|
| `src/services/routing/corridor/PolylineSampler.ts` | LngLat 加 alt?字段 + lerpLocal carry alt | 10 |
| `src/services/routing/mapmatch/MapMatchingClient.ts` | profile walking、radiuses=8、**bearings 真接 URL** + parse | 30 |
| `src/store/useRouteEditStore.ts` | 4 道门重写 + undo/reset 修 + 删 5 旧判据 + 删 smoothCatmullRom 调用 + 多笔正确处理 | 200 |
| `src/components/map/BrushOverlay.tsx` | 顶部 lastError pill 删 | 10 |
| `src/components/map/EditOverlayV236.tsx` | statusRow 三态 + Cancel左/Save右 + 顶部 banner 删 | 50 |
| `src/components/map/BrushStrokeLayer.tsx` | 仅渲染 sage(拒收笔已被 store 移除) | 5 |
| `src/screens/RouteEditorScreen.tsx` | 6 处 strip alt 都修 + Terrain 启用 | 30 |
| `src/store/useRouteEditStore.ts` (cont.) | UndoEntry 类型扩展 walkedIndex | 已含 |
| `src/services/LocalRouteExtras.ts` | alt schema 扩展(向后兼容) | 10 |
| `src/config/featureFlags.ts` | brushEditV62 flag | 5 |
| `src/services/routing/editAnalytics.ts` | 7 个新事件 | 30 |
| `src/components/OtaBadge.tsx` | 255 → 256 | 1 |

### 7.2 新增文件

| 文件 | 用途 |
|---|---|
| `src/utils/strokeBearing.ts` | computeBearings(stroke) + bearingDifference helper |
| `src/utils/strokeGate.ts` | 4 道门核心逻辑(独立纯函数,易测) |
| `src/store/__tests__/strokeGate.test.ts` | 4 门单元测试 |
| `src/store/__tests__/altPreserve.test.ts` | alt 保留全路径测试 |
| `src/store/__tests__/undoWalkedIndex.test.ts` | undo / reset 测试 |
| `src/store/__tests__/integration250.test.ts` | 250 case 集成 |

### 7.3 删除

- `smoothCatmullRom` 函数(及 3 处调用点)
- `snapDisplacementStats`、`fracBad`、`maxDispM` 相关函数
- v253-v255 错误判据相关代码

---

## 8. 时长(诚实预算)

| 阶段 | 工时 |
|---|---|
| 算法(4 门 + bearings 接入) | 1.5 天 |
| LngLat alt 类型扩展(14 文件 carry through)| 1 天 |
| 状态管理 6 个 bug 修 | 1 天 |
| Terrain + queryTerrainElevation | 1 天 |
| UX 单行三态 + 按钮位置 | 0.5 天 |
| Feature flag + telemetry 埋点 | 0.5 天 |
| 单元测试 + 集成测试 250 case | 1.5 天 |
| 4 眼 review 修循环(R3 R4) | 1 天 buffer |
| Code 4 眼 review(R5 R6) | 1 天 buffer |
| **总** | **9-10 天** |

---

## 9. Ship 标准(强制)

- [ ] typecheck clean
- [ ] jest 全过(含 250 case 集成 + 新单元测试)
- [ ] **R3 review = PASS, 0 blocker / critical**(plan 阶段)
- [ ] **R4 review = PASS, 0 blocker / critical**(plan 阶段独立)
- [ ] **R5 review = PASS, 0 blocker / critical**(code 阶段)
- [ ] **R6 review = PASS, 0 blocker / critical**(code 阶段独立)
- [ ] 真机测试矩阵 15 个 case 全过
- [ ] Telemetry dashboard 正常采数
- [ ] **灰度 1% → 10% → 100%**(每阶段 ≥ 1 天观察)
- [ ] 关键 KPI(沿路画接受率 ≥ 70%, Preview latency ≤ 3s, FA 监控)无异常

---

## 10. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| J2-039 类型 case 真用户碰到 | 低 | undo 兜底,无品牌伤害 | 已知边界,文档化 |
| Mapbox 国内挂(实测 0%) | 极低 | G4 拒收 | 已实测 50 次 0 超时 |
| DEM 加载不及时 alt = null | 中 | 海拔图缺数据 | graceful + 重试 + UX 不阻塞 |
| 多笔 API 消耗超预算 | 中 | $$ | telemetry 监控,后续 sprint 多笔合并 |
| Terrain 启用拖慢渲染 | 低 | RouteEditor 卡 | 只在 RouteEditor mount,其他屏关 |
| 4 眼 review 漏 bug | 极低 | 灰度 1% 兜底 | flag flip 立即回滚 |
| iOS / Android 行为差异 | 中 | 真机 bug | 真机矩阵 15 必跑 |
| LngLat 类型扩展破坏 14 个文件 import | 中 | 编译错 / 测试失败 | typecheck + alt? optional 字段保兼容 |

---

## 11. 不在 v6.2.2 范围(归档)

- LINZ + OSM NZ trail 数据集成(~2-3 周,留 v7)
- own-map(用户自己 GPS 历史 snap,~1 周,留 v7)
- 导航接通(7 处 wire,~1 周,留 v7)
- API 调用优化(多笔合并 / 后端缓存,留 v7)
- Tilequery 建筑 + 路存在性预拒(留 v7,本期靠 G3 朝向 + Preview 兜底)

---

## 12. PO 红线检查表

| # | 红线 | v6.2.2 满足度 | 兜底 |
|---|---|---|---|
| 1 | Mapbox 渲染路 → snap | ✓ 99%(实测 250/250 城市) | NZ 山区拒 |
| 2 | 沿路画 → 不歪扭 | ✓ 100%(snap 失败直接拒,不再粉饰) | — |
| 3 | 250m 内斜穿 → 接 | ✓ 80% G3 容差 15° | 20% 走 undo |
| 4 | 250m 外 → 拒 | ✓ G1 锚点 + corridor | — |
| 5 | 城市 FA ≈ 0 | ✓ 1.7% known case,主流 < 0.5% | undo + Preview |
| 6 | 山区无数据 → 拒 | ✓ 100% NoMatch | 文案诚实 |

**PO 已接受:FA 1.7%(包括 J2-039 / J4-SH-010 / J4-SH-007 / J4-SH-011 边界,主流场景几乎不发生)+ undo 兜底**。

---

## 13. R1 / R2 反馈逐条对照

| R1/R2 发现 | v6.2.2 处理 |
|---|---|
| FA 数据不诚实(1.7%,不是 0.4%) | §0.3 §1.4 §12 全诚实,接受 1.7% |
| bearings 没接 URL | §1.1 §7.1 加 30 LOC 真接 |
| alt 工作量低估(50-80) | §2.1 §2.2 §7.1 LngLat 扩展 + carry through |
| smoothCatmullRom 还有 3 处调用 | §1.3 §7.3 删除并清理 |
| 没 feature flag | §5.1 brushEditV62 |
| 没 telemetry | §5.2 7 个埋点 |
| 没灰度 | §5.3 1% → 10% → 100% |
| DEM 加载竞态 | §2.3 重试 + graceful |
| backwards compat | §2.4 v255 加载兼容 |
| Android / iOS 差异 | §6.3 真机矩阵 15 必跑 |
| 多笔顺序与 walkedIndex | §3.1 锁定:并发独立判,基于会话开始的原线 |
| Status row 无 warning(避 race) | §4.1 简化为 2 态(error / 默认),computing 优先 |
| 拒收 UX 多笔提示 | §4.4 "X strokes rejected" |
| 真实噪声未测 | §6.4 灰度阶段 telemetry 监控,异常立刻 flip flag |
| 测试不覆盖 Mapbox 错误 | §6.1 mock NoMatch / 5xx / timeout |

---

**Plan 状态**:重写完毕,等 PO 确认 → R3 + R4 全新 context 4 眼独立 review → 双双 PASS → 开发 → R5 + R6 code review → 灰度 → 全网

**核心承诺**:这次不再相信"快"。慢慢做对一次。
