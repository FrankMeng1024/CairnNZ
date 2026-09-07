# Privacy and sharing matrix

The product does not implement symmetric privacy states across domains. `personal` is the backend/private name, Route/Cairn UI uses personal/private and friend, and marker DB historically uses `group` for the friend tier.

## Object matrix

| Domain | PRIVATE | FRIENDS | PUBLIC |
|---|---|---|---|
| Activity | **FACT — YES by endpoint scope only.** No privacy field or UI; all session routes require owner auth. | **FACT — NO.** No friend Activity query or sharing control. | **FACT — NO.** No public Activity query. |
| Route | **FACT — YES.** `routes.permission='personal'`; RouteEditor control; owner APIs. | **FACT — YES.** UI control and `permission='friend'`; `/api/circle/routes` requires mutual friendship. | **FACT — schema/query only, ordinary client NO.** DB enum/read behavior supports seed public rows; create/update validation rejects client public. |
| Cairn / Marker | **FACT — YES.** UI private, client `personal`, DB `personal`; owner APIs. | **FACT — YES.** UI friends, client `friend`, DB `group`; mutual-friend circle query. | **FACT — schema/read only, ordinary client NO.** Existing public rows and nearby discovery/votes exist; active Plant hides/blocks public selection and server rejects public writes. |
| Memory | **FACT — personal points YES.** Owner sync APIs; no per-point privacy field/control. | **FACT — PARTIAL.** Other users obtain points through their own subscription selection; point owner has no explicit per-point or global sharing opt-out. | **FACT — NO public Memory query.** |
| Fog | **FACT — personal derived Fog YES.** Mine scope uses own points. | **FACT — PARTIAL and currently unsafe.** Friend scope uses Memory subscriptions, not object privacy; intended friendship enforcement is delegated to a DB trigger. | **FACT — NO public Fog scope.** |

## Enforcement path

| Domain/state | Model field | UI control | API enforcement | Query behavior | Downstream effect |
|---|---|---|---|---|---|
| Activity/private | none | none | owner ID on sessions CRUD | only current user's sessions/detail | Trails Activities is Mine-only; no sharing |
| Route/private | `routes.permission=personal` | RouteEditor | owner writes; circle excludes personal | owner list still includes it | disappears from friend list after authoritative refresh |
| Route/friends | `routes.permission=friend` | RouteEditor | owner writes; circle joins mutual friends/blocks/hidden rules | friend-tier rows returned with author | friend list is read-only; current detail routing is broken |
| Route/public | `routes.permission=public` | no ordinary control | client write rejected | seed/public circle behavior may return anonymized author | **DORMANT / FUTURE** discovery capability |
| Cairn/private | `markers.permission=personal` | Plant/MarkerDetail | owner writes | owner list only | not in circle/public |
| Cairn/friends | client `friend`, DB `group` | Plant/MarkerDetail | owner writes; circle requires mutual friendship | friend rows returned with author | Trails Friends; Memory currently does not feed `circleMarkers` into its pin layer |
| Cairn/public | `markers.permission=public`, `public_snapshot` | public option disabled | client public create/update rejected | nearby public query returns blurred/anonymized silhouettes; vote/report models exist | **PARTIAL/DORMANT** public discovery |
| Friend Fog | no point privacy field; `memory_subscriptions` relation | viewer's Memory friend picker | POST is documented to rely on DB trigger; circle Fog trusts rows | most recent capped points per subscribed friend | owner-level friend source union in Memory |

## Sharing semantics

- **FACT:** Route and Cairn “friends” visibility is authorization by current mutual friendship; it does not create copies in the recipient's account.
- **FACT:** Activities have no active share action or privacy control.
- **FACT:** “Memory sharing” is not controlled by the source user. The viewer chooses subscriptions from their friends; the source points carry no per-point privacy field.
- **FACT:** A friend removal should terminate fresh friend-tier Route/Cairn reads, but cached client data can remain until reload.
- **FACT:** Blocks are applied to friend-tier circle queries, but nearby public-marker reads do not filter block relationships.
- **FACT:** There is no share link, external share payload, or object duplication for Activity/Route/Cairn/Memory in active code.

## Production enforcement finding

**PRODUCTION FACT — HIGH:** Production has the `memory_subscriptions` table but not `trg_memory_subscription_cap`. Repository route code inserts directly and maps only trigger-raised errors for “requires existing friend pair” and “limit exceeded.” `/api/circle/fog` reads subscription IDs and does not repeat the friendship check. Consequently:

1. the nominal five-friend cap is not enforced by the deployed DB path;
2. mutual-friend authorization is not enforced on new subscription rows by that path;
3. remove/block does not revoke existing subscription rows;
4. friend Fog can continue after friendship removal.

This is not an inference from UI. It was verified through read-only deployed schema metadata plus the exact deployed route behavior.

## Unsupported symmetry

| Assumption | Actual result |
|---|---|
| Every object supports Private/Friends/Public | **FACT — false.** Activity has implicit private only; Memory/Fog have no object privacy field. |
| Public is a current creation choice | **FACT — false.** Route/Cairn client public writes are rejected. |
| Friendship alone controls all friend content | **FACT — false.** Fog adds the independent subscription relation. |
| Removing a friend revokes all friend data | **FACT — false.** Route/Cairn authorization changes, but caches remain; Fog subscription remains. |
| Blocking hides all public content | **FACT — false.** Nearby public marker query does not apply blocks. |
| Paid entitlement controls share tiers | **FACT — false today.** RevenueCat state does not alter Route/Cairn privacy or server Memory cap. |
