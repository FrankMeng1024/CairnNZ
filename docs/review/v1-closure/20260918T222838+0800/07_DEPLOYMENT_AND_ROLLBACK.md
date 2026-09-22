# Deployment and rollback boundary

Follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md` exactly.

1. Identify review and production hosts, containers, image IDs, commits,
   database/schema ledgers, and Public feature state before writes.
2. Inventory and back up only affected Cairn test-business tables. Fence
   writers and stale generations before any reset. Preserve accounts,
   credentials, migration ledger, infrastructure, and de-identified GPS
   calibration fixtures.
3. Rehearse additive/corrective migration on isolated data; never rewrite an
   applied migration.
4. Deploy an explicit backend-only payload to the isolated review realm,
   enable Public only there, seed synthetic A/B/C/D/M identities, and run API,
   MySQL, operator, race, and rollback checks.
5. Production may receive only necessary backward-safe code/schema. Verify via
   actual endpoint calls that Public publishing/discovery/operator access stays
   server-disabled while Personal/Friends health remains green.
6. Record review and production image/commit/schema/feature identities
   separately. Roll back by the runbook's prior image/commit plus forward-safe
   schema handling; do not restore withdrawn Public access from caches.

No OTA publication, App Store change, billing change, public tunnel, broad
reset, or general Public enablement is authorized.

## Functional-run recovery observation — 2026-09-20T10:16:31+08:00

- No migration, deployment, database writer, API harness, or service restart
  from the failed overnight supervision run remains active or has an unknown
  outcome.
- Review container `691e61549515` (`cairn-v1-closure-mysql`) remains running
  idle and loopback-scoped at `127.0.0.1:3310->3306`.
- Unrelated container `f3b4d31e78f1` (`cc-builder-mysql`) remains untouched on
  host port `3306`.
- No database operation was executed during supervision recovery.

## Closeout deployment status — 2026-09-21T21:32:00+08:00

Status: **NO_DEPLOYMENT**.

- FINAL PF R8 and Public R15 used isolated, owned review fixtures only. Their
  cleanup receipts do not constitute deployment or production health checks.
- No backend image, production schema, feature flag, client runtime/build
  version, or OTA channel was changed by closeout. The single existing client
  marker was incremented O60→O61 for the validated owner-test candidate.
- General Public production enablement remains false. Native GPS/Mapbox,
  physical-device, field, battery and owner acceptance remain unverified.
- Formal release closure remains HOLD for A4 performance and FR-DISCOVERY
  plan evidence. The distinct owner-test gate is `OTA_CANDIDATE_READY` under
  the explicit convergence policy; this prepares but does not publish an OTA.
- The owner may manually publish the identified O61 candidate for physical
  iPhone testing after reviewing this package. Public must remain production-
  disabled. Any later backend deployment must separately follow
  `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`; do not infer deployment from
  the present functional receipts.
