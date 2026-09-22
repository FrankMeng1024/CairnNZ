# FR-DISCOVERY-500 v2 MySQL plan gate — FAIL/HOLD

Date: 2026-09-20  
Preimage fingerprint:
`fa986cc808e067b98563d9cf72fa6cd885d038d414fafe342d98a9f701b1bff5`
(645 files)  
Integrated fingerprint:
`bcd168db8240d24302e6559451d0f0e1af5d2957d17b651bc177524b6d6ae698`
(646 files)  
Verdict: **FAIL/HOLD** at the N=2,001 real MySQL plan-shape gate.  
N=10,000: **NOT_RUN**. Preserved E/F API/MySQL harness: **NOT_READY / NOT_RUN**.

## Candidate integration

Primary-writer and HEAVY_EXCLUSIVE ownership was held by
`/root/a4_memory_primary`. Existing dirty/untracked work was preserved.

The frozen product candidate was:

`/Users/mzm/Desktop/cairn_revision03_work/canary-friend-discovery-500/product-fix-v2-20260920T140515+0800/`

Its product patch SHA-256 was reverified as
`f4c04fd76e75f0f2b45bc06e7460100d58714af1bf8a1d57bb8fd5ff819fe6a0`.
Before application, the protected preimages were exact:

- `backend/src/routes/friend-content.js`:
  `1d02791a7e54c7d125cd688528ca46583b6f0f0fc397cfd8379ad9ee54a1252a`;
- `backend/src/services/encounterPolicy.js`:
  `c99226e4cfb013151c72287db8790e779f45b4c6a1d7e9e1bd50f9536a091ae2`;
- `backend/src/services/activitySourceProvenance.js`:
  `719ade4404d064df5bdf867496270b6f9b6a61643fd2d5a6c68946dd6e8b13cd`.

The new service/test/old-runner target paths were absent. Both commands passed
against the current dirty tree before application:

```sh
git apply --check --whitespace=error-all /Users/mzm/Desktop/cairn_revision03_work/canary-friend-discovery-500/product-fix-v2-20260920T140515+0800/patches/FR-DISCOVERY-500-product-fix-v2.patch
patch --batch --dry-run --fuzz=0 -p1 -d /Users/mzm/Desktop/cairn/CairnNZ < /Users/mzm/Desktop/cairn_revision03_work/canary-friend-discovery-500/product-fix-v2-20260920T140515+0800/patches/FR-DISCOVERY-500-product-fix-v2.patch
```

Only the product-v2 changes were applied:

- `backend/src/routes/friend-content.js`, resulting SHA-256
  `3c2e99beac0f71d06ceb2f379ee080e3c9bb9192072756fa1b60787b12fd19d8`;
- new `backend/src/services/friendDiscoveryCandidates.js`, byte-identical to
  the reviewed candidate, SHA-256
  `fa8188505f62ec9732eb4224bd0b09023d93ee9c5d2acf49ed700e50e139a4bb`.

The patch moves current friendship/audience/owner/block/already-encountered
authority, conservative wrapped spatial filtering, exact 50 m filtering,
freshness, and finalized eligible source-session selection ahead of canonical
JSON expansion. It retains passive-evidence bypass, canonical same-session /
segment / ±1 second / 5 m binding, newest-100 and 10-second-to-30-minute
qualification, stable 500-marker ordering, `FOR UPDATE`, and exact JavaScript
revalidation. No migration, dependency, lockfile, hook, deployment, Public
enablement, or unrelated route changed.

Post-application checks:

- reverse patch check passed;
- integrated service was byte-identical to the frozen candidate;
- `node --check` passed for the route and new service;
- focused candidate source tests passed 3/3:
  `friend authority, spatial, and session filters precede canonical expansion`,
  `bounded exact semantics and stable page remain downstream of source
  qualification`, and `normal route wiring retains lock and exact JS
  revalidation after the candidate page`;
- `git diff --check` passed for both integrated files.

The corrected external plan-runner r2 identities were also reverified:

- runner
  `cbaa076a0cf9316fc0a8e483e0d242bf2ed83787b1c0437da25b8337fbdf2e5c`;
- parser
  `e60a0f8f3938ba51a000dad5697d29fe6d6dbcfea855b4c28b41a6b0a3470db0`;
- parser/source tests
  `9c55ffd8bd152dd38cdc97dac8f0c74c6a50da17820eca0d570d3941c135fcab`.

All three passed `node --check`; the parser/source sensitivity suite passed
6/6, including estimated-versus-actual row discrimination, wrong N, repeated
JSON expansion, and missing bounded-marker mutations.

## Container, isolation, and fixture

The retained review authority was container
`691e6154951534e8bae6f46c62fb2d8a9e92ba09b5818f6a9e55616950ec1ad2`
(`cairn-v1-closure-mysql`, `mysql:8.0.36`), already running on loopback host
port 3310. It was not restarted. Unrelated container
`f3b4d31e78f11ba82d597ff3a98191f5573764e7594a16557be95dc697402a13`
(`cc-builder-mysql`, MySQL 5.7, host 3306) was not queried, restarted, or
modified.

The pre-run process audit found no competing Cairn friend-discovery, browser,
Expo, Playwright, or Jest workload. Personal Chrome, WindowServer, Docker
hyperkit, and Spotlight were materially active and untouched. Thus
`machineUncontendedForTiming=false`; no general machine-performance claim is
made.

Two exact disposable schemas were newly created by independently cloning only
the empty table definitions from retained `cairn_v1_closure`, then applying
migrations 041 and 042 inside those new schemas:

- `frdisc_v2_plan_2001_review_bcd168db`;
- `frdisc_v2_plan_10000_review_bcd168db`.

Both contained 39 tables and all five migration-042 source/canonical/segment
columns. The 10,000 schema was never seeded.

The 2,001 schema seed receipt is
`/Users/mzm/Desktop/cairn_revision03_work/evidence/fr-discovery-500-v2-plan-bcd168db-20260920T175008+0800/seed-2001.json`,
SHA-256
`d93108c9104b7c0788255e6b849c1085c17a382591ba4f042f777ad6cb06e8ac`.
It records:

- viewer F ID 17, author E ID 18, reciprocal friendship rows 2;
- current episode ID 9 / UUID
  `50000000-0000-4000-8000-000020010001`;
- exactly 501 live current-group E markers, nearby marker ID 9 and 500 newer
  distant markers; marker-ID list hash
  `f51c4f3053ce5ff90644c1f04ae26d4b239e16603825877cf0123e63d25b0ac3`;
- nearby finalized native session ID 13 / Activity
  `50000000-0000-4000-8000-000000002001`, with exactly two canonical points;
- distractor finalized native session ID 14 / Activity
  `50000000-0000-4000-8000-000020010000`, with exactly 2,001 canonical
  points;
- nearby witness ID 105 with two endpoints 15,000 ms apart, accepted
  `activity_real`, 5 m accuracy, and exact nearby segment/coordinates;
- exactly 2,001 accepted 5 m distractor Memory points, one-to-one with the
  distant canonical points; point-ID list hash
  `dc7e7f9c32e1d0e7098fb0dbfd5baaff5f97a3218aca7656369f480689d0b65d`;
- zero encounters;
- stored nearby canonical JSON SHA-256
  `0ccf43bc61bbeb379360eb51e9294c5a9df9d279f3b2a013818bdfb84c0c508f`;
  stored distractor canonical JSON SHA-256
  `e413f07f6d041667d4bccfb67aa5688d9939494b7d59a7923e7e44aea970f40d`.

## Exact gate result

The corrected r2 runner was invoked once with the exact receipt IDs,
`FR_PLAN_DISPOSABLE_SCHEMA=1`, exact expected/database schema, documented
Activity IDs, `FR_PLAN_EXPECTED_EVIDENCE_COUNT=2001`, loopback port 3310, and
the retained review credentials. It opened a read-only repeatable-read
transaction, completed its exact fixture preflight, executed the candidate
`EXPLAIN ANALYZE`, executed the candidate SELECT, and rolled back.

Because the runner asserts that the SELECT returns only the expected marker
before calling the plan-shape parser, reaching the parser failure also proves
the candidate SELECT returned exactly marker ID 9 in that snapshot.

Terminal result: **FAIL**:

```text
AssertionError [ERR_ASSERTION]: viewer-keyed presence access: expected at least 2 matching actual plan node(s)
```

Failure receipt:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/fr-discovery-500-v2-plan-bcd168db-20260920T175008+0800/plan-2001.stderr.log`,
SHA-256
`ce5038cab866e4f44e9528abf4bb331a834f206eb1d69276f27393ee8bd8a305`.

The failed runner writes its complete TREE plan and timing JSON only after all
shape assertions. Consequently `plan-2001.json` is empty (SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`),
and neither the exact TREE nor its measured `elapsed_ms` survived the failure.
Performance Schema retained no per-statement EXPLAIN plan/digest from the
closed connection. This is an evidence-output limitation of r2; it is not
filled in by inference or an unchanged retry.

Plan/cost/bound disposition:

- fixture/identity/source/canonical preflight: **PASS** at N=2,001;
- candidate result identity: **PASS**, exactly nearby marker ID 9;
- required two actual `idx_presence_encounter_context` access nodes:
  **FAIL** (the parser found fewer than two matching nodes);
- exact TREE, actual node costs/rows beyond the first failed family, absolute
  wall-time ceiling, relevant-session/canonical/JSON-table bounds:
  **UNVERIFIED** because r2 did not emit the plan before asserting;
- N=10,000 plan and `N=10000 / N=2001` ratio: **NOT_RUN / N/A**;
- preserved E/F API/MySQL harness: **NOT_READY / NOT_RUN** because both plan
  sizes did not pass.

No second N=2,001 execution, parser relaxation, altered plan assertion, N=10,000
seed/run, API run, deployment, or workaround occurred.

## Cleanup and retained state

After the terminal failure, exact-ID cleanup deleted only fixture users 17 and
18 in the 2,001 disposable schema and relied on declared cascades. It then
checked every recorded user, all 501 marker IDs, both session IDs, episode ID,
witness ID, and all 2,001 Memory-point IDs: all were absent. Cleanup receipt:

`/Users/mzm/Desktop/cairn_revision03_work/evidence/fr-discovery-500-v2-plan-bcd168db-20260920T175008+0800/cleanup-2001.json`,
SHA-256
`4d4e31c0b5950398cb0ca9e914498ea258bea09313f5b97ad92900b970137c11`.

A first post-cleanup display query had a read-only projection typo
(`table_schema` instead of `schema_name`) and is preserved as superseded
diagnostic output. The corrected read-only receipt
`post-cleanup-schema-counts-corrected.log`, SHA-256
`33807013b67ce75c94bced0d59ab16d35498cc5825a938e6e29beda9fa59f1ba`,
shows zero users, markers, sessions, Memory points, and witnesses in both
disposable schemas. Both original containers remained running on their
original ports; no service was restarted.

The product-v2 source integration remains in the primary tree at fingerprint
`bcd168db...`, but FR-DISCOVERY-500 remains **FAIL/HOLD / product unverified**.
The next valid work is a reviewed diagnostic/correction that preserves the
actual TREE on failure and explains the missing pair of attributable presence
index nodes. It is not the preserved E/F harness and must not be an unchanged
plan rerun.
