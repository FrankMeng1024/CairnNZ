# UI, three-theme, and performance evidence

## Loaded production screens

`qa/web-loaded/manifest.json` records 70 Expo Web captures using production screens, Chrome, `en-NZ`, `Pacific/Auckland`, reduced motion, synthetic NZ geometry, and the existing react-map-gl/mapbox-gl v2 adapter. Every Memory capture waited for `window.__cairnMap.loaded()` and for the “Opening your map” veil to become hidden.

The capture set includes Personal, Combined, and single-friend Memory; Memory sharing; source removal; geometry error and retry; friend list/profile/content; read-only friend Cairn and Route Detail; revoked/unavailable content; Home; Hike; Run; text-only Plant; owned Activity/Cairn/Route; empty and enriched Cairns; All Cairns; Trails; settings; long text/focused browser edit; and authentication.

Themes: Day, Sunset, Night. Viewports: 320x568, 390x844, 430x932.

Review boards:

- `qa/web-loaded/personal-friends-three-theme-board.jpg`
- `qa/web-loaded/full-surface-three-theme-board.jpg`
- `qa/web-loaded/revision-02-edge-state-board.jpg`

The loaded run has zero recorded runtime errors. It preserves one labelled Mapbox GL v2 callback warning during direct QA route teardown. Each subsequent map independently passed `loaded()` before capture, so the warning is not hidden or treated as a loaded-state pass by itself.

## Map unavailable

`qa/web-map-unavailable/day-memory-map-unavailable-management-390x844.png` is a separate no-token Expo Web run. It shows the unavailable state with personal Memory context and management controls still usable, and asserts the loading veil opacity reached zero. It is not native Mapbox evidence.

## Performance

`qa/memory-presentation-metrics.json` contains the source fixture, intermediate geometry, immediately-before-Finish, immediately-after-Finish, after-reload, and measured results. The displayed geometry remains identical across Finish/reload because Finish is reconciliation rather than first reveal.

The 240-point standalone fixture produced six updates, a 582 ms maximum geometry build, 702 ms maximum including the 120 ms coalescing policy, and a 388 ms maximum synchronous bounded slice. Sampled prior-coverage loss and unsupported reveal were both zero. Persistence write counts are asserted separately: one coverage write and two meaningful presence writes for the return fixture, without repainting coverage.

These results are bounded desktop evidence. They do not establish native phone frame time, physical GPS quality, battery behavior, or New Zealand field performance.

## Evidence reuse after final code changes

The final source changes after the screenshots were limited to test type guards, bounded test envelopes, the explicit 1999/2000/2001 assertion, and the review-only ordered-race harness. No production UI, geometry implementation, token, theme, or fixture source changed after the capture run. The screenshots were therefore reused unchanged; all affected tests and both integrated Personal/Friends evidence paths were rerun after their final corresponding changes.

