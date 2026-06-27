# Sprint 68 Goal — Friend System F2 (Mark UI + Interaction + Like/Delete)

**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (v4.2 final, §3 + §4.11 + §4.12)
**Sprint Phase**: Friend System v1 / 5 (F2 of F1-F5)
**Acceptance Mode**: auto (per PROJECT_STATE.md)

## Sprint Goal (one sentence)

Land the user-facing Mark surface for Friend System v1: tri-tier visibility on create, tier-aware visual treatment, the 4-form Detail Sheet, fake Like/Report UI, dual-semantic Delete, and Hide-from-me with client-side cache wipe.

## Story List

| ID | Title | Type | Pts | Owner |
|----|-------|------|-----|-------|
| STORY-00530 | Mark create UI: visibility toggle (default Friend) | Story | 3 | Frontend |
| STORY-00531 | Mark visual treatment: self / friend-ringed / stranger-gray | Story | 5 | Frontend + UX |
| STORY-00532 | Detail Sheet 4 forms (§4.11 A/B/C/D) | Story | 5 | Frontend + UX |
| STORY-00533 | Like/Report UI (no API wire) + Delete dual-semantic | Story | 3 | Frontend |
| STORY-00534 | Hide-from-me flow + client-side cache wipe | Story | 3 | Frontend |

Total: 5 Stories, 19 points.

## Critical Gates (CLAUDE.md compliance)

- **Visual fidelity check** (§Frontend Standards): every Story compares against Sprint 0 style demo / existing Cairn sepia + Liquid Glass tokens.
- **Three iron laws (v4.2 §3) must drive ALL conditional rendering**: visible(mark), can_like_report(mark), can_delete(mark).
- **No API wire for Like/Report** (v4 row §4.12) — UI changes are local session state only.
- **Public marks anonymous** (v4 row Q): author_name hidden in all 4 detail forms when permission='public' regardless of creator.
- **Personal marks of friends NOT visible** (§3 matrix row 3): tap on a friend-Personal mark = no sheet, no response.

## Dependencies

- All Stories depend on Sprint 67 backend (STORY-00527 mock data, STORY-00528 endpoints).
- 530 ↔ 531 independent. 532 depends on 530 (visibility ENUM in create) + 531 (visual treatment consumed by sheet header). 533 depends on 532 (action surface). 534 depends on 533 (Delete-from-view trigger).

## Definition of Done (sprint level)

- All 5 Stories Done + verified
- Mark create flow lets user pick Personal/Friend (Public hidden in UI per v4 §11, but write path already rejects via Sprint 67 H1)
- Visual treatment matches §3 visibility rules at all 3 mark types
- Detail Sheet renders correct form for all 6 (creator × visibility × visited) combinations
- Like UI is session-local; restart reverts state (no DB write)
- Delete dual-semantic verified: own mark → DELETE; other mark → POST /api/hide
- Hide-from-me wipes the local mark cache + the mark vanishes from the map until rehydration sees the filter
- Static tab visual review of all 4 detail forms (Playwright HTML or Storybook-equivalent) before any device test
- Arch + UX + QA subagent reviews all PASS
- Live device verification (user's iPhone) noted as DEFERRED to F5 hardening Sprint — not blocking F3 start

## Sprint capacity compliance

5 Stories meets CLAUDE.md minimum (4). Visual-test gating means device verification rolls forward; this Sprint focuses on code correctness + static visual fidelity.

## Out-of-scope (explicit "What We Will NOT Build" within this Sprint)

- Real like/report HTTP wire (v1.1)
- Visited-state computation server-side (already in fog logic — clients use existing `in_my_fog` from FogLayer)
- Stranger Public mark blurred-icon display (F4 Story 5)
- Memory tab integration (F4 entirely)
- Live iPhone device verification (deferred to F5 hardening per `feedback_unity_visual_test`)
