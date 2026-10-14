# O79 Route, Memory, and library UI decisions

## Route workspace

Before, the editor accumulated independent summary, status, tool, review, Trim, Point, and footer surfaces. Undo lived outside the tool family, Add here floated over the map, and each mode changed the bottom geometry. The final workspace has three owned rows:

1. A fixed toolbar: equal 44pt-minimum Draw / Point / Trim peers plus a fixed square Undo.
2. A fixed 116pt context slot: Browse may be visually empty; Draw, matching, freehand choice, Point, Trim, brief status, and actionable error use this one region.
3. The lowest row: editable Route name and Save together. Save is disabled while geometry is unresolved or saving.

The rows and horizontal anchors do not move between Browse, Draw, Point, Trim, matching, or fallback at 360/390/430 widths. The live Trim rail may extend above its context content without moving the toolbar/name row. Search, recenter, overview, and More remain map functions; Undo and mode confirmations do not float over the map. Search and More have one exclusive overlay owner.

## Interaction modes

The editor owns one mode value:

`Browse → DrawArmed → Drawing → MatchPending → Browse | AwaitFreehandChoice`

`AwaitFreehandChoice → Browse` after either Redraw or Use drawing.

`Browse ↔ PointTargeting`, `Browse ↔ TrimPreview`, and any valid mode may enter `Saving` only when no unresolved transaction exists. Tool selection calls one invalidation path that aborts/fences the active request, removes provisional/review layers, resets unapplied Trim, and clears mode-only messages. Accepted or cancelled Draw always returns to Browse; another stroke requires tapping Draw again. A second finger interrupt cancels an incomplete provisional stroke rather than creating a hidden multi-stroke transaction.

The Web evidence bridge is development-only and Web-only. It submits a geographic stroke to the same production `handleDrawStroke` path because the native RNGH canvas is not present on Expo Web. It is a labeled QA fixture, not a production feature and not evidence of native touch sampling.

## Exact final English copy

| State | Instruction | Actions |
|---|---|---|
| Draw armed | `Start near an end to extend, or connect two points to reshape.` | Draw on map |
| Point target | `Move the map so the crosshair marks your next point.` | `Set start` or `Add point` |
| Trim preview | `Drag either end of the route to shorten it.` | `Cancel` / `Apply` |
| Valid raw fallback | `No mapped path fits your drawing. Keep the line you drew?` | `Redraw` / `Use drawing` |
| Accepted Draw, brief | `Line added. Move the map, or tap Draw to continue.` | None |
| Pending match | `Matching your drawing to nearby paths…` | `Cancel` |

The valid raw fallback is a neutral decision, not an error. Provider codes remain diagnostic-only. There is no user-facing “disconnected pieces”, “transaction”, “section”, “Draw is still active”, or permanent “Ready to save”.

## Route geometry and rendering invariant

Only the accepted ordered Route points/parts/gaps plus identity, ownership, and share metadata are persisted. Theme, context-state, animation, provisional ink, and QA metadata are never stored in Route geometry. Accepted matched paths and accepted safe raw drawing both commit through the same ordered-draft/history owner and create one Undo entry. Imported Activity gaps remain factual gaps.

Seam normalization is intentionally local: inspect only vertices within 12m of an attachment, remove a ≤1.5m duplicate or a strongly reversing fold, and stop before a genuine turn. Tests retain sharp corners, U-turns, and out-of-range geometry. Day/Sunset/Night select the shared semantic line styling at render time.

## Location authority

Memory no longer treats stale watcher data or owned history as current-entry camera authority. It waits for a credible current result, uses a persisted manual city only after location failure, and preserves deliberate manual browse. New Route does not paint a regional/world fallback as current while a fix is pending; it shows an honest locating surface, qualifies recency/accuracy, uses neighborhood zoom once, and fences late GPS after a user-selected place or manual camera interaction.

## Shared library system

Activities, Routes, and Cairn Library share the same search, compact segmented filter, and record-row primitives. Their semantics remain distinct. The order on both Trails tabs is Header → tabs → Search → compact filters → dated records. Cairn Library keeps owned/found sections and the canonical `CairnPinV10`, but removes the redundant decorated circle around that already-complete marker.

## Mapbox legal controls

All affected screens derive logo/attribution positions from the shared `mapOrnamentsAbove` contract. The Web adapter renders Mapbox's genuine logo and `AttributionControl`; relative offsets move both the visual control and its hit region. Detail screens reserve the measured bottom-sheet height. Controls are not hidden, replaced, or counterfeited.

## Deliberate non-deviations

- No Home art, theme direction, Activity/Fog truth, Friends delay, backend, runtime, app/build version, or native configuration was changed.
- Point routing remains network-routing semantics; it does not silently fall back to freehand.
- A planned raw Route is not movement evidence, safe-navigation certification, or a Fog unlock.
- Native GPS, native Mapbox ornament geometry, RNGH gesture handoff, keyboard/safe area, and full iPhone end-to-end remain explicit device checks rather than being inferred from Web evidence.
