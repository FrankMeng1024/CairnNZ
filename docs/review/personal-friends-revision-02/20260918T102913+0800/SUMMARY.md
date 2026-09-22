# Personal Journal / Friends Revision 02

## Verdict

The agreed Revision 02 software and locally executable verification are complete for the unpublished O60 candidate. Personal and Friends have independent software PASS verdicts. Physical iPhone, native Mapbox, native background/foreground, real GPS, actual iOS keyboard/safe-area/haptics, physical friend proximity, and New Zealand field behavior were not run and are not claimed. The whole app and owner acceptance are not claimed.

## Corrections delivered

- PF-R1: source, viewer, account, request, grant, and projection generations fence asynchronous friend Memory work before publication and persistence. Purge wins over in-flight reads and queued writes; a later valid reselection still works.
- PF-R2: the 250 m private mask is now a conservative ground-distance, whole-cell intersection predicate, verified at approximately -35, -41, -45, -47 and across the NZ-adjacent antimeridian.
- PF-R3: exploration coverage is spatially deduplicated while bounded real presence witnesses retain immutable first/latest observations and separate mutation signals.
- Personal Memory records from the accepted-point handler before Finish, without a server Activity ID or network. WAL/recovery, storage-failure, relaunch, duplicate-reconciliation, and idempotent Finish cases pass.
- Fog presentation uses one 30 m policy, exact evidence deduplication, stable incremental union, authority-scoped caching, content-complete signatures, bounded work slices, clipped cosmetic smoothing, and last-valid geometry only within the same authorization boundary.
- Downloaded friend Cairns and Routes use one viewer/owner/resource/revision/authorization-scoped cache with a non-renewing 24-hour maximum, rollback protection, detail reauthorization, durable local Hide, and immediate known-revoke/account purge.
- Borrowed Route use requires a current online lease or a previously issued unexpired offline lease, persists only minimal recovery geometry, preserves an active outing through later revoke, and clears locally at Finish/discard with a retryable idempotent terminal acknowledgement.
- Encounter eligibility remains friend-only, prospective, server-authorized, finalized-Activity/passive-real constrained, quality/continuity checked, and idempotent. It is not described as cryptographic proof of a person.

## Executed results

- Client Revision 02: 20 suites, 208/208 assertions PASS.
- Required `npm run verify:changed`: CORE gate, 508/508 PASS.
- Additional normal-store Personal journey coverage: 5 suites, 56/56 PASS.
- Backend focused contracts: 39/39 PASS.
- Isolated real HTTPS API + MySQL 8.0.45 A/B/C/D harness: 17/17 grouped assertions PASS, including two deliberately held late-response races.
- Expo Web visual run: 70 current production-screen captures across Day/Sunset/Night and 320x568, 390x844, and 430x932; loaded Memory asserted through real Web Mapbox where supported. A separate no-token run proves the map-unavailable management state.
- Synthetic standalone geometry on an Intel i5-5350U Mac: 582 ms maximum update build, 702 ms maximum including the 120 ms coalescing policy, 388 ms maximum synchronous slice, zero sampled prior-coverage loss, and zero unsupported reveal area. This is not phone performance or field evidence.

## Operations and identity

- Repository/deployed backend commit: `393338b5c159e7341d22b94086b5c29455386bdf`.
- Production image: `sha256:24c6e1d6862fc302490ec90531c8190d8c62d405d209a3fa5788b9a98d5f3e0d`.
- Review image: `sha256:6368de97533007f8db79998b7b2bcb7c590233929fe6c4198ae334160a49e87d`.
- Production and isolated review schemas are through migration 039; postconditions pass.
- Production and review HTTPS health are green. The production account sweep logged `hardDeleted=0` after restart.
- O60 and app version 0.2.6 are unchanged. No OTA was published.

## Evidence integrity

The failed pre-fix reproductions, failed review deployment attempt, corrected rollback/redeploy, MySQL collation failure, missing harness export mount, and initial TypeScript/test-envelope failures are retained. They are not rewritten as passes. `TIMING_ERRATUM.md` preserves the prior W1/W2/W3 records and marks unrecoverable completion times unknown.

