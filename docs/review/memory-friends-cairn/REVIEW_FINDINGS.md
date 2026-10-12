# Independent review findings

Reviewer: Rawls (`memory_cairn_review`), read-only.

## First pass on `1494342`

Verdict: **HOLD**.

Confirmed findings:

1. Exact private-place coordinates and grants could survive account change.
2. `activity_real` discovery checked session existence but not the witness
   timestamp/coordinate/segment against acknowledged canonical geometry.
3. Publication/friendship/audience changes after visit entry could become a
   stationary feed.
4. Moderation did not distinguish one revision from the whole source.
5. Reader Remove hid the collection but history/read/Thanks still worked.

Additional risks: silent 20,000-row friend projection truncation, unread/history
count semantics, Friend overflow presentation splitting, missing bounded
freshness and incomplete inference copy.

## Implemented resolution in `1398488`

- Account-owned store generation fences, synchronous exact-data purge and
  `expectedUserId` on every sharing mutation.
- Active/final canonical Activity evidence join with ±1 second, ≤5 m and exact
  segment identity; positive and adversarial real HTTP/MySQL cases.
- SQL epoch-millisecond temporal frontiers for publication, friendship and
  Friends audience at visit entry.
- Required `decision_scope`, revision/source-independent freeze/restore/remove,
  and irreversible confirmed removal.
- Collection Remove now blocks history/read/Thanks and future reacquisition.
- One request-level presentation group for Friend overflow, bounded freshness
  ≤20%, full eligible projection without silent truncation, group-based unread,
  and explicit familiar-place inference warning.

## First resulting-commit pass on `1398488`

Verdict: **HOLD**.

Supported remaining findings:

1. Revision moderation covered only one audience snapshot of a logical revision.
2. A Friends-only updated revision did not use its update timestamp as a visit
   temporal boundary.
3. The new discovery endpoint did not apply the viewer-side Public pilot gate.
4. The legacy Friend encounter verifier remained a contradictory acquisition
   path based on mutable marker content.

## Closure in `e0c1f97`

- Moderation/read filters and operator actions cover every snapshot with the
  same `(marker_id, content_revision)`; removal also purges matching publication
  snapshots and acquisition reads.
- Friend candidates include `marker.updated_at`; stationary version changes are
  denied until a genuine departure/time/re-entry visit.
- Public discovery requires viewer pilot authorization while eligible Friend-only
  Cairns remain available.
- The old Friend verifier returns 410 and screen loading is read-only. Circle and
  Friend content read immutable acquisitions instead of mutable markers.
- Acquisition has an atomic logical unique key across audience snapshots.
- Thanks is private aggregate-only for the author; self-Thanks is denied.

## Second HOLD on `e0c1f97`

The reviewer confirmed the viewer gate, legacy containment, logical acquisition
key, pure revision moderation and Thanks API, but found two remaining defects:

1. `marker.updated_at` was absent from the visit-entry predicate, so a revision
   published after a later visit began could still become eligible in place.
2. Source decisions also overwrote revision state, and Found read paths did not
   consistently overlay a still-active source freeze.

## Closure in `6149980`

- Both evidence and visit-entry frontiers include the Friend revision update.
  The real harness now acquires v1, begins a later visit, publishes v5 while the
  visit remains open, denies v5, then requires another departed/elapsed/re-entered
  visit.
- Nonterminal source decisions mutate only `cairn_source_moderation`; logical
  revision state remains independent. Found library, history, read, Thanks,
  unread and pending presentation apply the effective source overlay.
- The harness tests both orderings: source restore preserves a revision freeze,
  and revision restore cannot bypass an active source freeze.
- Aggregate Thanks queries also exclude owner/viewer equality defensively.

## Fourth HOLD on `6149980`

The reviewer found one high-severity remaining defect: deployed
`markers.updated_at` has whole-second precision, so a Friends-only edit later
in the same wall-clock second as visit entry could compare as if it predated
the visit. The prior fixture also edited SQL directly instead of exercising the
authenticated production update path.

## Closure in `80d2c32`

- Migration 045 adds and backfills `markers.content_changed_at DATETIME(3)`.
- Both production material-write paths update it in the same transaction as
  `content_revision`; permission-only writes do not impersonate content edits.
- Friend discovery uses that frontier for evidence and visit-entry eligibility.
- The real harness starts the visit first, performs four authenticated Marker
  updates from v1 through v5, proves the stored frontier is strictly later,
  denies acquisition in place, then allows v5 only after a genuine later visit.
- Isolated MySQL/API passed 24/24; backend 129/129; Activity 625/625; locked
  Hike/Run replay stayed `f678f89d` / `a1479659`.

## Exact final re-review

The reviewer returned **PASS** for exact commit
`80d2c32ede0de6cfb9be3a1403809fdc6c81a997`, while noting exact same-millisecond
equality as a theoretical conservative-boundary opportunity.

## Equality hardening in `a5967b5`

Friend content/friendship/audience and Public publication authority must now be
strictly earlier than visit entry. Exact equality fails closed. The real MySQL
fixture explicitly creates the equality boundary after authenticated v1-to-v5
writes and the complete suite remains 24/24.

The same reviewer returned **PASS** on exact commit
`a5967b50bc7336304380f1b8ff6ae9c349639fa3`; no concrete regression was found.
The nonblocking test gap is that Friend equality has a real MySQL boundary
fixture, while Public-publication and current-friend equality currently rely on
the shared production predicate plus static contract tests rather than two
additional dedicated MySQL equality fixtures.
