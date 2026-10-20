# Hike/Run quality-upgrade frozen rubric

Frozen before candidate tuning on 2026-10-20. Clean route geometry and traveller diaries are evaluation-only and never enter the app or replay process.

## Population and denominator

- The regression population is the eleven previously frozen route families plus nine new geographically distinct families.
- The new corpus has one ordinary profile for every family and one independent second profile. The plan labels the second profile either ordinary or supported-difficult before noise is generated.
- The product target is **more than 90% Excellent among representative ordinary journeys**. Difficult journeys are reported separately and cannot inflate that denominator.
- A journey with invalid physical provenance, an impossible clean path, incomplete output, missing export evidence, or a production-branch bypass is excluded as invalid evidence, not counted as a pass.

## Human verdicts

### Excellent

All of the following are true:

- The Live line is calm while moving and standing, its head follows the person without a conspicuous hook, and an ordinary turn appears promptly rather than being cut.
- The saved Activity is recognizably the walked sequence at normal mobile map zoom: no false shortcut, parallel-path theft, invented loop, long endpoint hook, or erased intentional return.
- Start and end are locally credible; stationary growth is at most 8 m; ordinary departure lag is at most 8 s.
- No supported interval is silently lost. An actual outage may remain an explicit unsupported gap but must not create a fictional connector.
- Save/reopen identity, Memory projection, server acknowledgement, and eligible local cleanup agree exactly once.
- A complete diagnostic export is independently replayable in a fresh process.

### Graceful degradation

The Activity remains useful and temporally ordered, but a localized defect is visible in a difficult evidence window. It must have no fabricated long connector or topology change, remain within three localized Route edits, preserve the original Activity and Memory, and retain a complete replay export.

### Unacceptable

Any material sequence/topology error; route through an obstacle; loss of a normal turn/return; repeated or long endpoint hook; unbounded stop scribble; silent GPS-loss bridge; save/sync duplication or premature cleanup; mutable original Activity/Memory during Route correction; incomplete or non-replayable diagnostics; crash; or production branch not exercised.

## Quantitative corroboration

Metrics inform but do not replace the human verdict:

- order-aware sampled Fréchet-style progression and backtrack/return preservation;
- cross-track mean, p95, and maximum, reported with supported coverage rather than used alone;
- signed distance error, start/end displacement, false-turn count, stop-window growth, restart and recovery lag;
- Live head displacement and frozen-prefix mutations over time;
- output segment/topology changes and explicit unsupported intervals;
- sync attempts, idempotency key, acknowledgement, cold reopen, Memory count, and cleanup state;
- export record counts, checksums, declared omissions, and fresh-process geometry fingerprints;
- bounded storage, CPU/runtime, request count, and package size.

The thresholds above are fixed for this campaign. Named-route exceptions, denominator changes, and post-hoc tolerance changes are prohibited.
