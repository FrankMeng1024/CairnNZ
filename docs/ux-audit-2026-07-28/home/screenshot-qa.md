# Screenshot QA — home

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's "预期 UI" in `home/AUDIT.md`.

## S01-cold-boot.png — PASS
- Expected (S01): Home with logo top-left + greeting right-aligned + three ActivityCards (Hiking / Running / Leave a Cairn) + Tools row (Trails / Friends / Memory / Settings). Bypass mode expected since we're on web.
- Observed: Bypass rendered Home directly. Cairn logo top-left with green stones icon. "Good evening, Explorer" greeting right-aligned. Three activity cards in correct order:
  - Hiking card — pale green `#eef4e8` bg, mountain glyph left panel, "Hiking" title 800-weight, "Track your route · Explore at your pace" subtitle, accent line, chevron circle.
  - Running card — pale blue `#e8f1f8` bg, footprints glyph, "Running" title, "Route planning · Lock mode" subtitle.
  - Leave a Cairn — pale cream `#fff5e9` bg with orange flag icon panel, "Leave a Cairn here" title, "Drop a note for friends or your future self" subtitle.
- Tools row: Trails / Friends / Memory / Settings — 4 rounded-square iconWraps in ~30×30 circles. All labels visible on one line.
- Dev-only "[dev] MarkDetail preview" text at bottom (matches S29 — expected in DEV builds).
- All cards render without overlap or clipping. Matches AUDIT expectation.

## S01-cold-boot-fullpage.png — PASS
- Expected: Same content, fullpage capture (may extend beyond viewport).
- Observed: Identical to viewport S01 — page fits viewport, no scroll content. Matches.

## S21-iphone-se.png — FAIL (BROKEN RENDER — matches audit prediction)
- Expected (S21): Three cards on 375×667, "Leave-a-Cairn subtitle may clip or wrap awkwardly at 71px height". Audit itself flagged this as a Critical bug candidate.
- Observed: **Confirmed critical clipping — "Leave a Cairn here" title is clipped at the TOP by the overlapping Running card**. The letter tops of "Leave a Cairn / here" are cut off, and the Running card's rounded bottom edge visually overlaps the flag card's top edge.
- This is the exact predicted-in-code Critical bug from S21 / S32 (dense-state clip on iPhone SE). Screenshot is the ground-truth evidence that flex 1/1/0.4 allocation collapses the third card.
- Additionally: subtitle "Drop a note for friends or your future self" wraps to 2 lines and sits close to the card bottom edge.
- Bug already documented in AUDIT.md §S21 and §S32 with fix suggestion #1. Screenshot confirms.

## S22-iphone-15-promax.png — PASS
- Expected (S22): Cards feel spacious, panelW cap engaged at 130, larger bottom inset.
- Observed: Three cards render cleanly on 430×932. Hiking + Running + Leave-a-Cairn all fit without title clipping. "Leave a Cairn here" title fits on one line at this width (contrast with S21 where it wraps to two lines because the accent-line and title share compressed horizontal room).
- Tools row visible with all 4 icons. Layout matches audit expectation.

## S24-home-return.png — PASS
- Expected (S24 real-user post-permission return): Home renders normally after returning from other screens or post-permission dialog. Full Home content visible.
- Observed: Identical Home render to S01-cold-boot.png. Logo top-left, "Good evening, Explorer" greeting, three activity cards (Hiking / Running / Leave a Cairn) with correct color coding, tools row (Trails / Friends / Memory / Settings), dev-only MarkDetail preview link at bottom.
- No missing state, no error banner, no layout shift. Confirms Home is idempotent — returning to it yields the same visual state as cold boot at this viewport.

---

## Summary for home
- **PASS**: 4 (S01 viewport, S01 fullpage, S22 Pro Max, S24 return)
- **FAIL / BROKEN RENDER**: 1 (S21 iPhone SE — Leave-a-Cairn title clipped by overlapping Running card, confirms Critical bug from AUDIT)
- **Not shot yet**: S02-S20, S23, S25-S32 (pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- `home/S21-iphone-se.png`: Truncation confirmed. "Leave a Cairn here" title top-clipped where Running card overlaps. This is a Critical bug per user policy (truncation/clipping = never cosmetic).
