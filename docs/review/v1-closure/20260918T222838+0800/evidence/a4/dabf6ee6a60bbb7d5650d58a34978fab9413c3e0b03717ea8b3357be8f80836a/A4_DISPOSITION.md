# A4 Memory synchronous-slice disposition

Completed: `2026-09-20T11:03:36+08:00`

## Verdict

**PASS for the final standard A4 gate at exact source fingerprint
`dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a`
(636 files).** The frozen `<150 ms` slice and event-loop ceilings were not
changed. The original 180 ms failure and every later failed sensitivity run
remain retained; they are not rewritten as passes.

The deliberately constrained 384 MiB heap sensitivity is separately **FAIL**:
the corrected 10,000-point synchronous slice stayed below the frozen ceiling
at 103 ms, but the combined friend case observed 184.15 ms event-loop delay.
This is a sensitivity boundary, not final-gate evidence and not a native-device
claim.

## Baseline and preserved failure

- Task baseline: `cab465fa6ff734ac5ad6b1c5f13e2076c13cf350b26207dae9b05e009768a604`
  (636 files).
- Original failed source: `044045c3ad1ecde3c8eb9c55b76a72c14dfc46a39d8c14bf659b51e498e29929`.
- Original command: `cd app && npm run verify:changed`.
- Original runner evidence:
  `../044045c3ad1ecde3c8eb9c55b76a72c14dfc46a39d8c14bf659b51e498e29929/verify-changed-resumed.log`
  and `verify-changed-resumed.json`.
- Original result: exit 1; the 10,000-location case measured one 180 ms
  synchronous geometry slice against the frozen `<150 ms` ceiling at
  `revision03MemoryScale.test.ts:472`.
- Preserved profiles:
  `../044045c3ad1ecde3c8eb9c55b76a72c14dfc46a39d8c14bf659b51e498e29929/verify-changed-diagnostics/profile-summary.json`
  and `verify-changed-diagnostics/gc-sensitivity/summary.json`.

## Diagnosis and test sensitivity

The benchmark is
`app/src/features/memory/__tests__/revision03MemoryScale.test.ts`, case
`10,000 distinct-location diagnostic retains every input without duplicate
inflation`. The affected runtime is
`app/src/features/memory/components/FogLayer.tsx`, primarily
`buildTiledMemoryDisplayEvidence` and `buildClippedTileEvidence`.

Phase labels were added without changing thresholds, footprint radius, circle
steps, input history, or truth assertions:

1. At `34f89ebbd8191c217daa66e0bdb3fd41f8c53f8e49db031e77f8cbe332f7f576`,
   an isolated 10k run measured tile sorting at 107 ms, event-loop delay at
   108.17 ms, and tile geometry at 21 ms. This exposed cold locale collation as
   a near-ceiling source.
2. After locale-independent ordering, the complete six-case suite at
   `13f5fcb30b9c6d939abcab5aec29465404061fbd7aafcd359805622ffa3ebbf0`
   still failed at 184 ms in `tile_geometry` after the earlier history/friend/
   cache cases had run. This reproduced memory-pressure sensitivity and showed
   sorting was not the complete cause.
3. The preserved constrained-heap CPU profile attributes its longest interval
   to Turf `intersect`/polyclip in `buildClippedTileEvidence`; Turf occupied
   59,666.765 ms of profiled wall time and no GC pause reached 150 ms.
4. Replacing general circle/rectangle Turf intersection reduced standard 10k
   total geometry from 87,277.7 ms in the retained post-sort failure to
   51,628.0 ms in the final run. One intermediate standard run still recorded
   a 326 ms wall interval; it remains retained at
   `../af8e736708cf31ce33a31d48fe1612904cf1f1a871a679121b458abb536fcf59/scale-final/jest.json`.
5. A deliberately altered 384 MiB heap run with atomic labels measured 10k
   maximum synchronous geometry at 103 ms (circle generation 101 ms, tile
   union 15 ms, rectangle clip 4 ms, sort 12 ms), while separately failing the
   friend-case event-loop-delay ceiling at 184.15 ms. Evidence:
   `../e57e6c93cc21ee70b58a0ca69ff994dfe8d885ffeaf7c4b350d99c011ee79fb8/heap-384-sensitivity/`.

This sequence demonstrates that wall-clock maxima are sensitive to cold locale
initialization, allocation/heap pressure, and process scheduling. No passing
rerun was used to erase a failure; each retained run either changed
instrumentation, product code, or the explicit heap condition.

## Smallest demonstrated product correction

Changed product file:

- `app/src/features/memory/components/FogLayer.tsx`
  - use stable code-unit ordering for ASCII tile/group keys instead of
    locale-aware collation;
  - clip each convex 20-step, 30 m evidence circle to its axis-aligned display
    tile with Sutherland-Hodgman before the existing Turf unions;
  - retain optional phase-labelled slice observation at existing yield
    boundaries.

Changed test file:

- `app/src/features/memory/__tests__/revision03MemoryScale.test.ts`
  - collect and emit slowest slices and per-phase maxima;
  - all frozen budgets and truth assertions remain unchanged.

The clipping result is the intersection of two convex polygons. Every created
vertex lies on an original circle chord or tile boundary, so it cannot widen
the supported area. The test retains the exact 30 m outside-point rejection,
zero sampled unsupported reveal, zero sampled retained loss, distinct-history,
gap, and independent-cache assertions.

Final file hashes:

- `FogLayer.tsx`: `946946475072e03f79f8e7953282f01102170fa7f778c7b72903f6ab43d0beea`
- `revision03MemoryScale.test.ts`: `a4fae946e961bbf6ef9aeb1162f91672d802e9d10caed6c158c2dbe2c22235ef`

## Final focused verification

1. Activity diff router, scoped to the owned Memory source in the shared dirty
   tree:

   `cd app && npm run verify:changed -- --file=app/src/features/memory/components/FogLayer.tsx`

   Result: exit 0, Activity CORE **451/451** (continuity 35, cadence 5,
   background 25, gap 14, elevation 5, matching 42, telemetry 38,
   integration 106, Memory gap 5, recovery 35, Memory 25, offline/sync 36,
   simulator-shared 56, server 23, scoped static 1).

2. Final exact-source six-case scale gate:

   `cd app && R03_CANDIDATE_FINGERPRINT=dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a R03_MEMORY_SCALE_OUT=../docs/review/v1-closure/20260918T222838+0800/evidence/a4/dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a/scale-final/memory-scale.json node node_modules/jest/bin/jest.js src/features/memory/__tests__/revision03MemoryScale.test.ts --runInBand --silent --json --outputFile=../docs/review/v1-closure/20260918T222838+0800/evidence/a4/dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a/scale-final/jest.json`

   Result: exit 0; **6/6**.

   - 2,001 cold history: 10,460.18 ms; max slice 16 ms; event-loop max
     17.16 ms.
   - 40-point live append: 209.78 ms total; nine tiles/groups rebuilt; max
     slice 9 ms.
   - persistent cache: 380/380 tiles; zero skipped; max encode 3 ms; max parse
     1 ms.
   - friend composition: 2,001 self + 2,000 cells; max slice 59 ms; event-loop
     max 60.32 ms; zero rejected cells.
   - 10,000 distinct history: 51,628.05 ms total; p95 slice 9 ms; max slice
     17 ms; event-loop max 17.34 ms; zero retained sample loss.
   - sampled unsupported reveal: 0/8,000; exact 30 m boundary case passed.

   Runner artifacts and hashes:

   - `scale-final/memory-scale.json` —
     `0dee0622cb31f3fd8c74af6bad80ad0e98b4e9b1b1f2a98ad36b28ca9509c319`
   - `scale-final/jest.json` —
     `33a75a6bf93befb76d769961831de7d34fb011006b600c27a52875766a8a98a1`

3. Adjacent realistic Raw GPS, live-before-Finish presentation, and gap
   continuity:

   `cd app && node node_modules/jest/bin/jest.js src/features/memory/__tests__/revision03RawGpsPipeline.test.ts src/features/memory/__tests__/memoryLivePresentationEvidence.test.ts src/features/memory/__tests__/memoryFogContinuity.test.ts --runInBand --silent --json --outputFile=../docs/review/v1-closure/20260918T222838+0800/evidence/a4/dabf6ee6a60bbb7d5650d58a34978fab9413c3e0b03717ea8b3357be8f80836a/adjacent-memory-jest.json`

   Result: exit 0; **3/3 suites, 21/21 tests**. Live update maximum slices were
   3–12 ms. Artifact SHA-256:
   `a8e869b65ccea0c94824cd748378d3fc9daeacbaf15c24149653b624b212d802`.

   The first run emitted Jest's delayed-exit warning. The diagnostic command
   with `--detectOpenHandles` then passed the same 21/21 and exited 0 without
   identifying any open handle; no retry was used to change a failed result.

## Boundaries

This closes the local standard A4 software measurement only. It does not prove
native iOS scheduling, background GPS delivery, Mapbox/GPU paint, battery,
lock-screen behavior, physical-route fidelity, or field performance. No
backend, database, deployment, OTA, version, marker, or supervision hook was
touched. No owned process remains running.
