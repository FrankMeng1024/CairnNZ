# Cross-domain mutation effects

This matrix records implemented consequences, not desired policy. “None” means no effect was found in active code/schema; it does not mean no effect is desirable.

## Mutation matrix

| Mutation | Primary object | Secondary object effects | Local state effects | Server effects | Fog / Memory effects | Sharing / visibility effects | Rollback / recovery |
|---|---|---|---|---|---|---|---|
| Delete Activity | Activity/session | Does not delete generated Routes or Cairns; local marker IDs can survive elsewhere | Removes summary and per-session points immediately | Owner DELETE for session is fire-and-forget | **FACT:** no Memory point deletion; Fog survives | Activities are owner-only, so no circle visibility change | **FACT — MISSING:** no rollback if server delete fails; local history can diverge |
| Discard unfinished Activity | Active recording | Deletes remote shell when known and active JSONL | Clears tracking/recovery state and file | Deletes server shell best-effort | Unsaved trace is not flushed to Memory | None | Recovery choice is explicit; failed remote delete may leave a hidden empty shell |
| Rename Activity | Activity display name | None | Updates local session store only | **FACT:** no backend update | None | None | **MISSING:** server hydration can reintroduce old/null name |
| Generate Route from Activity | New Route | Copies processed Activity geometry; no reference is written either direction | Adds Route to store after API success; editor extras/draft | Inserts independent `routes` row | None | Permission chosen personal/friend | Retry only through editor; repeated generation is allowed |
| Delete Route | Route | Intended schema would null `sessions.route_id`; active Activities do not populate it | Optimistically/remotely removes route and related local editor/follow extras | Deletes owned route; edit envelopes cascade | None | Friend visibility disappears after fresh circle query | **FACT — DEFECT:** service returns false instead of throwing and store can remove locally anyway; no rollback. **PRODUCTION FACT:** route FK is absent |
| Edit Route | Route | Does not rewrite source or future Activities | Store may update optimistic/current list and local extras | PUT route geometry/name/metrics/permission | None | Permission can add/remove friend-circle visibility after refresh | **FACT — DEFECT:** `null` response can be treated as resolved success; no authoritative rollback |
| Change Route privacy | Route permission | No Activity consequence | Own store value changes; friends' caches not actively invalidated | `personal` or `friend` only; public client value rejected | None | Circle query includes mutual-friend `friend` rows; personal disappears | Same false-success/stale-cache risks as edit |
| Delete Cairn | Marker | Marker votes cascade; Activity local marker ID may dangle | Removes local marker optimistically | Deletes owned marker and dependent votes | **FACT:** marker-contributed Memory point and Fog survive | Own/friend visibility disappears only if server delete succeeds and clients refresh | **FACT — MISSING:** no durable delete queue/rollback; detail copy incorrectly implies Memory removal |
| Edit Cairn | Marker | No Activity/Route update | Optimistic own marker change | PUT owned marker | No correction of previously inserted Memory point if coordinate changes | Friend visibility reflects updated permission/content on refresh | **MISSING:** remote failure is swallowed; local can diverge |
| Change Cairn privacy | Marker permission | None | Optimistic marker update | Maps client `friend` to DB `group`; public write rejected | None | Circle includes friend/group for mutual friends; personal excludes it | Same missing rollback and stale cache boundary |
| Accept friend request | Friendship | Creates mutual relationship; request accepted | Friend/request lists update | Inserts two directional friend rows transactionally | Does not auto-subscribe Fog | Enables friend-tier Routes/Cairns and permits intended Memory subscription creation | Friends store mutation has recovery/refresh; domain caches load separately |
| Decline friend request | Request | Establishes rejection/cooldown state | Removes/updates request list | Rejects request; 30-day resend cooldown | None | No circle access granted | API error is surfaced; no cross-domain rollback needed |
| Cancel outbound request | Request | None | Optimistic request removal | Deletes/cancels outbound pending request | None | None | Friends UI confirmation and error handling |
| Remove friend | Friendship | **FACT:** does not delete either user's Routes/Cairns; only access relation changes. Does not delete Memory subscription | Optimistic Friends removal with rollback; circle Route/Cairn/Fog caches remain stale | Deletes two friendship rows | **FACT — CONTRADICTED HUMAN INTENT:** subscription survives, so `/circle/fog` can continue serving points | Fresh circle Route/Cairn queries stop friend-tier rows; public remains | Friends mutation rolls back on failure; no product-wide cache invalidation |
| Block friend | Block + friendship | Removes friendship and rejects pending requests; does not remove Memory subscription | Friends/block slices update; circle caches not cleared | Inserts block, removes friend pair, rejects pending | Fog subscription survives | Friend-tier circle access ends on fresh query. Nearby public marker query does not filter blocks | API-level mutation/error handling; no cross-domain rollback/cache reconciliation |
| Unblock user | Block | Does not restore friendship or subscription | Block list changes | Deletes block | Existing stale subscription may still exist | Friendship must be re-established for friend-tier content | Standard API error handling |
| Subscribe to friend Fog | Memory subscription | None | subscription store updates; friend point cache can load | Inserts `(user_id, friend_id)` | Adds that friend's points to Friends scope | Shares the selected friend's exploration to the viewer | **PRODUCTION FACT — AUTHORITY DEFECT:** relied-on trigger is missing, so intended friendship/cap checks are not enforced by DB |
| Unsubscribe from friend Fog | Memory subscription | None | removes subscription; excludes/removes friend point cache after refresh | Deletes subscription row | Removes only that friend's source; personal/other-friend overlap remains | Ends Fog visibility from that friend | Explicit reversible action; no historical provenance record |
| Reset Memory | User's Memory points | Activities, Routes, Cairns remain | Clears personal Memory/H3 cache | Deletes current user's memory points; region cleanup behavior follows service | Personal Fog resets; marker points can be reintroduced only by future mutations, not reconstructed automatically | Friend Fog remains based on selected subscriptions | Destructive typed confirmation; no undo |
| Delete account | User | Eventually cascades sessions, routes, markers, memory, friendships, subscriptions, votes, tokens/preferences/exports according to FKs | Logs out/clears local slices after server response | Soft-delete, revoke current token/push; cron hard-delete after grace | Core memory points cascade on hard delete | Friendship/content disappear on hard delete; public rows owned by user also delete | Restore available until deadline; **PRODUCTION FACT:** only five minutes. `unlocked_regions` may orphan because production FK is absent |
| Logout | Local session only | Does not delete server domain data | Clears app user, completed sessions, markers, Memory/H3, SAF-01; detaches sync; sets logout marker | Push unregister currently disabled; RevenueCat user reset is attempted | Local view clears; server Memory remains | No server friendship/privacy change | Sign in/hydration restores server-backed data; some local-only Activity naming/history may be lost if not server-backed |

## Friend-removal intent verification

| Required consequence from human intent | Classification | Evidence result |
|---|---|---|
| Remove friendship | IMPLEMENTED | Backend deletes mutual friend rows. |
| Remove friend-only Routes | PARTIAL | Server authorization removes them from fresh results; current client cache is not cleared immediately. |
| Remove friend-only Cairns/Marks | PARTIAL | Same server result and stale-cache boundary. |
| Remove Fog available only through that friend | CONTRADICTED | Memory subscription is independent and is not deleted by remove or block. |
| Preserve user's own exploration | IMPLEMENTED | Friend data is stored/fetched separately from the personal point set. |
| Preserve exploration supported by other friends | IMPLEMENTED at owner level | Other friend caches remain and rendered geometry unions overlaps. |
| Preserve per-Activity independent support | ABSENT | Personal `memory_points` have no Activity/source provenance or reference counts. |

## Destructive-action wording implications

- **FACT:** “Delete Activity” must not currently promise to remove its explored area, Cairns, or generated Routes.
- **FACT:** “Delete Cairn” must not claim it disappears from Memory/Fog; the current Memory point survives.
- **FACT:** “Remove friend” cannot honestly promise Friend Fog removal until subscription cleanup and server authorization are repaired.
- **FACT:** “Delete Route” should not imply any Activity/history deletion.
- **PRODUCTION FACT:** account deletion must surface the actual server deadline; the current deployment's five-minute window is a release blocker rather than a UX preference.
- **INFERENCE:** Future source-aware destructive wording requires explicit provenance fields or a recomputation policy, not copy changes alone.
