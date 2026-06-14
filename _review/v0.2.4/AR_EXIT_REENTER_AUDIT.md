# AR exit + re-enter (same process) 审计

场景: 用户 plant cairn → 退出 AR → 同 app process 内 再进入 AR。

---

## Section 1: 退 AR + 重进 AR 代码路径

**ARScreen mount/unmount** (`app/src/screens/ARScreen.tsx`):
- mount L717-728: 仅 breadcrumb,无 scene state init。
- unmount L725-728: breadcrumb + `crashLogger.uploadDiagnostic`。**没主动清 markerStore.arOrigin / spawnedIds / Unity scene。**
- L1269-1281: `<UnityAROverlay>` 子组件随 ARScreen mount/unmount。

**UnityAROverlay mount/unmount** (`app/src/components/UnityAROverlay.tsx`):
- mount L266-360 useEffect[]:
  - 重置 `parseUnityMessage` 节流。
  - L274 `arReadyRef=false` (隐式: ref 实例化为 false 然后 ArReady 后置 true,但 ref 跨 unmount 不保留——新组件 = 新 ref)。
- unmount L332-358 cleanup:
  - L341 `unityRef.current.postMessage('CairnBridge','OnClearAll','')` → Unity 端清 cairn GameObject。
  - L343 `spawnedIdsRef.current.clear()`。
  - L350-356 `lastSentOriginRef / bulkSpawnedRef / emptyMarkerFrameCountRef / rejectionTrackerRef / recentPlanesRef / observedPlaneYsRef / lastCameraYRef` 全清。
- L982-987 `<UnityView>` 实例随子组件 unmount,但 `@azesmway/react-native-unity` 是 **singleton** (L9-11 注释明说),native UnityFramework process 不死,只是 view detach。

**Unity 端 scene state** (`UnityARLib/Assets/Scripts/CairnBridge.cs`):
- L397-425 `OnEnable`: 重置 `_arReadySent / _diagSent / _stateStallReported / _firstFrameLogged / _lastLoggedFrameState=None / _startTime=Time.realtimeSinceStartup`,re-attach `planeManager.trackablesChanged` + `ARSession.stateChanged`。**注释明说: 这是 RN remount 的钩子,deliberately 不在 OnApplicationPause(false) 跑。**
- L427-434 `OnDisable`: 仅 unhook listener,**不销毁 ARSession**。
- L851-855 `OnClearAll`: 调 `spawner.ClearAll()` 销毁 cairn GameObject。
- ARSession 本身: AR Foundation 持续 run,view detach 期间仍 tick (L444-460 注释)。

**bulk-spawn 重 spawn 路径** (UnityAROverlay.tsx):
- L647-832 `case 'ArFrame'`: 每次 ArFrame 都检查 `arReadyRef && !bulkSpawnedRef && userPos && unityRef`。
- L716 `projOrigin = projectOrigin(props.arOrigin, props.userPos)` → 优先 props.arOrigin (markerStore 持久化 origin)。
- L757-771 OnSetSessionOffset (永久 0,L745)。
- L775-797 遍历 `props.markers`,对每个 marker `buildSpawnRequest({arkitX/Y/Z, arOriginLat/Lng, lat, lng}, projOrigin, groundY)` → Unity OnSpawnStrand。
- Tier-A 路径 (`unityCairnSpawn.ts`): same arOrigin + arkit XYZ snapshot 偏差 <5m → 直接用 plant 时 ARKit world XYZ;否则 Tier-B GPS 重算。

---

## Section 2: 现有测试覆盖

- jest `cross-session-e2e.test.ts` L41-: 描述明说 "S1 plant + S2 resume" 用 `useMarkerStore.hydrate()` 模拟 **process 死后冷启动 hydrate**。从未 mount/unmount UnityAROverlay 或 ARScreen。L125 注释 "simulate user walked 60m" 直接调 `clearArOrigin()` skip 真 ARScreen 路径。
- `S4-phase-sync.test.ts` 唯一含 "re-enter" L3 注释,但实测 hiking session 不是 AR re-mount。
- jest `__tests__/` 16 个文件,**0 个 render `<ARScreen/>` 或 `<UnityAROverlay/>`**,无 RTL 测试,无 React Test Renderer mount 链路。
- Unity QARunAll (`Editor/QARunAll.cs`): L97/100/108 显式 Skip 所有 ARScreen react state 测试,理由 "C# Editor 不可达"。无 OnClearAll → re-OnSpawnStrand 同 sub-session test。

**这个具体场景: NOT COVERED.**

---

## Section 3: 潜在 bug (grep 确认)

(a) **UnityView unmount 后 native 状态**: `react-native-unity` singleton (UnityAROverlay.tsx L9-11 注释) → process 不死,但 RN view detach。**未确认**: ARSession 是 paused 还是 keep-running。CairnBridge L444-448 `OnApplicationPause(false)` 注释暗示 AR Foundation 自己决定;view detach 不等于 background。**潜在风险**: detach 期间若 ARSession 仍 tick,plane buffer 在 RN side 已 clear (L354) 但 Unity 仍维持 trackables → 重进时 PlaneDetected 不重发 → groundYRef=null → buildSpawnRequest 收到 null ground → cairn Y 走 fallback。真存在,需真机验证。

(b) **ARSession 重进**: CairnBridge.OnEnable (L398-418) 重置 `_arReadySent=false` → 重发 ArReady → RN bulk-spawn 重新走流程。但 ARSession state 不重 init (L444-448),world coord origin 跟之前 **同一套**。重进时 markers + arOrigin 直传 → 路径正常。

(c) **markerStore.arOrigin 同 process 内**: zustand store 不依赖 mount/unmount,L211 `useMarkerStore(s => s.arOrigin)` reactive subscribe → process 内 100% 保留。✓

(d) **bulk-spawn 路径**: L786-797 `buildSpawnRequest` 用 markerStore (arkitX/Y/Z + arOriginLat/Lng) → 走 Tier-A,前提 plant 时 arOrigin == 当前 arOrigin (偏差<5m)。**真存在 bug**: 若 plant 时 marker 没存 `arOriginLat/Lng` (line 1158 三元: `unitySpawnPos ? plantArOrigin?.lat : undefined`,即 fallback 路径 plant 出来的 marker 没 arOrigin 快照) → re-enter 走 Tier-B GPS,GPS 抖动 5-15m → cairn 飘。

(e) **走 30m 再回来重进 AR**: `decideGpsLock` + `isOriginStale` (ARScreen.tsx L496-534): origin 离当前 GPS > `ORIGIN_STALE_DISTANCE_M` (默认 50m,L488 v0.2.4 修) → `clearArOrigin` 重 lock。30m 内 origin 不变,Tier-A 仍可走 (假设 ARKit world 同 session 没 re-init)。**但** Section 3(a) 风险: 若 ARSession 在 detach 期间 paused → 重进 init → ARKit world frame **可能** relocalize (.limited 状态),world (0,0,0) 漂移 → arkit XYZ snapshot 不再对齐 → cairn 飞天。CairnBridge L580-590 `_arReadySent` 等到 SessionTracking 才发 ArReady,所以 RN 等到 relocalize 完才 bulk-spawn,理论缓和;但真机 ARKit relocalize 失败概率 ~10-30%。

(f) **detach 期间 cairn GameObject**: UnityAROverlay unmount L341 OnClearAll → `spawner.ClearAll()` 销毁所有 cairn GameObject。重进时 spawnedIdsRef 也清 (L343)。无残留,无 dedupe 冲突。✓

---

## Section 4: 测试方案

- **jest 真测可行,但有限**: 可用 RTL `render(<UnityAROverlay/>)` + mock `@azesmway/react-native-unity` 的 postMessage,模拟 mount → 发 ArReady mock → 触发 bulk-spawn → unmount → re-mount → 验 OnClearAll 发了 + spawnedIdsRef 清了 + bulk-spawn 重新走。能 cover (c)(d)(f),不 cover (a)(b)(e) ARKit 真行为。
- **Unity Editor 真测有限**: `GroundYResolverFsmTestHarness.cs` 模式可仿——写 `ARScreenReEnterHarness.cs` 在 Editor 内 OnDisable→OnEnable 走一遍,验 _arReadySent 重置 + cairn ClearAll → re-Spawn 一致。能 cover Unity 侧 OnEnable 重置。**不能** cover 真 ARKit relocalize。
- **必须真机**: (a)(b)(e) ARKit world frame 在 view detach + re-attach 期间是否保持稳定/relocalize,只能真机 + telemetry (debug_snapshots + breadcrumbs `unity-overlay:recv:first-ArFrame` px/py/pz 比对)。

---

## Verdict

**这个 case 真测过 + 真覆盖? NO.**

证据:
1. `__tests__/` 0 个 render ARScreen/UnityAROverlay。
2. cross-session-e2e 测的是 store hydrate (process 死后),非同 process re-mount。
3. QARunAll Skip 所有 ARScreen state,无 OnClearAll→re-OnSpawnStrand 同 sub-session 编排测。
4. CairnBridge.OnEnable (L398) 注释证明开发者**知道**有 RN remount 路径,但既无 jest 也无 Editor harness 覆盖该路径整链。

**建议下一步**:
1. (P0,1 天) 加 `__tests__/ar-re-mount.test.ts`: 用 RTL 真 mount UnityAROverlay,mock postMessage,模拟 ArReady → bulk-spawn → unmount → re-mount → 验 OnClearAll + 重 bulk-spawn。Cover (c)(d)(f)。
2. (P0,0.5 天) 加 Unity Editor `ARScreenReEnterHarness.cs`: 模 OnDisable→OnEnable,验 spawner.ClearAll + flag 重置。Cover Unity 侧。
3. (P1,真机) 在已部署的 telemetry pipeline 加专项 breadcrumb tag `ar:re-enter:N`,统计 ARKit re-attach 后首 ArFrame 的 px/pz 是否跟之前 session 一致 (delta<0.5m=稳定;>2m=relocalize)。Cover (a)(b)(e)。
4. (P2) 在 ARScreen unmount 时主动 `arSession.Reset()` 还是 keep-warm? 现状没明确策略,subagent 看代码无法判定。

**严苛结论**: "退 AR 再进 AR" 同 process 路径在静态代码上有合理设计 (CairnBridge.OnEnable 重置 + UnityAROverlay cleanup 完整),但 **0 自动测试 + 0 Editor harness + 0 真机 telemetry 验证**。不能宣称 "work"。
