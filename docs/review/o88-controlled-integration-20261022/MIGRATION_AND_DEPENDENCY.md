# O88 combined migration and dependency disposition

## Migration identity and order

The frozen Hike/main delta adds no migration file. The reviewed Cairn history adds exactly these forward/rollback pairs after the existing 051 ledger:

1. `052_cairn_placement_provenance.sql`
2. `053_cairn_qa_fixture_cohorts.sql`
3. `054_memory_hit_push_explicit_opt_in.sql`
4. `055_notification_delivery_outbox.sql`
5. `056_notification_target_receipt_reliability.sql`

There is no filename/ordinal collision. The disposable current-schema fixture contains both Hike telemetry columns/indexes and Cairn marker-vote/abuse tables. Exact application and harness results are recorded in the external integration receipt package.

For a separately authorized future deployment, the safe order is: back up and verify the production ledger; apply 052 through 056 once in order; deploy the compatible backend/API and workers; verify cron registration and health; then make the tested client eligible. Code integration alone does not make an existing phone/server pair ready. No production migration, fixture or deployment is part of this integration.

## Dependency disposition

- Frozen installs use the committed lockfiles with `npm ci --ignore-scripts`; lifecycle scripts are intentionally not evidence of a native build.
- Web runtime remains on locked Mapbox GL JS 2 through `react-map-gl/mapbox-legacy`; the unused umbrella GL3 peer metadata remains visible to `npm ls` and is not hidden with overrides.
- `react-native-view-shot` remains outside Expo's expected version and requires an Owner/native-release decision.
- App audit findings and inherited TypeScript diagnostics are assessed separately in the exact-source receipts; no `audit fix --force`, SDK upgrade, second Mapbox major or blanket TypeScript suppression is authorized or used.
- iOS native capability remains a device gate. A Web-only import resolution neither proves nor requires a new binary by itself.
