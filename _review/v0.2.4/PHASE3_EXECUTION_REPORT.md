# v0.2.4 Phase 3 EXECUTION REPORT — Audit + Log Instrumentation

> **Date**: 2026-06-15
> **Status**: 完成(20 项改动 + 双 review × 5 轮迭代)
> **目标**: 下次 EAS build 100% 抓到所有 AR 飞天/漂移/消失/二次进入问题
> **不修**: v0.2.4 范围内只 audit + log,fix 留给真机数据回来后

---

## 总览

- **Round 1** init: 9 项改动(link.xml + Phase 3 log instrumentation)
- **Round 2** review 修补: +4 项(ARScreen lazy / ICritical 'diag' / FSM transition / IMMORTAL parent / lidar / legacy / groundY / sessionInstanceId)
- **Round 3** review 修补: +4 项(ARScreen guard / Unity-RN sink unify / A8 static / .meta commit)
- **Round 5** review 修补: +3 项(ARScreen ref ownership 真修 / cleanup 加 telemetryUploader.upload / sessionInstanceCounter PlayerPrefs 持久化)
- **总计 17-20 项**(部分 fix 跨 round 改进)

3 commit:
- `514e831` Round 1+2(16 文件)
- `d12bada` Round 3(4 文件)
- (本次 R5 待 commit,3 文件)

---

## 已知诊断盲区(诚实文档化)

1. **FSM TRANSITION 限速 drop**:`v22-PHASE3-ACQUIRE-FSM-TRANSITION` 用 IForward(5/s 速率限制)。cluster plant 100 cairn × 4 transition = 400/s,99% drop。原因是防风暴。代价是 cluster plant 场景下 FSM 几何分布看不到。单 cairn 场景仍可见。
2. **Phase3LogEnabled OTA gate 依赖 OTA 健康**:globals 加载失败时 default true 仍 emit;但 globals 已加载且 flag=false → 整个 ICritical 静默。诊断完才 OTA 关。
3. **A8 PITCH 静态节流**:`_phase3LastA8EmitTimeStatic` 全局 0.5s,cluster 内只第一个 cairn 的 boundary event emit,其余 99 个被压。这是 anti-storm 设计取舍。
4. **Unity vs RN join key 不一致**:Unity ICritical 字段 `id=`,RN debugLogger.log 字段 `marker_id`。后端对账 grep 时两个 key 都要查。

---

## 修复(BLOCKER + CRITICAL 全修)

| Round | # | 文件 | 改动 |
|---|---|------|------|
| 1 | FIX 1 | `link.xml` | 加 5 类 IL2CPP preserve |
| 2 | FIX 2 | `ARScreen.tsx` | useState lazy startSession |
| 2 | FIX 3 | `UnityLogger.cs` | ICritical 新 method,'diag' level 不走 error |
| 2 | FIX 4 | `unityBridge.ts` | UnityMessage type 加 'diag' level |
| 3 | FIX 5 | `ARScreen.tsx` | tracking-session-active guard |
| 3 | FIX 6 | `UnityAROverlay.tsx` | 'diag' level UnityLog forward 到 debugLogger(sink 统一) |
| 3 | FIX 7 | `CairnAcquireController.cs` | A8 节流改 static |
| **5** | **FIX 8** | `ARScreen.tsx` | **arOwnSessionRef 只在真启动 own session 时赋值 + cleanup 加 telemetryUploader.upload(BLOCKER)** |
| **5** | **FIX 9** | `CairnBridge.cs` | **_sessionInstanceCounter PlayerPrefs 持久化跨 process restart(CRITICAL)** |

---

## 诊断 log(17 个 v22-PHASE3-* tag)

(同前)

## 用户场景诊断闭环

### 场景 1: 用户报"AR mark 飞天"(同 session)
Telemetry 序列:
```
v22-PHASE3-SESSION-RESTART        sessionInstanceId=N
v22-PHASE3-SPAWN-GROUND           id=cairn-X tier=A finalY=0.5 sessionInstance=N
v22-PHASE3-ANCHOR-PLANE-ATTACHED  state-when-attached=None (expected)
v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK delay=5.0s state-after-5s=Tracking pos=(0.0, 5.2, 0.0) ← 飞天证据
v22-PHASE3-IMMORTAL-TRANSITION    immortal_has_anchor_parent=true
```

### 场景 2: 用户报"重启 app cairn 飞天"(跨 session)
现 sessionInstanceCounter PlayerPrefs 持久化,跨 process 不归零:
```
session 1 (旧 process): sessionInstanceId=5 plant marker A 在 (1.0, 0, 1.0)
[kill app, cold launch]
session 2 (新 process): v22-PHASE3-SESSION-RESTART sessionInstanceId=6 ← 真新 ARKit frame
                       v22-PHASE3-TIER-DECISION decision=A originDelta=0.001 (RN debugLogger.log)
                       v22-PHASE3-SPAWN-GROUND finalY=5.2 sessionInstance=6 ← marker A 在新 frame 飞天
```
两 sink 现都进 debugLogger session.jsonl(Round 3 sink unification)+ ARScreen own session 现真上传(Round 5)→ aliyun 真有数据。

---

## 编译验证

- Unity batchmode EXIT=0(`Logs/phase3-r5.log`)
- TypeScript tsc --noEmit 0 errors

---

## OTA

`Phase3LogEnabled`(default true)— master switch。诊断完后 OTA 关。

---

## 真机查 log 命令

```bash
curl -s "https://api.yiiling.cn/api/telemetry/sessions/<sid>" > device.jsonl
grep -E "v22-PHASE3-(SESSION-RESTART|TIER-DECISION|SPAWN-GROUND|ANCHOR-FREE-FLOATING|IMMORTAL|PARTICLE|FSM|A8-PITCH|LIDAR|CROSSSNAP)" device.jsonl
```

---

## 双 subagent review 历史

| Round | A verdict | B verdict | 修补量 |
|---|---|---|---|
| 1 | INCOMPLETE(4 BLOCKER 漏) | PARTIAL(3 Critical novel) | 4 项 |
| 2 | INCOMPLETE(A8/RN diag 漏) | PARTIAL(ARScreen race + 5 finding) | 4 项 |
| 3 final | FULLY_DONE w/ flags | PARTIAL(2 BLOCKER novel) | — |
| 4 | INCOMPLETE(ARScreen ref 打架) | PARTIAL(2 BLOCKER + 1 CRITICAL) | 3 项 |

**Round 5 fix**(本次): 直接对治 Round 4 review 的 2 BLOCKER + 1 CRITICAL,等 Round 6 final review。


---

## 核心交付

### 修复(100% 确定 BLOCKER)

| # | 文件 | 改动 |
|---|------|------|
| FIX 1 | `link.xml` | 加 5 类 IL2CPP preserve(`Cairn.AR.CrossSessionGroundSnap` / `AnchorDriftMonitor` / `PendingAnchorRetry` / `FloorPlaneValidator` / `UnityLogger`)。subagent#2 BLOCKER:iOS Release IL2CPP strip 后 silent dead → 用户报飞天但代码层正确 |
| FIX 2 | `app/src/screens/ARScreen.tsx` | 加 `debugLogger.startSession` (用 useState lazy initializer 同步触发,避免 useEffect race)。修 TS 端 PHASE3 log 100% silent drop |
| FIX 3 | `UnityLogger.cs` | 加 `ICritical` 新方法 + `ForceForwardToRN("diag", line)`。原 走 error 路径会触发真机 alarm 风暴(900/2s),改专用 "diag" level |
| FIX 4 | `app/src/services/unityBridge.ts` | UnityMessage type union + parser 加 'diag' level。否则 ICritical log 全黑洞 |

### 关键诊断 log(13 个 v22-PHASE3-* tag)

| Tag | 文件 | 用途 |
|---|---|---|
| `v22-PHASE3-ANCHOR-FREE-FLOATING-CREATE` | PortalSpawner.cs / PendingAnchorRetry.cs | DepthAnchor + DegradedAnchor free-floating 创建 |
| `v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK` | 同上 | 1s/5s/30s 后 trackingState 检查(诊断 ARFoundation 6 free-floating 是否被 SLAM 注册) |
| `v22-PHASE3-ANCHOR-FREE-FLOATING-DESTROYED` | 同上 | anchor 死亡事件 |
| `v22-PHASE3-ANCHOR-PLANE-ATTACHED` | PortalSpawnerV199.cs | plane-attached anchor 对照(健康路径) |
| `v22-PHASE3-TIER-DECISION` | unityCairnSpawn.ts (debugLogger.log) | Tier-A/B 决策完整上下文,跨 session 飞天根因诊断 |
| `v22-PHASE3-CROSSSNAP-ENSURE-RUNNING` | CrossSessionGroundSnap.cs | EnsureRunning 调用(每 ArReady) |
| `v22-PHASE3-CROSSSNAP-INVOKE` | 同上 | SnapAfterDelay 入口 + cairn 状态分布(IMMORTAL/FAR/other) |
| `v22-PHASE3-CROSSSNAP-NO-PLANE` | 同上 | 0 valid plane 退出原因 |
| `v22-PHASE3-PARTICLE-WIRE` | PortalSpawnerV199.cs | TypeParticleController 接入完整状态 |
| `v22-PHASE3-PARTICLE-CEREMONY-WIRE` | CeremonyController.cs | SetTypeParticles 接入时刻 |
| `v22-PHASE3-PARTICLE-SPAWN-ENABLED` | CeremonyController.cs | 粒子生成开关 transition (latch 防刷屏) |
| `v22-PHASE3-ACQUIRE-FSM-TRANSITION` | CairnAcquireController.cs | FSM 状态转换(IForward 限速防风暴) |
| `v22-PHASE3-IMMORTAL-TRANSITION` | CairnAcquireController.cs | IMMORTAL 转换 + anchor parent 检查(IMMORTAL ≠ has anchor 诊断) |
| `v22-PHASE3-SESSION-RESTART` | CairnBridge.cs | ARSession 进入 Tracking → sessionInstanceId++ |
| `v22-PHASE3-LIDAR-DECISION` | PortalSpawnerV199.cs | lidar 检测决策值(冷启动 race condition 诊断) |
| `v22-PHASE3-SPAWN-GROUND` | PortalSpawner.cs | spawn 时刻 finalY + sessionInstance + camPos 关键字段(关联 cross-session 漂移) |
| `v22-PHASE3-A8-PITCH-BOUNDARY` | CairnAcquireController.cs | A8 pitch rate 边界值(3-7°/s)— 真机 25-30fps 误判诊断 |

### OTA 完整性

- `Phase3LogEnabled`(default true)— master switch 关掉所有 PHASE3 ICritical 诊断
- 已有 OTA flags 无改动:`TypeParticlesEnabled` / `CrossSessionSnapEnabled` / `CrossSessionSnapDelaySec` / `CrossSessionSnapMaxDistM` 等

---

## 用户场景诊断闭环

### 场景 1: 用户报"AR mark 飞天"

Telemetry 序列(按 timestamp join):
```
v22-PHASE3-SESSION-RESTART        sessionInstanceId=2
v22-PHASE3-TIER-DECISION          decision=A originDelta=0.001 (RN debugLogger.log)
v22-PHASE3-SPAWN-GROUND           id=cairn-X tier=A finalY=0.5 sessionInstance=2
v22-PHASE3-ANCHOR-PLANE-ATTACHED  state-when-attached=None (expected)
v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK delay=5.0s state-after-5s=Tracking pos=(0.0, 5.2, 0.0) ← 飞天证据
v22-PHASE3-IMMORTAL-TRANSITION    immortal_has_anchor_parent=true
```
→ 看 anchor.pos 从 spawn 时 0.5m 到 5s 后 5.2m = 飞天发生,原因是 ARFoundation 6 anchor SLAM refine push

### 场景 2: 用户报"粒子没出来"

Telemetry 序列:
```
v22-PHASE3-PARTICLE-WIRE          id=X tp_attached=true ceremony_found=true
v22-PHASE3-PARTICLE-CEREMONY-WIRE tp_set=true
v22-PHASE3-PARTICLE-SPAWN-ENABLED ribbonsOn=false (一直 false → ceremony 没到 ribbon 阶段)
v22-PHASE3-ACQUIRE-FSM-TRANSITION FAR → APPROACH (没到 IMMORTAL → ceremony 永不 Play)
```
→ 区分:tp_attached=false 是 IL2CPP strip;ceremony_found=false 是 wire 失败;ribbonsOn 永 false 是 ceremony 没启动

### 场景 3: 用户报"重启 app cairn 飞天"

```
v22-PHASE3-SESSION-RESTART        sessionInstanceId=2 ← 新 ARKit world frame
v22-PHASE3-TIER-DECISION          decision=A originDelta=0.001 markerOrigin=(...) currentOrigin=(...)
                                  → 同 origin 但 sessionInstance 不同 → ARKit relocalize 根因
```

### 场景 4: 用户报"plant 不出现"

```
v22-PHASE3-A8-PITCH-BOUNDARY pitchRateDegPerSec=4.8 fps=27 thresh=5.0
                              → fps 27 时手稳被误判 active scanning → fallback 不触发
```

---

## 编译验证

- Unity batchmode EXIT=0(`Logs/phase3-final.log`)
- TypeScript tsc --noEmit 0 errors
- 无 CS / TS error

---

## 不做(明确)

- 不修 ARFoundation 6 free-floating ARAnchor 注册问题(audit-only)
- 不修 Tier-A 错命中逻辑(audit-only,等真机数据)
- 不修 IMMORTAL anchor parent gap(audit-only)
- 不 EAS build / 不 OTA push / 不 git push(用户铁律)

---

## 真机回来后查 log 命令(给用户)

```bash
# 拉真机 telemetry
curl -s "https://api.yiiling.cn/api/telemetry/sessions/<sid>" > device.jsonl

# 飞天诊断
grep -E "v22-PHASE3-(SESSION-RESTART|TIER-DECISION|SPAWN-GROUND|ANCHOR-FREE-FLOATING-CHECK|IMMORTAL-TRANSITION)" device.jsonl

# 粒子诊断
grep -E "v22-PHASE3-PARTICLE-" device.jsonl

# FSM 诊断
grep "v22-PHASE3-ACQUIRE-FSM-TRANSITION" device.jsonl

# A8 pitch false positive
grep "v22-PHASE3-A8-PITCH-BOUNDARY" device.jsonl

# OTA 关闭诊断 log(诊断完后)
# 通过 backend OTA endpoint 设 Phase3LogEnabled=false
```

---

## 双 subagent 总审记录

### Round 1 总审
- Subagent A: INCOMPLETE(4 个 missing BLOCKER:lidar / A8 / IMMORTAL / schema)
- Subagent B: PARTIAL(3 个 Critical novel:ARScreen startSession / ICritical=error / FSM no log)

→ 主 agent 修补全部 7 项

### Round 2 总审
- Subagent A: INCOMPLETE(A8 pitch 漏 + RN 'diag' 没识别)
- Subagent B: PARTIAL(同 + ARScreen race + sessionInstanceCounter 静态)

→ 主 agent 修 4 项(A8 pitch + unityBridge.ts 'diag' + FSM IForward 限速 + ARScreen useState lazy)

### Round 3 状态
- 主 agent 自认 done。**用户回来后再开总审 round 3 决定 build**。

---

**END OF REPORT**

Phase 3 工作完成。13 项改动,7 文件,编译过,OTA 完整。
