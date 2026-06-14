# SUB FINAL P0+P1+P2 VERIFY (independent reviewer)

主 agent 言论一律不信,自己跑自己看的结果。

## 1. Unity QA run: pass=? fail=?

**自己跑了** (rm -rf qa-cases + Unity batchmode -executeMethod QARunAll.RunHeadless)。

```
=== DONE: pass=22 fail=0 skip=32 ===
```

QA-74-multi-cairn-batch-snap PASS。QA-75-anchor-drift-sliding-window PASS。所有 SKIP 都有 reason (RN-side jest / native runtime 不可 Editor mock)。

**Verdict: TRUE. 22 pass, 0 fail.**

## 2. Flipbook 60 PNG 真出: YES

`UnityARLib/Logs/slam-drift-flipbook/` ls = 61 entries (frame-00..frame-59 + summary.txt)。

md5 (3 抽样):
- frame-00.png = 323123e6ffba8cca53e4f0d0776c65de (79235 B)
- frame-30.png = e61aef656d301249b8fa981de4d4eb74 (79545 B)
- frame-59.png = c0c8dfcbb218ef64d4050376414f7a87 (79472 B)

**3 个 md5 全不同 + size 不同**。不是复制粘贴的同一张图。summary.txt 写着 "Total Y drift 0.3m cubic ease in, X jitter ±0.02m sin wave"——drift 是渐进的,所以 frame-00/30/59 必定视觉不同。**Verdict: TRUE flipbook**.

## 3. LIVE-POSE emit grep 命中: 2 处

`AnchorDriftMonitor.cs`:
- L77-78: 注释说明 v22-CAIRN-LIVE-POSE 10s 周期 emit
- L83: `UnityLogger.IForward("v22-CAIRN-LIVE-POSE", ...)` — 真 emit 调用,带 `now=`,`initial=`,`driftM=`,`sessionAgeSec=`

包在 `if (Time.time - _lastLivePoseTime >= _livePoseIntervalSec)` 守卫里 (L79),`_livePoseIntervalSec = 10f` (L38)。**真 10s 周期 emit。Verdict: TRUE.**

## 4. Sliding-window 字段 grep: 新有,旧无

新字段 (全在 AnchorDriftMonitor.cs):
- L35: `_maxEmitsPerWindow = 5`
- L36: `_emitWindowSec = 60f`
- L45: `Queue<float> _emitTimestamps`
- L56: `_emitTimestamps.Clear()` (Init)
- L90-95: window slide 逻辑 (`while ... _emitTimestamps.Peek() < windowStart ... Dequeue()`)
- L96: `capReached = _emitTimestamps.Count >= _maxEmitsPerWindow`
- L119: `_emitTimestamps.Enqueue(Time.time)`
- L127: `public int EmitsInCurrentWindow => _emitTimestamps.Count;` (testable accessor)

旧字段 grep across **全 UnityARLib/Assets/**: `_maxEmitsPerSession\|_emitCount` = **0 命中**。完全删除,没残留。

**Verdict: TRUE. 新字段全在,旧字段全删。**

## 5. QA-74 多 cairn 真测 (而不是单 cairn fake): YES

QARunAll.cs L714-749:
- 真创 4 个 ARPlane (planeA-D) at xz=(0,0)/(3,0)/(6,0)/(9,0),y 偏移 0/0.05/0.10/0.15 (用 reflection-based `CreateMockARPlane` 真挂 BoundedPlane via SetSessionRelativeData,不是 mask copy)
- 10 cairn at xz=(0..9, 0)
- 循环 10 次,每个 cairn **独立** call `CrossSessionGroundSnap.PickSnapPlane(planes, cairnPositions[i], 0.1f, 1.5f)` (真生产路径)
- 期望 mapping: i=0,1→A; i=2,3,4→B; i=5,6,7→C; i=8,9→D
- `AssertEqualF("multi-cairn-correct-picks", matchCount, 10)` —— 必须 10/10 配对

不是单 cairn 假装多 cairn。是真 10 cairn × 4 plane 的 batch 测。**Verdict: TRUE multi-cairn.**

## 6. 反向 mutation 反 self-licking: STATIC TRACE (not destructive)

我没真去改 `_emitTimestamps` → `_emitCount` (那要 augment 代码,违反约束)。改用 static logic-trace:

QA-75 (L703-711): `monitor.AddComponent<AnchorDriftMonitor>()` + `monitor.Init(...)` + `ctx.AssertEqualF("initial-window-count", monitor.EmitsInCurrentWindow, 0)`。

`EmitsInCurrentWindow` 在 AnchorDriftMonitor.cs L127 = `_emitTimestamps.Count`。如果 P1 回滚 (删掉 `EmitsInCurrentWindow` 或换回 `_emitCount` int 字段):
- 编译期: QARunAll.cs L707 直接 CS0117 `'AnchorDriftMonitor' does not contain 'EmitsInCurrentWindow'` → headless run 0 PASS / build error
- 即使重命名成 `_emitCount` 但保留 accessor: Init 后 Queue.Count=0 vs int=0 都过,但 Queue 的 Peek/Dequeue/Enqueue 调用 (L92-119) 全要改否则编译失败

也就是: **测试名义上只 assert 初始 0, 但要让该测试存在/编译, 必须 sliding-window 生产代码真在**。回滚生产 = 编译挂 = QA-75 FAIL。

**Verdict: 静态 trace 显示测试真依赖新行为。非 self-licking。**

(注: QA-75 case 本身只 assert initial-count=0,没 assert "5 次 emit 后 dequeue 行为",这是覆盖深度可改进点;但 P1 claim 的范围是 "sliding-window 字段在 + 测试存在 + accessor 可读",这点 verified。)

## Verdict: P0+P1+P2 真做了

- **P0** (LIVE-POSE 10s emit): 真加,L83 `IForward("v22-CAIRN-LIVE-POSE", ...)` 带完整 payload + 10s 守卫。
- **P0** (60-frame flipbook): 真出 60 PNG + summary.txt,3 个 md5 全不同。
- **P1** (sliding-window 替换 5/session): 新字段 7 处全在 (Queue/Count/Window/Enqueue/Dequeue/Peek/accessor),旧字段全项目 0 命中。
- **P1** (QA-75 测 sliding-window): PASS,真挂 MonoBehaviour + 真 call accessor。
- **P1** (QA-74 多 cairn batch snap): PASS,10 cairn × 4 plane,真 PickSnapPlane,10/10 配对。
- **P2** (anchor-removed 埋点): 真加,L68-74 `GetComponentInParent<ARAnchor>()` null 检测 + emit 一次性 guard。

**主 agent 这次没撒谎**。22/22 PASS,所有声称的代码改动都 grep 实证可见,evidence 文件真在磁盘。

剩唯一可改进点 (非 lie): QA-75 case 深度只到 initial-count,没真 trigger 5 次 emit + sleep 60s 验 dequeue。建议 v0.2.5 加深。但此点不属本次 audit 范围 (audit 范围 = P0+P1+P2 是否 done)。
