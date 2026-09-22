# CARD-AD-01 evidence provenance addendum

This evidence-only addendum supersedes misleading reference labels in the CARD-AD-01 product-family comparison. It does not rewrite Activity Detail and it does not alter or delete the original review artifacts.

## Corrected provenance

The earlier board included historical screens but labeled them as current references:

- the old three-tab Trails screen;
- the old `Leave a mark` Plant form and taxonomy;
- historical Hike/Run layouts.

Those images are historical reference material only. They are not proof that CARD-AD-01 or CARD-CAIRN-01 matches the current implemented app.

For this run, current behavior is attributable to the checked-out source identity and is shown by:

- `CAIRN-VIS-001`: current Home, normal app root;
- `CAIRN-VIS-002`: current two-library Trails, reached through the Home handler;
- `CAIRN-VIS-003`: current Plant, reached through the Home handler;
- `visual/images/board-current-reference-correction.jpg`: the side-by-side correction board.

All four are Expo Web captures using isolated synthetic state. They are not native-device or native RN Mapbox evidence.

## Activity Detail carry-forward boundary

CARD-AD-01 screenshots did not provide end-to-end proof for linked-Cairn navigation, Save as Route, Activity deletion, or sync retry. This run adds proof only for the authorized personal-Cairn chain:

`Activity Detail fixture -> actual linked-own-Cairn row handler -> Own Cairn Detail -> actual edit handler -> Back to the same Activity -> Memory -> All Cairns -> same stable Cairn row -> the same Own Cairn Detail`

The initial synthetic Activity route was forced. Every step after that uses the actual navigation and mutation handlers and is recorded in `visual/capture-results.json`. This is local fixture proof, not physical-device acceptance.

Activity Save as Route, Activity deletion, and Activity sync retry remain registered for their appropriate Activity/Route review slices and are not marked passed here.

