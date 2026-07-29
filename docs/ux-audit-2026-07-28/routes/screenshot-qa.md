# Screenshot QA — routes

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `routes/AUDIT.md`.

## S01-routes-activities-empty.png — PASS
- Expected (S01 header + S03 empty Activities tab): SegmentControl header with 3 tabs (Activities / Routes / Flags) with Activities selected, then empty state with illustration + copy.
- Observed:
  - Back button top-left (pill variant), centered "Routes" h1 title. Right side balanced padding — matches AUDIT S01 pattern (60px minWidth balance).
  - Full-width SegmentControl: 3 tabs. "Activities" active (green text, white pill background with subtle shadow). "Routes" and "Flags" grey/inactive.
  - Empty-state illustration: soft sage-green mountain silhouette (2 layers: darker foreground with 3 peaks + lighter background peaks), a small cairn/stone-pile at the base of the tallest peak, and a dashed golden-tan trail winding from cairn up the mountain. Well-composed and on-brand (mountaineering + cairn metaphor).
  - "No tracks walked yet" h3 title (bold, sepia/text primary).
  - "Start hiking or running. Your tracks will live here." subtitle (textSecondary sepia).
  - Rest of screen: empty cream space (Colors.bg).
- All expected elements present. Empty-state illustration is polished and matches Cairn brand voice. SegmentControl visual state clearly indicates active tab.
- No clipping, no misalignment, no error state.

### Observations vs AUDIT
- AUDIT S01 noted "hard-coded 60px right-side spacer is fragile" — visually fine at default sizes, cannot verify at longer BackButton labels from this shot.
- AUDIT S02 flagged missing haptic on tab switch — cannot verify from static screenshot.
- The empty-state illustration + copy is a solid answer to AUDIT concerns about affordance ("first-time user understands what to do") — 3-word CTA "Start hiking or running" is clear.

---

## Summary for routes
- **PASS**: 1 (S01 activities empty)
- **FAIL**: 0
- **PARTIAL**: 0
- **Not shot yet**: S02-S36 (Routes tab, Flags tab, populated states, RouteEditorScreen, GPX import, long-name overflow — all pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- None from this shot. Empty state renders cleanly.
