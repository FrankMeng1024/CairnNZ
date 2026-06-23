# v305 H3 Fog — Render Path Review (Subagent B)

**verdict: NEEDS_FIX**

scope: 只看 FogLayer / MemoryMap / h3FogBuilder / mapboxAdapter 的渲染路径。不评 store/migration/UnlockConfig。

---

## Critical

### C1. FillLayer fillAntialias=true + LineLayer 同源 → 共享边重画 2 次,边界 visible "粗黑线" + 透明度叠加 (FogLayer.tsx:117-139)

`ShapeSource id="memory-fog-src"` 里同时挂了 `FillLayer` 和 `LineLayer`,**FeatureCollection 是 N 个独立的 Polygon Feature**(每个 hex 一个),不是一个 MultiPolygon,也不是 dissolved boundary。

后果:
- 相邻 unvisited hex A 和 B 共享一条边。LineLayer 渲染时,A 沿自己的 6 边各画一条 line,B 同理 —— **A∩B 这条共享边被画了 2 次**。
- lineOpacity=0.55 时,两层 0.55 alpha 叠加在像素上 ≈ 1 - (0.45)² = 0.7975,而单独一条边只有 0.55。**用户会在 unvisited 区域内部看到一张明显的六边形网格,违反 "reads as cloud, not as game grid" 的设计意图**(comment FogLayer.tsx:113-114 本人写的)。
- 在 zoom 11、res 8 demoted 时这个网格特别明显 —— 几百个 hex 内部线全部 2× 强度。
- `fillAntialias: true` (FogLayer.tsx:125) 在两个相邻 fill 之间还会有 1px 半透明 anti-alias 缝,fillColor + 缝下面的底图颜色透出来 —— 在 fillOpacity=1 的纯色场景下视觉表现就是 hex 之间有更亮的 hairline,**和 LineLayer 描线叠加变成"双线" 视觉效果**。

应对:LineLayer 必须用 dissolved boundary(只画 unvisited 区域的整体外轮廓),不能让每个 hex 都自己描边。
- 选 A: 用 h3-js 的 `cellsToMultiPolygon(unvisitedCellIDs)` 得到合并外轮廓 → 单 Feature 灌进另一个 ShapeSource → LineLayer。
- 选 B: 干脆去掉 LineLayer,只靠 FillLayer 软边(fillAntialias)+ Mapbox 内置抗锯齿。

**这是渲染路径里最显眼的视觉 bug,不是 nitpick。**

### C2. useMemo 依赖里漏 `useH3Fog`,kill-switch 不能跨 state 切换正常工作 (FogLayer.tsx:71-105)

`fogFC` useMemo deps = `[cellVersion, debouncedBounds, debouncedZoom, userId]`。**没有 useH3Fog**。

后果(细查):
- 当前实现里 useH3Fog 只在 useMemo **之后** `if (!useH3Fog) return null` 做 kill-switch(FogLayer.tsx:108)。这意味着 useH3Fog=false 时,useMemo **仍然在每次 cellVersion bump 时跑 buildUnvisitedHexFeatures** —— 用户开了 kill-switch 想关掉性能负担,代码反而该跑还跑(只是不渲染)。
- 测试 N=3500 unvisited cell:`build_ms` 仍然每次 cellVersion bump 都 ~50-100ms 在主线程,玩家把开关关掉以为有救,实际没救。

应对:`useH3Fog=false` 时应该让 useMemo **不算**。简单两种姿势(选其一,不能既改 hooks 顺序又保住 ESLint):
- 把 `useH3Fog` 加进 deps,并在 useMemo 体里 `if (!useH3Fog) return null` 提前。
- 不动 useMemo,在 useH3Fog 切到 false 时 unmount FogLayer(由父组件控制),让 useMemo 直接随组件 unmount 释放。

### C3. fogFC 引用稳定性问题 — 每次 setData 灌新数组,iOS Mapbox v11 setData 3500 features 实测会卡 (FogLayer.tsx:101-104, MemoryMap.tsx:260)

`useMemo` 返回新对象 `{type:'FeatureCollection', features: result.features}` 每次 cellVersion / debouncedBounds 变化都是全新引用。Mapbox `<ShapeSource shape={fogFC}>` 内部对 shape prop 做引用对比,**新引用 → 全量 setData(整个 FeatureCollection 重新序列化 + 跨 RN bridge + 在 native 端建索引)**。

iOS Mapbox v11 已知:
- `setData` with FeatureCollection of N polygons 走 ObjC 桥 → 序列化 N×6 个 [lng,lat] 数组 + N 个 Feature dict。N=3500 实测大概率 50-150ms 主线程阻塞(经验值,需用 Xcode Instruments 验)。
- 这个开销 **不算在 `build_ms` 里**(perf 只测了 JS 端 buildUnvisitedHexFeatures 时间),所以现在的 telemetry 看不到。
- iOS Mapbox setData 大 FC 历史上有 GitHub issue,例如 rnmapbox/maps#2589 类型(单次 setData 主线程卡顿)。

后果:
- 用户 pan/zoom 跨 res 边界(getResForZoom 阶梯)时,viewport_cell_n 可能从 ~500 跳到 ~3500,**单次 setData 主线程阻塞 100ms+,UI 卡顿肉眼可见**。
- 比 turf.union 当然好(15s → 100ms),但**仍然不是真的丝滑**,跟 PRD 想要的"H3 是 50ms"的承诺不一致。

应对:
- (a) 进一步降 cell budget(VIEWPORT_CELL_BUDGET 3500 → 1500),牺牲分辨率换流畅度;
- (b) incremental update: 维护 prev unvisited cell set,只 add/remove diff,而不是整个 setData。但 ShapeSource 没暴露 incremental API,需要走原生 module(改动量大,不建议本 OTA 做)。
- (c) 至少把 setData 耗时也 telemetry 进去 —— 现在拿不到 client perf 实测数据。

---

## Serious

### S1. debouncedBounds object identity 抖动 → useMemo 过度 invalidate (FogLayer.tsx:56-69, MemoryMap.tsx:113-126)

`debouncedBounds` 是 useState 存的 object。`setDebouncedBounds(bounds)` 每次 setter 都会把上游传来的新 `bounds` object 写进 state。

上游 `MemoryMap.updateBoundsIfChanged` (MemoryMap.tsx:113-126) **有做** eps=1e-5 比对去重,这部分 OK。但有两个隐性破口:
1. `onMapSettle` 在 throttle trailing(100ms,MemoryMap.tsx:191)结束时,**即使** bounds 在 eps 内,**`setCurrentZoom(zoom)` 一定 setState**(MemoryMap.tsx:168)。FogLayer 上游收到的 props 里 zoom 变了 → useEffect (FogLayer.tsx:59-69) 触发 → setDebouncedZoom 触发 useMemo 重算。**zoom 哪怕只浮点跳了 0.001 也算变化**,因为 useEffect deps 用 `[bounds, zoom]` 没做 eps 比对。
2. setDebouncedBounds 调用本身是 `setDebouncedBounds(bounds)` —— **不做 prev 比对就直接灌 bounds**。如果上游 updateBoundsIfChanged 因为 setBounds(prev => prev) 没换引用,那 props.bounds 引用相同,可以;但 debounce 触发的是从 useEffect 内闭包拿到的 `bounds`(FogLayer.tsx:63),这个 bounds 是 effect 创建时刻的快照。**会不会 useEffect 关闭一个旧的 bounds,然后 setTimeout 100ms 后把"旧" bounds 写进 debouncedBounds**? 是的会。如果 bounds 在 100ms 内变两次但最后又回到原始引用,setDebouncedBounds 最后一次写的是同一个引用,React 会跳过 re-render —— 这部分 React 自己处理 OK。但中间 `setTimeout` 的 callback 闭包对 bounds 是 stale,**只灌最后一次有效**(因为 clearTimeout 清掉了前面的 timer)—— 这部分实际正确,no bug here。

主要 actionable: **#1 是个真实小坑** —— zoom 浮点抖动(Mapbox 给的 zoom 不是整数,onIdle 间会有 ±0.0001 的浮点扰动)会让 useMemo 多 invalidate。建议 zoom 比对加 eps 或 `toFixed(2)` 量化。

### S2. visitedParentsAtRes 在 visited cells 巨大时是 O(N) — 长用户线性变慢 (h3FogBuilder.ts:92-108, 149)

`visitedParentsAtRes(cells, res)` 在 res < 11 时对每个 visited cell 跑 `cellToParent` —— 50k visited cells × ~0.005ms = 250ms 主线程。**而且每次 buildUnvisitedHexFeatures 都从头算一次**(FogLayer.tsx 通过 useMemo cellVersion 触发 build,build 内部又调 visitedParentsAtRes(cells, res))。

长期用户(走过几千 cell)在 zoom 11/13 / res 8/9 视图下,**每次 pan 都要重新跑全部 cellToParent**。

Mitigation:
- 缓存 `visitedParentsAtRes(cells, res)`,key = `${cellVersion}:${res}`,LRU 4 项。
- 或在 useH3VisitedStore 里 maintain 多分辨率的 parent set,addPointToCells 时同时更新各 res 的 parent set(空间换时间)。
- 现在没缓存。**会在 visited cells >10k 后变成性能瓶颈**,N=50k 估算 250ms 完全可能,且无 fallback。

不是当下 Blocker(新用户没有 10k cells),但**长期用户 6 个月后这个 path 一定会成为体感卡顿源**,应当现在就建工单。

### S3. res 自适应跨边界跳变 — 视觉上 hex 大小突变,无渐进 (h3FogBuilder.ts:66-71, FogLayer.tsx:115)

`getResForZoom`:
- zoom 11.99 → res 8 (174m hex)
- zoom 12.00 → res 9 (66m hex,边长缩 1/√7 ≈ 0.38,**面积约 1/7**)

跨 zoom 12 边界用户会看到 **整张图的 hex 突然变小约 1/2.6 视觉尺寸**,viewport_cell_n 从 ~500 跳到 ~3500。
- 视觉 perception:用户 pinch zoom 经过 12 的瞬间,屏幕 fog "颗粒度" 跳变,**很不丝滑**。
- 同理 13→14 (res 9→10),15→16 (res 10→11)。

`lineBlur` 也是 zoom <13/15 用 5/3/2(FogLayer.tsx:115),**也是阶梯的**,不是 stops 插值。Mapbox 支持 `interpolate` style expression,可以让 lineBlur 在 zoom 11-13 之间 5→3 平滑过渡。当前实现给的是 JS 端算好的常量,所以 zoom 跨边界时 blur 也是离散跳。

视觉效果:
- zoom 11 一个 res 8 hex 屏幕 ~50px,blur 5px = 10% 边宽比
- zoom 16 一个 res 11 hex ~500px,blur 2px = 0.4% 边宽比
- **跨 zoom 不一致,zoom in 越多边界越锐,zoom out 越多边界越糊**,体验上是反直觉的(常理是离得近才看到精细,离得远应看到柔和团块 —— 现在反了)

应对:lineBlur 改成 Mapbox style expression `interpolate(linear, zoom, 10, 8, 13, 5, 16, 2)`,在 native 端 GPU 插值。或者把 lineBlur 调成相对 hex 屏幕尺寸的恒定比例。

### S4. cells.size === 0 && points.length > 0 recovery 在 useMemo 内 side-effect (FogLayer.tsx:78-81)

`if (cells.size === 0 && points.length > 0 && userId) { void migrateH3IfNeeded(userId); }` — 在 `useMemo` 体内调用副作用。

React 文档明确说 useMemo factory **必须是 pure**。这里 fire-and-forget migration 实际是 promise 副作用:
- StrictMode 下 useMemo 可能跑两次,会触发两次 migrateH3IfNeeded(取决于 migrateH3IfNeeded 内部幂等)
- 测试环境如果用 React Testing Library + act,也会奇怪

更稳健:挪到 useEffect 里 trigger,只在 (cells.size === 0 && points.length > 0 && userId) 变化时执行一次。

不影响线上行为(react native 默认非 StrictMode),但是个 anti-pattern,建议清掉。

### S5. estimateInitialBounds 在 lat 高纬度严重失真,首屏 fog 错位 (MemoryMap.tsx:64-74)

`halfDegLng = 0.005` 是个常量,不随纬度调整。lat 31°(comment 说的)时 0.005°lng ≈ 475m,但 lat 60°(挪威/阿拉斯加)时 0.005°lng ≈ 278m,lat 70° 时只有 ~190m。

后果:
- 高纬度用户首屏 estimateInitialBounds 给出的矩形比实际 viewport **窄得多**(只算了 longitude 方向)
- buildUnvisitedHexFeatures 会基于这个错误 ring 算 viewport cells,首屏 fog 在屏幕东西方向"少一块"或者 viewport 边缘没有覆盖
- 等 onMapIdle 第一次 fire(MemoryMap.tsx:154 之后)才会用真实 metersPerPixel 算 (MemoryMap.tsx:177-184),覆盖回去 —— 但首屏 100-500ms 内用户能看到错的 fog 状态

应对:estimateInitialBounds 也用同样的 metersPerPixel 公式(像 onMapSettle 里那样),依赖 centerLat 调整 halfDegLng。

---

## Nitpick

### N1. log 调用的 build_ms 比实际值小 (FogLayer.tsx:83-96)

log `total_ms: Date.now() - t0`,t0 在 useMemo 体内 line 83 取。但 build_ms 在 h3FogBuilder.ts:122 内部又算一次。**这两个值不一样**(useMemo 体里 total_ms 包括 useH3VisitedStore.getState() 取 cells + log 自己 + spread,会比 builder 内的 build_ms 大一点)。读 telemetry 时小心区分,文档要写清。

### N2. ShapeSource id 固定,但 FillLayer/LineLayer id 也固定 — 切 useH3Fog 时 layer ID 冲突可能? (FogLayer.tsx:119-138)

useH3Fog=false 后 FogLayer return null,Mapbox layer 拆掉。然后用户切回 true,layer 重建,id "memory-fog-src/fill/edge-line" 在 native Mapbox 里如果 unmount cleanup 没跑完就 remount,会 race。**没看到证据,但 Mapbox SDK 上 id 重复会 silent fail or duplicate**。不是当前 blocker,提示注意 cleanup 顺序。

### N3. `Mapbox as any` 的运行时假设 (FogLayer.tsx:50, 111; mapboxAdapter.ts:11-21)

`getMapbox()` 返回的 adapter 没声明 ShapeSource/FillLayer/LineLayer 等类型(实际有 — line 17-19 声明了 any),但 FogLayer 又重新断言 `const { ShapeSource, FillLayer, LineLayer } = Mapbox as any`。多余的 as any。

iOS native 一定 work(@rnmapbox/maps 标准导出),Android 一定 work,web 走 mapboxAdapter.web.tsx 的 shim —— 但 web shim **没读到内容,review 假设它正常 export 同名组件**。如要严格 verify,需检查 mapboxAdapter.web.tsx。

### N4. fogFC null 时不渲染 ShapeSource — OK,但要确认 unmount/remount 不漏 layer (FogLayer.tsx:109)

`if (!Mapbox.available || !fogFC) return null;` — fogFC 在 features.length===0 时返回 null(line 98-100),整个 ShapeSource 不渲染。

后果:用户全部覆盖完后(unvisited 0),整个 fog layer **从 Mapbox 中拆除**,然后第一次出现新 unvisited 时(理论上不会发生,但比如清空 visited 数据),又重新挂载。Mapbox native 在反复 add/remove layer 上历史不太稳。**建议改成永远渲染 ShapeSource,只把 features 设成 []**,fillOpacity 改成 expression 看 features count。当前实现风险小但不是最佳实践。

### N5. fillAntialias=true + fillOpacity=1 — fillAntialias 主要在边界生效 (FogLayer.tsx:125)

fillAntialias 在 Mapbox 主要影响 fill 的边缘抗锯齿。每个 hex 都是 6 边形,边缘像素是 antialiased 半透明 —— 在 fillOpacity=1 下,每个 hex 边缘有 1px 半透明像素,**相邻两个 fill 接缝处会双层叠 antialias**,可能看到 1px hairline 比 hex 内部稍浅(因为半透明叠半透明 ≠ 完全不透明)。

实测上这个不一定肉眼可见。但与 C1 的 LineLayer 双线问题叠加,**接缝处的视觉问题会被放大**。

---

## Verify needed

### V1. iOS Mapbox v11 setData 3500 features 实测 ms 是多少?

review 凭经验估 50-150ms,但 v11 比 v10 native pipeline 重写过,实测可能更快或更慢。**必须用 Xcode Instruments 量,不能信我的估算**。
- 测试方法:让 unvisited count 在 3500 时,触发一次 cellVersion bump,Instruments 抓 setData ObjC 调用栈的 wall time。

### V2. cellToBoundary 在 res 11 大量 cell 时实际 ms?

builder comment 写 res 11 25k cells / 658ms,但 cell-to-boundary 单独是多少没量。viewport_cell_n=3500 在 res 11 时 boundary 调用 ~35ms 估算,需 mobile 真机量。

### V3. mapboxAdapter.web.tsx 是否正确 expose ShapeSource/FillLayer/LineLayer

review 没读 web shim 文件。Playwright web 测试时 FogLayer 是否能挂上去?如果 shim 缺这几个组件,**web 端 fog 不渲染但不报错**(`Mapbox.available=true` 但属性是 undefined,React 渲染 undefined 组件 RN 上会抛,web 不一定)。

### V4. addPointToCells 触发 cellVersion bump 频率 — 实际用户走路 1 秒采 1 个点,1 hr 走完 3600 cellVersion bump,**每次都 invalidate useMemo**

- 假设 user 在走路,每秒 1 点,fog rebuild 50ms(N=200),那是 50/1000 = 5% CPU,持续。OK。
- 但若 cellVersion 因为重复点(同一 cell 再写 count++)也 bump(addPointToCells line 95),**实际同一 cell 反复打点也 invalidate useMemo**。
- 优化:同一 cell 重复打点不 bump cellVersion(因为 fog 视觉无变化)。
- 这条 verify on telemetry: 看 `memory.fog_built` 事件密度对照实际新 cell 增加密度。

---

## Summary

**Critical**: 3 — 共享边双描线 (C1)、kill-switch useMemo 不短路 (C2)、setData 大 FC 卡顿 (C3)
**Serious**: 5 — zoom 浮点抖动 (S1)、visitedParents 无缓存 (S2)、res 阶梯跳变 (S3)、useMemo 内副作用 (S4)、estimateInitialBounds 不考虑纬度 (S5)
**Nitpick**: 5
**Verify needed**: 4(都是需要真机 / Instruments / telemetry 数据,review 没法判断)

**verdict: NEEDS_FIX**
- C1 是肉眼可见的视觉 bug,违反"reads as cloud, not as game grid"设计意图,建议本 OTA 修(改 LineLayer 用 cellsToMultiPolygon dissolved boundary)。
- C2 是性能漏洞但用户可能感知不强,但 kill-switch 的存在意义就是给紧急情况用,逻辑不对必须修。
- C3 是性能上限问题,要至少加 telemetry 量出来,后续 sprint 改。
- 其它都可以进 backlog。
