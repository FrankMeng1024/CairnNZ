# Screenshot QA — memory

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `memory/AUDIT.md`.

## S01-memory-onboarding.png — PARTIAL
- Expected (Scene S1 cold entry): Onboarding modal renders over Memory map. Modal title "Walk to unlock your memory", body explains fog-clearing mechanic, "Got it" primary CTA. AUDIT flagged: modal renders on top of still-loading map with no perceived affordance, no tap-outside-to-dismiss (inconsistent with MysteryCairnSheet/RevealedCairnSheet).
- Observed:
  - Header preserved: Back button top-left (pill), top-right segmented toggle "Mine / Friends" (Mine active — dark background, textPrimary, Friends inactive with lighter text).
  - Backdrop: uniform grey `rgba(20,20,20,0.55)` scrim covering full map area — matches spec.
  - Modal card center-screen: white surface, rounded card corners, subtle shadow.
  - Title "Walk to unlock your memory" — h3 bold, dark sepia. Good.
  - Body paragraph 1: "The map starts covered in fog. As you walk around, the fog clears and the places you have been become part of your memory." — clear, on-brand.
  - Body paragraph 2: "Cairns left by you and others appear as you discover them."
  - Primary CTA: filled brown/tan "Got it" pill, white text.
- All modal chrome matches AUDIT expected UI. **PARTIAL** because AUDIT S1 flagged that the modal sits on top of a still-loading map with no visible loading affordance — from this screenshot the underlying map region is entirely grey (dimmed) and it's impossible to tell whether the map is loading or fully-loaded-under-scrim. This ambiguity is exactly the issue AUDIT S1 raised (6/10 score) — the screenshot confirms it visually.
- Cannot verify from static shot: (a) whether backdrop tap-outside dismisses (AUDIT says it does NOT — inconsistency with cairn sheets), (b) whether modal blocks map interaction until "Got it" is tapped.

## S02-memory-permission-state.png — PASS
- Expected: When location permission not granted, MemoryScreen falls back to a permission-request state instead of the map. Should have clear copy + primary CTA to Settings + secondary retry link.
- Observed:
  - Header preserved: Back button top-left (pill), top-right "Mine / Friends" segmented toggle (Mine active).
  - Empty map region: cream (`Colors.bg`) — no fog, no map, no error dialog. Just clean background.
  - Centered content: "Location permission needed" h3 title.
  - Body: "Memory needs your location to draw the map." — one clear sentence, product-appropriate voice.
  - Primary CTA: filled brown/tan "Open Settings" pill (matches "Got it" style from S01 modal).
  - Below button: "Try again" text link (secondary retry action).
- Copy is clear and actionable. Two-action pattern (primary Settings deep-link + secondary in-app retry) is a good fallback.
- No visible defect. Matches expected permission-fallback UX.

---

## Summary for memory
- **PASS**: 1 (S02 permission-state)
- **FAIL**: 0
- **PARTIAL**: 1 (S01 onboarding — modal chrome matches spec, but the AUDIT-flagged issue of scrim-over-loading-map with no affordance is visually confirmed by the entirely-dimmed background)
- **Not shot yet**: Scene S2-S25+ (post-dismissal, fog states, hierarchy panel, mystery/revealed cairn sheets, scope toggle — all pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- **Confirms AUDIT S1 finding visually**: The entirely uniform grey background beneath the modal shows there is no loading indicator, no map-visible-through-scrim, no affordance that anything is happening. First-time users could tap "Got it" and land on a still-loading map with no signal.
