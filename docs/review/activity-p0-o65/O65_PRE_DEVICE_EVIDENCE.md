# O65 P0 Activity pre-device evidence

Status: `IMPLEMENTED_DEVICE_PENDING`

Purpose: preserve the verified pre-device evidence for the O65 owner-test candidate. O65 contains the focused Hike/Run route-recovery, three-stage route-quality, Final-artifact authority, Activity Detail map-lifecycle, and Cairn-owned Activity locale fixes. It is not release acceptance.

## Fixed failure mechanisms

- Live historical prefix: the causal live-tail simplifier could retain only a context point and the newest point, then discard the context point at the mutable cutoff. The cutoff boundary is now mandatory, so settled geometry freezes into the durable historical prefix.
- Background/Finish completeness: foreground tracking now restores durable classifier continuity and the raw-ordinal watermark before watcher activation. Journal projection is scoped by activity identity and owner generation and is recomputed inside the synchronous state update so a foreground observation cannot be overwritten by an in-flight journal read. Finish seals from the complete durable canonical journal.
- Three-stage quality: Stage 1 suppresses uncertainty-envelope micro-turns and weak lateral clusters; Stage 2 stabilizes only a bounded recent tail while freezing history; Stage 3 applies evidence-bounded local repair before optional road-aware refinement.
- Final authority: revision and geometry fingerprint travel together. Detail, reload, and cache/server hydration must meet the expected revision/fingerprint and cannot downgrade a newer Final artifact. Save as Route consumes the loaded Final real segments.
- Activity Detail map: route source/layer identity now includes style generation and geometry identity, style load/resume rebinds the line, the route uses the top slot, and camera fit is keyed to map epoch, style generation, and geometry identity rather than arbitrary delays.
- Locale: Cairn-owned Activity and Trails month/date/time formatting uses explicit `en-NZ`; a `zh-CN` runtime no longer produces app-owned Chinese date text.

## Route authority

`native raw observations -> mode-specific Stage 1 acceptance -> durable canonical journal -> canonical Activity/Memory`

`canonical -> bounded Stage 2 live stabilization (frozen prefix + mutable tail) -> live map`

`complete durable canonical journal -> Finish seal -> Stage 3 local Final -> optional independently accepted Mapbox windows -> revisioned Final artifact -> local session/outbox/server -> Finish preview/Activity Detail/reload/Trails preview/Save as Route`

Memory remains canonical evidence and is never rewritten from snapped geometry. Gaps are segmented and are not sent through Map Matching as continuous travel.

## Failure-sensitive evidence

- Background prefix regression: figure-eight live output previously collapsed from 73 canonical points to 2 vertices and retained only 0.5% of path length. After the mandatory freeze-boundary fix, Hike retained 69 vertices/98.2% and Run 61/98.1%. The combined hard fixture retained 90/97.4% for Hike and 81/97.3% for Run.
- Background/Finish authority: a foreground state ending at ordinal 40 plus durable ordinal 104 previously risked restarting at 41; it now resumes at 105. A concurrently accepted foreground ordinal 97 survives journal projection. Both Hike and Run preserve all 108 fixture points across 72 foreground, 24 headless, and 12 continued observations through Finish.
- Local Final repair: before the fix, a 13 m accepted lateral spike was not removed and a correlated burst retained about 10 m displacement. Both are now repaired while genuine corners, U-turns, backtracking, switchbacks, loops, crossings, off-road movement, and real gaps remain protected.
- Final downgrade: a delayed revision-1 server response could overwrite revision-2 identity/geometry pairing. Merge and hydration now require the expected revision/fingerprint.
- Initial map load: deterministic lifecycle tests cover cold/delayed style, cached style, Final-before-map, map-before-Final, style reload, and app resume, converging on one full authoritative line and bounds fit.
- Locale: the pre-fix `zh-CN` reproduction produced `2026年9月`; post-fix output is English (`September 2026`, `13 Sept`).

## Adversarial route matrix

The deterministic suite exercises 22 fixtures through the actual Hike and Run raw-observation acceptance pipelines, causal live route, local Final refinement, and mocked Mapbox coordinator: clean road control, broad curve, 90-degree turn, hairpin, Z corridor, U-turn, out-and-back, loop, figure-eight, parallel roads, road crossing, mixed road/trail/road, full off-road, off-road beside a road, one-point spike, correlated two/three-point burst, prolonged poor accuracy, bad upstream acceptance, sparse background cadence, stationary drift then walk, real signal gap, and the combined hard integration route.

Fixtures use deterministic correlated drift, changing 4-50 m accuracy, irregular timestamps, variable speed, stationary periods, and background-like sparse delivery. The local layer makes no Mapbox request and therefore remains useful offline. Endpoints remained unchanged, protected topology was retained, off-road segments were not pulled to roads, and the real gap remained a gap.

The Mapbox failure matrix covers confident acceptance, partial tracepoints, low confidence, `NoMatch`, `NoSegment`, timeout, network failure, mixed multi-window outcomes, parallel-road ambiguity, and mixed road/off-road windows. A response is accepted only after geometry gates; failure falls back to truthful local Final geometry.

## Verification retained for this candidate

- Activity changed verification: PASS, including 529 Activity CORE assertions and the continuity, cadence, background, gap, elevation, matching, telemetry, integration, Memory, journal-recovery, offline-sync, simulator, server, and static groups.
- Focused route/store regression: 5 suites, 98 tests passed.
- Final artifact/Mapbox/locale/map lifecycle regression: 8 suites, 41 tests passed.
- Adversarial route matrix: 25/25 passed.
- `git diff --check`: passed.
- iOS Expo export/Hermes: succeeded, 4,175 modules, 11.7 MB bytecode artifact.
- Expo Web mobile validation: rendered at 390x844; local production diagnostic CORS was expected and did not produce page exceptions.

## Read-only production evidence

No production data was changed. Stable owner Activity IDs showed full-span server geometry rather than backend truncation:

- server 2130 / `10905792-ad1d-4fc7-bd2c-b08349272276`: 219 raw, 214 canonical, 34 Final; canonical 360.6 m, Final 334.7 m; endpoints unchanged.
- server 2098 / `bdf3ba8c-9003-469a-a5f0-fb02650a7210`: 489 raw, 472 canonical, 64 Final; canonical 705.6 m, Final 671.2 m; endpoints unchanged.
- server 2096 / `bca7f29c-ddf4-4e0c-8b24-7f3d273ddb9f`: Run, 210 raw, 204 canonical, 49 Final; canonical 646.0 m, Final 620.4 m; endpoints unchanged.

No historical Mapbox request/result telemetry existed for those exact Activities, so no claim is made about their historical matching outcome.

## Boundaries and remaining acceptance

- Client JavaScript/TypeScript only; no native dependency, plugin, app configuration, runtime version, or backend change.
- Compatible with Build 62 runtime `0.2.6-o61` and suitable for manual owner OTA publication; no OTA was published and no native build was created in this session.
- No backend deployment, restart, or production mutation occurred.
- Hidden QA/Simulator support remains compile-time gated by `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`.
- O65 remains `IMPLEMENTED_DEVICE_PENDING` until the owner completes the physical Hike and Run background/repeated-background/Plant/Pause/Finish/reload/Save-as-Route checks, confirms Final geometry, verifies Activity Detail cold/warm/style-resume rendering, and verifies English app-owned Activity UI under `zh-CN`.
