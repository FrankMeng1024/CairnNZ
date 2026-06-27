# Sprint 71 Goal — Friend System F5 (Hardening — iPhone-gated)

**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` v4.2 final, §14 F5
**Sprint Phase**: Friend System v1 / 5 (F5 of F1-F5)
**Acceptance Mode**: auto (Mode 2) — but this Sprint has explicit iPhone-only gates

## Sprint Goal

Land the iPhone-only verification gate that Sprints 67–70 deferred: live FPS on fog UNION (SPIKE-67-1), real-device visual review of every Friend System surface, and TestFlight build. Then close v1.

## Story List

| ID | Title | Type | Pts | Owner |
|----|-------|------|-----|-------|
| STORY-00544 | 18 Playwright scenarios from v4 §9 (web-runnable subset) | Story | 5 | QA + Frontend |
| STORY-00545 | iPhone real-device visual review (every Friend System surface) | Story | 8 | QA + user |
| STORY-00546 | fog UNION live FPS test + Story-00541 implementation | Story | 5 | Frontend + Arch |
| STORY-00547 | Performance acceptance: 5-friend fog UNION < 3s | Story | 3 | Arch |
| STORY-00548 | TestFlight build + Paywall acceptance + Virtual User score | Story | 5 | DevOps + PO |

Total: 5 Stories, 26 points.

## Critical gates (per `feedback_unity_visual_test` + SPIKE-67-1)

**Cannot run in current workflow env (Windows, no iOS device)**:
- Story-545 visual review — user iPhone required
- Story-546 fog UNION live FPS — SPIKE-67-1 explicit gate; user iPhone required
- Story-547 perf acceptance — user iPhone required (Chrome DevTools tracing on real device)
- Story-548 TestFlight build — requires Mac + Apple Developer cert; user-driven

**Can run in workflow env**:
- Story-544 — Playwright web scenarios; subset of v4 §9's 18 scenarios that don't depend on Mapbox iOS or live GPS

## DoD (when user runs the gates)

- 18 v4 §9 scenarios green (web subset auto-verified; iPhone subset user-verified)
- iPhone visual review: every Friend System surface (Mark create toggle, Detail Sheet 4 forms, Trails Flags + Routes Friends sub-tabs, Memory tab Mine|Friends, Friend pick modal, Paywall, Stranger blurred icons) matches design intent
- fog UNION FPS ≥ 50 at z=14 with 5 friends OR Fallback A (per-friend overlay) activated
- Memory tab perf: 5-friend UNION < 3s wall-clock from scope-toggle to first paint
- TestFlight build uploaded; user installs; Virtual User runs walkthrough; score ≥ 9.5/10 → ACCEPTED; project v1 COMPLETE

## When this will run

User-initiated. Workflow agent prepares scripts + docs; user executes on iPhone.
