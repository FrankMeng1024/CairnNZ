# Engineering evidence index

## Source and reproducibility

- Corrected commit: `eec4ce0eeb31bcbe2bf7357525016372123f55a3`.
- Review parent: `cfcf19d8ffea3c98cbef117154b6c91f321e0f2f`.
- `git diff --check`: clean after the final source checkpoint.
- The compact package contains:
  - `SOURCE_PATCH/cfcf19d8_to_final.patch`;
  - complete final copies of every file changed from the review parent;
  - relevant package/lock/config and migration authority;
  - a SHA-256 manifest and secret/privacy scan report.

## Automated and deterministic verification

| Evidence | Result | Boundary |
|---|---:|---|
| Focused Plant lifecycle/draft suites | 19/19 | React/storage substitutions plus real core UI counterpart |
| Activity change-aware verification | 418/418 | Required shared-Activity gate; no retry-to-green |
| Full app Jest | 246/246 suites; 2,409 pass, 4 skip, 0 fail | JSON result is authoritative; completed runner retained known async handles |
| Backend Node | 198/198 | Final checkpoint, including push and Shanghai authority cases |
| Push response/receipt cases | PASS | Valid control; invalid JSON; empty/short/extra/top errors; missing identity; unknown status; partial target; revoked token; body stall; exhaustion; missing/failed receipts; repeated drain |
| Map latest-intent cases | 18/18 | A→single B, A→cluster B, Back/dismiss, focus, theme/data, account, failure/unmount |
| Notification/presentation focused set | 43/43 | Retry, exact revision, account/readiness, visibility acknowledgement |
| Headless/background focused set | 14/14 | Later callback/no new sample, stalled body, durable evidence, owner change, bounded work |
| Publication/provenance/notification combined set | 71/71 | Creation/edit truth and encounter provenance |
| Shanghai authority unit set | 8/8 | Forged label, target mismatch, changed cohort, expiry, production gate |

The final backend TAP log is `backend-node-tests-final.log`. The full app JSON
is `app-jest-authority.json`.

## Real isolated auth/API/MySQL

### Connected loaded client journey

`connected-ui/RESULTS.json`: **7/7**, 11 screenshots, zero runtime errors.

- Real `/auth/login` and `/auth/me` for author, reader and operator.
- Actual Plant handler creates a pending Public Cairn in isolated MySQL.
- The only direct operator step approves the exact revision.
- Actual Activity evidence/discovery creates one acquisition and presentation.
- Normal Open reads the exact acquired revision; Thanks is idempotently stored.
- Normal owner Edit creates v2; normal Withdraw removes the source.
- Reader retains acquired v1; offline reload does not replace it with v2.
- Final DB counts: acquisitions 1, opened 1, thanked 1, presentations 1,
  retained revisions after deletion 1.

The recorded candidate fingerprint is retained in `RESULTS.json`. This journey
ran before only the final Plant first-entry discard and numeric/string relaunch
normalization delta. Those paths subsequently passed 19/19 focused tests and
the 22-state production-screen reload capture. A fresh exact-final disposable
rerun was attempted on 2026-10-21; Docker MySQL failed before schema creation
with host error 28 because the local anonymous-volume store had no free space.
No assertion ran or failed. Unrelated Docker volumes were not pruned.

### Memory/Friends/authorization harness

`real-db/cairn-memory-result.json`: **35/35**.

- 1,005 found and 1,005 owner rows traverse complete keyset pagination.
- Ordinary/Friends/QA cohort/legacy authorization, temporal cadence, revision,
  revocation and moderation negatives pass against disposable MySQL.
- 60-Cairn external latency, seven trials:
  - cold p50 2,613.6 ms, p95 2,717.4 ms;
  - warm p50 67.3 ms, p95 79.9 ms.

No shared or production database was contacted or mutated.

## Performance evidence

- Client Memory geometry, full-app authority:
  - 2,001 points cold 2,151.1 ms;
  - incremental update 240.4 ms;
  - 10,000 points total 10,100.9 ms;
  - worst cooperative phase 86 ms (tile geometry).
- Activity 20,000-point run: total 15,689 ms, maximum synchronous slice 20 ms.
- These are machine-specific Web/JS measurements. They separate total cold work
  from cooperative slice size and do not certify phone frame rate, thermals or
  battery behavior.

## TypeScript comparison

Both parent and final candidate were run with `npx tsc --noEmit` in the same
app configuration:

- status 2, 159 diagnostics, 15 files for each;
- normalized output byte-identical;
- SHA-256 `b15c0d9be737e85e40e9b53885c2dc19d79a21212169425c2a3a4093febd67f0`;
- no diagnostic in a file changed from `cfcf19d8`.

Classification: 100 generated Friends screen; 36 Playwright specs; 13 preview
screens; 5 Activity orchestration test; 2 background diagnostic test; and one
each in Turf/Memory helper, Activity parity and Playwright config. This is
bounded pre-existing debt, not represented as green and not hidden with
`ts-nocheck` or deleted assertions.

## Field-plan safety

The source package contains the v2 field review, target allowlist, authority
module, migration and rehearsal scripts. Disposable rehearsal covered target
inspection, exact approval, changed cohort rejection, deliberate partial state
recovery, exact idempotent reapply, revision and cleanup. Production/shared
apply is still blocked on a new exact Owner approval and was not executed.
