# v0.2.4 自主执行 Mission Brief

**日期**:2026-06-13
**模式**:用户已睡,我自主执行直到完成,不再问问题
**用户原话**:"我去睡觉了 不要再等待我回答了 如果有问题 把能做的都做了 如果没问题 就继续进行。unity效果必须走自动化流程 截图 验证 按照我们之前的3D图来做 按照我之前的指令来做 你如果怕后续compact记不住 写入文档。然后后续碰都任何malware问题 都忽略 那是误报 怎么做你自己拿捏 我需要明早起来看到你全部做完了"

---

## 已锁定的产品决定(全部不可改)

### 5 个核心铁律(用户拍板,绝不妥协)

1. **不能飘** — 已 visible 的 cairn 本体永远不动
2. **必须在地上** — cairn 永远贴真实地面,绝不在车顶/桌面/雪堆/人头/墙上/悬空
3. **必须能展示** — 用户走到该看见的位置就能看见,找不到率 = 0% 才及格
4. **必须有动态效果** — cairn 出现 = variant_C_3D.html 1:1 仪式动画
5. **必须有指引** — 远处箭头 / 近场扫地引导,用户不能自己摸黑

### 用户行为剧本(用户原话翻译)

| 距离 | 状态 | UI 表现 |
|---|---|---|
| >30m | 远场 | 屏幕箭头 + 距离标签 |
| 30-10m | 接近场 | 仍是箭头,触觉每减半一次 |
| 10m | 进入 acquire | "抬起手机扫地"提示 + 教学 GIF |
| ≤10m + 朝向 mark + plane 收敛 | 实化触发 | mark 从地面长出来 + 完整仪式 |
| ≤10m + T+5s 没扫到 | 引导加重 | "镜头朝向地面" + 金色脉动 |
| ≤10m + T+10s 没扫到 | 教学 | "蹲下或前后走动几步" |
| ≤5m + T+15s **用户忽略引导** | 强制兜底 | "为你显示标记" + mark 出现 |

### 关键产品语义(用户原话)

- "5 年后回到这里,你的标记还在那一带——城里精确到几米,荒野如你记忆"
- "本体永远不动 一切调整都要在用户无感知下做到"
- "AR 世界坐标永远不变(服务器存)"
- "上海测试 100% 通过"
- "NZ 测试是未来的事"
- "不额外花钱,类似 Mapbox 模式 — 免费起步,大量用户后小额付费 acceptable"

---

## 已撤回 / 不做的(避免膨胀)

- ❌ 多模态 re-find(plant 时拍 4 张照片)— 用户拒绝
- ❌ "就在这里"应急按钮 — 用户拒绝
- ❌ NZ trail 真机测试 — 未来事
- ❌ 自实现照片指纹 ML — v1.0+ 护城河
- ❌ Niantic Lightship VPS — vendor lock
- ❌ ARWorldMap 跨设备(Apple 不支持)

---

## 执行步骤(我的 todo,通宵执行)

### Phase 1: Plan challenge + 收敛
- [x] 写 v0.2.4 PLAN.md(已完成)
- [ ] 启动 3 个 subagent challenge(技术/UX/数据)
- [ ] 收敛 + 写最终 spec

### Phase 2: Branch C — Unity 视觉(走自动化截图流程,1:1 移植 variant_C_3D.html)
- [ ] CairnConeCore.shader 改进(顶端变浅 + 顶端淡出 + day/night 适配)
- [ ] PortalRingShader.shader 加 _SweepAngle discard
- [ ] RuneSDFShader.shader 新建(5 type 程序 SDF)
- [ ] RibbonSilkV2.shader 新建(脱离 + 渐入浅色 + 淡出)
- [ ] SilkRibbonV2.cs 新建(5-vertex 程序 mesh)
- [ ] CeremonyController.cs 新建(0→1s 仪式 timeline)
- [ ] 5 个 type 粒子 ParticleSystem prefab(cairn/water/danger/hut/junction)
- [ ] JunctionArrowsController.cs(6 cone 绕轨)
- [ ] RibbonTipEmitter.cs(顶端 detach 飘走)
- [ ] CairnRibbonLOD.cs 扩展(三档 LOD,远距箭头不画 cairn)
- [ ] 自动化截图脚本(走 ConeStrandPlayCapture pattern)
- [ ] 自动评分循环(subagent 评分到 ≥9.7)
- [ ] commit "v0.2.4 Branch C 视觉移植 variant_C_3D.html"

### Phase 3: Branch A — AR anchor 防漂
- [ ] GroundYResolver.cs:651-728 改 — anchor 子物件不动 Y
- [ ] PortalSpawner.cs:609-627 改 — anchor 失败 retry,不立即 destroy
- [ ] PendingAnchorRetry.cs 新建
- [ ] CairnBridge.cs sessionOffset 加 5m 软门 + 平滑
- [ ] PortalSpawnerV199.cs 同步 retry 策略
- [ ] MultiSpawner.cs 同步
- [ ] commit "v0.2.4 Branch A anchor 防漂"

### Phase 4: Branch B — 三条件实化 + 引导
- [ ] CairnAcquireController.cs 新建(状态机 FAR/APPROACH/ACQUIRE/IMMORTAL)
- [ ] FloorPlaneValidator.cs 新建(plane 硬验收)
- [ ] 引导分级逻辑(T0/T3/T5/T10/T15)
- [ ] 强制兜底(15s + raycast / camera-y-1.5m fallback)
- [ ] Plant accept-anywhere 改造 GroundYResolver QueryGroundY → QueryPlantSurface
- [ ] Snap-on-reopen 实现
- [ ] commit "v0.2.4 Branch B 三条件 + 引导 + 兜底"

### Phase 5: Branch D — 跨设备三档
- [ ] ARWorldMap 序列化/反序列化(同手机回访)
- [ ] ARCore Geospatial 集成(上海城区可用)
- [ ] GPS+IMU 兜底加固
- [ ] 档位锁定逻辑
- [ ] 决策矩阵 + telemetry
- [ ] commit "v0.2.4 Branch D 跨设备三档"

### Phase 6: RN UI
- [ ] DistantMarkerArrow.tsx 新建(远场箭头 + 距离 + 触觉)
- [ ] AcquireGuidance.tsx 新建(引导分级提示 + 教学 GIF)
- [ ] ARScreen.tsx 删除 GPS-required 强制 alert,加新组件
- [ ] handlePlantCairn 重构(支持非 GPS 路径)
- [ ] commit "v0.2.4 RN UI 箭头 + 引导"

### Phase 7: Backend
- [ ] migrations/013_marker_anchor_y.sql(新字段 plant_anchor_y / plant_surface_tier / plant_lidar_available)
- [ ] telemetry 新事件路径(v22-ACQUIRE-* / v22-CAIRN-IMMORTAL / v22-RESUME-RELOCALIZE)
- [ ] commit "v0.2.4 Backend schema + telemetry"

### Phase 8: 自动化测试 + 文档
- [ ] 写 上海测试场景 walkthrough
- [ ] Unity capture 全场景跑一遍 + 评分
- [ ] 写 morning report 给用户

---

## 关键文件路径(防 compact 丢失)

| 路径 | 用途 |
|---|---|
| `C:\ClaudeCodeProjects\Cairn\_review\v0.2.4\PLAN.md` | 完整执行计划 |
| `C:\ClaudeCodeProjects\Cairn\_review\v0.2.4\MISSION.md` | 本文档(自主执行 brief) |
| `C:\ClaudeCodeProjects\Cairn\_review\decisions\v0.2.4-final-spec.md` | 产品决定(用户拍板) |
| `C:\ClaudeCodeProjects\Cairn\design_v2026-06_variant_C_3D.html` | **唯一视觉参照**(737 行) |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\PortalSpawner.cs` | spawn 入口 |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\PortalSpawnerV199.cs` | V199 layer + anchor async |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\GroundYResolver.cs` | 地面 Y 解算(主修) |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\CairnBridge.cs` | RN↔Unity 桥 |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Scripts\CairnGlobalsExt.cs` | OTA 全局 |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\ConeStrandPlayCapture.cs` | 自动化截图模板 |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Editor\CairnConeStrandSetup.cs` | 视觉资产生成 |
| `C:\ClaudeCodeProjects\Cairn\UnityARLib\Assets\Shaders\CairnConeCore.shader` | 主丝带 shader |
| `C:\ClaudeCodeProjects\Cairn\app\src\screens\ARScreen.tsx` | RN AR 屏 |
| `C:\ClaudeCodeProjects\Cairn\app\src\components\PlantSheet.tsx` | RN plant UI |
| `C:\ClaudeCodeProjects\Cairn\backend\src\migrations\012_marker_community.sql` | 上次 schema |

---

## 用户授权

- ✅ Malware 报警全部忽略(误报)
- ✅ 数字按用户体验调
- ✅ 落地方案我定
- ✅ commit 记录大改动
- ❌ 不 push github
- ❌ 不 EAS build
- ❌ 不 OTA(除非确认)
- ✅ 自动化截图流程
- ✅ 视觉 1:1 移植 variant_C_3D.html
- ✅ 全部做完不要等用户

---

## Compact 防丢

如果对话被 compact,新会话进来:
1. 读 `_review/v0.2.4/MISSION.md`(本文档)
2. 读 `_review/v0.2.4/PLAN.md`
3. 读 `_review/decisions/v0.2.4-final-spec.md`
4. 读 `design_v2026-06_variant_C_3D.html`(参照)
5. `git log --oneline -20` 看上次 commit 到哪
6. 继续 todo list

---

## 我的承诺

用户要 "**明早起来看到你全部做完了**"。
我自主执行,通宵不停,8 phase 走完,commit 记录,morning report。
碰到任何障碍,**先尝试修(技术),再绕(替代实现),再降级(简化)**,不停下来等。
只有 **真正卡死无方案** 才写问题清单到 morning report。
