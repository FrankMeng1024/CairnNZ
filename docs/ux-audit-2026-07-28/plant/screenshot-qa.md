# Screenshot QA — plant

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `plant/AUDIT.md`.

## S01-plant-entry.png — PARTIAL (skipped GpsLockStep, landed on PinAdjustStep)
- Expected (S01 GpsLockStep native happy path): Progress bar 0→100 over ~5s ("Finding your ground"), then transition. Fast path may flash for <200ms before advancing.
- Observed: Screenshot shows **PinAdjustStep**, not GpsLockStep. The GPS lock step must have completed before capture (either fast path resolved <100ms, or web dev seeded a `lastWatcherFix`). This is expected behaviour for the fast-path when a cached fix is present.
- PinAdjustStep content:
  - Back button top-left, "Where's your cairn?" h1 title, "Drag the map to fine-tune. Tap Confirm when it feels right." subtitle (matches Cairn voice — one sentence, no jargon).
  - Real Mapbox map rendered (Shanghai area: 中心小学, Changping Rd, Yanping Rd, 静安区精神卫生中心南院, Fat Cow, Wuding Rd). This means the web build has a working Mapbox raster style here (unlike Hiking/Running where it fell back to placeholder). **Notable**: Plant screen has real map on web while Hiking/Running use placeholder — **inconsistent web-fallback strategy across screens**.
  - Center: orange target pin with amber outer ring and dashed circle (accuracy visualization).
  - Top-right controls: globe icon (satellite/globe toggle), + zoom, − zoom — three white pill buttons.
  - Bottom: full-width brown/sepia "Confirm this spot" primary button with rounded corners.
  - Mapbox attribution bottom-left, info icon bottom-right (standard SDK chrome).
- No visible clipping, no error state, layout is clean. But the screenshot **does not verify what AUDIT S01 was testing** (progress bar animation). PARTIAL because it skipped past the target state.

## S02-plant-compose.png — PASS
- Expected (ContentStep, empty state): 5-type marker chips (Danger / Junction / Water / Hut / Cairn), Title input (max 30), Body textarea (max 200) with placeholder, Voice memo row (coming soon), "Who can see this" audience buttons, "Plant Cairn" submit button.
- Observed:
  - Back button top-left. "Leave a mark" h1 title. "A few words, a voice memo, or both." subtitle.
  - "Type" label + 5 chips wrapped to 2 rows:
    - Row 1: **Danger** (selected — red triangle icon, pale-red pill bg, red border), Junction (grey), Water (grey with droplet), Hut (grey with house).
    - Row 2: Cairn (grey with cairn glyph).
  - Title input: white rounded pill, placeholder "Title (max 30)", counter "0 / 30" right-aligned below.
  - Body textarea: white rounded rect, placeholder "Tell whoever finds this...", counter "0 / 200".
  - Voice memo row: white pill "🎙 Voice memo (coming soon, max 30s)" — button visually disabled/muted.
  - "Who can see this" section: 2 audience pills side-by-side — "Just me" (lock icon, unselected white), "Friends" (users icon, pale-cream bg with amber border, SELECTED).
  - Bottom: "Plant Cairn" primary button — pale sepia/muted (disabled because no title entered).
- All expected elements present. Danger is the default type (matches AUDIT `markerTypes.ts`). Friends audience is default (matches privacy intent). Disabled submit is correct empty-state affordance.
- Matches AUDIT expectations.

## S03-plant-with-text.png — PASS
- Expected: Same as S02 but with title + body populated. Submit button becomes active. Counters update.
- Observed:
  - Title field: "Test cairn title", counter "16 / 30" — matches character count.
  - Body textarea: "A test note that a hiker would find here." with focus ring (dark border indicating active input), counter "41 / 200" — matches character count.
  - **"Plant Cairn" submit button now BROWN/SEPIA saturated** (was pale/disabled in S02) — indicates enabled state after content entered.
  - All other elements (marker type chips, voice memo, audience buttons) unchanged.
- State transition works as expected: empty → filled → enabled submit. Counter accuracy matches typed content.
- Matches AUDIT expectations. No clipping, no error state.

---

## Summary for plant
- **PASS**: 2 (S02 compose empty, S03 compose with text)
- **FAIL**: 0
- **PARTIAL**: 1 (S01 plant-entry — skipped GpsLockStep, landed on PinAdjustStep; cannot verify progress bar / accuracy affordance)
- **Not shot yet**: S02-S28 GPS states, S04+ marker type variations, error states, size overflows (pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- **Inconsistent web map fallback across screens**: Plant's PinAdjustStep shows **real Mapbox map on web**, while Hiking/Running fall back to sage placeholder "Real Map (EAS Build)". Either (a) both should show real map on web, or (b) both should fall back. This inconsistency is not documented in AUDIT.md — CONSISTENCY_REPORT candidate.
- Focus ring on body textarea in S03 is a thin dark border — good but visually differs from Auth's `inputFocused` (green primary border + primaryBg tint). Cross-screen focus-state inconsistency.
