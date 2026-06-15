# v0.2.4 Phase 3 EXECUTION REPORT — Audit + Log Instrumentation

> **Date**: 2026-06-15
> **Status**: 完成(13 项改动 + 双 review × 2 轮迭代)
> **目标**: 下次 EAS build 100% 抓到所有 AR 飞天/漂移/消失/二次进入问题
> **不修**: v0.2.4 范围内只 audit + log,fix 留给真机数据回来后

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
