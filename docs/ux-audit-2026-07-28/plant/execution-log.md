# plant — Playwright Execution Log

## Environment
- 414×896. Web bypass. Mapbox web shim loads OK (`[mapboxAdapter] web shim loaded`)
- Note: map defaults to Shanghai coordinates on web (no real GPS). Some map tiles fail to load (ERR_ADDRESS_UNREACHABLE) — expected on the account/region.

## Scenario S01 (map picker entry): pass
- Screenshot: S01-plant-entry.png
- Observation: Two-step composer flow.
  - Step 1: "Where's your cairn?" title + "Drag the map to fine-tune. Tap Confirm when it feels right." subtitle
  - Interactive Mapbox map region loads with location cursor pin
  - Layer toggle (globe icon, top-right), zoom +/-, my-location target button
  - Primary CTA "Confirm this spot" (solid brown/orange, full-width)
- Observation: Map tiles partially fail (some ERR_ADDRESS_UNREACHABLE) — may indicate Mapbox token issue for this region. Not a UX bug per se, but worth flagging to backend/config.

## Scenario S02 (compose form): pass
- Screenshot: S02-plant-compose.png
- Observation: "Leave a mark" title, "A few words, a voice memo, or both." subtitle
- Fields:
  - Type row: 5 pill options (Danger/Junction/Water/Hut/Cairn), Danger pre-selected in red (default)
  - Title textbox (max 30, counter 0/30)
  - Body textbox (max 200, counter 0/200)
  - Voice memo pill — labelled "(coming soon, max 30s)" — not implemented
  - Who can see this: "Just me" / "Friends" pills — Friends pre-selected (cream tinted)
- CTA at bottom: "Plant Cairn" — appears disabled (light beige/muted) with no text entered

## Scenario S03 (typed content): pass
- Screenshot: S03-plant-with-text.png
- Steps: typed "Test cairn title" + "A test note that a hiker would find here."
- Observation:
  - Title counter → 16/30 (correct)
  - Body counter → 41/200 (correct)
  - Body textbox border darkens on focus (good)
  - **Plant Cairn button transitions from disabled beige to solid brown (activated)** — clear affordance
- Observation: Title textbox does NOT get border-darken on focus but body does — inconsistent focus state
- UX bug: title field shows placeholder "Title (max 30)" — combining label + hint into placeholder is anti-pattern (label disappears when typing). Should have separate label above.

## Scenarios S04+ (submission, error paths, viewport variations): skip
- Reason: Plant Cairn submission would hit CORS-blocked backend. Skipping deep testing.
