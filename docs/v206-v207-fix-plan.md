# v206 + v207 修复总计划（基于 baseline + design 三方 subagent 结论）

## 关键洞见：双 GroundY pipeline 是主因

- Cairn 有两套 GroundY：RN-side `groundYRef.current` 和 Unity-side `GroundYResolver`
- Unity-side **无条件覆盖** RN data.y（PortalSpawner.cs:357-361 + MultiSpawner.cs:166）
- 所以 B1（RN groundY 政策）的影响有限——Unity 反正会用 `camera.y - ASSUMED_HOLD_HEIGHT` 替换
- **B3 ASSUMED_HOLD_HEIGHT=1.5m 才是用户看到的"不贴地"+"飞天"主因**

## 阶段 A：v206 OTA-deliverable（无需 EAS build）

| ID | 修复 | 文件 | OTA |
|---|---|---|---|
| A1 | BULK-EMPTY-BURN：drop `markers.length===0` 条件 + 加 emptyMarkerFrameCountRef 诊断 breadcrumb | UnityAROverlay.tsx:495-498 + new ref | ✅ |
| A2-1 | AROrigin reactive：`useMarkerStore(s => s.arOrigin)` | ARScreen.tsx:1039 | ✅ |
| A2-2 | OnSetSessionOffset 重发：lastSentOriginRef 替代 offsetSentRef，arOrigin null→persisted 时重发 | UnityAROverlay.tsx:444-467 | ✅ |
| B1 | RN PlaneDetected 加 area-weighted gating + 监听 Unity GroundYResolver locked Y 日志反向 sync | UnityAROverlay.tsx:389-409 | ✅ |
| OTA-DEFAULTS | OTA 数值 hotfix：FarShaftEnabled=false（mitigation）, ConfidenceRingAlphaUni=0.3, AssumedHoldHeight=1.3（如果 B3 OTA 暴露完成后），SummonRiseDistance=0.1, SummonDuration=0.15 | OtaConfig defaults | ✅ |
| OTA_VERSION | 205 → 206 | OtaBadge.tsx | ✅ |

## 阶段 B：v207 EAS build（Unity binary 改动）

| ID | 修复 | 文件 |
|---|---|---|
| B2-late | 将 RegisterCairn 移到 SpawnStrandInternal 早期；初始 currentY = data.y；前 6 帧强制 requery | PortalSpawner.cs:357 + 565 |
| B2-slow | LERP 自适应：\|delta\|>0.15m instant snap；0.05-0.15m FAST 2.5m/s；<0.05m SLOW 1m/s | GroundYResolver.cs:42 + 256-265 |
| B2-summon | Summon 推迟到 OnFirstLock 触发后再启动（或 1.5s timeout fallback） | PortalSpawnerV199.cs:167-181 |
| B3-OTA | ASSUMED_HOLD_HEIGHT 改成 OTA 可调 property（CairnGlobals.GetForType "AssumedHoldHeight" 默认 1.3） | GroundYResolver.cs:37 + 91 |
| B3-policy | TierC 不再无条件覆盖 data.y：仅在 TierA 或 data.y 不合理（>3m from camera）时覆盖 | PortalSpawner.cs:357 + MultiSpawner.cs:166 |
| C-gate | AttachFarShaft 加距离 gate：dist < FarShaftMinDist 时 skip spawn | PortalSpawnerV199.cs:409 |
| D1 | BuildPebble Y 改 derived 数学：halfL=0.11, halfM=0.08, halfS=0.05, Y = 累积底部 | PortalSpawnerV199.cs:241-243 |
| D2-curl | WispCurlStrength 绑 _CairnGlobalCurlStrength + RibbonStrandShader vert 乘进 _CurlAmp | CairnGlobalsExt.cs:92 + RibbonStrandShader.shader |
| D2-ribbon | HeroRibbonCurl 接通：MeshRibbonStrand 加 curlAmp 字段 + ApplyMpb SetFloat | MeshRibbonStrand.cs + PortalSpawnerV199.cs:401 |
| D2-killsw | 5 个 kill-switch 接通：V199LayerEnabled / RuneTextEnabled / PebbleStackEnabled / TypeChipEnabledOTA / AnchorAttachEnabled | PortalSpawnerV199.cs：AddV199Layers, AttachRuneText, AttachPebbleStack call sites, TryParentToAnchor |
| D2-dup | 删除 ConfidenceRingAlpha / ScanGridPulseHz / ScanGridHexSize 重复注册 | CairnGlobalsExt.cs |
| E-fade | ConfidenceRingShader frag：基于 _CairnGlobalArConfidence 做 fade-out（confidence > 0.7 时基本不可见） | ConfidenceRingShader.shader |
| E-radius | AttachConfidenceRing localScale 1.2 → 0.9 | PortalSpawnerV199.cs |
| E-distfade | ConfidenceRingFader 组件：距离 < 0.8m 时 alpha = 0 | new MonoBehaviour |

## 阶段 C：dynamic-runtime verify（所有 ship 后必跑）

实测 6 个用户 case，每个 case 收集屏幕录制：
1. 冷启动开 AR → 等 5s → 关 → 5s 内重开（A1 BULK-EMPTY-BURN）
2. plant 5 个不同 type 的 cairn → 检查 add-done log 中 pebble/runeText/ribbon 都是 True
3. plant 后远离 5m → 走回来 → confidence ring 应该在距离 > 2m 才出现
4. 不同 plant 的 groundY（RN ground vs Unity locked Y）应该 < 0.05m delta
5. 标记 spawn 后视觉上无"飞天 → 落地"动画
6. FarShaft 不在 6m 内出现
