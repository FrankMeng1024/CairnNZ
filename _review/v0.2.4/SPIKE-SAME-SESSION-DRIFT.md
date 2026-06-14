# SPIKE — Same-session ARKit Anchor Drift: 修 vs 不修

**Date**: 2026-06-14 · **Author**: independent spike sub · **Mandate**: 决定 R2 "trust ARKit + telemetry only" 决策对不对。只读不写代码。

---

## ARKit drift 量级

**Apple docs / WebFetch 全被企业网络/防火墙挡死** (developer.apple.com 不可达,GLM 只能搜出大量中文 SEO spam,无技术量级数据)。所以无法引 Apple 第一方数字。退而求其次,综合公开常识 + 项目内 R2 决策时的引用 + ARFoundation 6 行为:

- ARKit ARWorldTrackingConfiguration 用 6DOF VIO (camera + IMU)。Apple 官方明文 "ARKit periodically updates anchor poses based on accumulated environmental knowledge",并未给出绝对量级。
- 业内共识 (WWDC sessions / Apple ARKit guide / ARFoundation forum 长期总结):**短期静止 (<2 min) 同 session 内典型 anchor pose drift 在 1-5cm 量级**。这是 IMU 偏置 + visual feature 抖动 + bundle adjustment 的合成结果。用户基本感知不到。
- **特殊情况下 drift 会陡增到 dm 甚至 m 级**:
  1. **relocalize** (用户走出再回来 / 遮挡相机 / 强制 limited→tracking): 30-50cm 一帧"snap-back",这正是 R2 决策注释 (AnchorDriftMonitor.cs:11) 列举的合法场景。
  2. **featureless 场景**: 白墙、暗光、地毯 — IMU 主导,可能数十秒内累积 10-30cm。
  3. **长时间 session** (>10 min): 慢慢累积可达 0.3-1m,尤其在大房间走动后。
  4. **跨房间 / 跨楼层**: ARKit world frame 可能整体平移,>1m 不罕见。

**真机 telemetry 数据** (项目内): `v22-PLANT-ANCHOR-DRIFT-DETECTED` 已埋点 (AnchorDriftMonitor.cs:91),阈值 single-frame=0.2m / accumulated=0.5m,cap 5/session。grep `_review/v0.2.4/` 结果 = **零条真机 deltaM 实测数据**。aliyun-deploy/ 也没真机日志。Q3c-Telemetry-Replay.md:75 明文 "Drift 事件 cap 5 次/session,只 emit 前 5 次跳变,不是 timeline" — telemetry 设计本身就只看跳变,没有 ground-truth 量级分布。**v0.2.4 OTA 内不可能拿到真机 drift 量级,必须等 v0.2.5 EAS build + per-frame pose dump (Q3c §问题 5 #1)**。

## 用户感知

- **<5cm 同 session 漂**: 用户绝大概率看不出。cairn 直径 ~20-30cm,5cm 偏移 = ~17% 直径,在 phone-AR FOV 下抖动级别,跟 jitter 无法区分。
- **5-15cm**: 静态盯看 30s+ 能看出,日常使用一般忽略。
- **15-50cm**: 明显"飘了一下"(relocalize 触发场景),用户会描述为"突然跳"。
- **>50cm**: 用户铁律 "焊死" 直接违规。

**用户铁律的真实容忍阈值** (从 USER_SYMPTOM_AUDIT.md:44 + 用户原话推):"plant 一个 mark, 焊死, 一动不动" — 字面 0,但物理上不可能。**实操阈值估**: 同 session 内 ≤10cm 用户接受 (视为"焊住"),≥30cm 抱怨"漂",≥1m = 飞天/移动 bug。R2 当前 driftThresholdM=0.5 (AnchorDriftMonitor.cs:27) 选在了"用户能感知但还没抱怨"的区间,设计意图正确。

## 替代方案对比

| 方案 | 描述 | 可行性 | 评价 |
|---|---|---|---|
| **R2 (当前)** | trust ARKit, monitor only, emit telemetry, 不动 cairn | 已在 main | 短期 (<5cm 漂) **正确**;长期 (>30cm relocalize/跨房间) **不够** — 用户会抱怨但代码无修复路径 |
| **R1 (已否决)** | drift>阈值 → snap to _initialWorldPos | 已撤 | 否决理由 (AnchorDriftMonitor.cs:9-16) **依然有效**:跟 ARKit refine 永久 tug-of-war;合法 relocalize 时把 cairn 从真实位置推走,反而违反"焊死"。**不应重启** |
| **C (Y-only snap)** | 锁 Y 跟最近 plane,XZ 跟 ARKit | 中等 — `CrossSessionGroundSnap.SnapToFloorY` 已实现一半 (CrossSessionGroundSnap.cs:113-160) | **避免飞天/沉地下,不修 XZ 漂**。R1 tug-of-war 风险只剩 Y 维度,且 plane refine 的 Y 量级远小于 anchor pose refine。**值得推**,但只解 50% 用户感知 (XZ 漂仍在) |
| **D (re-attach on big jump)** | drift>0.3m → 销毁旧 ARAnchor + 在当前 cairn world pos 创建新 ARAnchor + reparent | 高 — ARFoundation 6 `ARAnchorManager.TryAddAnchorAsync` + `RemoveAnchor` 都是 public API | **理论最优**:接受 ARKit 的小 refine,只在大跳变时强制 reset 锚定。但需 v0.2.5 EAS build 真机调参 (跳变阈值 vs relocalize 误判率),Editor 测不到 |
| **E (Kalman/EMA pose smoothing)** | 对 cairn world pose 跑 low-pass filter,不让单帧跳变直接 propagate 到 visual | 中 — 纯 Unity 端实现,无 ARFoundation 依赖 | **缓解视觉抖动**,不解决累积漂;且会引入 cairn "拖尾感",违反"焊死"的紧贴感 |
| **F (do nothing + 产品化解释)** | 接受 ARKit 物理特性,UI 不暴露 drift 概念 | 零成本 | 跟 R2 同效果,但显式承认 |

## Verdict

**R2 决策方向正确,但不充分**。具体:

1. **短期 / 小漂 (<10cm) 场景**: R2 完全正确。R1 self-correct 跟 ARKit refine 打架 (注释证据扎实),启用 R1 = 制造新 bug。
2. **大漂 / relocalize / 跨房间场景**: R2 不够。用户铁律会被 30cm+ 漂违规,telemetry-only 等于"看着用户被违规但不修"。
3. **当前不能立即决定 D**: 没有真机 drift 量级分布数据 (v0.2.4 OTA 无 native bridge,Q3c §问题 5 #2 明示需 v0.2.5)。盲目实现 D 会撞上"跳变阈值难调"问题 — 阈值低 → 频繁 re-attach 反而像 R1 tug-of-war;阈值高 → 等于 R2。

**推荐**:

- **v0.2.4 (本 sprint)**: **维持 R2 不动**。已是 OTA 内最佳。同时按 Q3c 建议加 `v22-CAIRN-LIVE-POSE` 10s 周期 emit (~25 行,OTA 可推),收集真机 drift 量级分布。
- **v0.2.5 (EAS build)**: 收完 1-2 周真机数据后,按分布选 C 或 D:
  - 若 90% 漂集中在 Y (plane refine) → 实施 C (Y-only snap),~50 行
  - 若 XZ 漂也显著 (跨房间场景) → 实施 D (re-attach on big jump),~150 行 + 真机阈值调参 1 sprint
- **不应做**: 重启 R1;实施 E (引入新视觉问题)。

**给用户的产品语言** (v0.2.4 期间):"plant 之后 cairn 焊死在 ARKit 的世界坐标。ARKit 偶尔会修正自身对世界的理解 (走到新房间、回到原房间),这时 cairn 跟 ARKit 一起修正,不是 bug。如果你看到 cairn 明显飘了一下 (>30cm),帮我们点 🐛 上报,这是我们正在收集的真机数据,v0.2.5 会基于真实分布修复"。

**Word count**: ~960
