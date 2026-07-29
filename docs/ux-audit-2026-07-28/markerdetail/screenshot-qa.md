# Screenshot QA — markerdetail

Reviewed by A-SSQA on 2026-07-28. These are DEV-only preview shots from the MarkDetailSheet harness (Sprint 68 STORY-00532 + STORY-00533).

## S01-markdetail-preview.png — PASS (dev harness landing)
- Expected: The `__DEV__` MarkDetail preview from Home renders a harness screen listing all 4 sheet Form variants (A/B/C/D) with descriptions of each scenario.
- Observed:
  - Title "MarkDetailSheet — Dev Preview" h1 bold.
  - Subtitle: "Sprint 68 STORY-00532 + STORY-00533 — verify all 4 forms per v4 §4.11."
  - Seven scenario cards, each with a scenario letter + description + right-aligned green "Form X" badge:
    - A. My Personal mark (Form A) — "Edit + Delete only (no Like/Report — not Public)"
    - A. My Public mark (Form A) — "Edit + Delete + Like/Report (because Public)"
    - B. Friend's mark + I visited (Form B) — "Author name (LDY) + visited ✓ + Like + Report + Delete-from-view"
    - B. Stranger Public + I visited (Form B) — "ANONYMOUS (no author name) + Like + Report + Delete-from-view"
    - C. Friend's mark via fog + NOT visited (Form C) — "Author name (LDY) + '(Walk here to like/report)' + Delete-from-view ONLY"
    - D. Friend's Personal mark (blocked) (Form D) — "Sheet must NOT open — iron law 1 visibility deny"
    - D. Stranger Public + not visited (Form D) — "Sheet must NOT open — outside fog + no subscription"
  - Bottom hint (partially visible): "Tap a scenario to render the sheet. Form D scenarios should produce NO sheet (the component renders null)."
- Well-structured dev harness. Clear scenario-to-form mapping. All 4 Form variants covered per audit v4 §4.11.
- No visual defect. Copy is precise and tester-friendly.

## S02-form-A-personal.png — PASS
- Expected: After tapping "A. My Personal mark" scenario, MarkDetailSheet slides up showing Form A (Edit + Delete only, no Like/Report because not Public).
- Observed:
  - Backdrop: dim scrim over the scenario-picker background (matches modal pattern).
  - Bottom sheet slides up.
  - Close button (X) top-right corner.
  - Sheet title: "Hidden viewpoint" (bold h2).
  - Sheet subtitle: "Behind the rocks, quiet…"
  - Visibility badge: lock icon + "Personal" chip (grey, indicating not-public).
  - Right-aligned metadata: "3 days ago" (textSecondary).
  - Action row: two buttons side-by-side:
    - "Edit" (outlined pill with pencil icon, primary green text).
    - "Delete" (outlined pill with trash icon, red/danger text).
  - **No Like button** — correct for Form A (Personal, not Public).
  - **No Report button** — correct for Form A.
- Matches Form A spec exactly: Edit + Delete only. Visibility chip "Personal" reinforces why no Like/Report. Copy in title/subtitle is on-brand ("Hidden viewpoint / Behind the rocks, quiet…" — evocative, matches Cairn voice).

## S03-form-B-friend-visited.png — PASS
- Expected: After tapping "B. Friend's mark + I visited", sheet renders Form B: friend author name (LDY) + visited checkmark + Like + Report + Delete-from-view.
- Observed:
  - Same dim scrim + sheet chrome.
  - Close (X) top-right.
  - Title: "Coastal viewpoint" (h2 bold).
  - Subtitle: "Best sunset spot on island".
  - Visibility chip: users glyph + "Friend" (green-tinted, distinct from grey Personal chip in S02 — semantic color coding).
  - Right-aligned metadata: "3 days ago".
  - Below chip row: small user icon + "LDY" (author name — correct for Form B friend).
  - Green check + "You visited here" — correct visited affordance.
  - Primary action row: outlined pill "Hide from my map" with trash icon in red — this is the "Delete-from-view" action.
  - Bottom row: heart icon + "Like" text link, flag icon + "Report" text link — both present per Form B spec.
  - **No Edit / Delete buttons** — correct for someone else's mark (I can only delete-from-view, not delete the mark itself).
- Matches Form B spec exactly: author name shown, visited indicator, Like/Report/Delete-from-view actions. Red destructive color reserved for "Hide from my map" (which is the semantically strongest action here — irreversible-from-my-side).
- Semantic chip colors work well: grey "Personal" in S02 vs green-tinted "Friend" in S03 makes visibility state scannable at a glance.

---

## Summary for markerdetail
- **PASS**: 3 (S01 dev harness, S02 Form A, S03 Form B friend visited)
- **FAIL**: 0
- **PARTIAL**: 0
- **Not shot yet**: Form A Public (Like/Report added), Form B Stranger (ANONYMOUS author), Form C fog-blocked with "Walk here" hint, Form D null-render assertions, edit modal, delete confirmation, MarkerDetailScreen full-route detail, MarkerPin web fallback (all pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- None from these two shots. The dev harness + Form A both render cleanly and follow v4 §4.11 visibility rules.
