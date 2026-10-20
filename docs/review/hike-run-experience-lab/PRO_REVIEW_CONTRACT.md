# Independent Pro Review Contract

This package is an evidence bundle, not an invitation to trust the author’s PASS labels. The reviewer should attempt to falsify the conclusions below with the frozen inputs and included scripts.

## Review boundaries

- Source baseline: commit `79b99a2b4b48f99658d4dc7cc564579d50603486`, tree `19d870b24215a83ca68835dc5299a4c836236314`.
- Candidate identity is recorded in package-root `SOURCE_IDENTITY.json` and the SHA-256 manifest.
- The clean diaries and reference geometries are post-run scoring inputs only. Confirm that no `references-private` or diary data reaches `PUBLIC_INPUT.json`, the app bridge, or provider requests.
- All Simulator Cairns must remain QA-local. Any `/api/markers` request containing the QA identity is a critical failure.
- Browser acceleration is evidence for deterministic product functions, not proof of native iOS scheduling, power, or background execution.

## Required challenges

1. Recompute corpus and file hashes, then extract the ZIP into a fresh directory and verify the manifest.
2. Audit every route’s `routeFeasibility` and provenance. Reject any clean path that crosses a building, wall, river without a crossing, or inaccessible terrain. Distinguish clean truth from deliberately noisy GPS points.
3. Run the successful, degraded and offline fresh-process replays with captured responses only. Fail the run if a new Matching/Directions request is attempted.
4. Compare baseline and candidate training metrics. Confirm the candidate does not claim a geometry improvement when the metrics are unchanged.
5. Inspect M05, U06 and both X04 variants. Challenge whether each missing segment is honestly preserved and whether any selected Final line bridges a true blackout.
6. Inspect the two X05 network schedules. Confirm that raw, canonical, Live, local Final and selected Final coordinates are identical after excluding generated Activity identities.
7. Inspect the Run → Plant screenshots and `PLANT_DURING_ACTIVITY.json`. Confirm one Cairn, exact activity identity, coordinate/accuracy/timestamp provenance, zero marker API calls, and return to the same recording.
8. Stress repeated Activity Detail/theme navigation on Mapbox GL JS v2. Look specifically for `undefined.send`, blank accepted maps, stale global map references, and missing basemap features.
9. Audit the Web cache-trim workaround. Challenge the use of Mapbox private `_setCacheLimits`; confirm it is guarded, Web-only, and does not affect RNMapbox native.
10. Confirm the strict production marker HTTP body has not silently acquired fields unsupported by the deployed backend.

## Claims that must not be upgraded

- Do not call this native GPS acceptance: no compatible iOS simulator/device or `simctl` was available.
- Do not infer battery life, iOS suspension reliability, or native background callback behavior from Playwright.
- Do not call retained blackout distance undercount a PASS merely because supported coverage is high.
- Do not treat Final timestamp-attributed stationary growth as a reliable stop metric; use Raw/Canonical/Live plus visual review.
- Do not approve OTA merely from this package. The Home marker remains O87 by design.

## Reviewer output requested

Return one of `ACCEPT_FOR_TARGETED_IPHONE_QA`, `REQUEST_CHANGES`, or `REJECT_EVIDENCE`, with:

- challenged claim and exact evidence path;
- reproduction command and observed hash/result;
- route-feasibility decision for every disputed case;
- any broader regression caused by the selected candidate;
- the minimal additional evidence needed, avoiding a request to rerun already reproducible Web/captured-response work.
