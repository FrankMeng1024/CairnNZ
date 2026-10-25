# RNMapbox / Mapbox Standard Slot Review

## 实际依赖与机制

- App style：`mapbox://styles/mapbox/standard`。
- `@rnmapbox/maps`：10.3.1。
- lock-installed native Mapbox iOS SDK declaration：`~> 11.20.1`。
- 安装源码 `RNMBXLayer.swift` 在 add layer 前执行 `layer.slot = _toSlot(slot)`，并通过 `style.addLayer(styleLayer, layerPosition: layerPosition)` 应用 `aboveLayerID` / `belowLayerID`。
- `RNMBXSource.swift` 先 add source，再依 React child 顺序 add layers。

Mapbox 官方说明中，Standard 的 slot 决定 custom layer 所属的稳定绘制区域，relative positioning 在同一 slot 内才是可靠的顺序表达；未指定 slot 的 custom layer 与指定 `top` slot 的 layer 不能只靠 Web style 数组顺序证明最终原生顺序。参考：

- https://docs.mapbox.com/ios/maps/guides/styles/work-with-layers/
- https://docs.mapbox.com/ios/maps/guides/migrate-to-v11/
- https://rnmapbox.github.io/docs/components/CircleLayer

## 风险与最小修复

#19 状态：

```text
Fog(no explicit slot) --belowLayerID--> boundary(slot=top)
boundary(slot=top) --anchor--> Route overlays(slot=top)
```

这能避免 Route 等待 Fog-owned id，却没有消除 Mapbox Standard 跨 slot 风险。

#20 Route planning 状态：

```text
Fog(slot=top) < Route-owned boundary(slot=top) < all Route overlays(slot=top)
```

- `FogLayer` 接受可选 slot，并对 8 个 fill/line layers 一致传递。
- 只有 `OrderedRouteEditorScreen` 给 planning Fog 传 `top`。
- 普通 `MemoryMap` 不传 slot，因此没有把 Route 专用顺序扩散到普通 Memory。
- boundary 仍由 Route 拥有并始终挂载；Fog absent/loading/failed 时 Route 不等待它。
- `CanonicalRouteLayer`、repeat、turn cap、endpoint、growth、pending、Trim 等仍使用同一个 boundary 与 `top` slot。
- Standard 的 `top` slot 保持 custom non-symbol line/fill/circle 在 place/transit labels 之后的标签层级规则内；没有把 Route/Fog 放到不受控的无 slot 顶层。

Web 使用安装的 Mapbox GL JS v2，本身没有 Standard slot。adapter 仅接收 prop 以匹配 RN component shape，不把未知 `slot` 注入 v2 style；Web 证据只验证 relative order/source，不冒充 Standard 原生证明。

## 验证边界

| Evidence | 结果 |
|---|---|
| lock-installed iOS source / package contract | PASS |
| React declarations: all Route-planning Fog + boundary + Route use `top` | PASS |
| ordinary Memory has no Route-specific slot | PASS |
| Fog absent/loading/failure/late/remount/style reload tests | PASS |
| Web structural order/source | PASS |
| Mapbox Standard hosted Web pixels | BLOCKED（无授权 token） |
| physical RNMapbox iPhone | PENDING |

因此准确结论是：**跨 slot 源码风险已修复；物理 iPhone 最终绘制验收未关闭**。

## OWNER_ACTION_REQUIRED

如 Owner 授权既有 native build/device 流程，在物理 iPhone 的 Mapbox Standard 上验证：Fog absent、loading、failed、late mount、remount、Memory refresh、style reload；每项确认 Route 可见且 `Fog < Route`，并比较 Editor/Detail 同一路线和相机。不得用本轮 JS export 代替。
