# A4 independent-counterexample disposition

Completed: `2026-09-20T12:14:22+08:00`

## Verdict

**PASS for the reopened A4 correctness counterexamples at exact product
fingerprint `097d36a59d0744b83962e8d16ca6671bd2aa11d6ad6b8f955ec6eb374ce6acbf`
(638 files).** Closed three-corner friend input is rejected, exact half-open
8×8 input is accepted at the unchanged 64-tile cap, combined friend ordering
uses code-unit comparison, and a self 30 m footprint crossing either side of
the antimeridian remains present in valid rendered fog geometry.

This does not replace or silently extend the earlier performance disposition.
The standard A4 performance run at `dabf6ee6...` remains historical PASS and
the 384 MiB constrained-heap sensitivity remains historical FAIL. Both are
source-stale after this `FogLayer.tsx` correction. No unchanged performance
retry, threshold weakening, radius widening, browser, or native claim was
made here.

## Baseline and fail-sensitive RED

- Assigned baseline: `5fb82a42407b7bcbe07ac5af62fe821245a92a36687932f63925ee73c8a3b75c`
  (637 files).
- Independent package:
  `/Users/mzm/Desktop/cairn_revision03_work/candidates/a4-f6-independent-review-20260920T112634+0800/`.
- Verified package hashes: `REVIEW.md` `3bdd6e66...`,
  `PROPOSED_FOCUSED_TESTS.md` `08f7b025...`, manifest `6e3a4d33...`, and
  proposed fog test `a33874b5...`.
- Exact proposed suite command:
  `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/fogBoundaryCounterexamples.test.ts --runInBand --no-cache --json --outputFile=/tmp/cairn-a4-boundary-red.json`.
- Result: exit 1, **0/4**. Triangle, tile maximum, and locale collation were
  valid product REDs. The proposed antimeridian test stopped first on an
  incorrect assumption that Turf normalizes `destination` longitude.
- The fixture alone was corrected to wrap the east probe explicitly, then:
  `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/fogBoundaryCounterexamples.test.ts --runInBand --no-cache -t ANTIMERIDIAN --json --outputFile=/tmp/cairn-a4-antimeridian-corrected-red.json`.
- Result: exit 1, **one valid product failure**: the wrapped 20 m east probe
  was absent. The later latitude offset only removed the intentional
  sub-millimetre tile-seam gap from the cardinal probe; it did not change the
  demonstrated pre-fix east-side loss.

RED artifacts:

- `verifier-boundary-red.json` — SHA-256
  `1b93ac35ec50f997eeb5e16897ea9696d5955c9a48655b0371382fea2f270007`.
- `antimeridian-corrected-red.json` — SHA-256
  `0a6b9903aaf07ecc6c93ec845d242f5d8a4a1bb121d0699ce5c57c72d93f9113`.

## Smallest demonstrated correction

Changed product file: `app/src/features/memory/components/FogLayer.tsx`.

- A friend cell is rectangular only when its finite ring is closed, includes
  all four bounding corners, and every edge is axis-aligned. The triangle no
  longer becomes an unsupported bounding box.
- Maximum friend tile indices use the rectangle's exclusive upper bound.
  Exact `[0, 0]..[0.008, 0.008]` therefore counts 8×8, not 9×9; the cap stays
  exactly 64.
- Combined tile and per-tile friend feature keys reuse the existing code-unit
  comparator; locale collation is absent.
- Overflowing self tile x indices wrap into `[-180, 180)`. Each evidence point
  is shifted by the corresponding whole-world longitude only for its local
  wrapped tile before the unchanged exact 30 m circle is clipped.
- The first world tile applies the same `1e-9°` half-open inset already used
  on upper tile edges. This keeps evidence holes strictly inside the world
  polygon and can only under-reveal by a sub-millimetre amount.

No sampling, 30 m radius, circle resolution, friend density cap, gap rule,
history selection, or authorization source changed.

Final file SHA-256:

- `FogLayer.tsx`: `edd5f8fc9bef82c231d5212cf10593dd268a24a235c7d42bef4e034049865422`.
- `fogBoundaryCounterexamples.test.ts`:
  `f255a0f36cb778877292c186367205ad4cf6986ff6eed9a4a1610fc0df2de94d`.

## GREEN and adjacent verification

1. Consolidated focused command:

   `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/fogBoundaryCounterexamples.test.ts src/features/memory/__tests__/memorySyncReconcile.test.ts src/screens/__tests__/settingsAccountBoundary.test.tsx --runInBand --no-cache --json --outputFile=/tmp/cairn-a4-f6-focused-green-final.json`

   Result: exit 0, **3/3 suites, 16/16 tests**. The fog file contributes 5/5,
   including evidence and valid composed fog on both +180° and −180° sides.
   `focused-green-final.json` SHA-256:
   `2fdcf56f0abfe5fa5d845faaefa2927ebc20c83ea7165b8b3d6b8180e7c5d145`.

2. Adjacent Memory authority and gap continuity:

   `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/memoryFogContinuity.test.ts src/features/memory/__tests__/memoryEvidenceAuthority.test.ts --runInBand --no-cache --json --outputFile=/tmp/cairn-memory-adjacent-green.json`

   Result: exit 0, **2/2 suites, 16/16 tests**. Artifact SHA-256:
   `db763535481219ad34c454b55ef7a36f8bed316bc161d388ff8cb9aab55fb784`.

3. Functional live presentation subset, deliberately excluding the held
   performance case:

   `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/memoryLivePresentationEvidence.test.ts --runInBand --no-cache -t "repeat traversal|turns and parallel|tiled production geometry" --json --outputFile=/tmp/cairn-memory-presentation-functional-green.json`

   Result: exit 0, **3/3 selected tests**. Repeat history does not inflate,
   turns and parallel sections preserve their footprints without filling the
   hole, and the production tiled path preserves the 30 m boundary and true
   gaps. Artifact SHA-256:
   `0eb36d53a0bc8c4517067f69e72cae5cac52d03ec6af9aae9fe5a9e399ce40c2`.

4. Exact radius:

   `cd app && ./node_modules/.bin/jest src/features/memory/__tests__/revision03MemoryScale.test.ts --runInBand --no-cache -t "single tiled footprint stays within the exact 30 m" --json --outputFile=/tmp/cairn-memory-radius-green.json`

   Result: exit 0, **1/1 selected test**; every vertex is at most 30.005 m
   and the 30.05 m probe remains outside. Artifact SHA-256:
   `7a1f1d4c448c0f361b54b4a62cac72508e029734b7a727cf41076abe1e9fff13`.

5. Simulated-owned-file Activity changed-scope gate:

   `cd app && npm run verify:changed -- --gate=core --file=app/src/features/memory/components/FogLayer.tsx --file=app/src/services/memorySync.ts --file=app/src/screens/SettingsScreen.tsx --file=app/src/features/memory/__tests__/fogBoundaryCounterexamples.test.ts --file=app/src/features/memory/__tests__/memorySyncReconcile.test.ts --file=app/src/screens/__tests__/settingsAccountBoundary.test.tsx`

   Result: exit 0, **Activity CORE 457/457**: continuity 35, cadence 5,
   background 25, gap 14, elevation 5, matching 42, telemetry 38,
   integration 106, Memory gap 5, recovery 35, Memory 26, offline/sync 36,
   simulator shared 56, server 23, and scoped static 6.

The ordinary dirty-tree router explains FULL because unrelated preserved
`app/package.json` work is already present; the explicit owned-file core gate
prevents that unrelated diff from expanding this closure run. A direct global
compiler diagnostic also reported 168 existing repository diagnostics and
zero diagnostics in the six owned files.

## Stale-evidence impact and limits

- Prior exact-source A4 performance and loaded-web artifacts remain retained
  but are stale for `097d36a...`; they are not claimed as current-source
  performance or loaded UI evidence.
- Previously accepted realistic Raw GPS, history, gaps, and live-before-Finish
  evidence was not rewritten. Adjacent source-contract checks remain green,
  but no loaded browser/native replay occurred in this counterexample pass.
- No backend, database, deployment, OTA, marker/version, supervision hook, or
  F1/F2 harness file changed. No owned process remained after verification.

