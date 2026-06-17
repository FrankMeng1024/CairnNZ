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

#### A.0 **Unity framework rebuild — CI 自动化(用户 2026-06-17 二次澄清后修正)**

**根因(2026-06-17 一次提问)**:EAS build 通过 `download-unity-framework.js`
拉**预编译的** UnityFramework.xcframework,不是 EAS 自动从 v025/ 源码 export。
v025/ 100+ .cs 是 6/16-6/17 写;UnityARLib/builds/iOS/ 二进制是 6/7;
GitHub Release `unity-xcframework-latest` tag 当前指向 pre-v0.2.5 版本。

**自动化机制(2026-06-17 二次澄清,用户原话:"等提交 unity push 后 我们会有自动的 CI build unity")**:

`.github/workflows/unity-build-xcframework.yml` 提供完整自动化:
- **触发**:`push: paths: 'UnityARLib/**'`(任何 UnityARLib/ 改动 push 自动跑)
  + `workflow_dispatch`(手动)
- **执行环境**:`ubuntu-latest` + game-ci/unity-builder Docker(Unity 6000.0.36f1)
- **Pre-build gate**:CairnURPRenderer.asset ARBackgroundRendererFeature GUID +
  m_RendererFeatures 非空 — yellow-screen bug 防回归(6/8 已迭代过)
- **产物**:UnityFramework.xcframework.zip
- **上传**:softprops/action-gh-release@v2 → tag `unity-xcframework-latest`
  (固定 tag,覆盖式)+ commit `app/unity-release.json` SHA-256 marker
- **EAS 端**:`download-unity-framework.js` 拉同一固定 tag,自动拿到最新

**结论**:**不需要 Mac 手动 Unity Editor build + 手动上传**。Phase 5 起手只需:

1. 主 agent 在 Windows 写完 §A.1-A.6 全部代码改动(`UnityARLib/Assets/Scripts/v025/`)
2. 启用 HAS_ARKIT_WORLDMAP scripting define(改 `ProjectSettings.asset`)
3. 用户授权 `git push` + `EAS#1 build 授权`(目前 `feedback_no_push_no_build` 还在生效)
4. push → GitHub Actions 自动 build Unity → 覆盖 `unity-xcframework-latest` tag(~5-10 min)
5. EAS build → pre-install hook 拉新 framework → iOS 端跑 v025 最新代码
6. 真机 plant + recall

**Phase 5 entry 真正第 0 步是用户 push 授权,不是 Mac 操作。**

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
