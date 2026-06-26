# spike_z — "Memory 范围太大,静安一直亮到长宁" 真根因

## 结论:真根因 = #5 FogLayer L1 hole 半径写死 2800m,跟 initialReveal 半径(200m)完全脱钩

用户看到的"亮到很远"**不是** initialReveal 画大了,而是 **L1 fog floor 在用户位置永远凿一个 2800m 圆洞**。这个洞是覆盖全世界的雾层中央的"露底窗",窗里全是亮的底图(Mapbox outdoors)。改 `initialRevealRadiusMeters` 200→50 **对它没用** —— 那只影响 L2 mask(±3000m 方块内的细 cell 雾),L1 的 2800m 圆洞与 reveal 半径完全独立。

**证据**:
- `app/src/features/memory/components/FogLayer.tsx:65` — `const FLOOR_RADIUS_M = 2800;`
- `FogLayer.tsx:106-114` — `worldRectMinusCircle(userCenter.lat, userCenter.lng, FLOOR_RADIUS_M, 32)`,L1 雾用 worldRectMinusCircle 在用户位置打一个 2800m 圆洞,洞内全透。
- `services/fogFloorGeometry.ts:6` — "Fills the whole world with fog except a small circular cutout around the user."
- `FogLayer.tsx:66` — `MASK_PADDING_M = 3000`,L2 mask 是 6km 方块。L1 半径必须 < L2 才能被 L2 覆盖(代码注释也这么写)。
- `services/fogMaskRenderer.ts:77` — `DEFAULT_PADDING_M = 3000`,L2 mask 也跨 6km。

**地理对照**:静安站到长宁站直线 ~5.5km。2800m 圆洞直径 5.6km — 正好覆盖这段距离。用户看到的"静安一直亮到长宁"就是这个 5.6km 全亮圆洞 + L2 mask 在边缘 fade。

## 应该修哪一行

`FogLayer.tsx:65`,把 `FLOOR_RADIUS_M = 2800` 改到与 `initialRevealRadiusMeters` 同量级,例如 250m 或 300m。但**注意**:L1 hole 半径必须 < L2 padding 半径(注释明写),否则 L2 mask 边缘会有缺口。所以要么同时改 `MASK_PADDING_M`(66 行)和 `DEFAULT_PADDING_M`(fogMaskRenderer.ts:77),要么用约束 `FLOOR_RADIUS_M < MASK_PADDING_M`。

**最干净的根因修法**:`FLOOR_RADIUS_M` 改 `UnlockConfig.initialRevealRadiusMeters`(动态读 config,不写死),`MASK_PADDING_M` 改 `initialRevealRadiusMeters + 200` 之类,让所有视觉尺度跟语义半径锁死。

## 预测视觉

改完之后,用户初次打开 Memory:在 GPS 点周围看到一个 ~200-300m 的亮圆(对应 reveal 半径),圆外是暗雾,圆边缘有 cream 光晕过渡。**不会再看到** 从静安亮到长宁。

## 备选根因(如果改完仍亮一片)

1. **#3 recordCircleUnlock 在 200m 内 hex-tile 撒了 ~570 个点**:`useMemoryStore.ts:333` 用 `hexSpacing=20m` 撒满圆内点。200m 圆 → π·200²/(20²·√3/2) ≈ 363 个点。如果 FogLayer L2 mask 把这些点都 cell 化并 punch hole,L2 mask 的亮区跟 L1 2800m 圆叠加导致更亮。但 L2 mask 范围被 `MASK_PADDING_M=3000` 框住,不会跨城。
2. **#1 历史 cells 残留**:`memoryPersistence.ts` 在用户登录时 hydrate 历史 points,会调 `addPointToCells` 重建 cells。如果用户一年前在静安留点,这些点在 L2 mask 6km 范围内会被画 hole。但同样**不会**让 L1 圆变大 —— L1 圆永远只在用户当前位置打 2800m 洞。
3. **#2 fit-to-data zoom**:`MemoryMap.tsx:64` 写死 `INITIAL_ZOOM = 16.5`,`MemoryMap.tsx:275-278` 用 defaultSettings 固定 zoom,**没有** fit-to-data。这条排除。
4. **#4 H3 resolution**:`useH3VisitedStore.ts:145` `STORE_RES = 11`,`fogMaskRenderer.ts:78` `FOG_RES_METERS = 25`(res 11 hex 也 ~25m),一致。排除。
