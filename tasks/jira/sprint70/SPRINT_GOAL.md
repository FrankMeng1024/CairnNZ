# Sprint 70 Goal — Friend System F4 (Memory tab)

**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` v4.2 final, §14 F4
**Sprint Phase**: Friend System v1 / 5 (F4 of F1-F5)
**Acceptance Mode**: auto

## Sprint Goal

Wire the Memory tab to subscribed-friend UNION fog, 5-pick paywall, and stranger Public mark display — landing every UI surface this Sprint while explicitly deferring the iPhone-only fog UNION render perf gate to F5 hardening (per SPIKE-67-1 verdict).

## Story List

| ID | Title | Type | Pts | Owner |
|----|-------|------|-----|-------|
| STORY-00539 | Memory tab Mine\|Friends toggle | Story | 3 | Frontend |
| STORY-00540 | 5-friend pick modal (6+ shows 🔒) | Story | 4 | Frontend |
| STORY-00541 | fog UNION render (DEFERRED — iPhone-only per SPIKE-67-1) | Story | 5 | Frontend (deferred) |
| STORY-00542 | Paywall sheet UI (TestFlight only) | Story | 3 | Frontend + UX |
| STORY-00543 | Stranger Public mark blurred icon | Story | 3 | Frontend |

Total: 5 Stories, 18 points (14 active + 5 deferred).

## Sprint capacity compliance

5 Stories ≥ 4 min. Capacity slot occupied by Story 541 is deferred but tracked.

## Critical gates

- Story 541 fog UNION: **DOES NOT block** F5. The visual surface is wired (Story-539); only the actual UNION polygon render on map waits for the iPhone FPS measurement gate from SPIKE-67-1. If FPS PASS on user device → land Story-541 in F5. If FAIL → activate Fallback A (per-friend translucent overlay).
- Story 542 Paywall: NO real IAP. UI sheet + "Coming soon" toast. v1.2 wires real IAP per v4 §12.
- Story 543 blurred icon: matches v4 §3 matrix row 4 "远观模糊 (不在 fog 内但在我 500m 周围)" — icon visible but ungrippable.

## DoD

- Memory tab has Mine|Friends toggle at the top
- 5-friend modal accessible via Friends mode; lists subscribed friends + lockable beyond 5
- Paywall sheet renders correctly when 6th friend tapped
- Stranger Public marks within 500m render dim icon (no sheet on tap)
- Story 541 reproducibly defers to F5 with iPhone evidence requirement noted