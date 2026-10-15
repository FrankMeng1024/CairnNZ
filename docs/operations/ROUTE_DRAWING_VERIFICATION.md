# Route drawing verification

Route editing uses a staged loop so a geometry adjustment does not repeatedly
pay for a repository-wide compiler pass, Web export, browser launch, or a large
screenshot set. The stages reduce duplicated work; they do not reduce the final
release gate.

## Stage A — fast iteration

Start every Activity/Route change with the diff router, as required by the
Activity verification policy:

```sh
cd app
npm run verify:changed -- --explain
npm run verify:changed
```

After the first change, run the smallest failing Jest file directly. For a
change spanning the Route editing pipeline, use:

```sh
npm run verify:route:fast
```

This covers intent, the production store integration, Undo/Point continuity,
stroke validation, simplification, the bounded local trace, and the brush
overlay contract. It deliberately defers TypeScript and prints that fact. Do
not export Web, restart Expo, or generate screenshots after each code edit.

## Stage B — integration

When the focused tests are stable, run:

```sh
npm run verify:route
```

This adds touched-file TypeScript validation and the focused Mapbox client
request/response checks. Review the six synthetic replay fixtures in the
internal **Route drawing replay** screen. Keep one Expo server and one browser
session alive across comparisons; `scripts/web_qa_up.sh` is idempotent and
reuses Metro's cache.

Use the internal Debug screen to arm one local trace immediately before a
reproduction. Captures are memory-only, capped at eight sessions, 600 events
and approximately 2 MiB per session. They are never uploaded automatically.
Export a trace explicitly if it needs inspection outside the running app, or
use **Clear local** to discard all retained precise geometry immediately.

The replay compares original Route, raw finger stroke, recorded provider
candidate, legacy/provider-owned result, and current committed result. It uses
the actual intent and merge pipeline and reports metre and screen-pixel
deviation, path inflation, sharp turns, reversals, spikes, and seam angles.
Only redacted captures may become permanent fixtures; prefer the synthetic
fixture corpus.

## Stage C — final candidate

Run these once after relevant inputs have stopped changing:

1. `npm run verify:route`
2. `npm run verify:changed` (the diff may route runtime/package changes to the
   broader gate)
3. one Expo Web export and a mobile-size visual comparison
4. the applicable performance and release checks
5. a short native iPhone drawing session when native input behavior is in
   scope

Do not rerun a failed command unchanged merely to obtain green output. Diagnose
the failure and rerun only after its inputs or environment change.

The verification wrapper bounds client tests at five minutes for focused
gates and twelve minutes for the full gate, and bounds backend tests at three
and ten minutes respectively. Jest is explicitly force-exited only after it
has written its complete JSON result because Jest/Expo can retain an
unreported native FSEvents handle. A missing result, timeout, non-zero status,
or failed assertion still fails the gate; force-exit is not used to convert a
test failure into a pass.

Stop the persistent development Metro process before the final export. The O81
measurement accidentally left the hot QA server bundling lazy chunks while a
second Metro process performed the export; the competing cold export took
1,339.85 seconds. It passed, but this is avoidable process contention, not a
useful release check to repeat.

## Native boundary

Coordinate-injection and Web replay verify projection-independent geometry,
intent classification, provider selection, splicing, Undo, and persistence
events. They do **not** certify iPhone touch-event cadence, native
`getCoordinateFromView` projection, Mapbox pitch/bearing behavior, or dropped
native samples. With diagnostics armed, the active `RouteDrawOverlay` records
timestamped RNGH screen samples and each native `getCoordinateFromView`
projection; `OrderedRouteEditorScreen` correlates those samples with viewport,
camera, classifier, provider, selection, commit, Undo, draft persistence and
final Save events. A meaningful native-input change still requires real iPhone
telemetry evidence before release.

## Measured baseline for O81

Measured on the same development machine before and during O81:

| Check | Wall time |
|---|---:|
| diff-router explanation | 1.25 s |
| initial no-impact router run | 0.50 s |
| individual stroke validation Jest file | 7.01 s |
| five legacy targeted suites | 16.83 s |
| Route integration plus scoped TypeScript (initial sample) | 52.76 s |
| Route fast gate, 65 tests, static deferred (initial sample) | 12.38 s |
| Route fast gate after final contract audit, 74 tests | 9.44 s |
| Route integration/static gate, 109 checks | 54.99 s |
| six-screen hot Web replay matrix, one browser session | 19.67 s |
| final Web export with competing development Metro | 1,339.85 s |
| first full client suite assertions | 283.21 s |
| first full wrapper attempt before interruption | 880.33 s |
| isolated 10,000-point Memory diagnostic | 58.80 s |
| final bounded full gate, 1,984 passed and 4 skipped | 307.23 s |

The largest measured repeat cost was the compiler/static pass inside every
integration iteration. The stabilized Route fast gate makes that pass a Stage
B/C cost and was about 5.8× faster than the initial integration sample. The
first broad gate also exposed a larger runner cost: assertions finished after
283.21 seconds, but an unreported native FSEvents handle kept the wrapper alive
until it was interrupted at 880.33 seconds. The bounded/explicit exit policy
above prevents that wait without hiding assertion failures. Reusing the
persistent Expo server avoids the documented roughly 45-second cold Metro
bundle on subsequent visual checks. Final timings should be recorded again if
the gate composition changes.
