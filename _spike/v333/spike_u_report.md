# Spike U — Temp 文件方案工程可行性

## 1. Cairn 当前后台 GPS 落地链路

两条并行链路, 都已存在:

**链路 A — Tracking session (HikingScreen 录制)**
- `backgroundLocationTask.ts:117` TaskManager 收 GPS fix
- → `pendingBackgroundLocations[]` 内存队列 + `debugLogger.log()`
- 若 app killed: `appendDirectlyToSessionFile` 直接写 `cairn-logs/sessions/<sid>.jsonl` (file:78-109)
- 前台时 `useTrackingStore.ts:389` 每 1s drain 队列 → `addTrackPoint` → 三道 gate → `trackPoints[]`
- 服务器 PATCH 每 120s (file:446)

**链路 B — Memory fog unlock (ForegroundUnlockManager)**
- `ForegroundUnlockManager.tsx:244` 独立 `watchPositionAsync` (仅前台)
- → `processReading` → `unlockEngine.ts:80 recordPoint` → `useMemoryStore` + `useH3VisitedStore.addPointToCells` (h3Pure latLngToCell 同步, ~1μs)
- `cellVersion++` → FogLayer useMemo invalidate → Skia rebuild
- **后台时 `AppState='background'` → `stop()` + `flushMemoryNow()` (file:292-299)** — watcher 完全停掉, 不收点

## 2. "实时渲染耗电" 是否真问题

**否。** 三层证据:
- GPS chip 才是耗电大头 (10-50 mA, 取决于精度), JS 主线程 latLngToCell + Map.set + Skia invalidate < 1 ms/点
- Memory 链路后台**根本不跑** — `ForegroundUnlockManager` 已经在 `background` 状态停 watcher 并 flush. raster rebuild 后台时为 0
- Tracking 链路后台仍跑 (Skia FogLayer 不挂载, 只 push trackPoints[] + 120s PATCH), 耗电也在 GPS chip 上, 不在 JS 上

用户的产品直觉**技术上不成立**: temp 文件不会省电. 耗电 = GPS chip 在跑 = 不管 JS 把点写哪儿都一样.

## 3. Temp 文件方案的真实价值 (排序)

| 价值 | 现状 | 是否需要 |
|---|---|---|
| 防 app killed 丢点 | 已有 — `appendDirectlyToSessionFile` JSONL (BLT.ts:78) | **已解决** |
| 省电 | GPS chip 耗电, 与 store 写无关 | **伪需求** |
| 防后台 Skia rebuild | FGUM 后台已 stop, raster 不 rebuild | **已解决** |
| 防后台 sync 抢带宽 | 120s PATCH 一次, 已经节流 | **已解决** |
| SLC + Activity Recognition (Spike T 场景) | app killed 时系统事件来, debugLogger 内存空 | **需要** — 但 BLT 的 Path B 已是这种模式, 复用即可 |

## 4. 工作量评估

如果坚持做"独立 temp 文件 → Memory 打开时 flush":
- 新建 `pendingMemoryPoints.jsonl` writer (复用 BLT Path B 模式) — 1d
- MemoryScreen onMount 读文件 → `bulkImport` (已存在, file:386) → 删 temp — 0.5d
- 处理 Tracking 与 Memory 双写去重 (现在 unlockEngine 与 useTrackingStore 各自一套 gate) — 1d
- QA 测后台杀进程恢复 — 0.5d

**总 3d. 但收益 = 0** (因为后台 Memory 链路本就不跑).

## 5. 推荐

**否决 temp 文件方案. 走 SLC.**

- 用户真实痛点 = 后台开关开了仍然耗电 (Spike S 验证中) 或 全天追踪不可承受
- 温度文件解决的问题 Cairn 已经全部解决 (BLT Path B + FGUM 后台 stop)
- ROI:
  - Temp 文件: 3d, 省电 = 0, 防丢 = 已有
  - SLC + Activity Recognition (Spike T): 5-7d, 省电 80%+ (GPS chip 从持续 → 触发式), 这才是真的省电

**结论**: 用户的"打开 Memory 时 flush"直觉**对应到 SLC 是正确的** — SLC 投递事件天然异步, 必须落盘, 用户开 app 时 reconcile. 但单独做 temp 文件而不上 SLC, 是修补不存在的问题.

下一步: 进 Spike T (SLC + AR), temp 文件作为 SLC 的持久化层一并交付.
