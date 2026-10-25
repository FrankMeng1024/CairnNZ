# Route / Fog Layer Ordering

## 原生机制

安装版本为 `@rnmapbox/maps` 10.3.1。iOS `RNMBXLayer.swift` 对 `aboveLayerID`/`belowLayerID` 调用 `waitForLayerWithID`；`RNMBXMapView.swift` 在 anchor 不存在时只把 callback 放入 `layerWaiters`，没有 timeout。旧 Route 固定引用 `memory-overlap-edge`，而 `FogLayer` 可以在未准备好时返回 `null`，因此这个风险真实存在，不能用 Web adapter 行为替代。

同一安装包的 `RNMBXSource.swift` 先 `style.addSource(source)`，再按 React child 顺序执行 `layer.addToMap`。本轮利用这个现有原生机制，不增加延时：

1. Editor 在 Fog/Route 之前始终声明 `ordered-route-fog-boundary-source`。
2. source 内透明、零半径 `ordered-route-fog-boundary` 是 Route core 自己拥有的稳定 anchor。
3. Fog 的 fill/edge/mine/friend/overlap 全部使用 `belowLayerID` 指向 boundary。
4. Route casing/line/repeat lanes/turn cap、Trim、pending、growth、端点和用户位置使用 `aboveLayerID` 指向 boundary。
5. Route 从不引用任何 Fog-owned id。Fog 完全不挂载时，Route 的 anchor 仍然存在。

Web adapter 的 position reconciler 是同步、幂等的，并监听 `styledata`，用于迟到、重挂和 style reload。它只在关系错误时 `moveLayer`，避免 styledata/moveLayer 循环。

## 已验证

- Fog absent/loading/unavailable：Route anchor 与 Route 都能排序；不等待 Fog。
- Fog late mount/remount：Fog 被移到 boundary 下方，Route 保持上方。
- 错误顺序/style reload：重新收敛为 `Fog < boundary < Route`。
- 当前 Web 运行时实测：max Fog index 9、boundary index 10、min Route index 11，`safe=true`。
- Route source：1 feature、5 coordinates；queried rendered features 7。
- Route focused gate：100/100；额外 display geometry/draft：51/51。

## 证据分级

- Static：**PASS**（读取 lock-installed RNMapbox iOS source）。
- Web layer relationship/source：**PASS**。
- Web screenshot pixels：**FAIL/BLOCKED**（见 `ROUTE_VISUAL_GATE.md`）。
- RNMapbox iPhone：**PENDING**。本文件不声称 native PASS。

canonical points、distance、Point target、保存数据和 U/O display geometry 都未被本轮排序修复改变。
