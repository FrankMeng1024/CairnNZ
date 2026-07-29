# Screenshot QA — hiking

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `hiking/AUDIT.md`.

## S01-hiking-idle.png — PASS (with expected web fallback)
- Expected (Scenario 1 idle + Scenario 8 web fallback): Free Hiking route pill visible, "Enable GPS" amber chip top-right, map area with web fallback message "Real Map (EAS Build)".
- Observed:
  - Back button top-left (pill variant).
  - "Enable GPS" chip top-right with amber dot + pale-amber pill background — matches severityWarning styling.
  - Center: sage-green Map placeholder glyph + "Real Map (EAS Build)" + "Build with EAS to enable live tracking map" subtitle. This is the expected web-mode fallback per Scenario 8.
  - Bottom card: green target/route icon + "Free Hiking" label + "Tap to change route" subtitle + chevron up (indicating sheet-openable).
  - "Start Hiking" pill button with play glyph — enabled.
- All elements match AUDIT.md expected UI for idle + web fallback. No clipping, no error state.

## S02-route-sheet.png — PARTIAL
- Expected (Scenario 2 empty route picker): Sheet opens showing only "Free Hiking" (no saved routes). Audit flagged this state as lacking "empty state copy" — a real bug (5/10 score).
- Observed:
  - Bottom sheet correctly slides up over dimmed backdrop.
  - "CHOOSE A ROUTE" uppercase section header.
  - Single row: green target badge + "Free Hiking" + "No route · explore freely" subtitle + green checkmark (selected state).
  - No empty-state text like "You have no saved routes yet — try Free Hiking or import a GPX from Routes".
- Confirms AUDIT S02 finding: **row exists but no explanation copy for zero-saved-routes state**. Not "broken" (sheet does render) but PARTIAL — matches AUDIT prediction of a bug.
- No obvious visual defect on sheet chrome itself.

## S03-start-attempt-no-gps.png — PARTIAL (state shift observed vs AUDIT.md S6 expectation)
- Expected: This filename suggests "user tapped Start Hiking with no GPS". Should show validation/error state, chip should stay amber, likely a toast or "GPS required" copy.
- Observed:
  - GPS chip now reads **"GPS Offline"** with red dot (not amber "Enable GPS"). This is a state transition beyond what AUDIT scenario 6 documents — scenario 6 has "Enable GPS" chip (idle, no location); "GPS Offline" is a distinct state after start-attempt or state change.
  - Route pill has been REMOVED from the bottom card — only "Start Hiking" button remains at bottom.
  - Map placeholder unchanged.
- **Findings**:
  - Chip color changed amber → red on state transition — reasonable severity escalation, no bug.
  - Route pill disappearance is unexpected. On start attempt failing, the route picker should remain visible so user can choose a different route. Losing the route pill after a failed start is a UX gap.
  - No toast / error banner / modal explaining why Start Hiking is inactive. Button appears enabled but nothing has told user "we couldn't get GPS, tap here to enable".
- Not a fully broken render but definite UX friction. Matches spirit of AUDIT scenario 6 finding ("no interactive hint — chip is not tappable to open Settings/permissions").

---

## Summary for hiking
- **PASS**: 1 (S01 idle)
- **FAIL**: 0
- **PARTIAL**: 2 (S02 route-sheet — empty-state missing copy per AUDIT; S03 start-attempt — route pill lost + no error banner)
- **Not shot yet**: Scenarios 4-33 (pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- `hiking/S03-start-attempt-no-gps.png`: **Route pill disappeared from bottom card** after start-attempt. Not documented in AUDIT.md scenarios explicitly — this is an emergent runtime finding that needs a bug filed. Also "Start Hiking" button remains visually enabled while GPS is offline — no visible affordance change matching the "GPS Offline" chip.
