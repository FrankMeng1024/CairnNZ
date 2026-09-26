# Cairn incident-recovery report — 2026-09-26

## Verdict

O64 is a validated OTA-safe candidate. Backend commit `43c4733` is deployed,
migration 044 is applied, Public is enabled for a non-empty controlled canary,
and client source commit `389e955` passed the release gate and iOS Hermes
export. No OTA or native build was published. Native lock-screen/GPS behavior
and visual taste remain owner-device acceptance boundaries.

## Root causes

1. **Background Activity route loss.** The small mutable display tail could be
   restored without its durable frozen prefix. Foreground, headless-native and
   finalization paths also had overlapping ownership, so live, Finish and
   Detail could project different subsets of the same evidence.
2. **Memory loss/incompleteness.** Evidence production and restoration were too
   dependent on a mounted foreground runtime. Stale whole-snapshot writes could
   overwrite a newer headless append, and process-global hydrate state was not
   strictly account-fenced. The Mapbox puck was healthy but was never durable
   Memory authority.
3. **Sync misclassification/stalls.** Connectivity, request outcome and entity
   state were collapsed into offline-like UI. Retry wake-up depended on mounted
   flows; unknown remote outcomes, validation failures and auth failures did
   not have distinct durable states; cleanup after ACK was not crash-safe.
4. **Disappearing/reconciled Activities.** Server list hydration could outrank
   pending/local final truth, while incomplete numeric/client-ID mappings could
   reconcile the wrong record. Titles were not safe identities. Final geometry
   also lacked one revisioned artifact shared by every post-Finish consumer.

Earlier green runs missed these because they exercised foreground state or a
single renderer in isolation, mocked network availability as request success,
did not combine process death/account switch/unknown response/same-title rows,
and treated synthetic callbacks or Web frames as stronger evidence than they
are. The owner's seven device screenshots therefore correctly reopened the
claims. The new regressions are failure-sensitive at the durable journal,
identity and state-transition boundaries; native delivery is still not claimed
from Jest or Web.

## Owner real data

No owner record was mutated, merged by title or rewritten for testing.

| Observation | Stable identity and current fate |
|---|---|
| Run “lost”, about 0.6 km / 05:09 | Server session `2096`, client UUID `bca7f29c-ddf4-4e0c-8b24-7f3d273ddb9f`, finalized, 645.95 m / 309 s, account 106. Present. |
| Hike “seems lost”, about 18:26 / 0.8 km / 12:18 | Server session `2097`, client UUID `61970ac3-46d9-4912-9fc2-319c83ff98fb`. A client-UUID DELETE reached the server around 19:03; the row is deleted and its tombstone remains. Server evidence cannot reconstruct its route. Only an owner-device durable journal/cache could still contain it. |
| Hike “seems lost”, about 19:03 / 0.7 km / 11:15 | Server session `2098`, client UUID `bdf3ba8c-9003-469a-a5f0-fb02650a7210`, finalized, 705.63 m / 675 s, account 106. Present. |

The DELETE proves the first Hike's server fate, not why a user action or client
path issued it. That distinction is intentionally not replaced by a repair
claim.

## Implemented

- Hike and Run now share one owner/generation-fenced lifecycle. The durable
  journal rehydrates `frozen historical prefix + bounded mutable tail`; Finish
  seals and drains the exact owner before cleanup.
- Active real movement appends a cross-runtime, owner-scoped Memory evidence
  journal. Stale foreground snapshots merge/verify instead of truncating it;
  account purge and hydration fail closed.
- Activity/Cairn queues use durable entity states, immediate online wake,
  reconnect/foreground/cold-start wake, bounded retry, auth/validation/network
  distinctions and idempotent unknown-outcome reconciliation.
- Stable client UUID is the reconciliation key. Same titles stay distinct;
  conflicting mappings fail closed; stale server lists cannot erase retained
  local/final truth.
- A versioned Final Activity artifact is shared by Finish preview, Activity
  Detail, reload, Trails and Save as Route. It preserves real gaps and rejects
  delayed older geometry.
- Auth uses controlled shared password fields, OTP paste/AutoFill semantics and
  keyboard-safe actions. Plant retains exact standalone/Hike/Run caller context.
- Shared delete/keep modals cover Cairn Detail, Memory, Activity, Route, pending
  Activity and Debug. Hike/Run use shared recording chrome and state language.
- Debug replaces location input only; production orchestration and provenance
  fences remain shared, and simulator evidence cannot qualify real Memory or
  Public strangers.
- Home uses the new natural-material Sunny candidate (SHA-256
  `191a59c662e7d6fd7084b182bdf62db84e77c945b834d68e3aac6856c99b15d2`),
  with neutral water, softer mountain depth and foliage. Last Activity is one
  tap target. The substantial Privacy/Help/Cairn layouts from the preserved
  work were revalidated at 390×844 and sibling sizes. All remain owner visual
  acceptance candidates, not claimed taste acceptance.
- Memory Fog's 10k geometry hot path now batches local footprint unions and
  avoids repeated general-purpose feature allocation. The old 156 ms failure
  is 62 ms with the same exact 30 m boundary.

## Owner JSON closure

The original JSON remains immutable. `OWNER_RETEST_PATCH.json` is the separate
delta with observation, cause, family, implementation, migrated callers,
fail-before/pass-after evidence and device check for all 17 actionable cases.

| Case | Implementation state | Remaining authority |
|---|---|---|
| AUTH03, AUTH01, AUTH04 | Implemented and locally verified | Owner device keyboard/AutoFill/transition check |
| HOME01, HOME02, HOME03, HOME04 | Implemented/revalidated; reinstall policy remains explicit | Owner visual/native timing and reinstall-policy decision |
| CAIRN01, CAIRN02, CAIRN08, CAIRN09, CAIRN04, CAIRN06 | Shared callers migrated and locally verified | Owner device visual/interaction check |
| CAIRN03 | Durable scheduler implemented; real yiiling retry paths verified | Owner offline/reconnect check |
| CAIRN10 | Activity caller/provenance/QA Memory contract implemented | Owner Debug + real standalone Plant check |
| END01 | Test-definition correction only; completed Activities remain read-only | Confirm corrected wording |
| END02 | Shared Hike/Run owner guard implemented | Owner cross-entry check |

## Real yiiling deployment and integration

- Deployed checkout: `43c473388ee0a14955bcc71744d1f4fc3a4f4f6c`.
- Backend image: `sha256:4958f0ee02fb8f8a637f7b7714016a75e96c16b4be16e904acd7f082429f02c2`.
- Cairn API service start: `2026-09-26T06:22:31.07202035Z`.
- Migration ledger: `044`; schema postconditions and boot checks pass.
- Predeploy backup:
  `/opt/githubRepos/Cairn/backup/incident-20260926T0618Z-pre-f3469a3`.
  Backend image, code, full DB and configuration checksum verification passes.
- Only `cairn-backend` was recreated for the functional deploy. Shared MySQL,
  nginx, host, K0, Feature Map and unrelated services were not restarted or
  changed.
- HTTPS health reports API and DB `ok`.
- Activity production canary: 7/7 (delayed reconnect Hike, online Run,
  duplicate-title separation, final route order/precision, isolation, expired
  auth classification, MySQL exact rows); exact QA sessions cleaned to zero.
- Memory production canary: 8/8 (push, replay, MySQL exactly once, pull/reload,
  account isolation, supported reset, zero cleanup).
- Public real-MySQL harness: 21/21, including publish/reconcile, eligibility,
  near/bounded selection, final canonical validation, unknown outcome,
  Thanks/Hide/Block/Report, revision/withdrawal races, operator moderation,
  legacy endpoint denial, empty content and audit survival. Failed v1/v2
  harness receipts were retained as old-failure evidence; final QA rows are
  `0/0/0/0`.

## Public state

- Production gate is ON.
- Consumer allowlist is exactly accounts 103 and 106; it is not empty.
- Operator account 107 is operator-only and not allowlisted as a consumer.
- Server policy remains text-only, explicit-publication, real-presence-based,
  deterministic/bounded, read-only for strangers, with withdrawal and
  moderation controls. Quick Cairns remain private by default; simulator data
  cannot qualify.
- O64 rechecks capability after reconnect even when the prior cached gate was
  false, breaking the old gate-off activation cycle.
- Physical two-actor walking discovery remains the honest owner-device check.

## Verification and second pass

- Final diff-driven release gate: client 1458/1461 (three intentional skips),
  backend 109/109, static 102/102; total 1669/1672.
- Focused shared-caller review: 17 suites; the final reported subset was 11
  suites/61 assertions, plus 32/32 modal/timer checks with open-handle detection.
- Old-fail/new-pass Memory performance: 156 ms > 150 ms before; 62 ms after.
- iOS OTA-safe export: one Hermes bundle, 11,667,725 bytes; intended Home asset
  exported with exact manifest hash. Runtime `0.2.6-o61`, production channel,
  simulator disabled.
- `git diff --check` clean for committed source.
- Same-session fresh sibling review covered Run after Hike; Activity Plant after
  Home Plant; Cairn/Route/Activity/Debug destructive actions; Create/Reset/Change
  Password; personal/friend/Public detail roles; retry/loading/offline branches;
  and stale legacy entry points. No second agent/session was used.

## Genuine remaining device boundary

The current native baseline already declares background location and no new
native build requirement was found. Only a real iPhone can certify 1–2 minute
screen lock/background GPS delivery, passive exploration behavior, Mapbox/Fog
frame timing, iOS keyboard/AutoFill and final visual quality. Follow the minimal
ordered plan in `OWNER_RETEST_PATCH.json`; do not reinterpret those pending
checks as local acceptance failures or as already accepted.
