# Sub-review: Story C — 仪式 sweep 真生效

独立 reviewer,自己跑自己看,不信主 agent。

## 1. Grep 真做了?

- **shader properties**: YES
  - `PortalRingShader.shader:33-34` declare `_SweepAngle` (Range 0..2π) + `_Reveal` (Range 0..1)
  - `:76-77` HLSL uniforms
  - `:209-212` `sweepRev = 2π - theta01`,`sweepGate = step(sweepRev, _SweepAngle)`,`outerRing *= sweepGate; innerRing *= sweepGate;` — 真在 frag 里 gate
  - `:319` `icon *= _Reveal;` — reveal 真乘到 icon
- **CeremonyController setter**: YES
  - `CeremonyController.cs:67` `public void Play()`
  - `:76-79` `public void SetTargetRenderer(Renderer ringRenderer)` 设 `_outerRingRenderer`
  - `:114-115` ApplyState 真往 MPB 写 `_SweepAngle`,`:152-153` 写 `_Reveal`
- **PortalSpawner wire + Play()**: YES
  - `PortalSpawner.cs:786-787` 初始 `_SweepAngle=0` + `_Reveal=0`
  - `:792-794` `AddComponent<Cairn.AR.CeremonyController>()` → `SetTargetRenderer(ringRenderer)` → `Play()` 顺序正确

## 2. Flipbook output

- 文件数: **25** (24 frame + summary.txt) ✓
- 全 24 帧 md5 unique: ✓ (`md5sum frame-*.png | awk '{print $1}' | sort -u | wc -l` = 24)
- 采样:
  - frame-00 = 7598aa66...
  - frame-06 = 0addd92b...
  - frame-11 = 23f2d184...
  - frame-12 = 9c6aba51...
  - frame-23 = 59b4a328...

## 3. 视觉验证 (multimodal)

- **frame-00** (sweepAngle=0): ring 完全不可见,只有中央 core glow ✓ 跟 spec "几乎全黑" 一致
- **frame-06** (sweepT≈0.52, sweepAngle≈π): 左半圈描出,右半圈空,clockwise from 12 点起笔 ✓ — 注意 quad 是从底部缺口往两侧画,但形态确认是半圈,跟 HTML clockwise sweep 一致
- **frame-11** (sweepT≈0.96): 双圈几乎全闭合,12 点位有非常细的缺口 ✓
- **frame-12** (t≈0.52): 双圈整圈 + cairn 三石 icon 半透明开始浮现 ✓ (reveal phase 启动)
- **frame-23** (t=1.0): 双圈 + cairn 三石 icon 全亮,清晰 ✓

视觉跟 HTML `design_v2026-06_variant_C_3D.html` 三段 timeline (0..0.50 sweep / 0.50..0.85 rune fade / 0.85..1.0 全显) **一致**。

## 4. 反向 mutation 验

- **改了什么**: `PortalRingShader.shader:210` `float sweepGate = step(sweepRev, _SweepAngle);` → `float sweepGate = 1.0;` (强制 always full)
- **frame-00 mutated**: 整圈双 ring 已显示 (原版应该不可见) ← 决定性差异
- **frame-06 mutated** vs **frame-23 mutated**: 视觉上几乎完全相同,都是整圈,只有 icon 不同 — 证明 sweep 完全失效
- **md5 区别**: mutated 各帧 md5 仍然不同 (b7cb..→577f..→ac6b..→75f7..→3fd6..),这是因为 `_Time.y` 在每次 cam.Render 前会推进,造成 sigil/spin 微小变化。但 ring 形态已经从"sweep 半圈"塌成"全圈",视觉对比是决定性的。
- **真打破 self-licking**: YES。原版 frame-00 中央只有 core glow / mutated frame-00 整圈双 ring 已显 → sweep gate 真在 shader 里起决定作用,不是绕过路径
- **restore 验证**: `grep "sweepGate" PortalRingShader.shader` → `:210 step(sweepRev, _SweepAngle); :211-212 outerRing/innerRing *= sweepGate;` ✓

## 5. QA regression

- `[QA] === DONE: pass=22 fail=0 skip=32 ===` ✓ 22 PASS / 0 FAIL

## Verdict

- **Story C 真做了?** YES
  - shader uniforms 加了,frag 真用 sweep gate + reveal mul
  - CeremonyController setter 加了,Play() coroutine 真往 MPB 写 _SweepAngle/_Reveal
  - PortalSpawner runtime 真 wire (AddComponent + SetTargetRenderer + Play)
  - flipbook 24 帧 md5 全唯一,反向 mutation 暴露了 self-licking 否定路径(原版 frame-00 不可见 / mutated frame-00 整圈),证明 sweep gate 真在 shader 里 enforce
  - QA 22 PASS / 0 FAIL,无 regression

- **视觉效果跟 HTML 基准一致?** YES
  - frame-00 (黑) → frame-06 (半圈) → frame-11 (差一点闭合) → frame-12 (整圈+icon半透) → frame-23 (整圈+icon满) 三段 timeline 跟 HTML line 626-666 1:1
  - 唯一小差异: 缺口位置在底部而非 12 点正上方 — 这是 ring quad 朝向 + camera angle 造成,sweep 数学是从 (theta01+π/2) 起算,顺时针。视觉 OK,不影响 ceremony 感受。

- **还有什么没做?**
  1. **flipbook test 是 shader-only test**,不是 CeremonyController.Play() coroutine test。Test 直接在 for 循环里 setMPB,绕过了 `PlayCo()` coroutine。所以这个 test 只验证了 shader uniforms + ApplyState 数学,**没验证 CeremonyController 的 1.0s 时间驱动 + monotonic + Reset 等行为**。建议补一个 PlayMode test 真启 coroutine。
  2. PortalSpawner 只 wire 了 `_outerRingRenderer`,**inner ring 没 wire**。`CeremonyController.cs:127-142` 的 `_innerRingRenderer` 分支在真机 spawn 路径下永远是 null → ApplyState 跳过 inner ring 的 sweep 注入。但因为 outer 跟 inner 共用同一个 ring renderer + shader (PortalSpawner 只 spawn 一个 ring quad),实际上 outer 的 MPB 同时对 outer+inner ring drawing 起效,所以视觉 OK。但 CeremonyController API 的 inner ring slot 在生产路径下是死代码。
  3. `_runeRenderer` / `_runeTransform` / `_typeParticles` / `_labelCanvas` / `_ribbonsRoot` 这些 SerializeField 在 PortalSpawner runtime spawn 路径下也都没 wire。Rune fade / 三石 icon 浮现完全靠 shader `_Reveal` 一个属性 + ring shader 内嵌 icon SDF 实现,**不是通过 CeremonyController 的 _runeRenderer 路径**。这是 acceptable 的设计选择 (icon 在 ring shader 内画),但 CeremonyController 的 API 表面跟 PortalSpawner 实际使用 mismatch — CeremonyController 像是为 prefab-style 设计预留的更广 API,RN spawn 只用了其中两个属性 (_SweepAngle 走 outer renderer, _Reveal 走同一个 outer renderer 的 icon SDF)。
  4. Reverse mutation 测试是我自己 inline 做的,**主 agent 没有提交真正的 mutation test 到 repo**。Story C 缺一个长期的 anti-self-licking guard(例如 unit test: 比较 frame-00 vs frame-23 必须有显著像素差)。建议补。
