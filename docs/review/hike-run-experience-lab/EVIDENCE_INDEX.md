# Hike / Run Experience Lab Evidence Index

The review ZIP preserves original relative source paths under `source/` and campaign artifacts under `evidence/`. Start with:

- `reports/EXPERIENCE_LAB_REPORT_CN.md` — executive result, tradeoffs and uncertainty.
- `reports/PRO_REVIEW_CONTRACT.md` — falsification-oriented independent review instructions.
- `reports/IPHONE_FOLLOWUP_CHECKLIST.md` — the remaining native-only checks.
- `reports/ITERATION_HISTORY.md` — rejected experiments and the evidence used to accept or revert them.
- `SOURCE_IDENTITY.json` — baseline, candidate commit/tree, branch and app/runtime/OTA identity.
- `MANIFEST.sha256` — complete package file manifest (excluding itself).
- `evidence/activity-output-atlas-03/ACTIVITY_OUTPUT_ATLAS.jpg` — all 15 Live/Final/hidden-truth comparisons on one real Mapbox Outdoors map.
- `evidence/activity-output-atlas-03/VISUAL_JUDGMENT.json` — structured post-run judgment for every case.
- `evidence/physical-route-atlas/PHYSICAL_ROUTE_ATLAS.jpg` — clean route feasibility atlas prepared before tuning.
- `evidence/comparison/CANDIDATE_COMPARISON.json` — baseline/candidate equality, three fresh-process replays and paired online/offline comparison.

## Corpus

`evidence/frozen-corpus/` contains the complete frozen contract inputs:

- `FROZEN_CORPUS_MANIFEST.json` and SHA receipt;
- public noisy observations/event schedules;
- private traveller diaries and clean references used only by post-run scoring;
- physical-feasibility records and captured Mapbox walking responses;
- calibration/holdout labels and deterministic seeds.

Corpus SHA-256: `c2c5b2235d0092c24bdbb11b0d736578d5d839badeef7f9599621270abc14339`.

## Product runs

- `evidence/baseline-*` — original baseline actual-app runs and deliberately retained failed attempts.
- `evidence/candidate-training-*` — exact captured-response candidate replay for all 11 training cases.
- `evidence/holdout-live-online/` — three unseen live Mapbox product runs.
- `evidence/holdout-offline-reconnect/` — paired unseen offline save/cold-open/reconnect run.
- `evidence/candidate-run-plant-flow-13-final/` — accepted full Run → Plant → same recording proof, including real basemap visibility after returning to the Run.
- `evidence/fresh-process-replay-{success,offline}/` plus the Plant replay — successful, degraded and offline fresh-profile replay evidence.
- `evidence/candidate-renderer-final-no-reuse/` — final three-map/cold-open/day-sunset-night stress after rejecting `reuseMaps`; runtime errors and capture recoveries are both zero.
- earlier `candidate-renderer-*`, `candidate-map-visibility*` and `candidate-run-plant-flow-*` directories are rejected iterations, not PASS evidence.

Each accepted product-run directory includes `RUN_RESULTS.json`, `NETWORK_BOUNDARY_AUDIT.json`, `QA_ACTIVITY_SHELF.json`, phone screenshots, public input, complete `QA_ACTIVITY.json`, captured-response receipts and theme evidence where applicable.

## Metrics and accounting

- `evidence/baseline-evaluation/TRAINING_METRICS.json`
- `evidence/candidate-training-evaluation/TRAINING_METRICS.json`
- `evidence/holdout-evaluation/HOLDOUT_METRICS.json`
- `evidence/mapbox-request-ledger.json` — 64 Matching + 14 Directions = 78 navigation requests, estimated USD 0.156.
- `evidence/verification/VERIFICATION_SUMMARY.json` — exact gates, outcomes and known red gate.

## Source and reproduction

- `source/app/` and `source/docs/` contain every changed/new source file at the delivered candidate commit.
- `source/baseline-to-candidate.patch` is the binary-safe Git patch from the frozen baseline.
- `source/changed-files.sha256` hashes the copied source subset.
- `source/app/package.json` and `source/app/package-lock.json` pin dependencies; `node_modules` is intentionally excluded.

From repository root after installing the existing locked dependencies:

```sh
cd app
npm run verify:changed
npm run verify:activity:gps
npx jest src/components/__tests__/mapboxWebConsumerCoverage.test.ts \
  src/screens/__tests__/runningQuickCairnHandler.test.tsx \
  src/screens/__tests__/plantActivityLinkage.test.tsx \
  src/store/__tests__/useMarkerStore.fastAck.test.ts \
  src/features/cairns/__tests__/cairnIdentity.test.ts \
  src/features/activitySimulator/__tests__/simulatorContracts.test.ts --runInBand
```

The replay/atlas scripts are in `source/app/scripts/`. They accept explicit `--corpus`, `--results`, `--output`, `--ledger`, and captured-response roots; paths in existing receipts show the invocation layout. Never place a Mapbox token in the review package. Live/atlas reproduction must obtain it from the authorized EAS environment or another reviewer-approved secret authority.
