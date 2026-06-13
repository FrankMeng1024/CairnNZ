# v6.2 开发 Plan(brush-edit 重做)

**版本**:v6.2
**目标**:基于 250 case 实测数据,把 brush-edit 做对(城市完整,NZ 山区拒收)
**Plan 状态**:待 4 眼 review
**Review 流程**:Plan + Code 都必须经 **SubagentR1 + R2 独立 review,双双 PASS 才推 OTA**

---

## 0. 4 眼 Review 流程(强制)

任何修改必须经过:
1. **SubagentR1 独立 review**(只给 plan/diff,不知道其他 subagent 存在)
2. **SubagentR2 独立 review**(完全独立 context,不见 R1 输出)
3. **双双 PASS(0 blocker, 0 critical)** → 推进
4. 任一 NEEDS WORK → 修完后**重跑 R1 + R2**(不是只跑一个)
5. 直到两个 subagent 同时 PASS

---

## 1. 产品需求回归(锁定红线)

| # | 要求 | v6.2 满足度 | 兜底 |
|---|---|---|---|
| 1 | 地图渲染的路 → snap | ✓ 99% | NZ 山区拒收 |
| 2 | 沿路画 → 干净不歪扭 | ✓ 100% | snap 失败直接拒,不再粉饰 |
| 3 | 250m 内斜穿小区 → 接住 | ✓ 80% 直接接,20% 走 undo | bearing 容差 15° |
| 4 | 250m 外乱画 → 拒 | ✓ 100% | 锚点 + corridor 双拒 |
| 5 | 城市 FA ≈ 0 | ✓ 99.6%(250 case 漏 1) | undo 兜底,Preview 看一眼 |
| 6 | 山区 / 没数据 → 拒 | ✓ 100% | 文案诚实 |

**漏的 1/250(J2-039)**:小区平行马路,几何上跟"在马路上画"一样。**接受这个边界,用户 undo 解决**。Future v7 LINZ + OSM 后端验证可补。

---

## 2. 算法层(基于 250 case 数据锁定)

### 2.1 Mapbox /matching 调用参数

```ts
// services/routing/mapmatch/MapMatchingClient.ts
const ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/walking';
{
  coords: stroke.points,
  radiuses: stroke.points.map(() => 3),  // 9m search ring
  bearings: computePerSegmentBearings(stroke, ±15°),
  annotations: 'distance',
  tidy: false,
  geometries: 'geojson',
  overview: 'full',
}
```

### 2.2 接受/拒收门(全 PASS 才接受)

**门 1 — 锚点**:`stroke.points[0]` 或 `stroke.points[last]` 至少一个在原线 50m 内
**门 2 — 几何偏移**:每个 stroke 顶点离 snap 路 ≤ **10m**
**门 3 — 朝向一致**:stroke 段方向 vs snap 段方向 ≤ **15°**
**门 4 — Mapbox 自报错**:`code === 'Ok'` 才进后续门;NoMatch / NoSegment / 网络 → 直接拒

### 2.3 删除以下旧判据(实测 0 区分能力,删干净)

- ❌ confidence ≥ 0.5
- ❌ tracepoint distance ≤ 8m
- ❌ null tracepoint ratio
- ❌ alternatives_count
- ❌ matched_len 比例
- ❌ snapDisplacementStats(v253-v255 的错误判据)
- ❌ Catmull-Rom fallback(v255 的"歪扭"根因)
- ❌ smoothCatmullRom 函数本身(已无调用)

### 2.4 多笔不互扰(锚点链漂修复)

- 每笔独立调 Mapbox(本期不做合并优化)
- 锚点门保证每笔至少一端在原线
- spliceMatched 按 arc 排序,验证无 267m 直线 bug 重现(spike 已验)

### 2.5 Eraser-split 后续处理

- 擦中段后 stroke 分 A1/A2 两个新 id
- **每段独立验门**(不再绑定一起拒)
- 实测的 A1/A2 不对称(Mapbox 给 conf 不同)由删除 confidence 判据自动解决

---

## 3. 数据层

### 3.1 海拔保留(必修,~32 LOC)

| 路径 | 修法 |
|---|---|
| Save-as-route 不编辑 | RouteEditorScreen 不再 strip alt(改 5 行)|
| Brush 编辑后,原 GPS 段(splice 头尾)| spliceMatched / lerpLocal / originalUpTo / originalFrom 4 个函数携带 alt 通过(改 25 行)|
| Brush 编辑后,Mapbox snap 段 | Mapbox SDK `queryTerrainElevation([lng,lat])` 本地查,0 网络;查不到 = null(graceful)|

### 3.2 Mapbox Terrain 启用(~10 LOC)

```tsx
<MapView ...>
  <RasterDemSource id="mapbox-dem" url="mapbox://mapbox.mapbox-terrain-dem-v1"
    tileSize={514} maxZoomLevel={14} />
  <Terrain sourceID="mapbox-dem" style={{ exaggeration: 1 }} />
  ...
</MapView>
```

### 3.3 Route schema(无破坏性改)

```ts
type RoutePoint = { lat: number; lng: number; alt?: number | null }
```

`alt?` 已是 optional,旧 routes 兼容。

### 3.4 distanceM / elevationGainM 重算

Save 时基于最终 polyline 重算 distanceM(haversine sum)+ elevationGainM(从 alt 算)。

---

## 4. 状态管理(useRouteEditStore)

### 4.1 必修 bug 清单(v249-v255 遗留)

| Bug | 修法 |
|---|---|
| undo() 不重建 walkedIndex | undo 时从 last.matchedPoints 重建 PointCloudIndex |
| UndoEntry 类型不含 walkedIndex | 类型扩展 + 5 处 push 站点更新 |
| resetEdits 不清 strokeSnapCache / lastWarning / activeStrokeId | 全部清 |
| eraseAt / removeStroke / beginTrimDrag undo push 不清 walkedIndex | 同上扩展 |
| sticky lastWarning 跨 stroke 残留 | beginStroke 清 lastWarning |

### 4.2 commitEditDraft + 多 Preview 状态

- v6.2 `runPreview` 重写:
  - 每笔过 4 道门 → 全 PASS = sage 显示 + accept;任一 fail = 红字 + 拒收(立即从画布消失)
  - 多笔时:每笔独立判,acceptedValidated 数组只装 PASS 笔
  - spliceMatched 只接收 acceptedValidated
  - lastError / lastWarning 单源管理
- `commitEditDraft` 保持 v251 的语义(本地 commit,不落库)

### 4.3 状态机一致性

- editOpSeq fence guard 保留(防 await 期间状态变化)
- 任何 mutation 后 walkedIndex 跟 matchedPoints 同步(不再脱节)

---

## 5. UX 层

### 5.1 错误显示(单行 XOR 三态)

EditOverlayV236 statusRow 一格三态:
- `isComputing` → 旋转 + "Computing…"
- `lastError` → 红 pill + 错误文案
- `lastWarning` → (本期不再用,删掉)
- 默认 → "N/8 brush strokes"

**顶部 BrushOverlay lastError pill 删除**
**EditOverlayV236 顶部 lastWarning banner 删除**
**底部 hint text 在 error 时隐藏**

### 5.2 拒收文案

- 不在路上:"未识别到这条路,请重画或贴近主干道"
- 离原线太远:"超出 250m 范围,请贴近原路线"
- 起点不在原线:"画笔起点必须在原线上"

### 5.3 按钮位置(全局规则锁定)

- **Cancel / Delete 永远在左**
- **Save / Edit / Done 永远在右**
- v255 已修过的位置不动

### 5.4 拒收笔的视觉

- Preview 后被门拒 → **立即从画布消失** + 顶部 lastError 红字
- 不再 amber 颜色保留(v255 错误尝试)

### 5.5 颜色

- sage(绿):成功 snap 的笔,显示在 sage LineLayer
- 拒收 → 直接消失(无颜色)

### 5.6 起笔规则

- 第 1 笔起点必须在原 route 50m 内
- 后续笔可从已存 stroke 接(eraser-split 后续画支持)
- 锚点门(2.2 门 1)保证整体不脱链

### 5.7 Save 名字

- save-as-route 必须用户填(无默认)
- existing route 进 view-mode 自动填名,canSaveView = nameValid && !saving(改名也能存)

---

## 6. 测试矩阵

### 6.1 单元测试(必加)

| 测试 | 验证 |
|---|---|
| `validateStrokes` 锚点门 | 单笔起终点都在原线 50m 外 → 拒 |
| `runPreview` 几何偏移门 | 模拟 stroke 离 snap 路 12m → 拒 |
| `runPreview` 朝向门 | stroke 方向 vs snap 方向差 30° → 拒 |
| `runPreview` Mapbox NoMatch | Mock NoMatch → 拒 |
| `spliceMatched` alt 保留 | 头尾段 alt 不丢,中间段 alt = null |
| `resetEdits` walkedIndex 重建 | 重建后 nearest 查询用新数据 |
| `undo` walkedIndex 回滚 | undo 后查询匹配 last.matchedPoints |
| save-as-route 不 strip alt | route.points[0].alt === sessionTrackPoints[0].alt |
| densify 后 alt 保留(线性插值) | 中间插的点 alt 在两端之间 |

### 6.2 集成测试(用 250 case)

加载 spike-jury-J1.json 到 J5.json,以 mock Mapbox 响应 跑算法,验:
- 城市 ACCEPT bucket pass 率 ≥ 84%(实测 16% FR 上限)
- 城市 REJECT bucket FA = 0% 或 ≤ 1 (J2-039 边界)
- NZ 山区 NoMatch 全拒
- 多笔场景无 267m 直线
- Eraser-split A1/A2 各自独立判

### 6.3 真机测试矩阵(OTA 后)

| # | 场景 | 期望 |
|---|---|---|
| 1 | 沿主路画 200m | sage,Preview snap 干净 |
| 2 | 沿主路 + 50m 斜穿小区 | 接住,bearing 容差内 |
| 3 | 穿楼直线 | 拒,红字"未识别" |
| 4 | 250m 外乱画 | 拒,红字"超出范围" |
| 5 | 起点离原线 70m | 拒,红字"起点必须在原线" |
| 6 | 画 4 笔多笔(主路 + 段斜路 + 主路 + 段斜路) | 各笔独立判,无 267m 直线 |
| 7 | 画一笔 → eraser 切中段 → 各半笔 Preview | 各半独立判 |
| 8 | Preview → undo → 再画 | walkedIndex 正确,起笔判对 |
| 9 | reset → 起点离 reset 前 commit 30m | 拒(reset 后 walkedIndex 已回原线) |
| 10 | 画穿建筑 → preview 拒 → undo / reset | 状态正确 |
| 11 | 编辑后 save-as-route → 进 RouteDetail | 看到 alt 保留(未来导航数据齐) |
| 12 | NZ trail 上画(Tongariro)| 拒,红字"未识别"(可接受) |
| 13 | UI 检查:Cancel 左 / Save 右 / 报错红字单行 | 符合 |

---

## 7. 文件改动清单

### 7.1 修改文件

| 文件 | 改动 |
|---|---|
| `src/services/routing/mapmatch/MapMatchingClient.ts` | profile 锁 walking,radiuses=3,bearings 参数 |
| `src/store/useRouteEditStore.ts` | 4 道门重写 runPreview;undo/reset 重建 walkedIndex;UndoEntry 扩展;删 5 个旧判据;删 smoothCatmullRom;alt 保留 |
| `src/components/map/BrushOverlay.tsx` | 顶部 lastError pill 删 |
| `src/components/map/EditOverlayV236.tsx` | statusRow 单行三态;顶部 banner 删;Cancel 左 Save 右 |
| `src/components/map/BrushStrokeLayer.tsx` | 仅渲染 sage(拒收笔已被 store 移除) |
| `src/screens/RouteEditorScreen.tsx` | save 不 strip alt;Terrain 启用 |
| `src/services/routing/corridor/PolylineSampler.ts` | densify 已存在,save 时调用 |
| `src/components/OtaBadge.tsx` | 255 → 256 |

### 7.2 新增文件

| 文件 | 用途 |
|---|---|
| `src/utils/strokeBearing.ts` | 计算 stroke 段 bearings + per-segment 比对 snap |
| `src/store/__tests__/runPreviewGates.test.ts` | 4 道门单元测试 |
| `src/store/__tests__/undoWalkedIndex.test.ts` | undo / reset walkedIndex 测试 |
| `src/store/__tests__/altPreserve.test.ts` | alt 保留测试 |

### 7.3 删除文件 / 函数

- `smoothCatmullRom` (已无调用)
- v253-v255 的 fracBad / maxDispM 相关 helper

---

## 8. 可扩展点(未来 v7+)

- **own-map**(用户自己 GPS 历史):`PointCloudIndex` 支持 `source: 'activity'`(已有),只需 wire `useSessionStore` 数据
- **LINZ + OSM**:后端 `/api/trails/near` 服务,客户端 fallback 调用(架构留接口)
- **导航接通**:`useTrackingStore` 加 `routeId` 参数,`HikingScreen` start-on-route 按钮(独立 sprint)
- **API 调用优化**:多笔合并、后端缓存(独立 sprint)
- **Tilequery 建筑预拒**(独立 sprint)

**v6.2 不做这 5 项,但架构留扩展位**。

---

## 9. 风险 + 缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| J2-039 类型 case PO 真机碰到 | 低(刻意场景)| 用户 undo + 文档化已知边界 |
| Mapbox API 国内挂(实测稳定)| 极低 | code != Ok 拒收路径 |
| 多笔合并不做导致大规模消耗超预算 | 低 | API 消耗模型给出预警阈值 |
| Terrain 启用导致地图渲染 perf | 中 | 只在 RouteEditor mount,其他屏关 |
| 4 眼 review 漏 bug | 极低 | 流程强制双 review |

---

## 10. 时间估算

| 阶段 | 工时 |
|---|---|
| 算法层 + 状态管理修复 | 2 天 |
| Terrain + alt 保留 | 1 天 |
| UX 修复 + 测试 | 1 天 |
| 单元测试 + 集成测试 | 1 天 |
| 4 眼 review 修循环 | 1 天 buffer |
| 总 | **5-6 天** |

---

## 11. Ship 标准(锁定)

- [ ] typecheck clean
- [ ] jest 全过(含新增测试)
- [ ] **SubagentR1 review = PASS, 0 blocker / critical**
- [ ] **SubagentR2 review = PASS, 0 blocker / critical**(独立)
- [ ] OTA 推前 commit hash 与 plan 对齐

---

## 附录:Spike 索引

详见 `C:/ClaudeCodeProjects/Cairn/docs/spikes/BRUSH_EDIT_SPIKES.md`

---

**Plan 状态**:待 PO review → 4 眼 subagent review → 开发 → 4 眼 code review → OTA
