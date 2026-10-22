# O88 combined migration and dependency disposition

## Migration identity and order

The frozen Hike/main delta adds no migration file. The reviewed Cairn history adds exactly these forward/rollback pairs after the existing 051 ledger:

1. `052_cairn_placement_provenance.sql`
2. `053_cairn_qa_fixture_cohorts.sql`
3. `054_memory_hit_push_explicit_opt_in.sql`
4. `055_notification_delivery_outbox.sql`
5. `056_notification_target_receipt_reliability.sql`

There is no filename/ordinal collision. The disposable current-schema fixture contains both Hike telemetry columns/indexes and Cairn marker-vote/abuse tables. Exact application and harness results are recorded in the external integration receipt package.

The inherited Hike/Run client-to-backend closure wrapper also now applies 052–056. Its first combined run proved all six browser/API cases but exposed that the wrapper stopped at 051 and that its DB postcondition expected five Memory sources while the current late-ACK deletion contract deliberately retains the sixth Activity's independent Memory facts. The wrapper now rehearses the full combined ledger and expects all six distinct six-fact Memory sources; production code and data semantics are unchanged.

For a separately authorized future deployment, the safe order is: back up and verify the production ledger; apply 052 through 056 once in order; deploy the compatible backend/API and workers; verify cron registration and health; then make the tested client eligible. Code integration alone does not make an existing phone/server pair ready. No production migration, fixture or deployment is part of this integration.

## Dependency disposition

- Frozen installs use the committed lockfiles with `npm ci --ignore-scripts`; lifecycle scripts are intentionally not evidence of a native build.
- Web runtime remains on locked Mapbox GL JS 2 through `react-map-gl/mapbox-legacy`; the unused umbrella GL3 peer metadata remains visible to `npm ls` and is not hidden with overrides.
- Exact combined Web probing found a GL2 readiness edge: hosted styles, sprites, vector tiles and glyphs all returned successfully and rendered real features, while immediately-refreshing vector tiles remained in GL2's `expired` state and prevented its strict `load`/`idle` events. The adapter now has a Web-only fallback that declares readiness only after a feature from a hosted Mapbox source in the active style is actually rendered. It does not accept local overlays or a merely mounted canvas, and native RNMapbox behavior is unchanged.
- Repeated rapid Activity/theme remounts also reproduced a GL2 teardown race: an IndexedDB tile Promise could finish after `Style#_remove` emptied its dispatcher and then attempt `getActor().send`. The Web adapter now guards only an already-retired GL2 dispatcher; live actors keep the original Mapbox selection path, future GL3 shapes are not patched, and native is untouched. Focused tests and three consecutive 34-state matrices passed with zero runtime errors.
- `react-native-view-shot` remains outside Expo's expected version and requires an Owner/native-release decision.
- App audit findings and inherited TypeScript diagnostics are assessed separately in the exact-source receipts; no `audit fix --force`, SDK upgrade, second Mapbox major or blanket TypeScript suppression is authorized or used.
- iOS native capability remains a device gate. A Web-only import resolution neither proves nor requires a new binary by itself.
