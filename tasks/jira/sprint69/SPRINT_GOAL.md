# Sprint 69 Goal — Friend System F3 (Route + Trails)

**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (v4.2 final, §3 + §10 + §14 F3)
**Sprint Phase**: Friend System v1 / 5 (F3 of F1-F5)
**Acceptance Mode**: auto (per PROJECT_STATE.md)

## Sprint Goal (one sentence)

Extend the Friend System visibility model from Marks to Routes + Trails — Route create UI gains a Personal|Friend toggle (default Friend), Trails Activities stay Mine-only, Trails Flags and Routes get a Mine|Friends sub-tab driven by the existing iron-law visibility.

## Story List

| ID | Title | Type | Pts | Owner |
|----|-------|------|-----|-------|
| STORY-00535 | Route create UI: visibility toggle (default Friend) | Story | 3 | Frontend |
| STORY-00536 | Trails Activities stays Mine-only (no Friends sub-tab) | Story | 2 | Frontend + UX |
| STORY-00537 | Trails Flags Mine|Friends sub-tab + circle markers consume | Story | 5 | Frontend |
| STORY-00538 | Trails Routes Mine|Friends sub-tab + circle routes consume | Story | 4 | Frontend |

Total: 4 Stories, 14 points.

## Critical gates

- v4 plan §10: Activities = Mine only (no Friend sub-tab). Bind explicitly — do NOT add a Friends sub-tab to Activities.
- v4 plan §10: Flags + Routes = Mine | Friends. Friends sub-tab consumes Sprint 67 `GET /api/circle/markers` + `GET /api/circle/routes`.
- Permission persistence reuses Sprint 67 STORY-00528 fix (Route model now stores permission='friend').
- Route create UI uses the same chip pattern as Mark (Sprint 68 STORY-00530) — visual parity.

## Dependencies

- Backend endpoints: Sprint 67 STORY-00528 — `GET /api/circle/markers` + `GET /api/circle/routes` (already live).
- Mark visibility helpers: Sprint 68 STORY-00531 (`markTier.ts`) + STORY-00532 (`markVisibility.ts`) reusable for Trails filter logic.
- This Sprint also closes the Sprint-68 follow-up "wire loadCircleMarkers" inside Stories 537/538.

## Definition of Done

- Route create UI has 2 chips (Personal + Friend), default Friend; no Public option
- Trails Activities tab has NO Friend sub-tab (intentional)
- Trails Flags tab: Mine | Friends sub-tab; Friends fetches `/api/circle/markers` and renders subscribed-friend friend-tier marks
- Trails Routes tab: Mine | Friends sub-tab; Friends fetches `/api/circle/routes` and renders subscribed-friend friend-tier routes
- Anonymization respected: Public marks in Friends-tab show no author (defense in depth — backend nulls server-side)
- All sub-tabs accept 0-result state (empty list with helpful copy)
- Arch + QA subagent reviews PASS

## Out-of-scope

- Memory tab (F4)
- Like/Report on the Trails-tab list (only available inside MarkDetailSheet from Map tap)
- Live device verification — F5 hardening Sprint
