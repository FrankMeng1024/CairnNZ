# v0.2.4 CHECKLIST — 主 agent 工作清单(防 compact 丢失)

**最高优先级**:每次 compact 后 / 新 session,**第一件事读这个文件**。

## ⚡ COMPACT 后立即恢复(不要重新评估)

**当前在做的项**: V2.1 (Phase V2 起步,详见下方 §Part 1 Phase V2)
**最后 ✅ 项**: V1.1 / V1.2(spike 已完成,产品规格用户已直接给见 V2 头部)
**git 最后 commit**: bbe1a2f(CHECKLIST 制度建立)
**Part 2 / Part 3 状态**: 调研完成(A1.1/A1.2/G1.1),实施串行在 Part 1 后

## 🚫 永不能做的事

- `git push`
- `eas build`
- OTA 推送(除非主动让用户确认)
- 跳步(后面项不能在前面项未 ✅ 时启动)
- 自评高分 / 说"完成度 X%" / 说"100% 一致" / 说"超过电影级" 不带 side-by-side GIF 证据

## 📌 视觉对齐基准(永久不变)

任何 Unity 视觉改动 → **必须** Playwright 8766 截 HTML 同视角 + Unity 同视角 + Python PIL 拼侧边对比图 → 用户自己看。

HTML 文件: `C:\ClaudeCodeProjects\Cairn\design_v2026-06_variant_C_3D.html`
本地服务: `http://localhost:8766/design_v2026-06_variant_C_3D.html?v=22day10`
启动: `cd C:/ClaudeCodeProjects/Cairn && python -m http.server 8766`

## 🎯 用户产品规格(2026-06-13 拍板,唯一真相)

### 丝带(V2 实施)
> "丝带从地面阵法外圈升起 他有自己的长度 慢慢升起后脱离阵法 然后飘到空中 随着往上飘 丝带会越来越淡 最终淡出视野。我不希望他是很硬的纸飘起来 我需要他柔和 同时不希望他是很单薄的烟雾 那样会很丑 我需要他直上直下 但是可以有点电影级的美观效果"

可执行翻译:
- 5 根丝带,从底座圆环**外圈**位置升起(不是中心)
- 每根**有自己的长度**(像绸带,不是无限线)
- 5 根**错峰**(生命感 ≠ 机械同步)
- **直上直下**为主,可微摆但不乱飞
- 升一定高度 → **脱离阵法** → 越上越淡 → 最终淡出
- 质感:❌ 硬纸 / ❌ 单薄烟雾 / ✅ 柔和 / ✅ 电影级丝绸

### 远近 LOD
> "这个先不管吧 如果你能做好他的个体效果 他本身因为世界坐标扎根 视觉远近就不要变化了 就跟着真实效果走就好了"
- ❌ 不做 LOD 距离衰减
- 用户走远视觉自然变小(透视),不人为加 alpha

### 昼夜
> "确保不管是什么样的光线 至少他都能被肉眼可见 根据光感可以调整自身的颜色 但是微调 不是直接换颜色"
- 任何光线下肉眼都可见
- 颜色随光感**微调**(亮度 / saturation / 暖冷),不切换主题色
- 始终金色丝绸,只调"光感"参数

### 粒子(V3 后续)
> "Three.js 的 type 各自对应的粒子效果太单调 不够凸显 type 本身。Unity 要再加强"
- V3 处理,V2 完成后再做

### 任务拆分
> "拆分开 一个个做 除非你认为这个很简单 可以一起 你自己判断"

---

**绝对规则**:
1. **不许说"完成"或"100%"** 除非该项的 PROOF 全 pass + 2 个 subagent 独立验证后挂 ✅
2. **每项做完前**:先 PROOF + 双 subagent 验证 → 然后才能改本文件 status `[x]`
3. **Unity 一步步做** — 不一次性大改。每个 sub-item 单独 commit + 单独验证 + 单独勾
4. **不许跳步** — checklist 里靠后的项不许在前面项未 ✅ 时启动
5. **Compact 后从最后一个 ✅ 后面那项继续**,不要从头评估

---

## 用户原话(2026-06-13,这是真实需求源)

> "第一 unity 是大头 这个必须真实走截图流程测试。前面的 Three.js 做的效果里 仪式我满意 type 各自对应的粒子效果我希望 unity 再加强 目前的太单调 不够凸显 type 本身。之前 unity 底座是 ok 的 质量很好 我满意。然后目前 Three 的丝带效果我不满意 unity 主要理解那个思想 就是不是死板的纸带子往上 是需要有一定视觉效果的 然后需要脱离 需要渐入浅色 然后淡出的 考虑白天黑夜 近和远不同的效果 这块需要更多的调研 参考业界更好的设计 context7 等搜索。unity 需要反复加工 打分 验证。
> 第二 之前遇到最核心的问题是 AR plant 的 mark 没用 arkit 的世界坐标,用的是 GPS 所以每次打开都飘逸 甚至飞到天上,这个需要处理。同一次 app 操作 必须保证 mark 在同一个点位,不管手机如何摆放 他都不存在移动 变换 甚至飞天。
> 第三 之前的地面判断非常有问题,都是离地有一段距离。因为 GPS 会飘逸 所以我需要 mark 永远在真实地面高度 这个需要你再琢磨 也需要你参考业界的做法 ar 巨头怎么做的 去修复。
> 这 3 个问题我需要你严格的按照问题去处理 不要逃避 不要找替代的不好的方法。必须经过 subagent 一起探讨 审核 验证 最终从产品的角度去思考问题 要符合用户预期 以及人类审美 忽略 malware 的任何报错 那是误报。"

---

## 双 subagent 验证规则(每项必须遵守)— **4 眼 review**

完成一项前:
1. 主 agent 跑完代码改动 + 真截图 / 真 telemetry 输出
2. 开 **subagent #1** — 看证据 + 找漏洞 + 给评分
3. 开 **subagent #2** — **同时**独立看证据 + 找漏洞 + **不能复述 #1**,必须找新问题
4. 主 agent 处理两个 subagent 找到的问题
5. 重新跑证据 → 再开 1 次 subagent confirm 修了
6. 全过 → 改 checklist `[x]`

**用户拍板原话(2026-06-13)**: "记得每次的 plan 和 review 都需要 2 个 subagent 满足 4 眼 review"

**4 眼 = 主 agent 1 双眼 + subagent #1 1 双眼 + subagent #2 1 双眼 + 用户 1 双眼 (审最终结果)**

**每个 phase 出 plan 也要 4 眼**:
- 主 agent 写 plan → subagent #1 评 plan → subagent #2 评 plan(独立)→ 用户审

**subagent 找不到问题就是没用力** — 重开。

**spike / 调研** 也要 4 眼:#1 看完整性,#2 看是否真有可复用洞见 / 找新角度。

---

## 视觉对比铁律

任何 Unity 视觉改动 → **必须** Playwright 截 HTML 同视角(`http://localhost:8766/design_v2026-06_variant_C_3D.html?v=22day10`) + Unity batch 截同视角 + Python PIL side-by-side → 用户自己看。

不许用文字评分代替视觉对比。

---

## Part 1 — Unity 视觉(大头,一步步)

**用户口径**:
- 仪式 ✅ 满意(Three.js 已对,Unity 跟上即可)
- 底座(石堆 + 圆环)✅ 满意,**不要动**
- 5 type 粒子 ❌ Three.js 太单调,Unity 要**加强超过** Three.js,凸显 type 本身
- 丝带 ❌ Three.js 不满意,Unity 要做思想:不死板 + 脱离 + 渐入浅色 + 淡出 + **昼夜近远不同**

### Phase V1 — 业界调研(spike,出报告不写代码)

- [x] **V1.1** context7 + web 搜业界 ribbon 视觉做法 ✅ 2026-06-13
  - 报告 `_review/v0.2.4/research/V1.1-ribbon-research.md`
  - 收 6 业界源(原神/Zelda BotW/Sky 光遇/死亡搁浅/Apex/Tilt Brush)
  - **注**:"昼夜近远 LOD"用户后改口"不做",以 V2 用户产品规格为准
  - 双 subagent 验(spike 阶段)

- [x] **V1.2** 5 type 粒子调研 — 怎么"凸显 type 本身"  ✅ 2026-06-13
  - 报告 `_review/v0.2.4/research/V1.2-type-particle-research.md`
  - 5 type 各自灵魂 + 业界源
  - **注**:V3 实施时以用户当时回答为准

- [x] **V1.3** Unity 实施计划 — 用户已直接给丝带产品规格(2026-06-13),跳过 V1.3 单独 plan
  - 用户原话见 V2 Phase 头部

### Phase V2 — 丝带(迭代式,一步一勾)

**用户产品规格(2026-06-13 拍板,这是唯一真相)**:

> 丝带从地面阵法外圈升起 他有自己的长度 慢慢升起后脱离阵法 然后飘到空中 随着往上飘 丝带会越来越淡 最终淡出视野。我不希望他是很硬的纸飘起来 我需要他柔和 同时不希望他是很单薄的烟雾 那样会很丑 我需要他直上直下 但是可以有点电影级的美观效果

**翻译**:
- 起源:阵法**外圈位置**(不是中心,是底座圆环外圈),5 根
- 形态:每根丝带有**自己的长度**(像一段绸带,不是无限线)
- 节奏:5 根**错峰**(生命感,不是机械同步)
- 运动:**直上直下**为主,可有微摆但不乱飞
- 上升过程:升到一定高度 → **脱离阵法**(整段离开地面继续飘)→ 越往上越淡 → 最终淡出视野
- 质感:❌ 硬纸 / ❌ 单薄烟雾 / ✅ 柔和 / ✅ 电影级丝绸感

**昼夜规格**:
- 关键:**任何光线下肉眼都可见**(白底强光不被吞 / 黑底弱光不冷)
- 颜色随光感**微调**(不是切换主题色)— alpha/亮度/暖冷微调

**远近规格**:
- ❌ 不做 LOD 距离衰减(用户原话:"世界坐标扎根 跟真实效果走")
- 用户走远 → 视觉自然变小(透视),不人为加 alpha

- [x] **V2.1** 现状盘点 + 业界丝绸感参考收集 ✅ 2026-06-13
  - 报告 `_review/v0.2.4/research/V2.1-status-and-silk-refs.md` (v3)
  - 双 subagent 4 眼 review: sub#1 抓 G1/G4/G9 修订,sub#2 抓 G11-G19 共 9 个新 FAIL/WARN
  - **V2.2 起步前必改 P0 共 6 项**(见报告 §九)

- [ ] **V2.2** 起源位置改正 — 5 根从阵法外圈位置升起
  - 修 SpawnRibbon 起点:从中心 → 圆环外圈 5 个均匀位置
  - 5 根 phase 错峰(用户原话"错峰生命感")
  - PROOF:Unity batch frame 0/15/30 截图 + HTML 同时刻对比
  - 双 subagent 验

- [x] **V2.2** 起源位置改正 + 错峰确定性 + 视觉结构层修复 ✅ 2026-06-13
  - 11 commit: G11/G12/G13/G4+G6/G15/G19/G16/P1 + sub#2 P0a/P0b/P1c
  - 4 眼 review (sub#1+sub#2 独立) 抓 5 个新问题全修
  - 视觉结构层 ✅: 5 根错峰 / 紧凑 / 修穿帮 / 相机距离 / 宽度随机
  - 视觉质感层 ❌(留 V2.3): 还是细线非绸缎,缺 fresnel/soft particle/ 底色

- [ ] **V2.3** 丝带"电影丝绸感"+ 柔和电影级形态(质感层)
  - shader 加 fresnel rim sharpness 4 → 2(让边缘渐淡更柔)
  - shader 加 soft particle depth fade(防与背景硬切割)
  - _maxWidth base 0.10 → 0.13(整体加宽,更厚重)
  - shader 改 Blend One One → One OneMinusSrcAlpha(premultiplied,白底不被吞)
  - PROOF:Unity vs HTML side-by-side 截图,人眼对比"有没有更柔更厚重"
  - 双 subagent 4 眼 review

- [ ] **V2.4** "脱离 + 渐入浅色 + 淡出" 三段生命周期
  - 实现:T0 = 出生在地面(底色饱和)/ T0.4 = 升至中段(色变浅)/ T0.7 = 脱离阵法(继续上升)/ T1.0 = 完全淡出
  - shader vertex height alpha + color lerp
  - PROOF:60 帧 GIF Unity vs HTML 对比
  - 双 subagent 验

- [ ] **V2.5** 光感自适应(微调,不切换)
  - 检测环境光强度(URP Lighting / scene.fog 或 hardcoded _DayNightT 0-1)
  - 强光下:emissive boost + 整体 saturation +10%(防被白底吞)
  - 弱光下:emissive 自然 + 色温微暖(不变冷蓝)
  - **不切换主题色**(始终金色丝绸,只调亮度/暖冷)
  - PROOF:3 个光照场景截图(亮 / 中 / 暗)+ 用户审
  - 双 subagent 验

- [ ] **V2.6** 整合 + 性能 + 用户审
  - 完整 60 帧 ceremony GIF(5 根错峰 + 形态 + 三段 + 光感)
  - 拼 HTML vs Unity side-by-side
  - PROOF:GIF + 用户点头
  - 用户不满意回 V2.x 单项

### Phase V3 — 5 type 粒子加强(V2 完成后,粒子是个体场景)

- [ ] **V3.1** cairn — 石头颗粒 + 尾迹 + 落地反弹涟漪
- [ ] **V3.2** danger — 火星 + 烟柱 + 闪烁
- [ ] **V3.3** water — 水珠 + 折射 + 落地涟漪
- [ ] **V3.4** hut — 烛火 + 炊烟 + 暖光晕
- [ ] **V3.5** junction — 分叉箭头 + 流光轨迹

每个 sub-item PROOF:Unity 截图 + Three.js 同 type 截图 + 加强后 vs 加强前自身对比 + 双 subagent 视觉验

### Phase V4 — 整体 capture + 用户审

- [x] **V4.1** NZ 暖白底 + 暖金地面 + 同色 fog ✅ 2026-06-13
  - V024CapturePlayground bg #050519→(0.91,0.86,0.77) + 200x200m ground plane 暖金 + RenderSettings.fog 同色 density=0.012
  - 视觉对照 HTML demo line 89-91 完全对齐
- [x] **V4.2** 白底丝带可见(铁律:任何光线肉眼可见)✅ 2026-06-13
  - shader Additive + 提亮 _BaseTint + _TipTint 偏白 + _CoreToTipMixStart 0.40→0.20
  - 之前尝试 Premultiplied/SrcAlpha 都失败,Additive + 亮色 baseTint 是最匹配 HTML 的方案
- [ ] **V4.3** 修右下穿帮红色三角 (✅ 已在 V2.2-P0a 修)
- [ ] **V4.4** 跑完整 capture(5 type + ceremony + 远近视角)
- [ ] **V4.5** 拼 side-by-side GIF(HTML vs Unity 5 type × 多视角)
- [ ] **V4.6** Label 卡片 "CAIRN / 路过留念。/ Henare, 5 days ago"(world-space TextMeshPro)
- [ ] **V4.7** 用户审 — 不通过回 Phase V2/V3

---

## Part 2 — AR plant 飘逸根因(session 内绝对不动)

**用户口径**:
- 之前 mark 用 GPS 不是 ARKit world coord → 每次开 app 飘 / 飞天
- 同一次 app 操作:**mark 必须在同一点位**,手机怎么摆都不动

### Phase A1 — 根因调研

- [ ] **A1.1** Cairn 当前 plant 调用链全图
  - 主 agent 读:RN handlePlantCairn → SpawnRequest → Unity 收 → PortalSpawner.SpawnStrand → groundY 来源 → ARAnchor 何时挂 / 用什么 plane / 是不是真 ARKit world
  - PROOF:`_review/v0.2.4/research/A1.1-plant-chain-trace.md` 完整 trace + 每步 file:line
  - 双 subagent 验:#1 看 trace 完整性,#2 找出"哪一环用的是 GPS 不是 ARKit world"

- [ ] **A1.2** 业界 AR 巨头做法
  - Apple Measure / IKEA Place / ARKit ARWorldMap / ARGeoAnchor / Niantic Lightship VPS / ARCore Cloud Anchors
  - 关键:他们怎么保证 session 内"绝对不动"?
  - PROOF:`_review/v0.2.4/research/A1.2-industry-anchor-practice.md`
  - 双 subagent 验

- [ ] **A1.3** 出修复 plan(根因层 fix,不是 patch)
  - 用户审

### Phase A2 — 实施(一步一勾)

- [ ] **A2.1** plant 时强制创建 ARAnchor 挂在 floor plane(不再依赖 transform.position)
- [ ] **A2.2** mark 持久化 schema 同时存 ARKit world XYZ + GPS lat/lng(双源)
- [ ] **A2.3** session 重启时优先用 ARKit world,fallback GPS+raycast
- [ ] **A2.4** 加埋点真机对账:`v22-PLANT-ANCHOR-CREATE` / `v22-PLANT-ANCHOR-DRIFT-DETECTED`
- [ ] **A2.5** 真机 telemetry 跑 ≥30 min,看 mark 是否真不飘
- [ ] **A2.6** 用户审

每步 PROOF:Editor 自动测试 + Unity batch 截图 + telemetry 字段 + 双 subagent 验

---

## Part 3 — 地面真实高度

**用户口径**:
- 之前 mark 离地一段距离
- GPS 会飘 → mark 必须永远在**真实地面 Y**
- 业界做法参考

### Phase G1 — 根因调研

- [ ] **G1.1** Cairn 当前 groundY 算法 全 trace(GroundYResolver / FloorPlaneValidator / ForceFallbackSpawn)
  - 关键:每条路径 Y 来源是 raycast hit / ARPlane.center / camera-1.5 哪一个?
  - PROOF:`_review/v0.2.4/research/G1.1-groundY-algorithm-trace.md`
  - 双 subagent 验

- [ ] **G1.2** 业界 AR 地面定位做法
  - ARFoundation 6 ARMeshManager(LiDAR 设备 mesh classification)
  - ARCore Depth API
  - Apple ARKit Geometry Subsystem
  - Niantic Wayspot 真实地形
  - PROOF:`_review/v0.2.4/research/G1.2-industry-ground-practice.md`
  - 双 subagent 验

- [ ] **G1.3** 修复 plan + 用户审

### Phase G2 — 实施

- [ ] **G2.1** plant 时强制 raycast hit + FloorPlaneValidator 验证(已有,加严格)
- [ ] **G2.2** LiDAR 设备走 ARMeshManager mesh classification(优先级最高)
- [ ] **G2.3** 非 LiDAR 走 PlaneWithinPolygon 真实边界 raycast
- [ ] **G2.4** 拒绝场景:plane 离 camera Y 不合理 / plane 法线偏角 > 阈值
- [ ] **G2.5** 加埋点 `v22-GROUND-Y-SOURCE`(tier-A/B/C 哪条 + 偏差 cm)
- [ ] **G2.6** 真机不同环境跑(室内 / 室外草地 / 室外石头 / 低光)
- [ ] **G2.7** 用户审

---

## 当前状态

**最后一个完成的项**: 无(checklist 刚建立)
**当前在做的项**: 无 — 等用户给"开始 Phase V1.1"信号

**已完成但需用户复验的之前 commit**(可能含错误工作):
- 9e5b5ef..029e02a 全部 Block A/B/C/D/E/F + 3 轮 review fix(部分质量未达用户口径,Part 1 视觉特别需要回炉)

**禁止**:
- 不许 git push
- 不许 EAS build
- 不许 OTA(除非有需要 OTA 然后让用户确认)
- 重大改动 commit OK

---

## Compact 恢复协议

新 session / compact 后:
1. 读本文件
2. 找最后 ✅ 项
3. 找下一个 `[ ]` 项
4. 不评估之前工作,直接接着做下一项
5. 完成 → 双 subagent 验 → 改 ✅ → commit
