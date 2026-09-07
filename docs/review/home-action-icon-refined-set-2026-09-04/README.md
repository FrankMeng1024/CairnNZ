# Home action icon refined set — 2026-09-04

Review-only artwork. Nothing in this folder is wired into production.

## Concepts

- **Hike:** a compact uphill stride with a planted pole and one quiet incline. The torso carries more visual weight than the limbs so the figure survives the current 29 px Home size without becoming skeletal.
- **Run:** a forward-leaning body with counter-swinging arms and a clearly open stride. Speed comes from posture; there are no motion lines or decorative effects.
- **Leave a Cairn:** the previously accepted Family B stone-stack and placement gesture is preserved as the semantic and visual anchor.

## Family logic

All three use a 48 × 48 grid, round terminals, dark-forest `currentColor`, compact silhouettes, and operational rather than decorative cues. The human marks use a filled head and weighted torso for optical stability; the cairn keeps its approved outline construction.

## Why this is stronger than the rejected studies

Earlier human studies were too skeletal and exposed awkward joint/anatomy decisions. Earlier shoe, terrain, route, and abstract-mark studies depended too heavily on their labels or read as category objects rather than immediate actions. This set restores direct action semantics while removing incidental detail, cartoon posture, and gimmicky speed marks.

## Files

- `icons/hike.svg`
- `icons/run.svg`
- `icons/leave-a-cairn.svg`
- `master-review-sheet.svg` / `.png`
- `home-size-review-sheet.svg` / `.png`
- `home-row-preview.svg` / `.png`

Rebuild the PNG review outputs from the repository root with:

```sh
node docs/review/home-action-icon-refined-set-2026-09-04/build-review.mjs
```
