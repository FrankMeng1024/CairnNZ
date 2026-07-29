# home — Playwright Execution Log

## Environment
- Viewport tests: 414×896 (default), 375×667 (iPhone SE), 430×932 (iPhone 15 Pro Max)
- `window.__cairnStores` NOT exposed on this build → EVALUATE-based state injection scenarios (S02 empty, S03 one-session, S04 many, S05 old, S06-S10 tracking/pending, S15 long name) render with default/empty state
- Web bypass active → app renders Home directly (no auth)

## Scenario S01: pass
- Screenshots: S01-cold-boot.png, S01-cold-boot-fullpage.png
- Observation: Home renders with 3 activity cards + tools row + [dev] MarkDetail preview link. No stats/RecentRow (empty state).

## Scenario S02: pass (with caveat — no store injection possible, real empty state)
- Screenshots: (covered by S01)
- Observation: Empty-state Home confirmed. No onboarding hero — matches auditor finding.

## Scenario S21: FAIL — Blocker layout bug on iPhone SE
- Screenshot: S21-iphone-se.png
- Observation: **On 375×667 (iPhone SE), the "Leave a Cairn here" card overlaps the Running card above.**
  - "Leave a Cairn / here" title collides with Running card bottom
  - Whitespace budget clearly insufficient for 3 cards at flex ratios (1/1/0.4) on this height
- Priority: **Blocker/Critical** — iPhone SE is a supported viewport per typical iOS lineup; primary CTA (Leave a Cairn) becomes unreadable
- Priority tag: LAYOUT REGRESSION SMALL-SCREEN

## Scenario S22: pass
- Screenshot: S22-iphone-15-promax.png
- Observation: 430×932 renders cleanly with generous spacing.

## Scenarios S03-S17, S25-S32: skip
- Reason: `window.__cairnStores` not exposed in this dev build. State-injection EVALUATE calls return undefined; would only re-screenshot default empty Home. Skipped to preserve time budget and avoid noise.
- Recommendation: enable `EXPO_PUBLIC_ENABLE_STORE_HOOKS=true` (or similar) on dev server to unblock these tests.

## Scenario S23 (Playwright bypass mode): pass
- Confirmed via env probe: bypass active, auth skipped, `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true`.
- Concern: no auth flow testable via web while this is on.

## Scenario S29 (MarkDetail dev preview): pass (visible)
- Observation: `[dev] MarkDetail preview` link visible at bottom below tools row in this dev build. Auditor's concern about it pushing toolsRow up on short devices is validated by S21 result.
