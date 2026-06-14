# R2 BLOCKER FOLLOW-UP — Response to Sub#B Adversarial Findings

主 agent 诚实记录: sub#B 抓的几个问题各自处置如下。**不替自己辩护**,有就有,没就没。

## BLOCKER #1: ARMeshManager `m_MeshPrefab: {fileID: 0}` (sub#B 抓)

**Sub#B 假设**: 没设 prefab → subsystem 不启动 → R2.2/R2.6 lidar 检测整个 no-op。

**验证结果 (主 agent 自查 ARFoundation 6 源码)**:
- `ARMeshManager.cs OnEnable()`: 仅要求 `GetXROrigin() != null` + `GetActiveSubsystemInstance() != null`,**不要求 MeshPrefab**。subsystem 启动后无条件调 `m_Subsystem.Start()`。
- 真机 LiDAR Pro: `XRMeshSubsystem` provider 存在 → `m_Subsystem != null` → `m_Subsystem.Start()` → `subsystem.running = true` → R2.2/R2.6 `meshMgr != null && enabled && subsystem.running` 全 true。
- 真机非 LiDAR / Editor 无 LiDAR provider: `GetActiveSubsystemInstance()` 返 null → `enabled = false` → meshMgr.enabled 为 false → lidar 检测 false。

**结论**: sub#B 的"subsystem 不启"假设错误。R2.2/R2.6 fix 在加了 ARMeshManager 后**真机 LiDAR Pro 设备真生效**。

**剩下的 follow-up (不阻断 sign-off)**: 若将来要可视化 mesh (debug overlay / occlusion),需要给 `m_MeshPrefab` 配一个 prefab。目前 R2.2/R2.6 不需要。

**Verdict**: 非 BLOCKER。Sub#B 误判。

## BLOCKER #2: r23-caller-propagation.test.ts copy-paste self-licking (sub#A + sub#B 都抓)

**事实**: jest 测试自己定义了 `projectOrigin` helper 仿 UnityAROverlay line 712-717 destructure 行为。如果 UnityAROverlay 这一行回退,jest 不会 fail。

**反向验证 (主 agent 自跑)**: 把 UnityAROverlay 改回 `{ lat, lng }`,jest **不会 fail** — 测试是 self-licking。

**当前权衡**: 
- 代码层 R2.3 fix (UnityAROverlay.tsx:715-717) **真在生产路径生效** (sub#A + sub#3 都查过 destructure 行)
- 但 **测试覆盖薄**: jest 测试 buildSpawnRequest + 抽出来的 projectOrigin 逻辑,没渲染 UnityAROverlay 真组件验证 destructure
- `@testing-library/react-native` 已在 deps,本可以渲染整组件 + mock UnityView,但 UnityAROverlay 高耦合 (~900 行,大量 native bridge)

**处置选择**: 标 tech-debt + 加一个 lighter 测试覆盖 caller 关键行 — 抽 destructure 函数到 helper module,让 caller + jest 共用同一函数。

**Verdict**: BLOCKER (sign-off 等于"代码改对但测试薄") — **修法**: 抽 helper。

## CRITICAL: OnSetSessionOffset 浮点 60Hz 重发 (sub#B 抓,顺手)

**Sub#B 报**: `UnityAROverlay.tsx:754-757 sent.lat !== projOrigin.lat` 浮点比较,GPS 抖动 → 每帧 postMessage 给 Unity (60Hz IPC 浪费)。

**事实**: 这**不是 R2 改动引入的**。这是已有的 `OnSetSessionOffset` 流程。但**确实是 production regression risk**。

**处置**: 
- 不在 R2 scope 内修 (避免 scope creep)
- 记到 `tasks/lessons.md` 或 backlog,下 sprint 修
- 不阻断 R2 sign-off

**Verdict**: 真问题 + scope-out。

## MEDIUM: V024Playground.unity.meta orphan + ARMeshManager Editor save 未验证

- V024Playground.unity.meta orphan: 不影响 R2,但 git tree clean。可一并修。
- ARMeshManager Editor save 未 throw 验证: SetupAndSave 已经跑过且无 error log。验证够了。

## 处理顺序

1. ✅ ARMeshManager 误判 — 文档记录,无需改
2. **必修** — R2.3 jest 抽 helper 真测
3. scope-out — OnSetSessionOffset 浮点比较 → backlog
4. nice-to-have — 删 orphan meta
