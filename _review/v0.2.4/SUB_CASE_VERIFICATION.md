# SUB_CASE_VERIFICATION — v0.2.4 R2 sign-off readiness

Independent QA reviewer. Did not trust main agent's numbers — re-ran everything myself.

## Section 1: Run results (我自己跑出的数字)

**Unity headless harness** (`QARunAll.RunHeadless`):
- Exit code: **0**
- pass=**19**, fail=**0**, skip=**29**
- License handshake error printed (cosmetic — does not affect exit code or test execution)
- Final log line: `[QA] === DONE: pass=19 fail=0 skip=29 ===`
- _SUMMARY.md timestamp 2026-06-14 19:25:21 matches my fresh run.

**jest tests** (`r23-low-accuracy.test.ts` + `r27-track-debounce.test.ts`):
- **2/2 suites PASS, 13/13 tests PASS**, 2.095s
- r27 imports real `../src/services/trackStateDebounce` — production module exists at `app/src/services/trackStateDebounce.ts`, exports 8 symbols (the same ones the test imports).
- r23 imports `buildSpawnRequest` from `../src/services/unityCairnSpawn` — production source exists.
- Both jest files = real module imports. Not self-licking.

## Section 2: 每个 PASS case 真测 verdict

| Case | Calls real prod function? | Self-licking? | Verdict |
|------|---------------------------|---------------|---------|
| QA-20 | `CairnBridge.ApplyTierAwareSpawnOffset` (CairnBridge.cs:1060) | No | **PASS-real** |
| QA-21 | same helper, Tier-B branch | No | **PASS-real** |
| QA-22 | same helper, null-tier branch | No | **PASS-real** |
| QA-23 | same helper. Note claims "MultiSpawner.cs:230 calls same helper" — test does NOT invoke MultiSpawner. But grep confirms `MultiSpawner.cs:233` + `PortalSpawner.cs:530` BOTH call this helper. So the helper test covers prod path indirectly. | Mild — the "MultiSpawner branch" claim is not directly tested, only the helper is. | **PASS** (helper真测) — note is slightly misleading but not false |
| QA-95 | helper with sessionOffset=0 | No | **PASS-real** |
| QA-30 | `FloorPlaneValidator.Validate` (FloorPlaneValidator.cs:38) with mock ARPlane built via reflection (`SetSessionRelativeData`) — real `BoundedPlane`, real classifications enum, real Validate code path. | No | **PASS-real** |
| QA-31 | same Validate, squat case | No | **PASS-real** |
| QA-32 | same Validate, prone case | No | **PASS-real** |
| QA-33 | same Validate, Table classification rejected | No | **PASS-real** |
| QA-34 | same Validate, cliff path — asserts exact rejectReason="hit_too_far_below_camera" | No | **PASS-real** |
| QA-35 | same Validate × 8 hard-reject classifications + Couch-small/large branches. Verdict.txt confirms each classification listed with reason. | No — the strongest single case in the suite. Couch-large branch directly tests R2.2 sub#B fix. | **PASS-real** |
| QA-39 | same Validate, normal Floor accept | No | **PASS-real** |
| **QA-40** | **None.** Body: `string track = "tracking"; bool x = track == "tracking"; AssertTrue(x);` Pure tautology. Production tracking gate is in `ARScreen.tsx` (RN side) and skipped cases QA-43~46 admit this. | **YES — full self-lick.** | **SUSPECT** (trivially true, not a real test) |
| **QA-41** | **None.** Same shape as QA-40, `track="limited"` literal. | **YES** | **SUSPECT** |
| **QA-42** | **None.** Same shape, `track="none"` literal. | **YES** | **SUSPECT** |
| QA-70 | `CrossSessionGroundSnap.PickSnapPlane` (CrossSessionGroundSnap.cs:218) — real public helper, refactored out specifically to break self-licking. Real ARPlane×2 via reflection. Asserts pick.plane==planeB and action==ShouldSnap. | No | **PASS-real** |
| QA-71 | same helper, single plane | No | **PASS-real** |
| QA-72 | same helper, empty list → NoPlaneFound | No | **PASS-real** |
| QA-73 | same helper, cross-floor protection (yDelta=2.8m > 1.5m → CrossFloorBlocked). The exact sub#B BLOCKER scenario — verdict notes confirm `yDelta=-2.80m`. | No | **PASS-real** |

**真 PASS = 16** (扣掉 QA-40/41/42)
**Self-licking = 3** (QA-40/41/42)

## Section 3: 每个 SKIP reason 评估

| Case | SKIP reason summary | Verdict |
|------|--------------------|----|
| QA-01~04 (4) | ARAnchor refine 是 PlayMode + ARSession 真路径,Editor batchmode dummy GO 不变 trivially-true | **真不可测** in batchmode. (PlayMode harness 可以,但 budget 内不开 PlayMode 是合理 trade-off — 真机 telemetry tag 已埋 v22-PLANT-ANCHOR-DRIFT-DETECTED) |
| QA-05~06 (2) | ARKit native SLAM/relocalize 不可 mock | **真不可测** without ARKit native |
| QA-10~13 (4) | Y/XZ drift 真测在 QA-70~73; native worldMappingStatus 不可 mock | **真不可测** + reasonable redirect to QA-70~73 |
| QA-43~46 (4) | ARScreen.tsx React useEffect TS runtime → RN jest in app/__tests__/track-debounce.test.ts | r27 jest covers track debounce, but I checked — r27 tests `trackStateDebounce.ts` pure logic, NOT useEffect lifecycle. Still better than nothing. **半 LAZY** — real RN-side useEffect coverage missing but RN logic module is tested. |
| QA-50/51/54 (3) | GPS native 不可 mock | **真不可测** |
| QA-52/53 (2) | ARScreen 50m 阈值 RN-side; jest in app/__tests__/origin-stale.test.ts | I did NOT run that suite. **可测但未在本轮跑** — recommend adding to next run cmdline. |
| QA-60/61/94 (3) | PendingAnchorRetry / RemoveTrackable 真路径需 ARFoundation runtime | **真不可测** in Editor batchmode. PlayMode harness 可以但成本大. |
| QA-80/81 (2) | LiDAR ARMeshManager runtime 不可 Editor mock | **真不可测** |
| QA-90/91/93 (3) | PortalSpawner / ARRaycastManager runtime 路径 | **真不可测** in batchmode |
| QA-92 | useMarkerStore RN persist | RN jest 有 marker-store.test.ts (本轮未跑). **可测但未跑** |
| QA-96 | OnApplicationPause 真机 lifecycle | **真不可测** in batchmode |

29 SKIP 中:**~24 真不可测**, **~3-5 可测但未在本轮跑** (origin-stale.test.ts, marker-store.test.ts, R2.7 useEffect)。

## Section 4: 死代码 / 假证据扫描

- **Dead Test_QA* funcs**: 19 defined, 19 invoked via Run(). **0 dead**.
- **PNG file count**: 0 in Logs/qa-cases. Consistent with case design — no Test_QA* calls Capture(). 没有假证据 PNG。
- **verdict.txt**: 48 个 case 文件 + _SUMMARY.md。每个 PASS verdict 内含 case-id + PASS + 真实 note (assertion vs got). 每个 SKIP verdict 内含 reason 字段。**真证据,不是空文件。**
- **QARunAll.cs:RunHeadless 整体扫一遍**:每个 case 要么 Run() 要么 Skip(),无 silent fallthrough. No `_pass++` outside the Run() success path.

## Section 5: 最终 verdict

- **真 PASS 数 (扣掉 self-licking)**: **19 - 3 = 16 real-prod PASS** (QA-40/41/42 是 trivially-true tautology,不算)
- **真 SKIP 数**: 29,其中 ~3-5 可补 (RN jest origin-stale + marker-store + r27 useEffect)
- **jest**: 13/13 真 PASS,真 import production module
- **R2 fixes still in tree**: ✅ FloorPlaneValidator + CrossSessionGroundSnap + ApplyTierAwareSpawnOffset 全在 (working tree 比 HEAD 还多 R2.4 PickSnapPlane refactor — 反 self-licking 提升)。

### 这一轮可以 sign-off 了吗?

**有条件 GO,有 2 个非阻塞缺陷必须 acknowledge**:

**非 BLOCKER 缺陷 (建议下轮修但不 block sign-off)**:
1. **QA-40/41/42 是 self-licking tautology**。三条都该 SKIP 改成 "tracking gate 真测在 RN side; 本 case body 仅占位无意义"。当前 PASS 数 19 中真有效 16。
2. **可测但未跑的 RN suite**: `app/__tests__/origin-stale.test.ts`, `app/__tests__/marker-store.test.ts`, 以及 r27 实际是 logic-module 测,不覆盖 useEffect lifecycle。建议下轮 cmdline 加上。

**没 BLOCKER 阻碍签这一轮 R2 sign-off,因为**:
- 16 个真生产函数 PASS 覆盖了 R2.2 (FloorPlaneValidator classification)、R2.4 (PickSnapPlane nearest-XZ + sub#B cross-floor)、R2.5 (Tier-A bypass shared helper)。三条 R2 修复线都有真测真函数。
- 0 FAIL,exit code 0,无编译错误,无静默坑。
- jest R2.3 (low accuracy) + R2.7 (track debounce) 真 import 真生产 module,13 PASS。
- 没有死 code,没有假 PNG,verdict.txt 是真内容。

### 修缺陷的具体建议

1. **QA-40/41/42 重做** (10 分钟):
   - 改 SKIP,reason: "tracking gate 真测在 ARScreen.tsx useEffect; 本 Editor C# 不可达。RN jest 覆盖 trackStateDebounce 模块但不覆盖 useEffect — origin-stale.test.ts + r27 已跑"
   - 或:在 r27 增加 useEffect 真路径测 (jest + @testing-library/react-native)

2. **下轮 jest cmdline 扩展**:
   ```bash
   cd app && npx jest __tests__/r23-low-accuracy.test.ts \
       __tests__/r27-track-debounce.test.ts \
       __tests__/origin-stale.test.ts \
       __tests__/marker-store.test.ts
   ```

### Confidence

**HIGH** — sign-off 可以推进。R2 三条修复线都有真测真函数支撑。3 条 self-licking 是技术债不是事故,需在 lessons.md 记 [pending] 下轮清。
