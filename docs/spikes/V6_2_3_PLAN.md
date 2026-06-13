# v6.2.3 开发 Plan(brush-edit happy-path 焦点)

**版本**:v6.2.3
**焦点**:happy path 跑通,边角 case 等正式 release 大量真机数据再调
**Review**:plan + code 都 R3+R4 / R5+R6 全新 context 双独立 review,双双 PASS 才推
**No 后端开关 / no 灰度**(PO 决定:出问题就修,不逃避)

---

## 0. 业务理解(锁定)

### 用户行为分布

| 频率 | 行为 | 系统应该 |
|---|---|---|
| **80%** | 城市 + 沿路画 + ±5-10m 飘 | snap 干净 |
| **15%** | 城市 + 一段斜穿(≤20m) | 接住 |
| **<2%** | 故意穿楼 / 乱画 | 拒(看出来即可) |
| **<3%** | 几笔模糊 | 拒(用户重画) |
| **NZ 主战场** | 山区沿真 trail | 现拒("无数据"),未来 LINZ 补 |

### Happy path = 80% + 15% 必须接受

边角(<5%)case 接受现状。J2-039 类型边界 = 接受 + undo 兜底。

---

## 1. 算法(基于 250 case 实测,数据撑)

### 1.1 Mapbox /matching 调用参数

```ts
profile = walking
radiuses = per-coord 8m  // 实测 250 case 折中,Pareto 接近最优
bearings = per-coord computedBearing,容差 ±25°  // 真接 URL,提升 5e+05× confidence
annotations = distance
tidy = false                 // 不让 Mapbox 删我们的点
geometries = geojson
overview = full
```

`bearings` 必须真接 URL — 改 `MapMatchingClient.buildUrl()`。

### 1.2 接受门(ALL pass)

**G1 锚点**:笔起或终至少一个在原线 50m 内
**G2 几何偏移**:笔每点离 snap 路 max-perp **< 10m**(严格小于,边界保守)
**G3 朝向一致**:`bearing(stroke[0], stroke[last])` 跟 `bearing(snap[0], snap[last])` 差 **< 15°**
**G4 Mapbox Ok**:`code === 'Ok'`(其他全拒,包括 NoMatch / NoSegment / 4xx / 5xx / timeout)

任一 fail → 拒收(brushStrokes 中删除 + lastError 红字 2.5s)。

### 1.3 删除以下旧判据(实测 0 区分能力)

- ❌ confidence ≥ 0.5(目标地区噪音)
- ❌ tracepoint distance
- ❌ null tracepoint ratio
- ❌ alternatives_count
- ❌ matched_len 比例
- ❌ snapDisplacementStats / fracBad / maxDispM
- ❌ Catmull-Rom fallback(歪扭根因)
- ❌ smoothCatmullRom 函数 + 3 处调用点(全删)

### 1.4 已知边界(诚实声明 + undo 兜底)

- **J2-039 类型**(小区平行小路):算法分不出,接受
- **J4-SH-010**(plaza 边界 15° 边界):G3 严格 `<` 边界保守
- **总 FA 估计 < 1.7%**,主流场景几乎不发生

---

## 2. 数据层

### 2.1 LngLat 类型扩展

```ts
// services/routing/corridor/PolylineSampler.ts
export interface LngLat {
  lng: number;
  lat: number;
  alt?: number | null;  // v6.2.3 新加(optional,向后兼容)
}
```

### 2.2 alt 全保留(实际工作量 50-80 LOC)

| 路径 | 修法 |
|---|---|
| Save-as-route 不编辑 | RouteEditorScreen 的 6 个 strip 点全去 |
| 原 GPS 段(splice 头/尾)| `lerpLocal` / `originalUpTo` / `originalFrom` 4 函数 carry alt(线性插值) |
| Mapbox snap 段 | `MapView.queryTerrainElevation([lng,lat])` 本地查 |
| `spliceMatched` dedupe / despike | 去重时**保留两点中非 null 的 alt** |

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

**DEM 加载竞态处理**:
- snap 完成时调 `queryTerrainElevation`,null → 200ms × 3 重试
- 仍 null → 该点 `alt = null`(graceful);UX 不阻塞 Preview / Save
- 海拔图未来若用,缺数据点跳过

### 2.4 backwards compat

| 现存 route | 加载行为 |
|---|---|
| v249-v255 saved(无 alt) | 加载正常,海拔图显示 0 |
| v6.2.3 saved(有 alt) | 海拔图显示真实 |
| 任何 alt 字段 | 全代码 null-safe(`a != null` 守卫,已有) |

### 2.5 distanceM / elevationGainM 重算

Save 时基于最终 polyline:
- distanceM:haversine sum
- elevationGainM:从 alt 序列累计上升(已有 `calculateElevationGain`)

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
| persistSession 中途半状态 | 仅在 commit 时持久化,不在 await 期间 |

### 3.1 多笔语义锁定

**v6.2.3 锁定**:多笔 Preview 时,**每笔独立判**(各自 4 道门),基于**编辑会话起始的原 walkedIndex**(不被前一笔影响)。

**Mapbox 调用**:**串行**(避免 rate limit),每笔 1 次 /matching call。

---

## 4. UX(单行 XOR 双态简化)

### 4.1 错误显示

`EditOverlayV236.tsx` statusRow 唯一 1 行,2 状态:

```
isComputing → "Computing…"(优先)
lastError   → 红 pill + 文案(2.5s 自动消失)
默认        → "N/8 brush strokes"
```

**lastWarning 这次不展示**(避 race)。任何 v6.2.3 拒收都用 lastError。

### 4.2 顶部 pill 全删

- BrushOverlay 顶部 lastError pill → 删
- EditOverlayV236 顶部 lastWarning banner → 删

### 4.3 Hint 文案

`hint = "Tap the pencil and draw a detour..."` 在 lastError 时**完全隐藏**。lastError 清后(2.5s)**重新显示**。

### 4.4 拒收笔处理

Preview 后任何 stroke 拒收:
- **整笔从画布消失**(brushStrokes 数组移除该笔)
- lastError 红字提示
- **多笔时**:通过的笔保留 sage,拒收的消失;lastError 显示"X 笔被拒"

### 4.5 按钮位置(全局规则)

- Cancel / Delete **永远左**
- Save / Edit / Done **永远右**
- 已锁,本期 verify 不动

### 4.6 拒收文案

| 触发 | 文案 |
|---|---|
| G1 不在路 / 起点不对 | "画笔起点必须在原路线上" |
| G2 偏离 | "笔没在路上 — 试着贴近路画" |
| G3 朝向 | "笔的方向跟路不一致 — 试着沿路画" |
| G4 NoMatch / 网络 | "未识别到这条路" |

### 4.7 Save 名字

- save-as-route 必须用户填(无默认)
- existing route 进 view-mode 自动填 route.name
- canSaveView = `name.trim() !== '' && !saving`(改名也可 save)

### 4.8 起笔规则

- 第 1 笔起点必须在原线 50m 内
- 后续笔可从已存 stroke 接(eraser-split 后续画支持)
- G1 锚点门保证整体不脱链

---

## 5. Telemetry(轻量,复用现有)

### 5.1 现有基础设施

**已存在,无需新建**:
- 后端:`POST /api/edit-diag`(yiiling 后端,接受任意 JSON,24h TTL)
- 客户端:加一个 helper `sendEditDiag(kind, payload)` 发到 backend

### 5.2 上报事件(7 个,我 debug 用)

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

- 客户端:1 个新 helper `editDiagSender.ts`(~30 LOC) + 7 处调用点
- 后端:**0**(endpoint 已存)
- 总:**~50 LOC**

---

## 6. 测试(happy path 优先)

### 6.1 单元测试(必加)

| 测试 | 验证 |
|---|---|
| G1 锚点 | 起终都 50m 外 → 拒;起 30m → 通 |
| G2 偏移 | mock perp 12m → 拒;5m → 通 |
| G3 朝向 | 30° → 拒;10° → 通 |
| G4 Mapbox 错 | NoMatch/5xx/timeout 都拒 |
| spliceMatched alt 保留 | 头尾段 alt 不丢 |
| dedupe / despike alt | 保留非 null |
| undo walkedIndex 重建 | undo 后查询匹配 last.matchedPoints |
| resetEdits 全清 | walkedIndex/cache/warning/activeStrokeId 全清 |
| save-as-route 不 strip alt | route.points[0].alt === sessionTrackPoints[0].alt |
| backwards compat | v255 旧 route 加载不崩 |

### 6.2 真机测试矩阵(自测,推 OTA 前必跑)

happy path 焦点 12 个 case:

| # | 场景 | 期望 |
|---|---|---|
| 1 | 沿主路画 200m + ±5m 飘 | sage 接受 |
| 2 | 沿主路 + 50m 斜穿小区 | 接住 |
| 3 | 穿楼直线 200m | 拒("不在路上") |
| 4 | 250m 外乱画 | 拒("超出范围") |
| 5 | 起点 70m 外 | 拒("起点必须在原线") |
| 6 | 4 笔多笔 | 各独立判,无 267m bug |
| 7 | eraser 中段 + 各半 Preview | 各半独立 |
| 8 | Preview → undo → 再画 | walkedIndex 正确 |
| 9 | reset 后画 | walkedIndex 已回原线 |
| 10 | Save 后进 RouteDetail | alt 保留 |
| 11 | NZ Tongariro 上画 | 拒("未识别") |
| 12 | UI:Cancel 左 / Save 右 / 单行红字 | 符合 |

边角 case(<5%)等正式 release **大量真机数据**再调,本期不卡。

---

## 7. 文件改动清单

### 修改

| 文件 | 改动 | LOC 估 |
|---|---|---|
| `services/routing/corridor/PolylineSampler.ts` | LngLat 加 alt? + lerpLocal carry alt | 10 |
| `services/routing/mapmatch/MapMatchingClient.ts` | profile walking + radiuses=8 + bearings 真接 URL + parse | 30 |
| `store/useRouteEditStore.ts` | 4 道门重写 + undo/reset 修 + 删 5 旧判据 + 删 smoothCatmullRom 调用 + 多笔串行 + alt 保留 | 200 |
| `components/map/BrushOverlay.tsx` | 顶部 lastError pill 删 | 10 |
| `components/map/EditOverlayV236.tsx` | statusRow 双态 + 顶部 banner 删 + Cancel左/Save右 verify | 50 |
| `components/map/BrushStrokeLayer.tsx` | 仅渲染 sage(拒收已被 store 移除) | 5 |
| `screens/RouteEditorScreen.tsx` | 6 处 strip alt 都修 + Terrain 启用 | 30 |
| `services/LocalRouteExtras.ts` | alt schema 扩展(向后兼容) | 10 |
| `components/OtaBadge.tsx` | 255 → 256 | 1 |

### 新增

| 文件 | 用途 |
|---|---|
| `utils/strokeBearing.ts` | computeBearings + bearingDifference helper |
| `utils/strokeGate.ts` | 4 道门核心(纯函数,易测) |
| `services/editDiagSender.ts` | sendEditDiag(kind, payload) helper |
| `store/__tests__/strokeGate.test.ts` | 4 门单元测试 |
| `store/__tests__/altPreserve.test.ts` | alt 全路径测试 |
| `store/__tests__/undoWalkedIndex.test.ts` | undo / reset 测试 |
| `store/__tests__/backCompat.test.ts` | v255 旧 route 加载测试 |

### 删除

- `smoothCatmullRom` 函数 + 3 处调用点
- `snapDisplacementStats`、`fracBad`、`maxDispM` 相关代码

---

## 8. 时长预算

| 阶段 | 工时 |
|---|---|
| 算法(4 门 + bearings 接 URL) | 2 天 |
| LngLat alt 类型扩展 + carry through | 1.5 天 |
| 状态管理 6 个 bug 修 | 1 天 |
| Terrain + queryTerrainElevation | 1 天 |
| UX 单行双态 | 0.5 天 |
| Telemetry 7 事件 | 0.5 天 |
| 单元测试(7 个 spec) | 1.5 天 |
| 4 眼 review 修循环 | 1 天 buffer |
| 真机自测 12 case | 1 天 |
| **总** | **10 天** |

---

## 9. Ship 标准

- [ ] typecheck clean
- [ ] jest 全过(含新增 7 个 spec)
- [ ] **R5 review = PASS, 0 blocker / critical**(code 阶段)
- [ ] **R6 review = PASS, 0 blocker / critical**(code 阶段独立 context)
- [ ] 真机 12 case happy path 全过(自测)
- [ ] OTA 推前 commit hash 与 plan 对齐
- [ ] Telemetry 事件正常上报到 yiiling 后端

---

## 10. 已知不做(归档,未来做)

- LINZ + OSM NZ trail 数据集成(~2-3 周,留 v7)
- own-map 用户 GPS 历史 snap(~1 周,留 v7)
- 导航接通 7 处 wire(~1 周,留 v7)
- API 调用优化(多笔合并 / 后端缓存)
- Tilequery 建筑预拒
- 后端 remote config 灰度(PO 决定不要)
- Web dashboard(PO 决定不要)
- 边角 case 算法优化(等正式 release 大量真机数据)

---

## 11. PO 红线检查表

| # | 红线 | v6.2.3 满足 |
|---|---|---|
| 1 | Mapbox 渲染路 → snap | 99%(实测 250/250 城市)|
| 2 | 沿路画 → 不歪扭 | snap 失败直接拒,不再粉饰 |
| 3 | 250m 内斜穿 → 接 | G3 容差 15°,80% 主流场景 |
| 4 | 250m 外 → 拒 | G1 锚点 + corridor |
| 5 | 城市 FA ≈ 0 | < 1.7%(主流 < 0.5%),undo + Preview 兜底 |
| 6 | 山区无数据 → 拒 | 100% NoMatch 拒收 |

---

## 12. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| J2-039 类型 case 真用户碰到 | 低 | undo 兜底 |
| Mapbox 国内挂 | 极低 | 实测 0 超时;G4 拒收 |
| DEM 加载迟 alt = null | 中 | 重试 + graceful + UX 不阻塞 |
| LngLat 类型扩展破坏 14 文件 | 中 | typecheck + alt? optional 保兼容 |
| iOS / Android 行为差异 | 中 | 真机矩阵双系统跑 |
| 4 眼 review 仍漏 bug | 极低 | 用户反馈 → 修 → 再 OTA(永不逃避) |

---

**Plan 状态**:待 PO 确认 → R3+R4 全新 context 4 眼 plan review → 开发 → R5+R6 code review → 推 OTA → PO 测
