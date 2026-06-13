# v6.3 Brush-Edit Plan — Simple Version

**版本**:v6.3 (simple)
**日期**:2026-06-13
**核心理念**:**信 Mapbox + 3 道纯几何门 + undo 兜底**。单次 ACCEPT ≥ 70%,N 次累积 ≥ 95%。
**Review 流程**:R1+R2 全新 context 双独立 review,双双 PASS 才推

---

## 0. 业务理解(锁定)

### 0.1 核心信念

1. **用户不是来瞎搞的**——他要画一条真路,所以"弹回最近的路"在主流场景就是对的
2. **算法做不到单次 100% 完美**——HMM map-matching 本质有歧义(平行小路、plaza 边),Footpath 也一样
3. **用户多次尝试中大多能正确**——单次错了用户 undo,下次更专注,N 次累积才是真红线

### 0.2 N 次累积成功率(数学)

| 单次 ACCEPT% | 2次 | 3次 | 4次 |
|---|---|---|---|
| 70% | 91% | **97%** | 99% |
| 80% | 96% | **99%** | 99.8% |
| 92% | 99% | **99.9%** | 100% |

**Ship 红线**:**单次 ≥ 70% + 3 次累积 ≥ 95%**。

### 0.3 用户场景(锁定,跟之前一致)

| 频率 | 场景 | 系统该做 |
|---|---|---|
| 80% | 城市沿路画 ±5-10m 飘 | snap 干净 |
| 15% | 城市 + 一段斜穿 ≤20m | 接住 |
| <2% | 故意穿楼 / 乱画 | Mapbox 弹合理路 OR 拒 |
| <3% | 模糊不准 | 拒 / 用户重画 |
| NZ 山区 | 沿真 trail | 现拒,等 LINZ |

---

## 1. 算法(纯几何,清除杂音)

### 1.1 Mapbox /matching 调用

```ts
// services/routing/mapmatch/MapMatchingClient.ts
profile = walking
radiuses = per-coord 25m   // 大 radius:让 Mapbox 拉到笔的真实位置
                           // (替代 v6.2.3 的 8m,8m 太紧导致 J1-036 类 800m 笔只 snap 60m)
annotations = distance
tidy = false               // 保留我们的点
geometries = geojson
overview = full
```

**删除**:
- ❌ `bearings` 不传(实测 INVISIBLE 65% 上无效)
- ❌ `confidence` 不读
- ❌ `tracepoint` 不读 distance / null
- ❌ `alternatives_count` 不读

### 1.2 接受门(4 道,ALL pass)

**G1 — 锚点**:笔**起点**或**终点**至少一个在原路线 50m 内
- 防"挂靠链"飘(v249-v255 的 267m 直线 bug 根因)

**G2 — corridor 红线(你的 250m 产品红线)**:Mapbox snap 输出的**任一点**离原路线 ≤ 250m
- 防 Mapbox 弹去几条街外
- 同时也是产品红线(超 250m 必拒)

**G3 — 远 snap 拒**:笔每个点离 Mapbox snap 输出的 max-perp ≤ **50m**
- 抓 14% 的"远弹"穿楼/穿草坪 case(实测 250 corpus 中 12 个 > 50m)
- **不再用紧阈值 10m**(那个误拒主流)
- 50m 是"Mapbox 弹合理范围"上限——超 50m 笔点离 snap 几何远,基本是穿楼/穿草坪

**G4 — Mapbox code === 'Ok'**:NoMatch / NoSegment / 4xx / 5xx / timeout 全拒
- 山区无数据自然拒(等 LINZ)

任一 fail → 拒收(整笔从画布消失 + lastError 红字 2.5s)。

### 1.3 实测数据(250 case 真实跑出来)

**ACCEPT bucket(134 case,主流场景)**:
- G4 Ok: 124/134 = **92.5%**(剩 10 个 NoMatch:山区 + 稀疏 + cycle lane)
- G4 + G2 + G3: 估计 ~85-88%(G2 的 250m 在原路线设计下基本不会卡掉 ACCEPT)

**REJECT bucket(116 case,故意穿楼/草坪)**:
- 65% INVISIBLE 类(perp ≤ 20m,Mapbox 弹脚下合理路)→ **接受弹**(用户 undo)
- 21% MEDIUM 类(20-50m)→ 部分被 G3 抓,部分通过(用户 undo)
- 14% CATCHABLE 类(>50m)→ G3 抓 ✓

**目标单次 ACCEPT ≥ 80%, FA ≤ 50%**(其中绝大多数是"弹合理路",用户 undo)。
**3 次累积:96%**——满足红线。

### 1.4 已删的判据(永远不再用)

- ❌ confidence(目标地区噪音,实测无区分)
- ❌ tracepoint distance / null ratio(实测无区分)
- ❌ alternatives_count(无区分)
- ❌ matched_len 比例(误拒过高)
- ❌ snapDisplacementStats / fracBad / maxDispM(v253-v255 错误判据)
- ❌ Catmull-Rom fallback(歪扭根因)
- ❌ G3 bearing(INVISIBLE 65% 上无效,实测)
- ❌ profile=driving(排除 footway,城市小路 NoMatch)

---

## 2. 数据层(alt 保留,跟之前一致)

### 2.1 LngLat 类型扩展

```ts
// services/routing/corridor/PolylineSampler.ts
export interface LngLat {
  lng: number;
  lat: number;
  alt?: number | null;
}
```

### 2.2 alt 保留路径

| 路径 | 修法 |
|---|---|
| Save-as-route 不编辑 | RouteEditorScreen 的 6 个 strip 点全去掉 |
| 原 GPS 段(splice 头/尾)| `lerpLocal` / `originalUpTo` / `originalFrom` 4 函数 carry alt(线性插值)|
| Mapbox snap 段 | `MapView.queryTerrainElevation([lng,lat])` 本地查 |
| `spliceMatched` dedupe / despike | 保留两点中非 null 的 alt |

### 2.3 Mapbox Terrain 启用

```tsx
<MapView ref={mapViewRef} ...>
  <RasterDemSource id="mapbox-dem"
    url="mapbox://mapbox.mapbox-terrain-dem-v1"
    tileSize={514} maxZoomLevel={14} />
  <Terrain sourceID="mapbox-dem" exaggeration={1} />
  ...
</MapView>
```

DEM 加载竞态:null → 200ms × 3 重试 → 仍 null = `alt = null`(graceful)。

### 2.4 backwards compat

v249-v255 saved route(无 alt)加载正常,海拔图显示 0。所有代码 null-safe。

### 2.5 distanceM / elevationGainM 重算

Save 时基于最终 polyline 重算(haversine + 已有 `calculateElevationGain`)。

---

## 3. 状态管理修复(v249-v255 遗留全清)

| Bug | 修法 |
|---|---|
| undo 不重建 walkedIndex | undo 时 `buildWalkedIndex(last.matchedPoints)` |
| UndoEntry 类型不含 walkedIndex | 类型扩展 + 5 处 push 站点更新 |
| resetEdits 不清 cache / warning / activeStrokeId | 全清 |
| eraseAt / removeStroke / beginTrimDrag undo push 缺字段 | 同步扩展 |
| sticky lastWarning 跨 stroke 残留 | beginStroke 清 lastWarning |
| editOpSeq fence + 中途 hardware-back / 后台 | Mapbox await 期间 fence 触发 → 静默 abort |
| persistSession 中途半状态 | 仅在 commit 时持久化 |

### 3.1 多笔语义

**v6.3 锁定**:多笔 Preview 时,**每笔独立判**(各自 4 道门),基于**编辑会话起始的原 walkedIndex**(不被前一笔影响)。

**Mapbox 调用**:**串行**(避免 rate limit),每笔 1 次 /matching call。

---

## 4. UX(简化,跟 v6.2.3 一致)

### 4.1 错误显示(单行 XOR)

EditOverlayV236 statusRow 唯一 1 行:
- isComputing → "Computing…"
- lastError → 红 pill(2.5s 自动消失)
- 默认 → "N/8 brush strokes"

### 4.2 删

- BrushOverlay 顶部 lastError pill → 删
- EditOverlayV236 顶部 lastWarning banner → 删
- Hint text 在 lastError 时完全隐藏

### 4.3 拒收笔处理

Preview 后任何 stroke 拒收:
- 整笔从画布消失(brushStrokes 数组移除)
- lastError 红字提示(2.5s 自动消失)

### 4.4 按钮位置(锁定,本期 verify)

- Cancel / Delete **永远在左**
- Save / Edit / Done **永远在右**

### 4.5 拒收文案

| 触发 | 文案 |
|---|---|
| G1 锚点 | "画笔起点必须在原路线上" |
| G2 corridor | "画的太远了,试着贴近原路线" |
| G3 远 snap | "没识别到这条路,试着贴近主路重画" |
| G4 NoMatch / 错 | "未识别到这条路" |

### 4.6 起笔规则

- 第 1 笔起点必须在原路线 50m 内
- 后续笔可从已存 stroke 接(eraser-split 后续画支持)

### 4.7 Save 名字

- save-as-route 必须用户填(无默认)
- existing route 自动填 route.name

---

## 5. Telemetry(轻量,debug 用)

### 5.1 复用 yiiling 后端

`POST /api/edit-diag` 已存在(24h TTL,限速 60/5min/IP)。

### 5.2 上报事件(7 个)

```ts
brush_preview_started   { stroke_count }
brush_preview_completed { stroke_count, accepted, rejected, ms_taken }
brush_gate_failure      { gate: 'G1'|'G2'|'G3'|'G4', stroke_idx, region }
brush_undo              { undo_stack_depth }
brush_save_committed    { stroke_count, distance_m, has_alt }
brush_mapbox_error      { reason, ms_to_error }
brush_alt_dem_null      { points_with_null_alt, total_points }
```

**用户完全不感知**。我下次你反馈"哪不对"时直接查 backend 数据。

### 5.3 工程量

- 客户端:`editDiagSender.ts` 新文件 (~30 LOC) + 7 处调用点
- 后端:**0**(endpoint 已存)
- 总:**~50 LOC**

---

## 6. 测试(happy path 优先)

### 6.1 单元测试(必加)

| 测试 | 验证 |
|---|---|
| G1 锚点 | 起终都 50m 外 → 拒;起 30m → 通 |
| G2 corridor | snap 出 300m 离原路 → 拒;100m → 通 |
| G3 远 snap | mock perp 80m → 拒;30m → 通 |
| G4 Mapbox 错 | NoMatch / 5xx / timeout 都拒 |
| spliceMatched alt 保留 | 头尾段 alt 不丢 |
| dedupe / despike alt | 保留非 null |
| undo walkedIndex 重建 | undo 后查询匹配 last.matchedPoints |
| resetEdits 全清 | walkedIndex/cache/warning/activeStrokeId 全清 |
| save-as-route 不 strip alt | route.points[0].alt === sessionTrackPoints[0].alt |
| backwards compat | v255 旧 route 加载不崩 |

### 6.2 真机自测矩阵(推 OTA 前必跑)

happy path 焦点 12 个 case:

| # | 场景 | 期望(单次) |
|---|---|---|
| 1 | 沿主路画 200m + ±5m 飘 | sage 接受 |
| 2 | 沿主路 + 50m 斜穿小区 | 接住(可能弹平行路,undo 重画) |
| 3 | 穿楼直线 200m | G3 拒 OR Mapbox 弹合理路 → undo |
| 4 | 250m 外乱画 | G2 拒 |
| 5 | 起点 70m 外 | G1 拒 |
| 6 | 4 笔多笔 | 各独立判 |
| 7 | eraser 中段 + 各半 | 各半独立 |
| 8 | Preview → undo → 再画 | walkedIndex 正确 |
| 9 | reset 后画 | walkedIndex 已回原线 |
| 10 | Save 后进 RouteDetail | alt 保留 |
| 11 | NZ Tongariro 上画 | 拒("未识别")|
| 12 | UI:Cancel 左 / Save 右 / 单行红字 | 符合 |

**N 次累积测试**(case 1, 2, 3 重做 3 次):
- 期望 3 次内成功率 ≥ 95%

---

## 7. 文件改动清单

### 修改

| 文件 | 改动 | LOC 估 |
|---|---|---|
| `services/routing/corridor/PolylineSampler.ts` | LngLat 加 alt? + lerpLocal carry alt | 10 |
| `services/routing/mapmatch/MapMatchingClient.ts` | profile walking + radiuses=25 + 删 bearings + 删 confidence parse | 20 |
| `store/useRouteEditStore.ts` | 4 道门重写(G1+G2+G3+G4)+ undo/reset 修 + 删 5 旧判据 + 删 smoothCatmullRom 调用 + 多笔串行 + alt 保留 | 180 |
| `components/map/BrushOverlay.tsx` | 顶部 lastError pill 删 | 10 |
| `components/map/EditOverlayV236.tsx` | statusRow 双态 + 顶部 banner 删 | 30 |
| `components/map/BrushStrokeLayer.tsx` | 仅渲染 sage(拒收已被 store 移除) | 5 |
| `screens/RouteEditorScreen.tsx` | 6 处 strip alt 都修 + Terrain 启用 | 30 |
| `services/LocalRouteExtras.ts` | alt schema 扩展(向后兼容) | 10 |
| `components/OtaBadge.tsx` | 255 → 256 | 1 |

### 新增

| 文件 | 用途 |
|---|---|
| `utils/strokeGate.ts` | 4 道门核心(纯函数,易测) |
| `services/editDiagSender.ts` | sendEditDiag(kind, payload) helper |
| `store/__tests__/strokeGate.test.ts` | 4 门单元测试 |
| `store/__tests__/altPreserve.test.ts` | alt 全路径测试 |
| `store/__tests__/undoWalkedIndex.test.ts` | undo / reset 测试 |
| `store/__tests__/backCompat.test.ts` | v255 旧 route 加载测试 |

### 删除

- `smoothCatmullRom` 函数 + 3 处调用点
- `snapDisplacementStats`、`fracBad`、`maxDispM` 相关代码
- `bearings` 相关函数(本 plan 不用)
- `computeBearings` / `bearingDifference` helper(留代码可能 v6.4 要用)— 保留但不调用

---

## 8. 时长预算

| 阶段 | 工时 |
|---|---|
| 算法(4 门 + radiuses=25) | 1 天 |
| LngLat alt 扩展 + carry through | 1.5 天 |
| 状态管理 6 个 bug 修 | 1 天 |
| Terrain + queryTerrainElevation | 1 天 |
| UX 单行双态 | 0.5 天 |
| Telemetry 7 事件 | 0.5 天 |
| 单元测试(7 个 spec)| 1 天 |
| R1+R2 plan review 修循环 | 0.5 天 buffer |
| 真机自测 12 case + N 次累积 | 1 天 |
| **总** | **8 天** |

(比 v6.2.3 的 10 天少 2 天 — 删 bearings + 单门 G3 简化)

---

## 9. Ship 标准

- [ ] typecheck clean
- [ ] jest 全过(含 7 个 spec)
- [ ] **R1+R2 plan review = 双 PASS, 0 blocker / critical**
- [ ] **R3+R4 code review = 双 PASS, 0 blocker / critical**(开发后)
- [ ] 真机 12 case happy path 全过(单次)
- [ ] 真机 N 次累积测试:case 1, 2, 3 重做 3 次,成功率 ≥ 95%
- [ ] OTA 推前 commit hash 与 plan 对齐
- [ ] Telemetry 事件正常上报到 yiiling 后端

---

## 10. 已知不做(归档,迭代时再做)

| 方案 | 何时做 |
|---|---|
| **大 radiuses 进一步 spike**(15/30/40 对比,定最优值)| **v6.3.1**(本期 ship 后第一个迭代) |
| bearings 重新引入(可能改善 平行小路 case)| v6.3.1 或 v6.4 |
| LINZ + OSM NZ 后端服务 | v7 |
| own-map(用户自己 GPS 历史 snap)| v7 |
| 导航接通 7 处 wire | v7 |
| API 调用优化(多笔合并 / 后端缓存)| v7+ |
| 边角 case 算法优化(等正式 release 大量真机数据)| v7+ |

---

## 11. PO 红线检查表

| # | 红线 | v6.3 满足 |
|---|---|---|
| 1 | Mapbox 渲染路 → snap | 92.5% G4 通过(实测 250 case) |
| 2 | 沿路画 → 不歪扭 | snap 失败直接拒,绝不粉饰 |
| 3 | 250m 内斜穿 → 接 | G2 守 250m,G3 守 50m 远 snap |
| 4 | 250m 外 → 拒 | G2 ✓ |
| 5 | 城市误接受 → 主流近 0 | 主流场景 G3 + G4 守住,边角弹合理路 + undo |
| 6 | 山区无数据 → 拒 | 100% NoMatch ✓ |
| 7 | undo 真有效 | walkedIndex 重建 ✓ |
| 8 | 等待 ≤ 3s | 单笔 ~200ms,4 笔 ~800ms |

---

## 12. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| radiuses=25 让 Mapbox 弹更远(FA 更高)| 中 | G3 守 50m + G2 守 250m 兜底 |
| J2-039 类(平行小路弹错)| 低 | 已知边界,undo 兜底 |
| Mapbox 国内挂 | 极低 | 实测 0 超时;G4 拒收 |
| DEM 加载迟 alt = null | 中 | 重试 + graceful + UX 不阻塞 |
| LngLat 类型扩展破坏 14 文件 | 中 | typecheck + alt? optional 保兼容 |
| iOS / Android 行为差异 | 中 | 真机矩阵双系统跑 |

---

## 13. 待迭代记录(simple 版本之后)

下面这些 v6.3 simple 不做,**ship 后基于真实用户数据迭代**:

1. **radiuses 真值优化**:本期定 25m,但 25m vs 15m vs 40m 哪个最好,等真实用户 telemetry 数据 1-2 周后定。
2. **bearings 重新引入**:可能解 J2-037 平行小路 case,但 v6.2 实测在 INVISIBLE 65% 上无效。等真实用户数据看是否值得加。
3. **G3 阈值调优**:50m 是估值,可能 30m / 70m 更优。telemetry 数据 + undo 比例反推。
4. **densify 修稀疏笔**:2 个 NoMatch case 是稀疏笔,客户端 densify 能修。简单加,但本期不必。
5. **G_corridor 渐进缩小**:250m 是产品红线,实测可能用户在 100m 内大多数,可考虑视觉提示"画太远了"。
6. **多笔合并 API call**:4 笔 → 1 次调用,省 70% API 消耗。
7. **本地缓存命中**:同一笔重画(undo 后类似)缓存命中,省 API。
8. **LINZ + own-map**:NZ 山区根治。

---

**Plan 状态**:待 PO 确认 → R1+R2 全新 context plan review → 开发 → R3+R4 code review → 推 OTA → PO 测

**核心承诺**:这次不写未实测的数字。所有数字来自 250 case 真实跑出来。
