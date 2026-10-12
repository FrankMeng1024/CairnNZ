# Memory / Friends / Cairn test results

Candidate code checkpoint: `a5967b50bc7336304380f1b8ff6ae9c349639fa3`

| Scope | Command | Result | Important limitation |
|---|---|---|---|
| Activity/Snap core gate | `cd app && npm run verify:activity:core` | PASS 625/625 | Run at `80d2c32`; final `a5967b5` changes backend only and has an identical `app/` tree; Source/Jest, not native GPS telemetry |
| Locked Snap fingerprints | baseline/candidate replay | Hike `f678f89d`, Run `a1479659` | 16/16 at `80d2c32`; final `app/` tree identical; captured provider fixtures only |
| Memory/Friends/Cairn client | targeted Jest set | PASS 146/146 | Web/Jest; known open-handle warning retained |
| Backend units/source contracts | all backend `*.test.js` | PASS 129/129 | Supplements real route tests |
| Personal/Friends HTTP+DB | `backend/scripts/run-personal-friends-harness.sh` | PASS 21/21, MySQL 8.0.36 | Disposable local realm |
| Public regression + Cairn HTTP+DB | `backend/scripts/run-public-cairn-harness.sh` | PASS 21/21 + 24/24 | Disposable local realm; final Cairn run skips already-proven Public baseline |
| Production-mode viewer gate | `HARNESS_MODE=memory-public-gate ...` | PASS 2/2 | `NODE_ENV=production`; Friend-only allowed, Public viewer allowlist enforced |
| Migration rollback | apply 035-045, execute 045 down, query schema | PASS `0 / 0 / 0 / 1` | Destructive down is review/emergency-only |
| TypeScript | `npx tsc --noEmit --pretty false` | 159 existing errors; 0 in changed production client files | Full repository is not type-clean |
| Web visual | Expo Web 390x844 + Playwright | 10 PNG, runtime errors 0 | `WEB_FIXTURE`; Mapbox unavailable/no compositing |
| Full repository gate | `cd app && npm run verify:full` | FAIL 1 of 1,943; 1,938 pass, 4 pending | One Memory wall-clock slice measured 2,278 ms while Expo/Metro workers were live; failure retained |
| Isolated failing scale case | exact failing Jest file after stopping Expo workers | PASS 6/6; max slice 16 ms | Diagnoses scheduler contamination; does not erase the retained full-gate failure |

## Real discovery coverage

The final HTTP/MySQL run covers:

- 3 of 200 ordinary candidates and stable repeated polling;
- 5, 20 and 100 guaranteed same-author Friend Cairns; one presentation group;
- current-Friend Public priority against 200 ordinary Public candidates;
- rejected mismatched Activity witness, accepted finalized canonical evidence,
  and accepted unfinished-Hike evidence only after its route prefix ACK;
- no global cooldown across different localities;
- stationary denial after publication, friendship or Friends-audience begins;
- stationary denial after a Friends-only content revision, followed by genuine revisit acquisition;
- authenticated `PUT /api/markers/:id` v1-to-v5 material updates whose
  millisecond content frontier is strictly later than the already-open visit;
- exact millisecond equality between content/public/friendship authority and
  visit entry failing closed rather than becoming a stationary unlock;
- genuine departure, elapsed revisit gate and fresh re-entry;
- v1 retained, v5 acquired only on a later legitimate visit;
- atomic logical revision deduplication across Friend/Public snapshot rows;
- production-mode Public viewer allowlist without blocking eligible Friend-only Cairns;
- cross-audience logical revision moderation, including legacy Friend/Circle/Public reads;
- aggregate author Thanks, idempotent reader Thanks and self-Thanks rejection;
- reader Remove blocking history/read/Thanks and later reacquisition;
- revision-only freeze/remove versus source-wide freeze/remove/restore;
- authenticated report/appeal and irreversible confirmed purge.

Measured isolated DB/API timings varied under local load. In the two final
review-closure passes, 20 Friend overflow took 1.306–1.417 seconds and 100 took
6.003–7.183 seconds. The latter is a known release risk.

## Retained initial failures

The evidence folder keeps each first failure rather than replacing it:

1. MySQL rejected `JSON_TABLE` combined with the trailing `FOR SHARE`; the
   unnecessary read lock was removed under the already locked viewer transaction.
2. The Friend fixture omitted the production `marker_audience_epochs` invariant;
   the fixture was corrected.
3. A 20-Friend load returned 16 after exposing timezone/eligibility ambiguity.
   Production comparisons now use SQL Unix milliseconds, avoiding Beijing/UTC
   parsing drift, and fixtures distinguish old content from during-visit content.
4. Fresh-return fixtures initially supplied only one observation after publication;
   they now provide two post-boundary observations over the real 10-second span.
5. One audience fixture used invalid enum `private`; corrected to production
   `personal` without changing application behavior.
6. One late Public harness detail read returned 404 after about 221 seconds and
   did not reproduce in the next complete run. An earlier explicit encounter
   ACK assertion was added so the prerequisite can no longer fail silently.
7. The first production-mode viewer-gate fixture supplied an empty sensitive-zone
   policy, which production correctly rejects. The isolated fixture now supplies
   one far-away nonempty zone; authorization semantics were not relaxed.
8. The first logical-revision run exposed duplicate v5 acquisitions through
   Friend/Public snapshot rows. Migration 045 and the insert path now enforce
   `(viewer_id, marker_id, content_revision)` atomically; the 23/23 rerun passed.
9. The full repository gate recorded a 2,278 ms wall-clock slice while Expo/Metro
   workers were running. The exact isolated file then passed with 16 ms maximum
   slice after those workers were stopped. Both results are retained; no budget
   or implementation was changed to obtain the pass.
10. One parallel MySQL run passed the Public 21/21 suite but the following
    Memory harness stopped after 12 assertions because the edit timestamp and
    post-edit visit entry landed in the same MySQL millisecond. Production
    correctly failed closed. The fixture now deliberately crosses that clock
    boundary; the subsequent nonparallel run passed 23/23.
11. The first millisecond-frontier migration rehearsal added the new column but
    then failed while changing its default; the harness retried the whole DDL
    file and surfaced a duplicate-column error. The migration now adds the
    final default in its first DDL statement; the next isolated apply passed.
12. The next run acquired only 3 of 5 seeded Friend Cairns because old fixture
    rows relied on the new current-time default. Fixtures now set their explicit
    historical content frontier; the unchanged production selection then passed
    24/24. Neither failure was retried away without diagnosis.

## Performance evidence

- 2,001-point diagnostic cold fixture: about 10.13 seconds.
- 2,001-point incremental geometry: about 237 ms.
- 10,000-point diagnostic fixture: about 49.13 seconds.
- Maximum synchronous slice in the isolated diagnostic: 17 ms.
- These are local Jest/fixture timings, not device frame-time guarantees.
