# Review findings and causal checklist

## Premature-closure controls

- Map each assertion to a specific executable result; broad suites are only
  regression support.
- A journey uses normal navigation/handlers and traced object identities;
  disconnected store tests are labeled as such.
- Verify normal page actions reach lower-level capabilities.
- Inspect every list/Detail/persistence writer under shared invalidation.
- Add nearby counterexamples, delayed schedules, and failure controls.
- Loaded map/product captures must pass readiness gates; loading-only captures
  are not accepted.
- Measure synchronous slices, event-loop delay, acknowledgement, persistence,
  and visible update separately in one correlated timing domain.
- Reject internally inconsistent or reconstructed timestamps.
- Queue completion requires runner-backed results, final source identity, and
  the closeout validator.

## Open findings

### V1-R03-01 — isolated Raw GPS evidence was not visible in actual Fog

Status: **FIXED AND EXECUTED**.

The O55 Raw GPS path correctly wrote `simulator_test` evidence outside personal
Memory, but `FogLayer` read only `points`. A debug Raw GPS Activity therefore
could not demonstrate live synthetic Memory in the loaded production renderer.
The bounded correction selects `testPoints` only when Debug, Simulator, and
Raw GPS are all explicitly active, suppresses friend projection mixing, uses a
separate display-cache authority, and labels the Memory context as isolated.
The isolated authority is covered by persistence, source-isolation, geometry,
and realistic-pipeline tests. A normal Home → Hike → Start flow using O55 seed
550101 produced noisy raw observations, accepted canonical movement, live test
coverage in the actual loaded Fog before Finish, stationary stability, resumed
coverage, normal Pause/Resume, normal Finish, Activity Detail, and independent
page-reload reconstruction. Personal coverage and presence remained zero.

### V1-R03-02 — representative history performed monolithic Turf work

Status: **FIXED AND EXECUTED**.

The original distinct 2,001-point case spent more than two minutes in a
monolithic accumulation, and the first tiled attempt still had a 1,140 ms
synchronous slice. The retained failed logs led to bounded 0.001-degree local
tiles, conservative 20-step footprints, 4x4 group union caching, and a linear
self-only Fog complement. The final 2,001+40 case rebuilt nine tiles/three
groups with a 93 ms maximum slice and a 2.1 ms Fog composition; the 10,000
distinct-location diagnostic retained all sampled inputs. Correctness tests
cover the 30 m boundary, disconnected evidence, and a meaningful hole.

### V1-R03-03 — loaded QA lifecycle races

Status: **HARNESS CORRECTED; FAILED RUNS RETAINED**.

The loaded runner initially configured Raw GPS before the screen's deliberate
fresh-entry reset, omitted the account authority in the session store, left the
first-visit Memory guidance open, and returned the wrong list envelope during
cold reload. Each condition failed visibly instead of being relabeled PASS;
screenshots/logs are retained under the revision-03 evidence directory. These
were fixture/lifecycle defects, not rewritten product assertions.

## Bounded final-review passes — provisional tree `e86a8744…`

Both authorized read-only reviewers returned **HOLD** on the provisional tree.
The following is the durable disposition queue; a source change still requires
fresh dependent evidence.

| Finding | Disposition at 2026-09-19 16:35 +08 |
|---|---|
| Friend projection could issue after revoke | Product transaction now locks ordered user rows, derives and revalidates the exact grant/policy in one transaction; focused/API paths pass. Deterministic real-MySQL race sensitivity remains open. |
| Async client mutation could cross account identity | `authenticatedFetch` now accepts `expectedUserId`; mutation callers bind viewer/generation before network. Focused identity test passes. |
| Public Block lacked cross-namespace durable authority | Durable blocked-author sentinel plus Public/Friend content/Friend Memory/presentation purge implemented. Delayed-list/Detail, offline, relaunch focused test passes; purge operations are explicitly viewer-bound. |
| Encounter source gaps were dropped | Source segment now crosses tracking, Memory persistence/sync, migration 042 and Encounter queries. Unit and real API/MySQL cases pass. |
| Public origin could be manufactured from unbound witness rows | Session stores canonical accepted Activity evidence and server-owned source provenance; publication/projection require canonical coordinate/time/segment matches. Production SQL excludes isolated QA. Cryptographic device attestation is not claimed. |
| Moderation/report payload was mutable | Migration 042 stores immutable per-episode type/text/location/hash and all operator/report/delivery reads use the snapshot. Expanded API assertion awaits final rerun. |
| Global newest-60 scan could starve local content | Candidate locality/canonical-source existence now precedes the bounded limit; sixty-newer-distant sensitivity case added, final rerun pending. |
| Account deletion missed new caches | Public, Friend Memory and synthetic Memory keys added; real populated A/B storage purge test passes 5/5 and preserves B. |
| MySQL concurrency evidence was sequential | Public withdrawal now uses a real row-lock barrier and separate API connection; final rerun pending. PF deterministic transaction barrier remains open. |
| Loaded responsiveness evidence was reconstructed/failing | Added one-domain DOM-dispatch acknowledgement and O55 input → accepted → Memory → Fog source → two-rAF paint instrumentation. Exact-source loaded rerun remains open. |
| Connected E2Es were fixture/deep-link fragments | Still open; disconnected evidence will not be promoted to E2E PASS. |
| R-GPS-07 bypassed O55 and R03/04/06 were weak | R-GPS-07 now runs two O55 Activities through normal input, Finish and reload. Noise/excursion, switchback/hole, true-gap and Run pace/stop assertions pass 10/10. |
| Candidate lacked closeout validator/identity | Fingerprint, runner recorder, registry assembler and closeout validator scripts exist; execution against final frozen source remains open. |
| Public Detail failure feedback could dismiss/wedge | Truthful queued/storage-failure behavior implemented; focused screen test and loaded error capture remain open. |
| Loaded UI state matrix was narrow | Larger-font/long-Unicode, map-unavailable and queued/expired Public states remain open. |

## Post-review execution update — 2026-09-19 17:20 +08

- Friend revoke/projection ordering now has real MySQL barrier evidence, not
  merely held JavaScript responses: 19/19 PF API assertions pass.
- Public locality, immutable moderation/report snapshots, and withdrawal
  locking now pass together in the final 17/17 API run.
- Loaded Raw GPS/performance passes all 20 assertions with observed in-browser
  acknowledgements and next-paint scheduling; the earlier failing timing run
  remains retained.
- Public Detail queued/storage-failure behavior passes three focused screen
  cases; the full cache/handler/account-boundary set passes 55/55.
- The first connected real-API loaded Public attempt discovered that the Cairn
  outbox spread client-only fields into the strict marker API. This is a new
  substantiated product defect, not an evidence workaround. The boundary is
  now whitelisted and a connected retry is active.

### V1-R03-04 — whole-second timestamps collided as shared content versions

Status: **FIXED AND EXECUTED**.

The real API race in `local-api-mysql-rev03f.json` changed Cairn text inside
the same database second and received the old `resource_revision`. Migration
040 adds monotonic `content_revision` to Cairns and Routes; accepted material
owner writes increment it, while friendship/audience revision remains a
separate authority. The focused backend gate is 48/48 and the real rerun is
17/17.

### V1-R03-05 — disposable current-schema fixture masked ancillary drift

Status: **FIXED AND EXECUTED**.

The fixture's account/push/export tables were stubs and it omitted current
hierarchy fields, so the real server reported schema drift and export failure.
The fixture now mirrors the already-applied 020–035 shapes and migrations
035–040 remain separately rehearsed. Failed runs `rev03` through `rev03f` are
retained; no production migration history was rewritten.

### V1-PUB-01 — restore could qualify observations made while suspended

Status: **FIXED; EXPANDED API RERUN ACTIVE**.

The first operator restore retained the original `published_at`. A qualifying
Activity observed during suspension could therefore be uploaded after restore
and pass the original-time lower bound. Restore now establishes a new
eligibility timestamp for new encounters while already legitimate encounter
records retain bounded reread authority. The API harness exercises evidence
during suspension, a retry after restore, and genuinely post-restore evidence.

### V1-PUB-02 — identical edit retry manufactured a content revision

Status: **FIXED; EXPANDED API RERUN ACTIVE**.

The shared marker writer incremented `content_revision` for any PUT, including
an identical retry after an unknown response. Resource revision now advances
only for changed type/text/approximate content; audience changes remain on the
separate authorization epoch. Identical retries preserve the approved episode.

### V1-PUB-03 — cold offline initialization discarded valid downloaded Detail

Status: **FIXED AND FOCUSED TESTED**.

The cache persisted the content but not the last authoritative pilot-enabled
state, then cleared visible entries when the capability request was offline.
The account-scoped envelope now persists that state, retains only unexpired
matching summary/Detail offline, resists clock rollback, and purges it when a
server-disabled capability is learned. Focused cache gate: 10/10.

### V1-R03-06 — isolated points lost their explicit provenance label

Status: **FIXED AND EXECUTED**.

The Raw GPS realm was correctly separated from Personal coverage, sync,
presence and sharing, but each in-memory and reloaded point carried the generic
`historical_unknown` label. That made the record itself less explicit than the
realm which contained it. Synthetic persistence now has its own small v1
envelope with fixed `simulator_test` provenance; obsolete synthetic QA payloads
are disposable and ignored. The final loaded sequence independently reloaded
20 `simulator_test` footprints while Personal coverage/presence stayed zero.

### V1-END-01 — endurance workload sensitivity failures

Status: **WORKLOAD CORRECTED; FINAL RUN ACTIVE**.

The first one-minute run omitted Report's required stable
`client_submission_id`; the second completed all cycles but queried a
nonexistent client outbox table as a server metric. Both failed outputs remain
retained. The corrected sensitivity run passed 30 cycles/198 real API calls,
including finalized movement, publication/withdrawal, grant transitions,
disconnect/reconnect, and idempotent Thanks/Report retries. The 30-minute
candidate run uses the same frozen budgets and workload.

### V1-OVERNIGHT-01 — exact-current changed gate exposed a real 10k slice overrun

Status: **OPEN; PROFILED DIAGNOSIS ACTIVE**.

The resumed exact-fingerprint `npm run verify:changed` completed rather than
being retried after the earlier owner interruption. It passed 109/120 suites
and failed 11. Two failures are in the active A4 scope: one 10,000-location
Memory geometry slice measured 180 ms against the frozen `<150 ms` budget, and
one cold-hydrate test still asserts the pre-O41 Memory initialization owner.
Nine other suites are classified as pre-existing full-gate collection debt,
including removed/private API imports, a nonexistent i18n module, and
Playwright specs collected by Jest. Lane A is profiling the 10k operation; the
budget is unchanged and the complete log is retained under the exact 044045c3
A4 evidence directory.

### V1-OVERNIGHT-02 — Friends and Settings green tests omit normal-path races

Status: **SUBSTANTIATED SOURCE FINDINGS; EXECUTABLE REGRESSIONS PENDING**.

The exact-current four-suite baseline passed 41/41, but a normal-caller trace
found gaps that those tests do not cover:

- `loadCircleMarkers` has no viewer/generation fence around asynchronous loads,
  so a delayed account-A response can block account B and later republish A's
  friend Cairns after an account switch.
- Memory's non-owner Cairn sheet exposes **Hide from my map**, but its current
  handler only closes the selection and does not persist Hide or purge/fence
  the cached item.
- Settings profile refresh and name-save responses can update the global user
  after logout/account switch, and account deletion lacks action-level
  single-flight protection.
- Friend discovery truncates the newest 500 candidates before proximity and
  evidence filtering, allowing an older eligible nearby Cairn to be starved by
  newer distant candidates.

These remain findings, not PASS claims. Lane C is specifying the minimum
deferred-promise and normal-entry cases before any shared-tree fix.

## Execution-packet reconciliation — 2026-09-20 19:07 +08

This section updates the live disposition from persisted receipts without
reclassifying any historical run or marking a closure stage complete. Current
product fingerprint: `bcd168db8240d24302e6559451d0f0e1af5d2957d17b651bc177524b6d6ae698`
across 646 files.

### V1-F1F2-01 — connected normal-entry journey

Status: **PASS WITH FIXTURE-BACKED EXPO WEB LIMITS**.

At fingerprint `fa986cc8…`, one bounded loaded run completed Home → Hike →
normal Start → realistic R-GPS-02 → Pause/Resume → private full Plant → same
recording → live Memory before Finish → Finish → same Activity/Cairn → Route
save/edit/reload → Use Route on Hike and Run. Stable client IDs, origin
Activity, edited Route geometry, idle/null-reference pre-start state, and
reload identity passed. The Web Route screen truthfully showed exact
`Map unavailable`; `plannedRouteSourceLoaded=false`, and native mounted Mapbox
source is NOT_RUN. All API and Mapbox reads were fixture-intercepted with a
synthetic pk-format token, so this is not real API/MySQL, real Mapbox, native
GPS/Mapbox, field, or timing evidence. Prior failed attempts remain retained.

### V1-A4-02 — current controlling Memory slice remains over budget

Status: **FAIL/HOLD; DIAGNOSTIC DEFERRED**.

The controlling gate at the applicable current-source lineage passed 123/124
suites and 1,170/1,174 tests but measured labelled `tile_geometry=162 ms`
against the unchanged `<150 ms` ceiling. The attempted six-case diagnostic did
not produce valid benchmark evidence after harness/environment boot failures;
its disposition is **DEFERRED_ENVIRONMENT/HARNESS / UNVERIFIED**. Neither the
partial pass count nor invalid diagnostic erases the 162 ms failure. Radius,
geometry truth, history, gaps, and live-before-Finish behavior remain frozen.

### V1-FRDISC-02 — v2 SQL integrated; strict r2 plan shape failed

Status: **FAIL/HOLD AT N=2001**.

The FR-DISCOVERY-500 v2 SQL patch is present in current fingerprint
`bcd168db…`. The real isolated MySQL 8.0.36 r2 gate stopped at N=2001 because
the asserted two viewer-keyed presence nodes were not observed. N=10000 and
the E/F API/MySQL run are NOT_RUN. External runner r4 adds exclusive pre-
assert result, raw TREE, parsed-node, and one-shot output receipts while
preserving nonzero strict failure; it is pending independent review and has
not been executed against MySQL. The r2 failure remains controlling.

### V1-C1-02 — focused green does not cover durable account-switch invalidation

Status: **C1 FULL GATE OPEN**.

The exact focused friend-content cache/authorization suite passes 23/23,
including the C2 summary/detail revision cases. The external durable-
invalidation R1 candidate separately passed its candidate-focused cases, but
independent counterexamples showed an account-A block/unfriend completion can
settle after switching to B and purge or present against B. The candidate was
not integrated. C1 requires one boundary that combines initiating viewer and
generation capture, `expectedUserId` transport, explicit-viewer durable purge,
strict removal fallback, and post-await screen feedback fences. C2's focused
pass remains valid but cannot close the shared full gate.

### V1-F6-02 — R13 Feedback authority gap

Status: **BLOCKED / NOT INTEGRATED**.

R13 corrected the previously reviewed hydrate, password, delete, marker, and
Settings account boundaries, but the Feedback composer still retains an A
draft into B and lets a delayed A acknowledgement clear B state or emit stale
success feedback/haptics. The independent review's two counterexamples fail.
The 15-second candidate test timeout was reviewed as harness headroom rather
than product timing, but it does not mitigate the Feedback blocker.

### V1-F4-03 — Public authority R2 remains default-off and blocked

Status: **BLOCKED / NOT INTEGRATED; PUBLIC DEFAULT OFF**.

R2's backend authorization matrix and most client fences are static-only. A
stale `verifyCompletedActivity` invocation can return success after an awaited
refresh crosses A → B; the Detail caller can then present stale offline-queue
feedback/navigation, and the helper does not require current logged-in state.
Its claimed seventeen cases are sixteen SQL fixtures plus one outer-node
transport assertion, not seventeen executed MySQL allow/deny cases. No R2
product code is integrated and no production Public capability is enabled.

### V1-F7-01 — Public Detail v4 awaits independent integration review

Status: **EXTERNAL FOCUSED GREEN 9/9; PENDING REVIEW**.

The v4 candidate is fail-sensitive against the current 5/9 baseline and fixes
only the v3 test settlement defect while retaining canonical cold/loading/
error, feature-off, current-route, mount, and attempt fences. It is not primary
PASS: integration, changed-tree verification, loaded mobile Web/native checks,
and owner visual acceptance remain NOT_RUN.

### V1-F5-01 — Homepage programmatic comparison is not owner/native acceptance

Status: **PROGRAMMATIC WEB PASS; OWNER/NATIVE PENDING**.

The isolated v3 loaded comparison passed all ten programmatic assertions,
captured four screens/four boards, and reported zero runtime errors. It used
fixture-only data and made no backend/account or performance claim. Owner
visual acceptance remains pending and native is NOT_RUN.

### V1-F8-01 — read-only cleanup inventory

Status: **PHASE 1 COMPLETE; NO CLEANUP EXECUTED**.

The external inventory and proposed action ledger are complete. No file was
deleted, moved, archived, reset, or cleaned up, and no database/API/browser or
deployment mutation occurred. Any Phase 2 action requires separate explicit
authorization and must not preempt F0–F7.

## Current closeout findings — 2026-09-21 21:32 +08

This update preserves every earlier finding and supersedes only their live
disposition where later immutable evidence exists.

### V1-FINAL-PF-R8 — exact-current Personal/Friends gate

Status: **PASS**.

The one-shot R8 run exited `0` at exact preflight/final fingerprint
`d7f7b4242ddf185332ccfac92b3c5e77cc89f88af3b2fd561109c3259e81ead2/663`.
The operator ledger, final evidence, gate receipt and both checksum manifests
agree. Personal proves ordinary authentication, O55 seed 550202, live Memory
before Finish, a durably completed Activity/Cairn/edited Route, ordinary Hike
and Run route reuse, DELETE acknowledgements, idle/null-reference cleanup, no
surviving session rows, and exactly one owner-matching tombstone per discarded
client Activity. C3 proves H/R recovery and N01/N03/N02 negatives through real
isolated API/MySQL.

At the frozen O61 candidate
`46aa7e1af18fb8187512991bd3a3d3450f892eebd2bb01867a03c0cd8d534040/664`,
all 82 R8 product dependencies still match. The intervening changes are the
single O60→O61 marker, its focused test, and closeout tooling; none changes an
R8-bound product file.

R8 records exactly 42 request-time deliberate offline aborts, 42 exact console
candidates and 42 unique correlations, with zero unmatched or reused events.
The N01 revoked-lease POST/404 remains a separate exact console allowance. No
unexpected request, HTTP response, page error or console error remains.

Owned container, ports, processes, temporary root and isolated profiles were
absent after cleanup. Retained MySQL `691e…:3310`, unrelated MySQL
`f3b4…:3306`, and personal Chrome PID 571 remained running and untouched.

### V1-FINAL-PF-HISTORY — superseded failures remain failures

Status: **PRESERVED**.

- R4 remains `FAIL_PRE_SIDE_EFFECT_PREFLIGHT`.
- R5 remains `FAIL_SOURCE_DRIFT_AFTER_COMPLETE_CONNECTED_EVIDENCE`; its
  completed journey was never promoted because the final source fence failed.
- R7 remains FAIL because the old harness classified a delayed deliberate-
  offline console event using mutable current state. R8 corrects the evidence
  correlation contract; it does not rewrite the R7 result.

### V1-PUBLIC-R15 — dependency-equivalent connected Public gate

Status: **PASS IN ISOLATED REVIEW REALM**.

Public R15's immutable gate, API authority, connected-enabled and connected-
disabled receipts remain exact under the 30-file dependency ledger. The run
covers owner creation/publication/edit/withdrawal, viewer discovery/detail,
offline durability, Hide/Block/Thanks/Report, operator disposition, delayed
responses and feature-off regression. This is not a production deployment or
general Public enablement claim.

### V1-CLOSEOUT-DISPOSITION — owner-test ready, formal release still HOLD

Status: **`OTA_CANDIDATE_READY`; FORMAL CLOSURE `HOLD`**.

Two independent formal controls remain HOLD and are not relabeled PASS:

1. A4 retains the measured `tile_geometry=162 ms` failure against the frozen
   `<150 ms` ceiling. The deferred diagnostic did not create replacement
   benchmark evidence.
2. FR-DISCOVERY r5.1 retains
   `FAIL_HOLD_FORMAL_PLAN_EVIDENCE_LIMITATION` from its one N=2001 attempt.
   Cleanup passed, but no retry or larger-N/E/F promotion occurred.

The owner's convergence contract permits these performance-deferred and
plan-evidence/P2 limitations for physical owner testing because neither is a
known P0. The fail-closed owner-test gate separately proves 20/20 functional
assertions, PF/Public/C3 dependency equivalence, no known P0 or pending local
functional blocker, loaded Homepage evidence, and the final isolated O61
loaded Auth capture. Its result is `OTA_CANDIDATE_READY`.

The formal validator result remains `HOLD` with controlling states
`[PASS,HOLD]`. Deployment is `NO_DEPLOYMENT`, OTA is `NOT_PUBLISHED`, Public
remains production-off, and native GPS/Mapbox/field acceptance remains
`UNVERIFIED`. Earlier O61 test/capture-contract failures remain preserved; the
single final correction passed without product-behavior changes.
