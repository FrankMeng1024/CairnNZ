# E01 — explicit expired cleanup proof

## Reproduced defect

The pre-fix `assertStoredCleanupPlan` accepted stored batch state `active` or `cleaned`, while migration 053 permits `active`, `expired` and `cleaned`. An exact batch explicitly transitioned to `expired` therefore failed before a new deletion-only grant could be used. The retained pre-fix reproduction is `e01-pre-fix-reproduction` in the external evidence directory.

## Bounded correction

- Cleanup validation now admits `active`, `expired` or `cleaned`; apply/advance code still requires the original active authorization and cannot reactivate an expired batch.
- Cleanup authorization schema v2 binds the actual server/database target, environment and realm, original batch and activation identity, immutable manifest, exact fixture object keys, reader IDs, and public/friend author IDs.
- `cleaned` is accepted only as an exact idempotent terminal verification. No generic admin delete path was added.
- The rehearsal now creates mixed fixture/non-fixture presentation and notification groups, a real partial interruption, and independently mutated target, batch, environment, realm, grant expiry, reader/author cohort, original activation, raw manifest and object probes.

## Exact-final real MySQL matrix

Executable source was `c3b765e0c8bc5f1b16c1e72f0eefdcd9a954434d`. Each run used a new local MySQL 8.0.36 container and database and removed its container plus anonymous volume on exit.

| Requested state | Observed before cleanup | Result |
| --- | --- | --- |
| `explicit-expired` | `state=expired`, TTL elapsed | 27/27 PASS |
| `active-elapsed` | `state=active`, TTL elapsed | 27/27 PASS |
| `active-valid` | `state=active`, TTL valid | 27/27 PASS |

The 27 checks in every mode cover: read-only plans/inspection; exact 60-object apply and reapply; cohort expansion rejection; partial apply recovery; two exact revisions; no expired reactivation; wrong target/confirmation/environment/realm/batch; expired cleanup grant; wrong reader and author cohorts; wrong original activation/manifest/object; exact partial cleanup; separate current cleanup permission; idempotent retry; mixed-group preservation; and zero live markers.

In the explicit-expired run, the simulated interruption left one fixture reference. Cleanup removed the remaining 59 marker rows; the immediate retry removed 0 and returned `alreadyCleaned=true`. Final verification found 0 live fixture markers across all eight audience/area cells. One ordinary marker, one mixed group/event and one mixed notification remained; fixture acquisitions, revisions, fixture-only group and fixture-only notification were zero.

No production/shared target was contacted and no Shanghai fixtures were activated outside the disposable schema.
