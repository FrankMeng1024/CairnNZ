# v0.2.4 CHECKLIST — 主 agent 工作清单(防 compact 丢失)

**最高优先级**:每次 compact 后 / 新 session,**第一件事读这个文件**。

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

## 双 subagent 验证规则(每项必须遵守)

完成一项前:
1. 主 agent 跑完代码改动 + 真截图 / 真 telemetry 输出
2. 开 **subagent #1** — 看证据 + 找漏洞 + 给评分
3. 开 **subagent #2** — 独立看证据 + 找漏洞 + **不能复述 #1**,必须找新问题
4. 主 agent 处理两个 subagent 找到的问题
5. 重新跑证据 → 再开 1 次 subagent confirm 修了
6. 全过 → 改 checklist `[x]`

**subagent 找不到问题就是没用力** — 重开。

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

- [ ] **V1.1** context7 + web 搜业界 ribbon 视觉做法
  - 查:Niantic Lightship / Pokémon GO AR+ / Apple Measure / Snap Lens / Houdini ribbon / Unreal Niagara
  - 查:昼夜参数化 ribbon shader 业界做法
  - 查:LOD 距离衰减(近 hero / 中 mid / 远 fade)做法
  - PROOF:`_review/v0.2.4/research/V1.1-ribbon-research.md` 报告 + 至少 5 个业界源
  - 双 subagent 验:#1 看完整性,#2 看是否真有可复用洞见

- [ ] **V1.2** 5 type 粒子调研 — 怎么"凸显 type 本身"
  - 调研每个 type 的灵魂(cairn=石头堆 / danger=火星烟柱 / water=水珠涟漪 / hut=烛火炊烟 / junction=分叉箭头),不是抄 Three.js
  - 业界做法:RPG 战利品掉落特效 / 元素类 RPG / Genshin / 神庙逃亡
  - PROOF:`_review/v0.2.4/research/V1.2-type-particle-research.md`
  - 双 subagent 验

- [ ] **V1.3** 把 V1.1+V1.2 → 出 Unity 实施计划(每个 type 粒子 + 丝带 4 维变化)
  - 用户审,签字才能进 Phase V2
  - PROOF:`_review/v0.2.4/research/V1.3-unity-impl-plan.md`

### Phase V2 — 丝带(迭代式,一步一勾)

- [ ] **V2.1** Unity 现有 SilkRibbonV2.cs + RibbonSilkV2.shader 现状盘点
  - PROOF:报告每个参数当前值 + 改进点
  - 单 subagent 验

- [ ] **V2.2** 实现"脱离 + 渐入浅色 + 淡出"三段动画
  - 改 shader:lifetime 三段 alpha + color lerp
  - PROOF:Unity batch 渲染 GIF + HTML 同视角对比
  - 双 subagent 验视觉

- [ ] **V2.3** 实现"昼夜不同"
  - 加 _DayNightT uniform(OTA),0=深夜冷蓝,0.5=黄昏暖红,1=正午暖白
  - PROOF:3 个 _DayNightT 截图(0/0.5/1)+ Three.js 同时刻对比
  - 双 subagent 验

- [ ] **V2.4** 实现"近远不同 LOD"
  - 近 5m 全细节,中 5-15m 简化,远 >15m 只剩光柱
  - PROOF:3 个距离 GIF + telemetry 切换帧
  - 双 subagent 验

- [ ] **V2.5** 整合 V2.2+V2.3+V2.4 + 性能测真机评估(iPhone SE2 baseline)
  - PROOF:flipbook GIF + FPS log
  - 双 subagent 验 + 性能 review

### Phase V3 — 5 type 粒子加强(一个 type 一个 sub-item)

- [ ] **V3.1** cairn — 石头颗粒 + 尾迹 + 落地反弹涟漪
- [ ] **V3.2** danger — 火星 + 烟柱 + 闪烁
- [ ] **V3.3** water — 水珠 + 折射 + 落地涟漪
- [ ] **V3.4** hut — 烛火 + 炊烟 + 暖光晕
- [ ] **V3.5** junction — 分叉箭头 + 流光轨迹

每个 sub-item PROOF:Unity 截图 + Three.js 同 type 截图 + 加强后 vs 加强前自身对比 + 双 subagent 视觉验

### Phase V4 — 整体 capture + 用户审

- [ ] **V4.1** 改 V024CapturePlayground 用 NZ 暖白 #E8DCC4 底 + ACES tonemapping + 暖金地面 + 同色 fog
- [ ] **V4.2** 修右下穿帮红色三角(诊断根因)
- [ ] **V4.3** 跑完整 capture(5 type + ceremony + 远近视角)
- [ ] **V4.4** 拼 side-by-side GIF(HTML vs Unity 5 type × 多视角)
- [ ] **V4.5** 用户审 — 不通过回 Phase V2/V3

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
