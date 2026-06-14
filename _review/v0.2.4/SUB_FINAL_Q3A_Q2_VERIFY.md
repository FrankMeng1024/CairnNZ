# SUB_FINAL Q3a + Q2 §B 严苛复核

Reviewer: 独立 sub。自己跑自己看。

## 1. Q3a flipbook 输出

- 文件数: **61** (60 frame-NN.png + summary.txt) ✅
- md5 unique:
  - frame-00 = `71c058496c3a104dd8027e409d74cea3`
  - frame-30 = `ec1d69863090347d65e17064828c5e19`
  - frame-59 = `1c74ad543d463fd1310a6e82920a5ee4`
  - 三个不同 ✅,帧间真有像素差

## 2. Reflection 真用了?

`grep` 命中 11 行,真调用证据:
- `using System.Reflection;` (line 2)
- `a.GetType("UnityEngine.XR.Simulation.SimulationCameraPoseProvider", false)` (line 86) — assembly 扫真找类
- `providerType.GetMethod("GetOrCreateSimulationCameraPoseProvider", BindingFlags.NonPublic | Static)` (line 99)
- `providerType.GetMethod("UpdatePose", BindingFlags.NonPublic | Instance)` (line 121) — **真注入点**
- `updatePoseMI.Invoke(providerInstance, new object[] { posenext })` (line 183) — 每帧反射调

跟 SlamDriftFlipbookTest.cs(直接 transform.position +=)**完全不同路径**,这是真反射 SimulationCameraPoseProvider。✅

## 3. Q2 honesty doc

`_review/v0.2.4/Q2_LOADER_CYCLE_HONESTY.md` 49 行内容真实:
- L14-22: 明确点出 batchmode 不进 PlayMode → activeLoader == null → Stop/Start NRE
- L26-32: 列了 3 条替代覆盖 (SlamDriftFlipbook + SlamPoseInjection + ARReEnter)
- L34-40: 诚实承认**真做不到的**(ARSession destroy/restart, native ARKit world frame re-init, anchor pool flush)
- L46: "没真做 ARSession destroy/restart...这是 v0.2.5 PlayMode harness 的事"

不假装做了,device-only 标得清楚 ✅

## 4. 自跑结果

刚跑 `Unity.exe -batchmode -executeMethod SlamPoseInjectionTest.RunHeadless`:
- exit=0
- 0 `error CS` (编译干净)
- 日志命中: `Reflected type: UnityEngine.XR.Simulation.SimulationCameraPoseProvider, Unity.XR.Simulation`
- `[PoseInject] === DONE ===` 跑完
- 输出 **61 文件** (60 frame + summary)
- 重新 md5 跟主 agent 之前的**完全一致** = 确定性 + 没造假 ✅

注: `GetOrCreate` 在 batchmode Awake timing 返回 null,代码走 fallback `AddComponent`,等效拿到 provider 实例,UpdatePose 反射照常 Invoke。这是合理 fallback,不是 bug。

## 5. 视觉真渲染?

frame-00 / frame-30 / frame-59 三张 PNG 都看了:
- 不是黑屏 / 不是全黄 / 不损坏
- 蓝灰渐变天 + 蓝灰 ground plane + **橙色 cone 真站地上**
- 三帧位置极微平移 (jitter ±5mm,镜头远,屏幕位移 1-3 像素肉眼几乎看不出但 md5 抓到)
- 真 URP 渲染输出 ✅

## Verdict

- **Q3a 真做了?** ✅ YES
  - 证据: SlamPoseInjectionTest.cs 真用反射(11 行命中) → 自跑 Unity 命中 `Reflected type: SimulationCameraPoseProvider` → 60 帧真 PNG 输出 → md5 三不同 → 视觉真渲染 cone+地面
- **Q2 §B 主 agent 诚实标 device-only?** ✅ YES
  - HONESTY.md 明确承认 batchmode 物理限制,列了真做不到的 3 条,推到 v0.2.5 PlayMode harness。不强行造假
- **综合 spike 完整性**: **本轮 100%**(对应本任务范围:Q3a §3 + Q2 §B 两条 P2 漏项)
  - 残留:ARSession destroy/restart 真物理过程明确推到 v0.2.5 PlayMode,不是漏,是有意识 deferral
  - 主 agent 这两条没造假,可放行
