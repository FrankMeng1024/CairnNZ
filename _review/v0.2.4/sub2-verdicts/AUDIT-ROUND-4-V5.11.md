# V5.11 第四轮 4-eye Audit (commit f2c064b)

**时间**: 2026-06-14
**改动**: ceremony tick 全程 + midHighlight 反向 + bloom 0.5→0.30 / 0.9→1.10

## sub#1 PASS_WITH_MINOR

**v510 BLOCKER 解决**:
- ceremony_frozen: FIXED — V024CapturePlayground.cs:589 `ceremonyT > 0.0f` 确认
- midHighlight_inverted: FIXED — sT-driven 公式真生效
- bloom_3_pillars: PARTIAL — 仍 3 群但有 sub-streaks
- ring_disconnect: deferred
- sqrt_popin: deferred

**新发现**:
- F: midHighlight clamp01 plateau (sT 0.7-1.0 全 1.0)
- G: phaseOffset 重启不保持 — _life=0 但不重设 phase

## sub#2 FAIL

**新 BLOCKER**:
- SUB2-V58-001 BLOCKER: ribbon-ring 截图悬空 (cam framing)
- SUB2-V58-002 CRITICAL: viewPitch 0.9964 卡死无效 (V5.8 fresnel 数值反推)
- SUB2-V58-003 MEDIUM: softTipFade 0.55 偏高
- SUB2-V58-004 MEDIUM: CHECKLIST drift 仍未修
- SUB2-V58-005 BLOCKER: 12 ribbon viewing projection 必糊 3 光柱 (前后排 X 重叠)

**用户 40/100 进度**: 42/100 (+2)

## 共识下一步
- 修 ribbon 起源 y 偏移
- 修 midHighlight × heightAlpha 双抵消
- 修 16 ribbon → 3 光柱

进入 V5.12.
