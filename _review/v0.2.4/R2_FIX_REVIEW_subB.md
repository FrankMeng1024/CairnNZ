# R2 Fix Review — Sub#B (Adversarial / Production-Path)

视角:user-experience / failure-mode / production-incident。补 sub#A 代码 review 看不到的层。

---

## R2.2 — FloorPlaneValidator kRejectMask 4→9 类
**Production-Path Verdict**: **CONCERN**
**真用户场景失败模式**:
- **only-Couch 房间 (用户在沙发上 / 客厅地毯)**: ARKit 在沙发腿/地毯交界处常把整片地面 classify 为 `Couch`(已知 iOS 16+ ARKit bug)。kRejectMask 把 Couch reject → `lidar_not_floor_and_too_small` → **用户在客厅永远 plant 不了**。代码无 fallback 到 unclassified-large-area 路径(area ≥ 1.0m² 的 unclassified gate 位于 line 70,但 Couch 已经被 classify 不会落入 unclassified)。
- **办公室会议室 (大桌子下面的地毯)**: ARKit 把桌下 0.6m² 地毯 classify 为 `Table`(深度采样穿桌面误归类)→ reject。
- **酒店床边**: 床边毛毯被 classify `Couch` → 卧室不能 plant。
**异步/时序 race**:
- 同一 plane ARFoundation 在 1-3s 内会 mutate `classifications` (从 None→Floor 或 Floor→Couch)。Validator 是 stateless,被 reject 的 plane 下一帧可能合法但 PendingAnchorRetry 1s deadline 已过。
**数据流断裂**:
- `rejectReason="rejected_classification"` 没区分是哪一类 — telemetry 看不到 Couch vs Table vs Ceiling 真实分布,无法 OTA 决定哪一类该松绑。

---

## R2.3 — ARScreen GPS 双档 + isLowAccuracy
**Production-Path Verdict**: **FAIL** (数据流断裂)
**真用户场景失败模式**:
- 用户进咖啡馆 GPS acc=18m → lock 成功 isLowAccuracy=true → 但 cairn 仍正常 plant,**位置偏 15m 靠 GPS**。Tier-A 阈值是 ARKIT_XYZ_TIER_A_MAX_DELTA_M=5m,GPS 噪声 18m 已经超过 → 第二次回这个 origin 必走 Tier-B GPS 反算 → cairn 飘出 15m。用户感受:**"明明 plant 在桌子上的 cairn,第二天回来在马路对面"**。
**数据流断裂(BLOCKER 级)**:
- `isLowAccuracy = acc > 10` 只在 line 513 计算,**只写到 breadcrumb log,没传给任何下游消费者**。注释声称 "下游 unityCairnSpawn.ts 已有 Tier-A 路径,只需查 lowAccuracy flag 决定走哪条" — 我读了 unityCairnSpawn.ts:**没有任何 lowAccuracy/lowAcc 字段**。`buildSpawnRequest` 只看 origin delta ≤ 5m 决定 Tier-A,**flag 完全孤儿**。
- arOrigin store 也没存 isLowAccuracy。下次 cold start 不知道这个 origin 是低精度锁的。
**异步/时序 race**:
- 用户 GPS 在 9.5m / 10.5m 之间抖动 → 每秒一次 reject/accept origin → setArOriginIfMissing 因为已存在所以无效,但 `clearArOrigin` 在 distM>50 才触发 — 这条无 race。

---

## R2.4 — CrossSessionGroundSnap per-cairn nearest-XZ
**Production-Path Verdict**: **CONCERN**
**真用户场景失败模式 (worst case)**:
- ARKit 在墙角 0.3m 远经常误识别一片 0.4m² horizontal 微 plane(墙根灰尘 / 鞋柜下沿),`PlaneClassifications.None` + alignment=HorizontalUp + area=0.4m² 刚好 < 0.5m² 被 area gate 砍掉 — **但若房间扫到充分了 area=0.6m²就过了**。用户 cairn 离这墙根 0.4m → nearest-XZ 选这个错位 plane → cairn 被 snap 到墙根 plane.center.y(可能比真地面高 5cm)。**用户感受**:cairn 比之前矮 / 高了一点点,看起来像"飘"。
- 多层结构(loft / 楼梯下)nearest-XZ 不考虑 Y 接近度:cairn 在 1F y=0,但 2F floor plane center.y=2.8m,XZ 距离比 1F 远 plane 近 → 选 2F plane → snap 到 2.8m → cairn 飞到天花板。代码 line 140 `if (Mathf.Abs(yDelta) < minDelta) continue` 过滤的是"已经对齐"的不需 snap,**没**过滤"y 差太大不该 snap"。1F→2F 跨层 yDelta=2.8m >> minDelta=0.10m → 触发 snap → 飞天。
**异步/时序 race**:
- coroutine 启动等 5s,期间用户走到另一个房间。`Camera.main.transform.position` 是 5s 后采的,但 `validPlanes` 用的是同时刻 trackables — race 自洽。但 `cairns` 枚举到的 cairn 位置是协程开始那一帧的 `c.transform.position`,如果 cairn 同时在被 ARAnchor 微调 → 用旧 cairnPos 算 nearest plane → snap 到错的 plane。
**数据流断裂**:
- `_coroutineRunning = true` 在 SnapAfterDelay 入口才 set(line 65),但 TryStartSnap line 54 检查它 — race window=Run 1 yield → Run 2 EnsureRunning → 两次 StartCoroutine 都过 `_coroutineRunning` gate。**理论上**两个 coroutine 同时跑,double-snap。实际 Unity 单线程 coroutine 调度可能掩盖,但不是设计上保证。

---

## R2.5 — MultiSpawner Tier-A bypass sessionOffset
**Production-Path Verdict**: **PASS**
**真用户场景**: tier='A' 路径直接用 data.x/z(line 232),tier='B' 加 sessionOffset。这条逻辑对。
**异步/时序 race**: 无明显问题。
**数据流断裂**: 无 — RN 端 plant 总是发 tier='A',re-spawn 总走 buildSpawnRequest 决定 A/B。

---

## R2.6 — PendingAnchorRetry runtime LiDAR detect
**Production-Path Verdict**: **CONCERN**
**真用户场景失败模式**:
- **真机冷启第一帧 (iPhone Pro)**: ARMeshManager 的 subsystem 在 ARSession Tracking 之前可能 `subsystem == null` 或 `subsystem.running == false`(Unity AR Foundation 6 已知:subsystem 在 first frame 之后才 wire)。冷启 0-2s 内 PendingAnchorRetry 触发 → `lidar=false` → 走 polygon 路径 → 不享受 LiDAR 优势。
- **Editor**: ARMeshManager 通常不存在 → `meshMgr == null` → lidar=false → OK。
- **运行时切 Low Power Mode 或后台 30s 切回**: ARMeshManager.subsystem.running 可能短暂 false → 重启 retry 时误判非 LiDAR。
**异步/时序 race**:
- `FindFirstObjectByType<ARMeshManager>()` 在每个 retry tick(0.1s)调一次 — 30 retry × 0.1s = 30 次反射查找 ⇒ 性能可接受但浪费;更严重的是若 ARMeshManager 在中途被 Destroy/Recreate(场景切换),retry 中间帧检测不一致。
**数据流断裂**: 无。
**潜在 Blocker**: lidar 误判→ Validator 走 non-LiDAR fallback (line 67 `if (lidarAvailable)` skip 分类 gate),但 line 93 kRejectMask 对 ALL devices 强制生效 — 所以 LiDAR 误判 ≠ 灾难,只是 Floor 优势用不到。**实际影响有限**。

---

## R2.7 — ARScreen track downgrade 200ms debounce
**Production-Path Verdict**: **CONCERN**
**真用户场景失败模式**:
- **正常用户**:track tracking↔limited 1 秒抖 5 次 → debounce 把 5 次降级压成 0 次(每次 200ms 内被新事件 cancel)→ trackRef.current 永远 'tracking' → plant button 永远开 → 用户 plant 出 limited 状态下的坏 cairn。**这是 fix 引入的新 BUG**:debounce 逻辑只 cancel pending downgrade,但若 limited→tracking→limited→tracking 在 200ms 内来回,**每次 limited 来时 timer 重置,never fires**。
- **真用户晃动手机**:ARSession 进 limited 是真实信号(暗光/feature 不足),fix 把它 mask 掉 200ms,期间 plant → 坏 cairn。**安全 vs UX 权衡 fix 站到了 UX 一边,但用户铁律是"焊死"**。
**异步/时序 race(Blocker 级)**:
- **useEffect cleanup 与 timer fire 竞态**: line 354 cleanup 清 timer,但 timer 已 fire 进入 setTimeout callback (line 350-353) **不会被 cleanup 取消** — callback 入队等 JS task,组件 unmount 后 callback 跑,**写 trackRef.current**(ref 还存在)— ref 写入本身不抛异常,但如果有 unmount-after 逻辑读 trackRef 会读到 stale 值。**实际影响小**(ref 是裸对象不依赖组件生命周期)。
- 真问题:**孤儿 timer 累积**。每个 arFrame.track 变化都 `clearTimeout + setTimeout`,但 effect deps 是 `[arFrame.track]` — 每次 track 变化新 effect 跑,新 cleanup 注册。中间状态 OK,但 unmount 时只能 cancel **最后一个 effect 的 timer**。前面已 fire 进 callback queue 的不可阻断。
**数据流断裂**:
- trackRef 是 useMemo 的 dep 替代品(line 224 注释承认 TDZ workaround),但 useMemo deps 没 trackRef → trackRef 变化不重算 a4PlantEnabled。**每次 a4PlantEnabled 重算靠 tick (200ms 一次)** — 也就是说 track 升级到 tracking 后,plant button 最多滞后 200ms 才放行。**与 R2.7 的"升级立即放行"承诺矛盾**。

---

## Sub#B 必修 BLOCKER 清单(上线前必须修)

1. **R2.3 isLowAccuracy 是死字段**:必须传到 unityCairnSpawn.buildSpawnRequest 决定 Tier-A 阈值(低精度时收紧 5m → 2m),或存到 arOrigin store 让 Tier-B 反算时知道原点本身有 18m 误差。否则这个 fix **零 production 价值**,只是 log 装饰。
2. **R2.4 跨层 snap 飞天**:`if (Mathf.Abs(yDelta) > MAX_SNAP_DELTA_Y)` 加上限(如 1.5m),否则 1F cairn 会被 snap 到 2F plane → 飞天复活。
3. **R2.7 debounce 反复 cancel 永不 fire**:加上 "若 200ms 内连续抖动 N 次,强制应用最近一次 limited" 的 hard cap(例如 1s 内累计 limited 时长 > 500ms 就立即生效)。
4. **R2.2 客厅/卧室 only-Couch fallback**:用户在常见家居场景 plant 不出来不是"焊死",是"焊死自己"。需要 telemetry 加 rejectReason 细分 + OTA kill-switch 让 Couch 能松绑回去(只把 Couch 当做"非 Floor 但可接受"if area ≥ 0.8m²)。
