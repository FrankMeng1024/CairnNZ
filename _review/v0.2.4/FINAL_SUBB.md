# FINAL_SUBB — Final Adversarial Review (sub#B)

**Posture**: 主 agent claims 不可信,跟 sub#A 互不重叠。Read+Grep 自己 verify。

---

## Section 1: Regression risk

主 agent 改了 5 个改动面,每个都有未 cover regression:

1. **ARMeshManager 加进 SceneSetup.cs:193-196** — 加在 `xrOriginGo` 子 GO 上,subsystem 启动靠 ARFoundation 自治。**风险**:
   - `ARMeshManager` 内部 `OnEnable` 在非 LiDAR 设备会 throw 还是 silent-disable? `m_MeshPrefab: {fileID: 0}`(已确认 baked scene 第一行在 968053edfd 后是 `m_MeshPrefab: {fileID: 0}`)— mesh prefab 为 null 时,`ARFoundation 6` 在 LiDAR 设备真启 mesh subsystem 会做什么? **没有 prefab 时 mesh 数据是被丢弃还是 throw**? PortalSpawnerV199 只查 `subsystem.running` —
     **未 verify**:无 prefab 时 LiDAR 真机 `subsystem.running` 是否真为 true。如果 ARMeshManager 内部要求 prefab 才启动,LiDAR 检测仍永远 false,改动等于 no-op。
   - `SetupAndSave` 在 `EditorSceneManager.SaveScene` 之前没有显式 disable ARMeshManager — 非 LiDAR Editor 模拟器跑 SetupAndSave 会不会 throw `MeshSubsystemDescriptor` 缺失导致整个 scene save 失败?
2. **R2.4 buildSpawnRequest origin 类型从 `{lat, lng} | null` 扩到 `{lat, lng, lowAccuracy?} | null`** — 公共 API。**未排查** outside `UnityAROverlay.tsx:794` 的其他 caller。Grep 显示 `buildSpawnRequest(` 只两处 caller:component + r23-test。OK,no regression。
3. **R2.7 ARScreen track 字段** — 主 agent claims 改了"删了视觉 case"。已读 ARScreen.tsx 关键区段:`a4PlantEnabled` 用 `track === 'tracking'` gate。**未 verify** track=='limited' 状态下 plant 按钮的可视化(toast 文案)是否被旧 case 删除导致用户看到空白 disabled 按钮无原因。
4. **UnityAROverlay 改动了 `OnSetSessionOffset` cadence** — 现在按 `originChanged` 触发(715-772 行)。**风险**:`projOrigin = persisted ?? live`,`live` 永远是新对象引用 (`{ lat: ..., lng: ... }` 每次 ArFrame 渲染新建),如果 `persisted == null` 时整个 session,`originChanged` 比较的是 `lat`/`lng` 数值不是引用 — OK,**no regression**。但如果 `live.lat` 因 GPS 抖每帧浮点变化(常态),会**每帧重发 OnSetSessionOffset** → Unity 60Hz 收 postMessage → 浪费 IPC。需要 epsilon 比较。
5. **删了 V024Playground.unity** — 已 grep 确认 Scenes 目录只剩 CairnAR.unity + ShaderTestbed.unity。但 git status 显示 `?? V024Playground.unity.meta` — meta 还在,scene 文件不见。**Editor 打 Cairn menu 加载 baked scene 没问题,但 V024CapturePlayground.cs(已编辑)如果 hardcode 引用 V024Playground.unity 的 LoadScene → Editor crash**。需 grep `V024Playground` in code 确认。

## Section 2: TS narrow / type 漏洞

跑了 `cd app && npx tsc --noEmit` — **EXIT=0,zero error**。但**缺真测**:
- `persisted ?? live` 类型推断为 `{ lat; lng; lowAccuracy?: boolean | undefined } | { lat; lng }` — TS 把 union 收成最宽公共子集。`origin.lowAccuracy` 在 `live` 分支访问会被推为 `boolean | undefined`(非 error,因 optional)。**没有掩盖的 type bug**。
- `unityCairnSpawn.ts:175` `origin: { lat, lng, lowAccuracy? } | null` 接收 `live` 时 `lowAccuracy` 是 undefined,`origin.lowAccuracy` falsy → 走 5m 默认。**逻辑正确,无 narrow 漏洞**。

## Section 3: 测试覆盖盲点

**严重盲点**:
- **R2.3 真消费者是 React 组件 `UnityAROverlay`,但仅 18 个 jest 测试中只有 `r23-caller-propagation.test.ts` cover R2.3 — 它 自写 `projectOrigin` 仿组件逻辑**(test line 13-19),**不渲染真组件,不测真 useEffect 链**。如果有人改 UnityAROverlay.tsx:715 的 destructure,test 不会 fail。是 **隐性 self-licking**(详见 Section 4)。
- **R2.2 + R2.6 ARMeshManager runtime 检测真测**:整个 `__tests__/` 目录无任何 Editor mode test 验证 `meshMgr.subsystem.running` 在真 LiDAR / 非 LiDAR 设备的实际值。Section 1 #1 列的 prefab=null 风险**完全没测**。主 agent 列 H 类用 mock ARPlane,但 mock 不会触发 ARFoundation 真 subsystem 启动逻辑。
- **Editor 跨 session H 类(QA-70/72/73)用 mock ARPlane** — 这是 fair simulation 不是真测。真生产路径走 `trackables` enumeration + `Camera.main` 全局 — Section 5 论证。
- **`@testing-library/react-native` 已在 deps 但根本没用** — 0 个测试 import 它。所有 React 渲染验证是空白。

## Section 4: 隐藏 self-licking

`r23-caller-propagation.test.ts` 在 **line 13-19** 自写了 `projectOrigin` 函数仿 UnityAROverlay 行为:

```ts
function projectOrigin(arOrigin, live) {
  const persisted = arOrigin
    ? { lat: arOrigin.lat, lng: arOrigin.lng, lowAccuracy: arOrigin.lowAccuracy }
    : null;
  return persisted ?? live;
}
```

**这就是 self-licking**:test 测自己写的 helper,不测真 `UnityAROverlay.tsx:715-717`。如果改组件代码漏字段,test 不 fail。**主 agent 把这算"真测"是欺骗**。
公允评:**反向 case (line 66-74)** 验证了"丢字段会破"逻辑 — 这有价值,但仍不能替代真组件渲染测试。**该 test 应改用 `react-test-renderer` mock UnityView 渲染真组件**。

`reverse-verify` test(line 66-74)是 fair simulation。它故意写了 buggy 版本验证 case 能 catch — **唯一不算 self-licking 的部分**。但和真组件 fix 之间还是有 gap:test 测的是 `projectOrigin` 这个 helper 的 contract,不是 UnityAROverlay.tsx:715 的真实代码 path。

## Section 5: Scene 一致性

**SetupAndSave 在生产真在跑吗?** Grep 全部 callsite:
- `BuildScript.cs:65` — CI iOS build 入口,`-executeMethod BuildScript.BuildIOS`
- `HeadlessRender.cs:36` — 渲染管道
- `ShaderTestbedSceneBuilder.cs:30` — testbed
- `SceneSetup.cs:74` — Editor 菜单

**结论**:CI iOS build 每次都 re-run SetupAndSave **覆盖** baked CairnAR.unity。所以 ARMeshManager 加入 SetupAndSave 是有效的。

**But** baked scene 也已经包含 ARMeshManager(grep 确认 `968053edfd...` GUID 1 hit,后跟 `m_MeshPrefab: {fileID: 0}`),CI 不跑也 ok — 双保险。**主 agent 这点是真的**。

⚠️ **新风险** 仍在:`m_MeshPrefab: {fileID: 0}` — Section 1 #1 raise 的"无 prefab 时 LiDAR subsystem 真启动吗"问题没人 verify。

## Section 6: 其他 scene

`Scenes/` 只有 `CairnAR.unity` + `ShaderTestbed.unity`(testbed 不需要 AR mesh)。**V024Playground.unity 已删除,但 .meta 还在** — git status 显示 `?? V024Playground.unity.meta`。**这是 process bug**:删 scene 没删 meta,Unity reimport 会 warn。

`V024CapturePlayground.cs.meta` 在 git status `??` 列,但 .cs 在 modified 列 — 文件还在,Editor 模式独立 scene 不需 ARMeshManager,**OK**。

---

## 必修 BLOCKER 清单 (sub#B 抓的,即使主 agent 说全 PASS)

1. **[BLOCKER]** ARMeshManager `m_MeshPrefab: {fileID: 0}` — 真机 LiDAR 设备 mesh prefab 为 null 时 `ARMeshSubsystem.running` 实际值 **未 verify**。如 ARFoundation 6 要求 prefab 非 null 才启动 subsystem,整个 R2.2/R2.6 LiDAR fix 失效(LiDAR 设备 `lidar=false` 同改前)。**修法**:写 1 个 Editor mode test 在 PlayMode 起 ARSession + ARMeshManager,asset prefab,assert subsystem.running。或 grep ARFoundation 6 docs 确认 prefab 可 null。
2. **[BLOCKER]** `r23-caller-propagation.test.ts` 是 self-licking simulation — 改 `UnityAROverlay.tsx:715-717` destructure 不 fail。**修法**:加 1 个用 `@testing-library/react-native` 渲染真 `UnityAROverlay` 的 component test,或在测试 import 真组件的 helper(若可 export)。
3. **[CRITICAL]** `OnSetSessionOffset` 每帧 GPS 抖触发重发 — `live.lat` 浮点比较无 epsilon。**修法**:`unityCairnSpawn.ts` 或 `UnityAROverlay.tsx:754-757` 加 epsilon (≥ 1e-7 ~= 1cm)。
4. **[MEDIUM]** `V024Playground.unity.meta` orphan — 删 .meta,提 commit 清理。
5. **[MEDIUM]** ARMeshManager prefab=null 时 Editor SaveScene 行为未测 — 加 unit test 跑 SetupAndSave,assert no exception(确认主 agent 改动不会 break Editor menu workflow)。

**主 agent 自评 "全 PASS" 不可信** — 至少 #1 + #2 是真 BLOCKER,#1 是 R2.2/R2.6 整个修复的 efficacy 黑洞,#2 是 R2.3 真测假装存在的隐性 fraud。
