# ADR-015: Phase 5 entry — Tier-S 路径 wiring 全清单(post-final-review 修订)

## Context
最终 review 跑了 2 个 sandbox test(meta-eval 后保留的 Test A + Test B narrow,
跳过 Test C/D 因为它们误导风险 HIGH):

- **Test A**(ARKit API 签名 verify,narrow):API_VERIFIED with **API drift**
- **Test B**(跨 session 链路 narrow):**4/4 FAIL** — 不是 bug,是 Phase 1A shell
  + RN 端 save-space 完全没 wire 的真实状态被诚实暴露

之前 ADR-014 把 ArkitWorldMap 真实现延期到 Phase 5,以为那是 "1 个文件 + 1 个 define"。
Test B 显示 Phase 5 工作量比那大很多。

## Decision

### A. ADR-014 范围扩大(原本只说 "single-file enable" — 不够)

Phase 5 entry 必做的 wiring 清单(测试 B 全部 FAIL 的对应修复 + 用户 2026-06-17 提问揭露的 Unity rebuild gap):

#### A.0 **【最关键 — 用户提问揭露的 gap】Unity framework rebuild + GitHub Release 上传**

**根因**:EAS build 通过 `app/scripts/download-unity-framework.js` 从 GitHub Release
拉**预编译的** UnityFramework.xcframework,**不是** EAS 自动从 v025/ 源码 export。

**当前状态(2026-06-17 文件系统检查)**:
- v025/ 目录 100+ .cs 文件 — 2026-06-16/17 写的
- UnityARLib/builds/iOS/ 最后修改 — 2026-06-07(v0.2.5 开始之前)
- GitHub Release 里 UnityFramework.xcframework 是 v0.2.5 之前的旧版本
- **如果今天直接 EAS build,Unity 内部跑的是旧代码;v025 全部 wiring 不生效**

**Phase 5 起手第 0 步必做(在 A.1-A.6 之前)**:
1. 在 Mac 上打开 UnityARLib(Unity Editor 6 / 6000.0.x)
2. 启用 HAS_ARKIT_WORLDMAP define(iOS PlayerSettings)
3. 写完 A.1-A.6 所有 wiring
4. Editor compile pass + EditMode tests pass(`Unity.exe -batchmode -runTests EditMode`)
5. **Unity Editor → File → Build Settings → iOS → Build → 生成 UnityFramework.xcframework**
6. **上传新 xcframework 到 GitHub Release**(覆盖或新 tag)
7. 更新 download-unity-framework.js Release URL(如果是新 tag)
8. 然后才 `eas build --profile production` → pre-install hook 拉新 framework

**跳过这一步的后果**:RN 端 plant 按钮工作,bridge 发 v025/spawn,Unity 旧 binary
没 V025Bootstrap 没 CairnSpawnerV2 收不到 → 消息丢失 → spawnCairnV2 timeout → "AR config error"
→ 等同 Phase 5 EAS build 直接失败。

#### A.1 Unity 端 ArkitWorldMapPersistence.iOS.cs(替换 Phase 1A shell)

#### A.1 Unity 端 ArkitWorldMapPersistence.iOS.cs(替换 Phase 1A shell)
1. 启用 HAS_ARKIT_WORLDMAP define in PlayerSettings(iOS slot,见 FINAL-D R1)
2. 写完整 SaveAsync:
   - guard:`Application.platform == IPhonePlayer && ARKitSessionSubsystem.worldMapSupported`
   - cast `ARSession.subsystem` to `ARKitSessionSubsystem`,null check
   - guard:subsystem.running + ARSession.state == SessionTracking + worldMappingStatus ∈ {Mapped, Extending}
   - 调 `subsystem.GetARWorldMapAsync((status, map) => ...)`(callback 不是 await — Test A 发现)
   - 用 TaskCompletionSource 桥到 async/await
   - `using map; using var bytes = map.Serialize(Allocator.Temp);`(Test A:必须 Dispose,否则 native 泄漏)
   - 写 `Application.persistentDataPath/v025/worldmaps/{spaceId}.arworldmap`
   - DllImport `Cairn_ExcludeFromBackup(path)` — Test B 发现 ObjC bridge 写了但 0 call site
   - emit telemetry
3. 写完整 LoadAsync:
   - 读 bytes → `NativeArray<byte>(Allocator.Temp)` → `ARWorldMap.TryDeserialize(out worldMap)`
     (Test A:不是 SerializationFromBase64,也不是 SetWorldMap)
   - if false → `MapCorrupt`
   - `using map; subsystem.ApplyWorldMap(map);`(Test A:**ApplyWorldMap 不是 SetWorldMap**)
   - **新 wiring**:启动一个 polling coroutine 把 `subsystem.worldMappingStatus` feed 给
     WorldMapLoadGateV2(Test B:gate 现在是 dead code,没人 feed)
   - 直到 Ready or Timeout

#### A.2 ADR-014 + ArkitWorldMapPersistence.cs 注释 drift 修
- ADR-014 §B 第 5 行 + 第 26 行 "SetWorldMap" → **ApplyWorldMap**(Test A drift)
- ArkitWorldMapPersistence.cs:66 注释 "ARWorldMap.SerializationFromBase64" → "TryDeserialize"
  (该 API 不存在)

#### A.3 Unity 端 LoadAsync 失败加 outbound message
- Test B 发现 LoadAsync 失败时只 NoCache → caller silent fall to Tier-G,RN 端没诊断
- 加 v025/load-space-failed wire response(对称于 save-space-failed)
- MessageTypes.ts 加 LoadSpaceFailed type

#### A.4 RN 端 save-space sender + listener
- Test B 发现 grep 整 app/src/ 关于 save-space:**0 sender + 0 listener**
- ARScreenV2 plant 流程结束 + 用户 stay > 30s → 自动触发 v025/save-space
  (anchor 稳定后保存)
- ARScreenV2 useEffect bridge.on 加 case 'v025/save-space-ok' → useCairnStoreV2.markSpaceSaved
- 加 case 'v025/save-space-failed' → 显示 toast "AR session not ready, will retry next time"

#### A.5 OnSaveSpaceFireAndForget 改为 awaitable
- Test B 发现 `async void` 是真实问题(unobserved exception 风险)
- 改 `private async Task OnSaveSpaceAsync` + 在 OnRawMessage 里 fire-and-forget 时
  `_ = OnSaveSpaceAsync(...)` 显式 + 顶层 catch 任何 Exception emit telemetry

#### A.6 Cairn_ExcludeFromBackup DllImport call site
- Test B 发现 ObjC 写了但 0 DllImport
- ArkitWorldMapPersistence.iOS.cs 加:
  ```csharp
  [DllImport("__Internal", EntryPoint = "Cairn_ExcludeFromBackup")]
  private static extern int Cairn_ExcludeFromBackup(string path);
  ```
- SaveAsync 写盘后调用,日志记录返回值

### B. Phase 5 entry test gates(必跑通才能 push EAS build)

1. Editor compile pass(HAS_ARKIT_WORLDMAP enabled + iOS build target)
2. EditMode test:模拟 ApplyWorldMap → poll worldMappingStatus → Ready
   (用 fake subsystem;实际行为 EAS 才知)
3. RN 端 jest:save-space-ok / save-space-failed listener 正确更新 store

### C. 真机 EAS build #1 测试目标(不变)

1. Plant cairn → kill app → 重开 → recall 同位置 → cairn 在原位 误差 < 5cm
2. 跨 device(A plant → B recall)→ Tier-G fallback,误差 < 2m,不崩溃
3. AR 跑 30min telemetry 后台 5s flush 持续到 backend

## Consequences

- (+) Phase 5 不再被低估为"1 file + 1 define"
- (+) Test B 揭露的 6 wiring bug 全有明确对应修复
- (+) ADR-014 drift(SetWorldMap → ApplyWorldMap)在 Phase 5 起手就改对
- (-) Phase 5 工作量比 ADR-014 写的大约 3 倍 — 大约 8-12 文件改动
- (-) Phase 5 4 眼 review 必须 verify A.1-A.6 全部 wire 通

## Failure modes

- Phase 5 实施时漏一项 wiring → Tier-S 路径 silent dead code 进生产 →
  用户在真机看到 plant ok 但 recall 错位 → 4 眼 review 检查清单必须穷举 A.1-A.6
- ARKit API 在更高 ARFoundation 版本变更 → Test A 单 file 单测加到 Phase 5 起步 lint
- ARWorldMap blob 跨 iOS 版本格式不兼容(非 v0.2.5 范围,iOS-side 限制)

## Expiration phase

Phase 5(EAS build #1 真机验证完)

## Status

active

## Signoff

- Main agent: 2026-06-17(诚实交底:Test A + B narrow 揭露 ADR-014 范围低估)
- User review pending
