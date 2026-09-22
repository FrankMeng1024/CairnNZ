# 01 — Memory, friends, permissions, and revocation

## Verdict

Personal Memory has a coherent local evidence boundary and remains separate from ordinary Cairn and Activity deletion. Friend Memory does not have a safe authorization boundary in production. The current system treats a viewer's display selection as if it were the data owner's grant, relies on a missing database trigger for friendship authorization, returns exact raw history, and fails to revoke access on unfriend/block. The blueprint's provenance-aware, owner-authorized model is directionally compatible, but it is not current fact.

## Personal Memory: what is authoritative now

| Question | Current fact | Evidence |
|---|---|---|
| Authoritative local evidence | Flat `VisitedPoint[]` with `lat`, `lng`, `ts`, `cid`, sync flag | `app/src/features/memory/store/useMemoryStore.ts:35-47` |
| Source/provenance persisted per point | **No**. `source` affects flush policy but is not stored | `recordMemoryEvidence.ts:5,28-68` |
| Spatial dedupe | 12.5 m (`radius * 0.5`) | `useMemoryStore.ts:132-133,220-260`; `memoryConfig.ts` |
| Explored predicate | point within configured 30 m radius | `useMemoryStore.ts:273-292`; `memoryConfig.ts` |
| H3 store | derived cache/dual write, rebuildable from points; not source authority | `useMemoryStore.ts:23-26,259-266`; `useH3VisitedStore.ts` |
| Fog geometry | client buffers point samples; self points, or self + enabled friend points; capped/smoothed for rendering | `app/src/features/memory/components/FogLayer.tsx` (`samplePoints`, `MAX_POINTS`) |
| Active Activity | accepted canonical Activity points call `source:'activity'` | `app/src/store/useTrackingStore.ts:4191-4197` |
| Recovery/final reconciliation | writes through the same evidence boundary | `useTrackingStore.ts:2410,4843` |
| Foreground passive walking | opt-in recorder writes when idle | `PassiveMemoryRecorder.tsx:20-108` |
| Plant/Cairn creation | no current Plant caller; does not itself create personal Memory | call-site search + `PlantScreen.tsx` |
| Activity/Cairn deletion | deletes the object, not personal Memory | current stores/services and focused contracts |
| Explicit Memory reset | separate Settings action clears server points/unlocked regions and local state | `SettingsScreen.tsx`; backend `routes/memory.js` |

This matches the accepted constraint that an Activity or Cairn deletion must not rewrite personal exploration history. It also means the current store cannot distinguish real Activity, passive real GPS, simulator passive GPS, or historical reconciliation after the fact. The `MemoryEvidenceSource` enum is runtime metadata, not persisted provenance.

Production builds disable the simulator profile, but preview/development enable it. If foreground auto-unlock is enabled while the simulator is selected, `PassiveMemoryRecorder` commits simulator samples as ordinary `source:'passive'` points (`PassiveMemoryRecorder.tsx:42-74`). Because source is discarded, later cleanup cannot identify those points. This is a test-data contamination risk, not evidence that production users are currently contaminated.

The Home coverage estimate uses point count times a constant (`memoryPointCount * 0.000541`) rather than unioned geometry. It is self-only, but it is an approximation that can over- or under-state area; friend union does not legitimately increase the personal statistic. See `app/src/hooks/useExplorationStats.ts`.

## Friend Memory: current data path

```text
viewer picks friend(s)
  -> POST /api/memory-subscriptions
  -> DB trigger is expected to check friendship + cap [ABSENT IN PRODUCTION]
  -> GET /api/circle/fog reads subscription IDs only
  -> exact {lat,lng,ts}, up to 20,000 newest points per friend
  -> RAM-only per-friend cache
  -> FogLayer renders self UNION selected friends
```

Important separations:

- `memory_subscriptions` is a viewer-controlled map-layer selection, despite its name; it is not an App Store subscription.
- There is no owner enable/disable grant, per-recipient grant, sensitive-place exclusion, coarsening, purpose/retention policy, or authorization version.
- Multiple selected friends are rendered as a union. There is no normal single-friend focus and no “hide self” mode.
- Friend points stay outside `useMemoryStore`; normal viewing does not upload them as the recipient's personal evidence.
- The per-friend cache is in RAM only. Logout/user switch clears it; relaunch loses it; an already-open session can retain revoked data until a local reload/purge.

Source path: `useMemorySubscriptionsStore.ts:42-143` controls selections; `useFriendMemoryStore.ts:29-155` stores per-friend points; `FogLayer.tsx` consumes the union. The normal UI is `MemoryFriendPickModal.tsx:41-168`.

## P0 — production authorization failure

The endpoint `POST /api/memory-subscriptions` validates an integer and self-subscription, then performs a bare insert (`backend/src/routes/memory-subscriptions.js:33-75`). It explicitly delegates both relationship and cap enforcement to `trg_memory_subscription_cap`, defined in migration 018 (`backend/src/migrations/018_friend_system_v4.sql:83-119`). Production schema inspection found that trigger absent while the migration ledger is already past 018.

The fog endpoint selects friend IDs solely from `memory_subscriptions` (`backend/src/routes/circle.js:55-63`) and then returns exact raw Memory rows (`circle.js:193-275`). It does not join `friends`, `blocked_users`, or the target user's soft-delete state. Consequently, a directly authenticated caller can currently:

1. submit any existing user ID permitted by the two user FKs;
2. exceed the nominal five-friend cap;
3. retrieve that user's exact historical Memory points;
4. retain access after unfriend or block, because those actions do not delete the subscription.

The production aggregate was zero `memory_subscriptions` rows at the audit instant, so no active exposure was demonstrated. That is not a control and does not lower the defect's severity. Normal UI limits selection and supplies friends from the user's list, but server authorization cannot depend on client behavior.

A normal migration rerun will not repair this because migration 018 is already recorded. A future approved fix requires a new corrective migration plus server-side authorization in the request/query path; this audit did not create either.

## Friendship, sharing, and revocation

Friend-tier Routes/Cairns use current mutual friendship in `/api/circle/routes` and `/api/circle/markers`; accepted friendship exposes all past friend-tier objects immediately. Friend fog differs: normal UI requires viewer selection, but the production API defect bypasses that requirement.

Unfriend deletes only `friends` rows (`backend/src/routes/friends.js:500-531`). Block inserts `blocked_users`, deletes `friends`, and rejects pending requests, but also leaves `memory_subscriptions` intact (`friends.js:600-644`). Therefore:

- friend-tier Route/Cairn queries stop on their next server read because they derive current friend IDs;
- exact friend fog does **not** stop, because `/circle/fog` derives stale subscription IDs;
- offline/open-session cache is not remotely invalidated;
- re-friending is not a well-defined new grant because the old subscription can survive.

Soft-deleted owners are hidden from the subscription-list UI (`memory-subscriptions.js:100-130`) but `/circle/fog` can still return their points until eventual hard-delete cascades. The running five-minute grace shortens that interval but contradicts O56's seven-day promise and is not a legitimate authorization mechanism.

## Required 10-state behavior matrix

| State | Blueprint/accepted expectation | Current behavior |
|---|---|---|
| 1. self only | personal evidence visible | Works; self points are authoritative. |
| 2. A only | display A under a valid owner grant; not personal evidence | UI cannot hide self; A can be selected by viewer; no owner grant. A remains display-only. |
| 3. self + A | provenance-aware union; personal count stays self-only | Render union works; personal statistic remains self-only; point source is per-friend only in RAM. |
| 4. A + B | retain A/B provenance through overlap | Render union and separate RAM buckets exist; no “friends without self” view. |
| 5. self + A + B | overlap survives per-source removal | Rendering can recompute by enabled friend IDs. |
| 6. remove A | A-only area disappears; self/B overlap remains | Explicit unsubscribe works locally/server-side; unfriend/block does not revoke A. |
| 7. remove B | symmetric with A | Same boundary and same defect. |
| 8. owner revokes while viewer offline | next authorization sync purges A; cached data bounded | No owner revocation API; open RAM remains; no entitlement version/push. |
| 9. re-add/re-authorize | explicit new grant with clear provenance | Old subscription may continue or revive; no grant event/history. |
| 10. owner deletes account | immediately unavailable; deletion policy controls purge | List hides soft-deleted owner, but fog query can serve until hard cascade; running grace is five minutes. |

## Six-level evidence summary

| Capability | Source | User reachable | Automated proof | Deployed match | Device loaded | Real field |
|---|---:|---:|---:|---:|---:|---:|
| Personal Activity→Memory | YES | YES | YES | PARTIAL | UNKNOWN | PARTIAL |
| Passive Memory opt-in | YES | YES | PARTIAL | PARTIAL | UNKNOWN | UNKNOWN |
| Explicit Memory reset | YES | YES | YES | PARTIAL | UNKNOWN | UNKNOWN |
| Multi-friend fog display | YES | YES | PARTIAL | YES | UNKNOWN | UNKNOWN |
| Friendship/cap authorization | YES (intended) | PARTIAL | PARTIAL | NO | UNKNOWN | NO |
| Owner-controlled sharing | NO | NO | NO | NO | NO | NO |
| Unfriend/block revocation | NO | YES (action) | NO | NO | UNKNOWN | NO |
| Provenance-aware overlap | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UNKNOWN | UNKNOWN |

`PARTIAL` real-field evidence for personal Activity→Memory refers only to older real-device corpora, not O56 or the current backend. It must not be read as current-release validation.

## Blueprint compatibility and decisions

Compatible direction:

- personal Memory stays independent of friend display;
- attribution is required to remove one friend without erasing self/others;
- unfriend/block/revoke must remove friend-only fog while preserving overlap;
- simulated/planned/display geometry must not become personal real evidence.

Decisions that remain product authority, not audit facts:

- whether every owner must opt in, or can grant per friend/per audience;
- exact/coarsened geometry, sensitive-place rules, retrospective history window, retention, and offline cache TTL;
- whether single-friend focus hides self or only changes emphasis;
- when a grant begins/ends and what re-friending means.

Minimum owner check before any social/location pilot: use two isolated accounts in a non-production dataset to prove subscribe authorization, exact revocation on unsubscribe/unfriend/block/delete, overlap retention, offline/relaunch behavior, and server logs that contain no unauthorized exact coordinates. The current shared production backend must not be used as the test bed for this defect.
