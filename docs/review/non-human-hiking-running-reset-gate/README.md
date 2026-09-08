# CairnNZ non-human Hiking + Running reset gate

Review-only icon exploration. The ten candidates are independent; matching numbers are not proposed families. No application or runtime source imports this folder.

## Accepted anchor

- Source: `docs/review/action-icon-reset-gate/icons/family-b/cairn.svg`
- SHA-256 before and after: `5429c91d5c810a1de2652e6eef8a1162f17b345b0b4ff973193ced60823ee1e1`
- Status: accepted context anchor, byte-for-byte unchanged

## Review boards

The PNG boards are reproducible local-only outputs and are ignored by Git.
Recreate them from the tracked editable SVG/icon sources with
`node docs/review/non-human-hiking-running-reset-gate/build-review.cjs`.

- Master: `docs/review/non-human-hiking-running-reset-gate/non-human-icon-master.png`
- Home size: `docs/review/non-human-hiking-running-reset-gate/non-human-icon-home-size.png`
- Semantic check: `docs/review/non-human-hiking-running-reset-gate/non-human-icon-semantic-check.png`
- Home preview: `docs/review/non-human-hiking-running-reset-gate/non-human-icon-home-preview.png`

Editable SVG versions of every board and all ten source icons remain tracked.

## Hiking evaluation

Ratings use `Strong / Good / Fair / Weak`. They are intentionally conservative.

| Candidate | Concept | Semantic clarity | Trail specificity | 29px readability | Maturity | Gate note |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | High-collar trail boot with a lugged outsole. | Strong | Strong | Strong | Good | Safe, direct object cue; slightly more utilitarian than premium. |
| H2 | Trail boot planted on a rising grade. | Strong | Strong | Strong | Strong | Best overall Hiking balance and safest selection. |
| H3 | Trail boot paired with restrained topo contours. | Good | Strong | Good | Strong | Most premium Hiking candidate; contour cue compresses at 29px. |
| H4 | Trekking pole against a reduced alpine ridge. | Fair | Good | Fair | Good | Reject for this gate unless human review reads it instantly; too label-dependent at 29px. |
| H5 | Compact technical trail pack. | Good | Fair | Strong | Strong | Mature equipment alternative, but can read as generic backpack/travel. |

## Running evaluation

| Candidate | Concept | Semantic clarity | Distinction from Hiking | 29px readability | Maturity | Gate note |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Low-profile road shoe with a clean segmented outsole. | Good | Strong | Strong | Strong | Safe and restrained, though the shoe alone can read as generic active footwear. |
| R2 | Performance shoe with two quiet rearward motion strokes. | Strong | Strong | Strong | Strong | Best immediate Running read and safest selection. |
| R3 | Performance shoe with a visibly split, lighter midsole. | Good | Strong | Good | Strong | Most premium Running construction; split detail softens at 29px. |
| R4 | Reduced shoe with two forward cadence arcs. | Good | Strong | Good | Good | Hold rather than advance: arcs risk reading as generic wind/speed notation. |
| R5 | Angled shoe in a toe-off posture with a short contact shadow. | Good | Strong | Strong | Strong | Premium dynamic alternative; motion is subtler than R2. |

## Current shortlist

- Best Hiking: H2
- Best Running: R2
- Safest: H2 and R2
- Most premium: H3 and R3, with R5 as the cleaner dynamic premium alternative
- Explicit non-advances: H4; R4 remains a hold rather than a recommended finalist

## Validation

- All ten source SVGs use non-human object, equipment, terrain, or movement cues.
- Every Home-size glyph is rendered at exactly 29×29 pixels.
- The Home preview is a static composite over real 390×844 Expo Web evidence; it is not an application screen or runtime mapping.
- A fresh Expo Web bundle completed at 390×844 on 2026-08-29. The fresh browser session stopped at Auth because the former Playwright auth bypass is intentionally removed; expected local backend CORS diagnostics were observed.
- `HomeProductIcon.tsx`, `HomeScreen.tsx`, and `homeBackground.ts` remained byte-identical during this gate.
- No push or OTA publish was performed.
