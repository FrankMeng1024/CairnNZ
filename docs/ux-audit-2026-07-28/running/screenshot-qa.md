# Screenshot QA — running

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `running/AUDIT.md`.

## S01-running-idle.png — PASS (with BUG-R-01 visual confirmation)
- Expected (Scenario 1 idle Free Run): Free Run route pill, "Enable GPS" chip top-right always shown (per BUG-R-01: hard-coded), map placeholder for web, "Start Running" primary button, "Screen locks automatically" hint.
- Observed:
  - Back button top-left.
  - "Enable GPS" amber pill chip top-right — matches AUDIT.md BUG-R-01 finding that the chip is hard-coded to "Enable GPS" regardless of `foregroundGranted` state.
  - Map area: sage placeholder + "Real Map (EAS Build)" + "Build with EAS to enable live tracking map" — same web fallback as HikingScreen.
  - Route pill: blue target/route badge (matches Running color coding `#e8f1f8`) + "Free Run" + "Tap to change route" subtitle + chevron.
  - **Primary CTA**: dark-green pill "Start Running" with play glyph — much bolder than Hiking's outlined "Start Hiking" button. Running promotes CTA to filled primary; Hiking uses outlined. Consistency point vs Hiking screen.
  - Below button: small lock icon + "Screen locks automatically" hint text (sepia/textMuted).
- Matches AUDIT expected UI for idle Free Run state. The screenshot is the visual proof of BUG-R-01 — chip labels "Enable GPS" even though we cannot verify `foregroundGranted` from a screenshot alone.

### Cross-screen consistency note (Hiking vs Running idle)
- Hiking's "Start Hiking" button = white/outlined pill.
- Running's "Start Running" button = dark-green filled pill.
- Both screens are activity-start CTAs; different button styles across sibling screens is a **consistency drift**. Neither AUDIT (hiking or running) explicitly flagged this — surface for CONSISTENCY_REPORT.
- Additionally, Running has "Screen locks automatically" affordance hint; Hiking has no equivalent hint (implicit that Hiking doesn't lock).

---

## Summary for running
- **PASS**: 1 (S01 idle Free Run)
- **FAIL**: 0
- **PARTIAL**: 0
- **Not shot yet**: Scenarios 2-35 (pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- **CTA button style drift Hiking vs Running**: Hiking uses outlined "Start Hiking" pill, Running uses filled dark-green "Start Running" pill. Both are the primary activity CTA. Not documented in either AUDIT.md — this is an emergent cross-screen consistency finding worth logging in CONSISTENCY_REPORT.
- **"Enable GPS" chip visual confirmation of BUG-R-01**: the chip renders even in web-mode where permissions aren't a concept. AUDIT already flagged this as Critical.
