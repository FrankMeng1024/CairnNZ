# O70 official-source and integration audit

Status: integration audit in progress; official semantics and price authority
were checked before live dispatch on 2026-10-01.

## Official sources

- [Map Matching API v5](https://docs.mapbox.com/api/navigation/map-matching/)
- [Directions API v5](https://docs.mapbox.com/api/navigation/directions/)
- [Mapbox pricing](https://www.mapbox.com/pricing)
- [Mapbox Streets v8](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/)
- [Mapbox data sources](https://docs.mapbox.com/help/dive-deeper/mapbox-data-sources/)
- [Mapbox attribution](https://docs.mapbox.com/help/dive-deeper/attribution/)
- [DOC maps and open data](https://www.doc.govt.nz/our-work/maps-and-data/)
- [LINZ Data Service](https://www.linz.govt.nz/products-services/data/linz-data-service)
- [LINZ aerial imagery](https://www.linz.govt.nz/products-services/data/types-linz-data/aerial-imagery/access-aerial-imagery)

## Verified provider semantics

- Hike and Run use `mapbox/walking`.
- Map Matching accepts at most 100 `{longitude},{latitude}` WGS84 pairs per
  regular request. `radiuses` are per-observation values from 0–50 m; the
  documented default is 5 m and the documentation suggests 20–50 m only for
  genuinely noisy observations. Approximately five-second sampling is a
  recommendation, not authority to erase a sharp turn.
- Strictly increasing timestamps are epoch seconds and must correspond one for
  one with coordinates when present. Missing or non-strict clocks should omit
  the parameter rather than invent chronology.
- `overview=full` returns the detailed route geometry. Tracepoints identify
  observation correspondence; they are not a substitute for bends in the
  returned matching geometry.
- Null tracepoints, sub-match identity, `matchings_index`, `waypoint_index`,
  alternatives and provider confidence have different meanings and must remain
  distinct.
- Directions accepts up to 25 ordered waypoints for `mapbox/walking`; it
  returns routes between waypoints, not Map Matching confidence or proof that
  every interval was traversed.
- Streets v8 exposes road/path network data, buildings (all buildings at high
  zoom), and structure features including bridges, tunnels, walls/fences,
  gates and cliffs. Coverage varies by zoom/source. Absence in one rendered
  view is UNKNOWN, not proof of zero obstacles.

## Current source locations

- Token authority: `app/src/config/mapbox.ts`.
- actual Hike/Run Finish caller: `app/src/store/useTrackingStore.ts`.
- request planner, response parsing, section gates, Directions provenance and
  final assembly: `app/src/services/routing/pedestrianFinalRoute.ts`.
- observation preparation and mandatory turn/reversal/stop preservation:
  `app/src/services/routing/snapTrack.ts`.
- Activity request governor: `app/src/features/activity/activityMapboxRequestGovernor.ts`.
- asynchronous revision selector: `app/src/features/activity/activityFinalRefinementQueue.ts`.
- isolated QA Activity persistence and reopen authority:
  `app/src/features/activitySimulator/snapLabActivityStore.ts`.
- actual raw-source replay and WAL/Memory/Finish path:
  `app/src/features/activitySimulator/snapLabLogicalRunner.ts`.

The request/response evidence portion of this audit will be completed after the
predeclared U01 actual-app sentinel. No unrelated authentication probe is
authorized.
