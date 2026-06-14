# SELF-LICKING AUDIT — QARunAll.cs vs R2 fixes

**Reviewer**: independent reviewer #2
**Commit**: 9cccc9d
**Method**: 对每个 R2 fix,grep QARunAll.cs 检查 case 是否真 import 生产类。`using Cairn.AR` 在第29行存在,但**几乎所有 R2 case 都不使用这个 namespace 里的真函数**。

---

## R2.2 — FloorPlaneValidator.kRejectMaskHard

**Test calls real code?**: **NO**
**Evidence**: QARunAll.cs:560-610 (`Test_QA35_RejectClassifications`)
- 第564行 case 自己定义 `const PlaneClassifications kHardReject = ...` (8 个 flag),把 R2.2 fix 的逻辑**复制**到 case 里
- 第598行 `wouldReject = (cls & kHardReject) != 0` — case 用自己 hard-code 的 mask 判断,不调用 `FloorPlaneValidator.Validate(...)` 或任何 FloorPlaneValidator 静态方法
- 整个 file 中 `FloorPlaneValidator` 字符串只在注释里出现 (第562, 619行),没有方法调用
**If R2.2 reverted, would test still pass?**: **YES** — case 跟 FloorPlaneValidator.cs 物理上 0 联系。删掉整个 FloorPlaneValidator 类 case 仍 PASS。
**Severity**: **CRITICAL**

---

## R2.3 — isLowAccuracy 数据流 (useMarkerStore → arOrigin → unityCairnSpawn / buildSpawnRequest)

**Test calls real code?**: **NO**
**Evidence**: 
- grep `buildSpawnRequest` in QARunAll.cs → **0 hits**
- grep `isLowAccuracy` in QARunAll.cs → **0 hits**
- grep `useMarkerStore` / `arOrigin` in QARunAll.cs → **0 hits**
- QA-52/QA-53 (FloorPlaneValidator.cs:789-803) 是 arOrigin **距离阈值** test (30m vs 80m vs 50m),跟 R2.3 isLowAccuracy 数据流**毫无关系**
- 真正 isLowAccuracy 在 `app/src/screens/ARScreen.tsx:550, 568, 571` (TypeScript) — Editor C# harness 根本访问不到
**If R2.3 reverted, would test still pass?**: **YES** — R2.3 完全无 case 覆盖。0/47 个 case 测过 isLowAccuracy 三层数据流。
**Severity**: **CRITICAL** — sign-off 是裸的,这是 main agent 自己 R2 修复列表里的项,但 QA 套件根本没碰

---

## R2.4 — CrossSessionGroundSnap (nearest-XZ + cross-floor protection)

**Test calls real code?**: **NO**
**Evidence**: QARunAll.cs:848-914 (QA-70/72/73)
- QA-70 第855-870行:case 自己定义 `var planes = new[] { (name, area, xz) ... }` 然后自己写 `foreach` 算 nearest-XZ。0 处 import `CrossSessionGroundSnap`
- QA-73 第887-913行:同样自己算 nearest-XZ,再自己 hard-code `kMaxSnapDeltaY = 1.5f` 复制 R2.4 sub#B 的 cross-floor protection 逻辑
- grep `CrossSessionGroundSnap` in QARunAll.cs → 0 hits (只在注释 "R2.4" 出现)
**If R2.4 reverted, would test still pass?**: **YES** — 把 CrossSessionGroundSnap.cs 的 nearest-XZ 改回 area-largest,case 仍 PASS,因为 case 重写了算法。
**Severity**: **CRITICAL**

---

## R2.5 — MultiSpawner Tier-A bypass

**Test calls real code?**: **NO** (main agent 自己承认)
**Evidence**: QARunAll.cs:489-499 (`Test_QA23_MultiSpawnerTierA`)
- 第494行 用 `CairnBridge.SpawnRequest` (一个 stub),不是 MultiSpawner
- 第498行 case 自己写 `ctx.Note("Logic-only verify — real MultiSpawner.cs grep needs to be done in R2.5 fix")` — **main agent 自己写的注释明确承认这是 logic-only**
- grep `MultiSpawner` in QARunAll.cs → 0 hits in code,只在注释
**If R2.5 reverted, would test still pass?**: **YES**
**Severity**: **MAJOR** — main agent 知道是 self-licking 但**没在 sign-off 文档里把它标 RED**;case 仍占了 47 个总数里的 1 个 PASS,虚胖

---

## R2.6 — PendingAnchorRetry

**Test calls real code?**: **NO**
**Evidence**: QARunAll.cs:809-832 + 977 (`Test_QA60_PendingRetryBlocks`, `Test_QA61_PendingRetryRemoved`)
- 第977行:`class PendingAnchorRetryStub : MonoBehaviour { }` — case **自己定义了一个空 stub class**
- 第815, 825行:`go.AddComponent<PendingAnchorRetryStub>()` 加的是 stub,不是真的 `PendingAnchorRetry`
- 第817行 `bool v199Skipped = retryPresent` — 直接拿 component 是否存在赋值给 v199Skipped,**完全没调 V199.TryParentToAnchor**
- grep `PendingAnchorRetry[^S]` (排除 Stub) in QARunAll.cs → 0 hits
**If R2.6 reverted, would test still pass?**: **YES** — 真 PendingAnchorRetry.cs 内部逻辑跟 case 0 关系
**Severity**: **CRITICAL**

---

## R2.7 — ARScreen track flicker debounce (TypeScript useEffect)

**Test calls real code?**: **NO** (架构上不可能)
**Evidence**: QARunAll.cs:661-783 (QA-43/44/45/46)
- ARScreen.tsx:331-389 是 React useEffect + useRef,**TypeScript**,在 React Native runtime 跑
- QARunAll 是 **Unity Editor C# 静态方法**,跨语言跨 runtime,物理上不可能 import ARScreen.tsx
- QA-43 (第661-703行) 重新用 C# 实现 `pendingDowngradeAt + toggles` 逻辑 — 这是 ARScreen.tsx:331-389 的 **C# 翻译版**,不是测试
- QA-45 第735-768行同样用 C# 重新实现 `limitedAccum + hardCapApplied` 逻辑
**Simulator vs production 一致性谁验过?**: **没人**。grep 整个项目 — 没有任何脚本对照过 QARunAll C# debounce simulator 跟 ARScreen.tsx useEffect 真实行为。两边可以**逻辑一致 case PASS,而真 ARScreen.tsx 里 timer cleanup 漏写一行 device 上 plant 在 limited 帧落地** — case 完全抓不到。
**If R2.7 reverted (TS 文件) , would test still pass?**: **YES**
**Severity**: **CRITICAL** — 比 R2.5 更糟,因为不是粗心,是 **architectural impossibility**:Editor C# harness 不可能测 React Native TS

---

## 总览

| R2 | 真覆盖 | severity |
|----|--------|----------|
| R2.2 FloorPlaneValidator   | NO  | CRITICAL |
| R2.3 isLowAccuracy 三层    | NO  | CRITICAL |
| R2.4 CrossSessionGroundSnap | NO | CRITICAL |
| R2.5 MultiSpawner          | NO (logic-only,main agent 已注明) | MAJOR |
| R2.6 PendingAnchorRetry    | NO  | CRITICAL |
| R2.7 ARScreen flicker (TS) | NO (跨 runtime 不可能) | CRITICAL |

- **Self-licking 总数**: **6 / 6**
- **真覆盖**: **0 / 6**
- 47 个 case 全套通过 ≠ R2 修复正确,**只 ≠ "main agent 写的复制版逻辑自洽"**

## 建议

**可以补真测试 (Editor PlayMode 范围内)**:
1. **R2.2** — 最容易。`Test_QA35` 应直接 `using Cairn.AR; FloorPlaneValidator.Validate(plane, camY, ...)` 喂 mock ARPlane subclass,assert 返回值。R2.2 改了 `kRejectMaskHard` 在 FloorPlaneValidator.cs:77-130,对得上调用。
2. **R2.4** — 中等。CrossSessionGroundSnap.cs 应该有公共 API 接受 `IList<plane-like>` 返回 winner。case 直接调那个 API,不要自己 foreach。
3. **R2.6** — 中等。把 stub 换成真 `PendingAnchorRetry` (即便它需要 ARKit deps,可以放 ifdef 或 mock subsystem)。

**Editor 限制做不到 (必须真机 + telemetry 对账)**:
4. **R2.7** — TypeScript runtime,只能在 RN 项目里写 jest test 或 detox e2e,Unity Editor 永远测不到
5. **R2.3** — 同 R2.7,纯 TS 数据流,需要 jest test 在 app/ 下面单跑
6. **R2.5** — 中等。MultiSpawner.cs 是 C# 但跟场景对象耦合,可以 PlayMode test;现在的 EditMode 静态方法跑不了

**当前 sign-off 实际状态**:6 个 R2 fix 中 4 个生产代码改动**完全无生产代码覆盖测试**;1 个 (R2.5) main agent 已自承认;1 个 (R2.7) 跨 runtime 架构上不可能。pinning 47 case PASS = 0 信心。 **真机 + telemetry_sessions 对账是唯一信号**(memory 里 `feedback_review_loop_dynamic.md` 早警告过这点)。
