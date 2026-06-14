# PROD PATH AUDIT — R2 fix 闭环走查 (sub#3)

Commit 9cccc9d. 只看真生产代码,不看测试。grep 出来的引用就是事实。

## R2.2 FloorPlaneValidator (kRejectMaskHard + Couch)
**生产路径触发?**: YES — 5 处真调用
**关键证据**:
- `CairnAcquireController.cs:464,620,693` Validate 调,传 `_lidarAvailable`
- `PortalSpawnerV199.cs:251` 设 `lidar = meshMgr != null && meshMgr.enabled && subsystem.running`,调 `ctl.Init(..., lidar)` 把 _lidarAvailable 注入 controller
- `CrossSessionGroundSnap.cs:103` lidar 硬写 false (走 polygon 路径)
- `PendingAnchorRetry.cs:91-96` runtime detect lidar 跟 V199 一致
- `GroundYResolver.cs:336` lidar=true (Tier-A 自带 floor 检查)
**Production-blocker**:
1. **CairnAR.unity 场景中无 ARMeshManager 组件** — `grep ARMeshManager` 在所有 .unity 文件 0 命中。`FindFirstObjectByType<ARMeshManager>()` 永远返 null → `_lidarAvailable = false` 永远成立。这导致 R2.2 的 LiDAR 分支 (line 67-75) 永不触发。
2. **classifications mask 检查 (line 91-128) 不依赖 lidarAvailable** — 是 LiDAR 与否都跑。但: ARFoundation 6 + 非 LiDAR iPhone (15/16 base) classifications 始终为 None,`(plane.classifications & kRejectMaskHard) != 0` 永 false,5 类拒永不命中。
3. 结论: kRejectMaskHard + Couch 松绑只在 **LiDAR Pro 设备**真起作用。非 Pro 用户裸奔。这是 device-only fix。
**真验证只能 device** ✅

## R2.3 isLowAccuracy 端到端
**生产路径触发?**: NO — caller 把字段丢了
**关键证据**:
- `ARScreen.tsx:568` setArOriginIfMissing 写 `lowAccuracy: isLowAccuracy` ✓
- `useMarkerStore.ts:299,316,318` 持久化 lowAccuracy 字段 ✓
- `UnityAROverlay.tsx:85` props 类型: `arOrigin?: { lat: number; lng: number; alt: number | null }` — **没 lowAccuracy 字段**(type widening 导致 TS 不报错)
- `UnityAROverlay.tsx:712-716` 显式 destructure: `persisted = props.arOrigin ? { lat, lng } : null; projOrigin = persisted ?? live` — **lowAccuracy 在这里被显式扔掉**
- `UnityAROverlay.tsx:784-793` buildSpawnRequest(projOrigin, ...) 拿到的 projOrigin 永无 lowAccuracy 字段
- `unityCairnSpawn.ts:194` `origin.lowAccuracy ? 2.0 : 5.0` 永走 `5.0` 分支
**Production-blocker**: **致命断点**。R2.3 store 端写对了但 UnityAROverlay 这个唯一真消费者把字段丢了。低精度 GPS 用户(>10m acc)的 Tier-A 阈值仍然是 5m,跟普通用户一模一样。R2.3 当前**零 production 价值**(sub#B 已经报过,sub#A 已建议 grep,主 agent 没补 fix)。
**真验证**: 修改 UnityAROverlay.tsx:85 prop 类型 + line 712 destructure 即可。**目前 fix 是死的**。

## R2.4 CrossSessionGroundSnap (per-cairn nearest-XZ)
**生产路径触发?**: YES — CairnBridge.cs:597 ArReady 时调 EnsureRunning
**关键证据**:
- `CairnBridge.cs:597` `Cairn.AR.CrossSessionGroundSnap.EnsureRunning()` ArReady 时启动 ✓
- `CrossSessionGroundSnap.cs:71` `WaitForSeconds(5)` 默认延迟 5s
- nearest-XZ 算法 (line 119-156) 每 cairn 单独 picks plane,加 maxSnapDeltaY=1.5m 跨层保护 ✓
- `c.SnapToFloorY(planeY)` 改 `cairn.transform.position.y` (line 144 of CairnAcquireController)
- cairn 父级是 ARAnchor (PortalSpawnerV199.cs:896,920 `SetParent(a.transform, worldPositionStays:true)`)
**Production-blocker**:
1. **5s 倒计时风险**: 用户冷启动后 5s 内可能已经走开/转身,触发 inView=false → 真 snap。但 IMMORTAL 状态需要 cairn 已 plant 完成,跨 session 默认满足 — 只看 IMMORTAL 数量。
2. **IMMORTAL 状态实际产出?**: `grep State.IMMORTAL` 需查 Acquire 状态机,产线 plant 完后会进 IMMORTAL — 验证存在。
3. **anchor 拉回风险 (用户提的)**: `SnapToFloorY` 改 `cairn.transform.position.y` (世界坐标 Y)。cairn 是 ARAnchor 子节点,worldPositionStays=true。Unity 在父 transform 变更时会重算 child localPosition 维持 world。下一帧 ARAnchor refine 平移(通常 cm 级) → cairn world Y 跟着平移 cm 级。**snap 结果不会被完全拉回**,但会有 cm 级抖动。OK。
**真验证只能 device** ✅(IMMORTAL 状态 + ARAnchor refine 行为 Editor 测不到)

## R2.5 MultiSpawner Tier-A bypass
**生产路径触发?**: NO — MultiSpawner 在 Cairn 生产 scene 不存在
**关键证据**:
- `MultiSpawner.cs.meta` GUID = `43d6bdaa89f019644a7f8b2450da114a`
- `grep 43d6bdaa CairnAR.unity` → 0 命中
- `SceneSetup.cs:189` `spawnerGo.AddComponent<PortalSpawner>()`(GUID `08086b...`,scene line 540 命中)
- `CairnBridge.cs:33-34` 注释 "v187.7.4 — was MultiSpawner; now ICairnSpawner. SceneSetup wires PortalSpawner (v187); MultiSpawner (v186) deprecated"
- `ShaderTestbedSceneBuilder.cs:83` 仅在 shader 测试场景里 add MultiSpawner — 非生产 scene
**Production-blocker**: **R2.5 是死代码 fix**。Cairn 生产用 PortalSpawner(主) + PortalSpawnerV199(layer add-on)。MultiSpawner 是 v186 老路径,v187 后被 PortalSpawner 取代,scene 不挂,生产 0 调用。
**真验证**: PortalSpawnerV199.cs:568 同样的 Tier-A 逻辑 sub#A R2_FIX_REVIEW 已提到要 cross-check — 是这条主路径需要审,而 MultiSpawner R2.5 fix 等于无关。

## R2.6 PendingAnchorRetry lidar runtime detect
**生产路径触发?**: YES — PortalSpawner.cs:645 主 anchor 失败时启动
**关键证据**:
- `PortalSpawner.cs:644-645` `container.GetComponent<PendingAnchorRetry>() ?? container.AddComponent<PendingAnchorRetry>()` (主 plant 路径,raycast 无 hit 时 retry)
- `PortalSpawnerV199.cs:854-856` V199 路径检测到 PendingAnchorRetry 存在就跳过,避免双 coroutine SetParent 抖动 ✓
- `PendingAnchorRetry.cs:91-96` lidar runtime detect 用 ARMeshManager,跟 V199 line 251 一致
**Production-blocker**:
1. **lidar 检测同样依赖 ARMeshManager 在 scene 中存在** — 上面已确认 CairnAR.unity 无 ARMeshManager。`lidar` 始终为 false。
2. retry 流程本身 (1s × 0.1s raycast) 跟 lidar 无关,会跑。
3. lidar=false 进 Validate → 走 area gate 不走 classification gate。fix 把 lidar runtime detect 加进来,在生产没 ARMeshManager 时**等于硬写 false 一样**。**fix 跟 PendingAnchorRetry 之前的 hard-coded false 行为完全一致**。
**真验证只能 device** ✅ 但即便 LiDAR Pro 真机测,**还需 scene 加 ARMeshManager 组件**(目前没加),否则真机也是 false。

## R2.7 track flicker 200ms debounce
**生产路径触发?**: YES — arFrame.track 10Hz 真更新
**关键证据**:
- `ARScreen.tsx:340-397` useEffect 监听 arFrame.track,debounce + downgrade hard cap + same-value guard
- `UnityAROverlay.tsx:843` props.onArFrame({ ..., track: msg.track }) 真传给 ARScreen
- `CairnBridge.cs:726-729` ArFrame 10Hz emit (`ARFRAME_DECIMATE = 6` decimate from 60fps)
- 10Hz = 100ms 间隔 → 200ms debounce = 2 帧
**Production-blocker**:
1. user 担心 1Hz frame 间隔 → 200ms 永不触发,**实际 10Hz**,200ms 是 2 帧,debounce 真起作用。
2. downgrade hard cap (300ms 内 limited 累计 >200ms 强制立即降级) 防止 flicker 永久 mask 真问题 — 数学正确。
3. fix 在 useEffect 真 wire 上,arFrame.track 是真依赖。
**真起作用** ✅

---

## 总结

- **真起作用 fix 数**: 4 / 6 (R2.4, R2.6 部分, R2.7,R2.2 部分)
- **dead-fix (生产不调) 数**: 2 / 6
  - **R2.3** — caller `UnityAROverlay.tsx:85, 712-716` 把 lowAccuracy 字段丢了,fix 当前**零 production 价值**
  - **R2.5** — MultiSpawner 不在生产 scene,fix 是死代码上的死代码
- **device-only 真验证 (Editor 测不到) 数**: 4 / 6 (R2.2 LiDAR 分支, R2.3 整条链路, R2.4 IMMORTAL+ARAnchor, R2.6 LiDAR runtime)
- **环境层 production-blocker (Editor 改不了)**: **CairnAR.unity 场景缺 ARMeshManager 组件** → R2.2 LiDAR 分支 + R2.6 lidar runtime detect 在所有真机上**仍然不会触发**(包括 LiDAR Pro 设备)。fix 写得对没用,scene 不挂组件等于 fix 不起作用。

## 建议补什么让 fix 真在生产路径起作用

1. **R2.3 必须修**(致命 caller 断链):
   - `UnityAROverlay.tsx:85` 加 `lowAccuracy?: boolean` 到 prop 类型
   - `UnityAROverlay.tsx:712-714` destructure 时保留 lowAccuracy: `persisted = props.arOrigin ? { lat: ..., lng: ..., lowAccuracy: props.arOrigin.lowAccuracy } : null`
   - 否则 R2.3 就是 sub#B 早就报过的"死字段+log 装饰"

2. **R2.2 + R2.6 LiDAR 真起作用**(scene 改动):
   - `CairnAR.unity` 加 ARMeshManager 组件(挂到 XR Origin 子节点),配置 mesh density + classification request
   - 否则即便 LiDAR Pro 设备 `meshMgr != null && enabled && subsystem.running` 也是 false(因为没 component)

3. **R2.5 处置选择**:
   - 删 MultiSpawner.cs(deprecated v186 path)+ R2.5 fix 整体撤
   - 或者 cross-check PortalSpawnerV199 的同位逻辑(sub#A 提到的 568 行附近)是否也需要同样 Tier-A bypass — **这是真要审的主路径**

4. **R2.4 cairn 抖动**(可选,cm 级,可接受):
   - 如果真想 snap 后 anchor refine 不拉走 → snap 时用 `arAnchorManagerRef.AttachAnchor(plane, new Pose(snapPos, ...))` 重 anchor,不改 transform。当前实现 cm 级抖动可接受。

**严苛立场**: 6 个 fix,4 个真在生产路径上有效但 2 个有 LiDAR scene 依赖,2 个完全死的(R2.3 / R2.5)。声称"6 fix 全部 reviewed PASS"是不诚实 — production blocker 是 caller 链路 + scene 配置,不是 fix 代码本身。
