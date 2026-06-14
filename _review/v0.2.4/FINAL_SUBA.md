# FINAL_SUBA — sub#A independent sign-off review

主 agent 言论一律不可信。本文每条结论独立验证,要么有行号证据要么标 SUSPECT。

## Run results
- **Unity QARunAll**: pass=16 fail=0 skip=32 (来自 `[QA] === DONE: pass=16 fail=0 skip=32 ===`,无 [QA-FAIL] / FAILED 行)
- **Jest**: 18/18 pass (3 suites — r23-low-accuracy, r23-caller-propagation, r27-track-debounce)
- Exit code: 隐式 0 (任何 fail 都会被 Run() 累加,fail=0 → exit=0)

---

## BLOCKER 1 — R2.3 UnityAROverlay 透传 lowAccuracy

| 检查 | 结果 | 证据 |
|---|---|---|
| prop 类型加 `lowAccuracy?` 字段 | YES | UnityAROverlay.tsx:85 `arOrigin?: { lat: number; lng: number; alt: number \| null; lowAccuracy?: boolean } \| null` |
| destructure 透传字段 | YES | UnityAROverlay.tsx:715-717 `persisted = props.arOrigin ? { lat: ..., lng: ..., lowAccuracy: props.arOrigin.lowAccuracy } : null` |
| jest 真测 caller 链路 | **SUSPECT** | r23-caller-propagation.test.ts:13-19 |

**SUSPECT 详情 (重要)**: r23-caller-propagation.test.ts 在 line 13-19 **复制 (copy-paste)** UnityAROverlay.tsx:715-717 的 projectOrigin 逻辑到 test 文件内嵌函数,然后测这个**复制函数**。test 没 import UnityAROverlay 组件、没用 react-test-renderer/RTL render 真组件。

后果: 如果 UnityAROverlay.tsx 把 line 716 改回 `{ lat, lng }` (重现 bug),**这个 test 仍然 PASS**,因为它测的是它自己复制的 projectOrigin 函数。这是 sub#3 之前抓的 self-licking 模式的轻量化版本,只是从 Unity C# 搬到了 TS。

reverse-verify case (line 66-74) 也是测内嵌的 buggy 函数,不解决根因。

**判定**: 代码层 fix 实际生效 (UnityAROverlay.tsx:715-717 真改),但 jest 不能保证回归。**等于无回归网,生产路径靠手 review,可接受但留 tech-debt**。

---

## BLOCKER 2 — R2.2/R2.6 ARMeshManager

| 检查 | 结果 | 证据 |
|---|---|---|
| SceneSetup.cs AddComponent<ARMeshManager>() | YES | SceneSetup.cs:193-195 创建子 GO `AR Mesh Manager`,SetParent(xrOriginGo),AddComponent<ARMeshManager>() |
| Scene 文件 GUID 出现次数 | 1 | grep `968053edfd89749c48f4ea5d444abf64` UnityARLib/Assets/Scenes/CairnAR.unity → line 1132 |
| Scene 真静态挂 ARMeshManager | YES | CairnAR.unity:1123-1141 — GameObject m_Name="AR Mesh Manager" + MonoBehaviour 引用 ARMeshManager script GUID + m_MeshPrefab/m_Density 等字段 |
| 非 LiDAR 设备会 break? | NO | ARFoundation 6 自治 — XRMeshSubsystem 在不支持设备 .running=false,不抛错。`SceneSetup.cs:191-192` 注释也声明,符合 Apple ARKit/ARFoundation 6 公开行为 |

**注意 (非 BLOCKER)**: SceneSetup.cs 是 `[MenuItem("Cairn/Build CairnAR Scene")]` (line 71) — 是 Editor 工具,运行时不跑。Scene 文件已静态包含 ARMeshManager,真机加载即生效。SceneSetup 代码的作用只是开发者重建 scene 时确保不丢。**两份不冲突,但 SceneSetup 重跑会创建一个新 GO 而非合并。** Acceptable。

**判定**: 真 fix。LiDAR 真机现在 FindFirstObjectByType<ARMeshManager>() 不再返 null,`lidar=true` 路径会真触发。

---

## BLOCKER 3 — R2.5 MultiSpawner 死代码

| 检查 | 结果 | 证据 |
|---|---|---|
| helper 在 CairnBridge | YES | CairnBridge.cs:1060-1066 `ApplyTierAwareSpawnOffset(string tier, float rawX, float rawZ)`, Tier-A → bypass offset, 其他 → apply offset。逻辑正确 |
| PortalSpawner 调 helper | YES | PortalSpawner.cs:530 `var spawnXZ = CairnBridge.ApplyTierAwareSpawnOffset(data.tier, data.x, data.z)` |
| MultiSpawner 调 helper | YES | MultiSpawner.cs:233 `var mxSpawnXZ = CairnBridge.ApplyTierAwareSpawnOffset(data.tier, data.x, data.z)` |
| 真生产用 (PortalSpawner)? | YES (推断) | SceneSetup.cs:200 `spawnerGo.AddComponent<PortalSpawner>()` — scene 真挂 PortalSpawner |

**判定**: helper 真共用、真生效。MultiSpawner 即便是 deprecated,helper 本身是 PortalSpawner 在跑、QA-23 case 也走 helper 路径。**主 agent 处置合理,不是搪塞**。死代码风险只在 MultiSpawner 文件本身存在,不影响 R2 正确性。

---

## BLOCKER 4 — QA-40/41/42 tautology 改 SKIP

| 检查 | 结果 | 证据 |
|---|---|---|
| QA-40 改 Skip | YES | QARunAll.cs:93 `Skip("QA-40-tracking-allows-plant", ...)` |
| QA-41 改 Skip | YES | QARunAll.cs:94 |
| QA-42 改 Skip | YES | QARunAll.cs:95 |
| QA-43~46 也是 Skip | YES | QARunAll.cs:96-99 |
| 死 Test_QA40~46 函数还在? | NO | grep `Test_QA40\|41\|42\|43\|44\|45\|46` QARunAll.cs → 0 hit |

**判定**: 真 fix。无死代码残留。

---

## 死代码扫描

- `Run()` 调用次数 vs `static void Test_QA*` 函数定义次数: **16 vs 16,完全对齐**。`grep -c "^        Run("` = 16; `grep -c "^    static void Test_QA"` = 16
- Logs/qa-cases/ 子目录数: 45 (含 SKIP 也建目录,见 QARunAll.cs:182-188 Skip() 实现写 verdict.txt)
- Logs/qa-cases/ PNG 文件数: **0** (无假视觉证据)

**Skip() 自动建目录写 verdict.txt** — 不是 stale,每次跑都重建。OK。

---

## Sign-off verdict

**READY (with one tech-debt note)**

4 个 BLOCKER 都真修了,Unity 16 PASS / 0 FAIL,Jest 18/18 PASS,无死代码残留,无假 PNG。

**Tech-debt (不阻塞 sign-off,但下个 sprint 必须修)**:

1. **R2.3 jest test 是 self-licking 轻量版** — r23-caller-propagation.test.ts:13-19 复制了被测函数到 test 内嵌。无法捕获 UnityAROverlay.tsx 真组件回归。建议:
   - 改用 react-test-renderer 真 render UnityAROverlay,或
   - 把 projectOrigin 提到独立 export 函数 `src/services/projectArOrigin.ts`,test + 组件都 import 同一份。

这条不是 BLOCKER 因为代码层 fix 真生效 (生产路径用真函数),只是回归保护薄。

---

**给主 agent**: 不要把 jest 18/18 PASS 解读为"R2.3 完全 OK",test 设计上抓不到组件回归。要么补 RTL test 要么提取共享函数。
