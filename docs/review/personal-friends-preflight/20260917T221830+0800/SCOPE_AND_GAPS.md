# Scope, contracts, and overnight gaps

This is the bounded implementation handoff for Personal Journal plus Friends Collaboration. It reuses the existing requirements register and capability IDs; it does not create a competing product system.

Classification meanings:

- `ALREADY_PROVEN`: attributable local implementation plus relevant automated proof exists; deployment/device/owner acceptance may still be pending.
- `EXISTING_BUT_INCOMPLETE`: a real surface or contract exists but cannot satisfy the proposed first version.
- `SMALL_EXTENSION`: bounded change around an accepted contract.
- `NEW_SHARED_CONTRACT`: new persistence/authorization semantics required across client and server.
- `OWNER_DECISION_REQUIRED`: implementation direction materially depends on owner policy.

## Personal Journal scope

| Capability / requirement | Class | Current evidence | Minimum overnight action | Explicit boundary |
|---|---|---|---|---|
| Activity lifecycle, metrics, Final/Gap, local Detail (`ACT-01..03`, `RQ-ACT-001..008`, `RQ-ACTD-001..003`) | ALREADY_PROVEN | `useTrackingStore.ts`; CARD-AD-01; O54/O55 tests | Preserve and run focused changed-file/regression gates after Memory integration | No GPS, pace, Live, Final, or simulator algorithm retuning |
| Own Cairn identity/detail/All Cairns (`CAIRN-01..05`, `RQ-CAIRN-003..006`) | ALREADY_PROVEN | `useMarkerStore.ts`; `AllCairnsScreen.tsx`; `MarkerDetailScreen.tsx`; CARD-CAIRN-01 | Preserve; verify Memory entry remains outside map/GPS failure and linked Activity path still resolves | No Public/non-owner discovery through All Cairns |
| Route create/edit/use (`ROUTE-01..05`, `RQ-ROUTE-001..007`) | ALREADY_PROVEN | `useRouteStore.ts`; `MapHistoryScreen.tsx`; corrected CARD-ROUTE-01 revision 02 | Preserve and exercise real geometry journey in integrated synthetic flow | No new planner, matching, turn-by-turn, or version tree |
| Personal Memory map/hierarchy (`MEM-01..04`, `RQ-MEM-001..004`) | EXISTING_BUT_INCOMPLETE | `MemoryScreen.tsx`, `MemoryMap.tsx`, `HierarchyPanel.tsx`, `useMemoryStore.ts` | Keep the map/hierarchy; integrate honest evidence/context states and shared theme roles | No new social feed or journal timeline |
| Durable evidence provenance (`MEM-01`, `MEM-05`, `RQ-MEM-001`, `RQ-MEM-005`) | NEW_SHARED_CONTRACT | `recordMemoryEvidence()` accepts a source, but `useMemoryStore.recordPoint()` stores only lat/lng/time/client id; backend `memory_points` is also source-free | Persist minimal provenance: real Activity/passive, Cairn, simulator/test, historical unknown, optional source Activity identity; exclude synthetic evidence from personal/shared projections | Never infer historical origin from geometry, time proximity, or a nearby Cairn |
| Real/simulator isolation (`DIAG-01`, `RQ-MEM-005`) | SMALL_EXTENSION after provenance | `activitySimulator/capability.ts`; `PassiveMemoryRecorder.tsx` subscribes to simulator and records `source: 'passive'` | Mark simulator/test evidence explicitly; keep it in disposable diagnostics only | Do not remove O55 or change its simulation algorithms |
| Place reflection (`MEM-02..04`, `RQ-MEM-002..004`) | SMALL_EXTENSION | `attributeMemoryPoints.js` derives `first_unlocked_at`, `last_visit_ts`, `point_count`; `hierarchy.js` omits those fields | Return first/last recorded-evidence context and defensible counts; copy must not call point count “visits” | No verified repeat-visit claim; no fabricated retrospective provenance |
| Personal Memory Day/Sunset/Night | EXISTING_BUT_INCOMPLETE | `MemoryScreen.tsx` uses Product-DNA roles, but hierarchy/local controls retain hard-coded material colors; native evidence absent | Correct local semantic roles and exercise meaningful states in three themes | No global theme redesign |
| Technical offline/reconnect (`OFFLINE-02`, `RQ-MEM-005`) | EXISTING_BUT_INCOMPLETE | local Memory persistence and card offline entities exist | Specify per-action prerequisites, preserve local truth, reconcile by stable ids/revisions, reject stale responses | Offline does not imply uncached basemap/history availability |

### Personal data truth

The current personal Memory store is a flat point set. That proves recorded evidence exists at a coordinate/time; it does not prove independent visits, continuous presence, source Activity, real-versus-simulator origin, or retrospective association with a Cairn. Existing historical rows must enter the new contract as `unknown`. A first version may show “first recorded” and “last recorded” when those values are derived from stored evidence; it must not relabel point count as visit count.

## Friends Collaboration scope

| Capability / requirement | Class | Current evidence | Minimum overnight action | Explicit boundary |
|---|---|---|---|---|
| Requests/accept/decline/cancel/remove/block (`FRI-01`, `RQ-FRI-001`) | EXISTING_BUT_INCOMPLETE | `useFriendStore.ts`, `FriendsScreen.tsx`, `backend/src/routes/friends.js` | Add honest errors/loading and transactional effects on grants/subscriptions/caches; protect late same-account responses | Do not redesign the accepted Friends structure |
| Author-controlled sharing | NEW_SHARED_CONTRACT | No owner grant exists; `memory_subscriptions` is viewer selection | Add owner/viewer grant, history/effective scope, active/revoked state, auth version, projection version | Friendship is not blanket consent; selection is not a grant |
| Viewer-controlled display | EXISTING_BUT_INCOMPLETE | `useMemorySubscriptionsStore`, picker, `mine | friends` scope | Add self, self-plus-selected, and single-friend modes; preserve source identity/overlap | Never merge friend points into personal Memory |
| Derived shared Memory (`MEM-06`, `RQ-MEM-006`) | NEW_SHARED_CONTRACT | `/api/circle/fog` returns exact raw lat/lng/time rows | Produce owner-authorized derived display cells/regions, exclude sensitive places, version responses | Coarse does not automatically mean anonymous; no raw history response |
| Request-time authorization/revocation (`MEM-06`, `RQ-MEM-006`) | NEW_SHARED_CONTRACT | `/fog` checks subscription only; `/markers` and `/routes` check friendship; unfriend/block do not remove subscriptions | Central owner-viewer authorization predicate; recheck every request; transactional revoke; grant-versioned client acceptance | No UI-only gate or legacy endpoint bypass |
| Stale response/cache/account switch | NEW_SHARED_CONTRACT | `useFriendMemoryStore.loadFriendFog()` is RAM-only and has no owner/grant revision; account reset exists | Owner/viewer/source/grant-version cache key, mutation/read epochs, delayed-response rejection, purge rules, bounded offline policy | Do not promise immediate offline revocation |
| Honest non-owner Cairn Detail (`CAIRN-06`, `RQ-CAIRN-007`) | NEW_SHARED_CONTRACT | Personal Detail is owner-authoritative; older marker detail primitives are not a normal permission-checked Friend path | Add read-only shared-Cairn role reachable from Friend Detail/Memory only when object permission and encounter/explicit access permit it | No edit/delete, no All Cairns leakage, no spatial-nearness inference |
| Honest non-owner Route Detail/use (`ROUTE-05`, `RQ-ROUTE-007`) | NEW_SHARED_CONTRACT | `/circle/routes` returns friend routes; there is no normal consumer or durable permission snapshot | Add read-only preview and stable authorized reference snapshot for Hike/Run; revalidate before starting; preserve owner/source | Reference is not copy or ownership; no planned geometry to personal Memory |
| Friend Detail normal entry | SMALL_EXTENSION | Friend tap opens a profile modal with counts | Extend the accepted profile structure to shared/authorized items and recoverable states | No global feed/inbox |
| Presence-gated Encounter (`ENC-01`, `RQ-ENC-001`, `RQ-CAIRN-008`) | NEW_SHARED_CONTRACT / OWNER_DECISION_REQUIRED | No schema, API, store, or navigation contract exists | Prospective server-issued fact from canonical real evidence, current grant, stable identities, idempotency | No map-pan, planned-route, simulator, view, or raw-response encounter |
| Public content | DEFERRED | Historical public rows and lower-level paths exist | Preserve data; exclude Public from claimed v1 and from friend projection queries | Do not implement or delete Public; it is not “one permission string away” |

## Current friend contract answers

### Facts in current source

| Question | Current fact | Product consequence |
|---|---|---|
| What owner grant exists today? | None. `memory_subscriptions` is inserted/deleted by the viewer in `memory-subscriptions.js`. | Viewer preference is being treated as access authority. This must be replaced, not relabelled. |
| What does the current Memory grant expose? | There is no grant. `GET /api/circle/fog` selects exact `lat`, `lng`, and `ts` for subscribed friend IDs, up to the route limit. | The current endpoint exposes raw history rather than a derived display projection. |
| How are historical and new data distinguished? | They are not. `memory_points` and friend-fog responses have no provenance/history-window field. | A prospective grant cannot be enforced without a minimum effective-time/version contract. |
| How are sensitive places handled? | No sensitive-zone model or projection exclusion is present in the inspected friend endpoints. | A first version needs an explicit default and testable query behavior. |
| What happens on unsubscribe? | Viewer row is deleted; `getSubscribedFriendIds()` no longer includes that friend. | It changes display selection only; it does not model owner revocation. |
| What happens on unfriend/block? | Friendship/request rows are removed; existing Memory subscriptions are not transactionally revoked. | `/fog` may remain accessible because it checks subscriptions rather than friendship/block/grant. |
| What happens on owner revoke? | There is no owner-revoke operation. | Required contract is missing. |
| What happens on account deletion/re-friending? | General account cleanup exists, but no inspected grant/version history defines re-friend semantics. | New friendship must not silently restore an old grant or stale cache. |
| Can a delayed request restore revoked data? | Yes in principle: `useFriendMemoryStore.loadFriendFog()` lacks owner/grant revision validation before publishing. | Add response versions and post-await validity checks. |
| How long can shared cache remain usable? | Friend points are RAM-only; no explicit TTL/revocation policy exists. | Offline semantics are accidental, not a product contract. |
| What happens offline? | Cached in-memory data may remain during a process; no authorization refresh or durable policy is expressed. | Product must choose bounded last-authorized use or no shared offline cache. |
| Is shared content a reference or independent copy? | `/circle/routes` and `/circle/markers` return another user's objects; no copy/reference lifecycle is defined. | Default must be read-only reference; explicit copy would be a separate object and out of this v1 unless authorized. |
| Can a non-owner mutate the original? | Owner routes/marker mutation APIs are owner-scoped, but no authoritative non-owner screen contract exists. | Keep mutation denied at API and UI; test direct bypass. |
| Does Route use have a stable permitted snapshot? | No friend Route use handler was found; personal selected-route snapshot boundaries exist. | Reuse the personal boundary with owner/ref/grant version, then keep the active reference stable. |
| Can an API bypass normal UI? | Yes: legacy circle endpoints can be called directly and do not implement the proposed complete authorization rules. | Secure/retire compatibility paths server-side; UI restrictions are insufficient. |

### Recommended defaults pending owner approval

- New grants are per viewer and prospective from the grant effective time.
- Share only a server-derived coarse cell/region projection; never raw point/time rows.
- Sensitive places are excluded by default before projection.
- Last-authorized derived shared data may remain offline for at most 24 hours with “last checked” context; no newly authorized or newly encountered data appears offline.
- Re-friending creates no grant automatically and cannot revive an old cache/version.
- Non-owner Cairns and Routes are read-only references. A permitted Route use stores an immutable session reference snapshot, not an owned copy.
- An author is not notified merely because the viewer encountered or opened an item.

## Minimum schema/API changes

The smallest complete design is additive and owner scoped:

1. `memory_share_grants`: owner, viewer, status, effective/history boundary, authorization version, projection version, created/revoked timestamps; unique active pair semantics.
2. A corrective migration/reconciliation for viewer subscriptions that no longer have current friendship/grant eligibility. Migration 018's trigger cannot be treated as the sole runtime authorization check.
3. A derived Memory projection endpoint returning per-source cells/regions plus version and freshness metadata, never raw point/time history.
4. Transactional unfriend/block/revoke/account-delete cleanup and server query predicates. Re-friending starts ungranted.
5. Object-level friend Cairn/Route access rows or equivalent explicit owner permission compatible with current owner identity and tombstones.
6. If approved, a prospective friend-only Encounter fact with stable object/evidence IDs and a uniqueness/idempotency boundary.
7. Client owner/grant/revision guards modelled after the corrected Route same-owner stale-read protection, without building a global sync framework.

Public rows must remain untouched. New friend queries must explicitly exclude public discovery data unless an independent future Public contract authorizes it.

## UI and state scope

`UI_STATE_INVENTORY.json` lists the reachable surfaces and material states. The overnight batch should integrate functionality into current structures:

- frozen/accepted structure: Home, Auth/onboarding, Friends shell;
- reusable candidates pending device review: Activity Detail, Own Cairn Detail, All Cairns, Route Detail/Editor;
- bounded completion surface: personal Memory and friend-specific extensions;
- explicit non-goals: redesigning Settings, Trails, Plant, Hike/Run, or the global visual system.

Applicable state families are loading/empty/error, saving/disabled/selected, offline/reconnect, permission denied/map unavailable, stale response/account switch, revoke/block, unsaved/timeout/unknown mutation outcome, long/larger text, keyboard, and safe area. The acceptance contract selects meaningful combinations; it does not claim every Cartesian combination.

## Sequential work packages

### WP1 — Preserve baseline and prove isolation

- Reusable: O57/O58/O59 card tests, MySQL 8 route harness, system Chrome Playwright path.
- Missing: current full Friends schema fixture and A/B/C/D seed; deterministic network-delay controls.
- Minimum schema/API: none in product yet; test-only fixture/runner safety may need repair.
- Blocking choice: none.
- Verification: unique disposable DB, explicit host/db assertion, `DISABLE_CRON=1`, synthetic `.invalid` users, four isolated browser/API sessions, external-write interception.
- Checkpoint/fallback: stop before Friends writes if real A/B/C/D authorization tests cannot be isolated; Personal work can continue independently.

### WP2 — Complete Personal Memory / Journal gaps

- Reusable: personal cards, Memory persistence/hierarchy/map, current Product-DNA components.
- Missing: evidence provenance, simulator exclusion, place-context response fields, bounded state/theme work.
- Minimum schema/API: additive Memory provenance/effective source fields and honest hierarchy projection.
- Blocking choice: none; use `unknown` for history.
- Verification: unit/model + real local DB/API + actual personal handlers/browser themes; focused Activity/O55 regressions.
- Checkpoint/fallback: deliver Personal separately if Friends work stops. Do not hide provenance failure behind UI copy.

### WP3 — Friend authorization and derived shared layers

- Reusable: friend lifecycle, subscription picker, Memory renderer primitives.
- Missing: grant, projection, sensitive exclusion, revocation, revisions/cache ordering.
- Minimum schema/API: grants plus derived projection and transactional cleanup.
- Blocking choices: decisions 1–4.
- Verification: real MySQL/API A/B/C/D matrix, direct endpoint bypass tests, delayed responses, account switch, offline/reconnect.
- Checkpoint/fallback: leave friend Memory disabled/unclaimed if authorization is incomplete; do not expose raw `/fog` as a temporary success.

### WP4 — Permitted friend content interactions

- Reusable: owner Detail identity, read-only component roles, personal Route reference snapshot.
- Missing: normal Friend Detail entries, non-owner Detail authorization, Route reference lifecycle, optional Encounter.
- Minimum schema/API: explicit object permissions; Encounter table/API only if approved.
- Blocking choice: decision 5 and precise object share controls.
- Verification: API denial/allow tests plus actual navigation/use handlers; prove no ownership/Memory mutation.
- Checkpoint/fallback: ship requests/grants/shared Memory without friend Cairn discovery if Encounter is excluded; do not fake discovery.

### WP5 — Scoped three-theme and recoverable-state integration

- Reusable: locked Home family, shared tokens/components, accepted Friends structure, current card surfaces.
- Missing: Memory hierarchy role cleanup and new friend state surfaces.
- Minimum schema/API: none beyond prior packages.
- Blocking choice: none after visual semantics are frozen.
- Verification: system-Chrome mobile captures in Day/Sunset/Night, long/larger-text and keyboard/safe-area browser stress; native remains separate.
- Checkpoint/fallback: no global redesign; retain functional semantic components if visual polish is incomplete and report HOLD for affected acceptance rows.

### WP6 — Integrated/adversarial regression

- Reusable: existing card suites and changed-file gate.
- Missing: combined A/B/C/D journeys and authorization adversaries.
- Minimum schema/API: final migrations from WP2–4.
- Blocking choice: none.
- Verification: `ACCEPTANCE_MATRIX.json`, real handlers, real local MySQL/API, controlled network delay, browser navigation, focused regression.
- Checkpoint/fallback: issue separate Personal and Friends verdicts. Do not reduce one scope to make both green.

### WP7 — Delivery, rollback, and owner review

- Reusable: card handoff/package conventions and manual candidate marker process.
- Missing: coherent backend deployment set, isolated HTTPS owner target, native/device evidence.
- Minimum schema/API: deployment inventory/order/rollback for all local migrations.
- Blocking choice: explicit later deployment/OTA approval.
- Verification: manifest/hashes, compatibility table, rollback rehearsal against disposable DB, at most five grouped device checks.
- Checkpoint/fallback: local candidate only. No publication or production migration.

## Critical path and writer policy

Critical path: owner decisions → isolated Friends schema harness → Memory provenance → grant/projection/revocation → optional Encounter/object access → integrated authorization tests → scoped UI evidence → deployment-ready handoff.

Use one primary code writer for Memory/friend stores, navigation, backend authorization routes, and migrations. Independent work should be read-only review, fixture design, or test observation. Never allow simultaneous writers on those shared boundaries.

## Release and compatibility dependencies

An isolated owner-review environment needs a compatible backend set, not only an OTA:

- local migration 035/settings account-feedback-export contract status reconciled with target backend;
- O58 owner Cairn history and create-replay changes;
- O59 migration 036 and Route origin/delete response contract;
- new Memory provenance/reflection migration/API;
- new Friends grant/projection/revocation/object-access/optional-Encounter migrations/API;
- old-client/new-backend and new-client/old-backend behavior explicitly tested.

Until the new friend backend is present, the old raw friend-fog path should not be advertised as the completed feature. Restricting a visible accepted capability requires explicit owner approval; this preflight does not hide or publish anything.

Current EAS preview/development profiles point at production, so they are not an isolated test target. Native/device loading, actual Mapbox rendering, haptics, larger-text fidelity, physical GPS, and NZ field behavior remain outside local proof.
