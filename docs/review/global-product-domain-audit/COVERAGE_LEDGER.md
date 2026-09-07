# Validation and coverage ledger

Methods: **CODE** active source/call graph; **RUNTIME** controlled Expo Web or existing accepted runtime evidence; **API** route/service contract; **SCHEMA** migrations/local schema definition; **PRODUCTION** read-only deployed metadata/runtime; **TEST** focused automated test.

| Area | Coverage | Methods | Evidence boundary / remaining limitation |
|---|---|---|---|
| Authority/visual documents | REVIEWED | CODE | Required visual authorities, manifest, north-star, roadmap, DNA/changelog, and migration state read before board work |
| Working tree / git | REVIEWED | CODE | baseline status, branch, HEAD, origin, diff, untracked artifacts recorded; pre-existing changes preserved |
| Production deployment | REVIEWED | PRODUCTION | host checkout, Docker topology/health, selected container source hashes, EAS production update/version inspected read-only |
| Home | REVIEWED | CODE, RUNTIME | navigation, actions, unfinished recovery, exploration statistic and themes checked |
| Friends | REVIEWED | CODE, API, SCHEMA, RUNTIME, PRODUCTION | request/friend/block lifecycle and product-wide effects traced; no sensitive row inspection |
| Hike | REVIEWED | CODE, RUNTIME, TEST | lifecycle, route selection, Plant entry, recovery, completion checked; physical-device GPS/background remains partial |
| Run | REVIEWED | CODE, RUNTIME, TEST | same plus quick Cairn and recovery parity; physical-device GPS/background remains partial |
| Activity domain | REVIEWED | CODE, API, SCHEMA, RUNTIME, TEST, PRODUCTION | creation through deletion, local/server sync and P0 deployment boundary traced |
| Activity P0 | REVIEWED | CODE, RUNTIME, TEST, PRODUCTION | focused contract/guard tests; local HEAD not current production OTA; one unrelated tracking dedupe test fails |
| Routes | REVIEWED | CODE, API, SCHEMA, RUNTIME, PRODUCTION | create/detail/edit/delete/privacy/circle/reuse/following traced; production route FK checked |
| Activity → Route | REVIEWED | CODE, API, SCHEMA | exact UI/editor/API transformation and provenance break established |
| Route → Activity | REVIEWED | CODE, API, SCHEMA | picker and shared tracking boundary traced; no persisted relationship |
| Trails Activities | REVIEWED | CODE, RUNTIME, API | Mine-only list/filter/sort/detail/actions checked |
| Trails Routes | REVIEWED | CODE, RUNTIME, API | Mine/Friends, search/filter/sort and broken friend-detail boundary checked |
| Trails Cairns | REVIEWED | CODE, RUNTIME, API | Mine/Friends, category/privacy/sort/detail actions checked |
| Plant | REVIEWED | CODE, RUNTIME, API | all current entries, GPS/pin/content/privacy/offline/save/error/detail traced |
| Cairn / Mark / Marker | REVIEWED | CODE, API, SCHEMA, RUNTIME | terminology, fields, community capability, Activity/Route absence and deletion effects traced |
| Memory | REVIEWED | CODE, RUNTIME, API, SCHEMA | inputs, maps, Cairns, friend picker/paywall, persistence/error settings traced |
| Fog / exploration | REVIEWED | CODE, API, SCHEMA, PRODUCTION | Turf/H3, personal/friend overlap, provenance/revocation and deployed trigger checked |
| Privacy / sharing | REVIEWED | CODE, API, SCHEMA, PRODUCTION | per-domain private/friend/public controls and server query enforcement mapped |
| Activity Detail | REVIEWED | CODE, RUNTIME, API | entry, local/remote points, delete, rename, Save as Route |
| Map History | REVIEWED | CODE, RUNTIME | ID-specific active branches and unparameterized dormant/legacy branch separated |
| Route Detail / Editor | REVIEWED | CODE, RUNTIME, API, SCHEMA | actions and mutation failure boundary checked |
| Cairn Detail | REVIEWED | CODE, RUNTIME, API | own lookup/edit/delete/privacy; friend detail failure checked |
| Settings | REVIEWED | CODE, RUNTIME | visible, hidden, persisted, dead and dormant consumers inventoried |
| Feature flags / hidden paths | REVIEWED | CODE | `__DEV__`, Platform web bridge, local flags, five-tap Debug, generated previews traced |
| Subscription/paywall | REVIEWED | CODE, API, SCHEMA, PRODUCTION | client purchase/restore and server cap gap traced; provider dashboard config remains UNKNOWN |
| Auth/account | REVIEWED | CODE, API, SCHEMA, PRODUCTION | create/verify/login/reset/restore/logout/delete/export and deployed grace window checked |
| Offline/sync | REVIEWED | CODE, API | domain-by-domain queues/fallbacks/retries/conflict gaps classified; native Mapbox cache behavior UNKNOWN |
| Notifications | REVIEWED | CODE, API, SCHEMA, PRODUCTION | UI, client registration/producers, backend tables/cron separated; live delivery not triggered |
| Background jobs | REVIEWED | CODE, PRODUCTION | native tracking, client daemons/token refresh and backend cron ownership/cadence traced |
| Production database domains | REVIEWED | SCHEMA, PRODUCTION | table/column/FK/trigger metadata only; no sensitive data and no writes |
| Account hard-delete cascades | PARTIAL | CODE, SCHEMA, PRODUCTION | core FK consequences and missing `unlocked_regions` FK verified; exhaustive retention/compliance policy is outside code audit |
| Native iOS/Android activity behavior | PARTIAL | CODE, TEST | needs physical-device proof for CoreLocation, lock screen, process death and Mapbox ornament interaction |
| RevenueCat products/pricing/trials | UNKNOWN | CODE | dashboard/external provider state not stored in repo and not required for safe read-only production audit |
| Mapbox offline/license requirements | UNKNOWN | CODE | external authoritative documentation research intentionally not performed |
| Public content population/moderation operations | PARTIAL | CODE, API, SCHEMA | capability traced; production content rows not inspected because no domain conclusion required user data |

## Validation results

| Check | Result | Classification |
|---|---|---|
| Expo Web active surfaces at 390×844 | Home/Trails tabs/Plant/Hiking/Running/Memory/Settings rendered; functional board created | **FACT — PASS for reachability/context** |
| Activity operational-state test | 8/8 passed | **FACT — PASS** |
| Activity P0 screen contract test | passed in combined focused run | **FACT — PASS** |
| P0 store operation guards | 2/2 passed when isolated | **FACT — PASS** |
| Broader selected Activity tests | 24 passed, 1 timestamp-dedupe assertion failed (expected 54, got 14) | **FACT — PARTIAL / PRE-EXISTING FAILURE** |
| TypeScript no-emit | failed with broad pre-existing repository errors | **FACT — FAIL as repository-wide gate** |
| Backend health | healthy | **PRODUCTION FACT — PASS** |
| Production schema trigger check | zero triggers; required Memory trigger absent | **PRODUCTION FACT — FAIL authority expectation** |
| Production session Route FK check | `route_id` column present, `fk_session_route` absent | **PRODUCTION FACT — FAIL migration expectation** |
| Production mutation safety | only metadata/health/SELECT-style schema inspection performed | **PRODUCTION FACT — PASS read-only constraint** |

## Explicitly unperformed

- No production product mutation, email trigger, push trigger, account action, friend action, or data modification.
- No migration, deploy, container restart, service restart, commit, push, EAS update, or OTA.
- No physical-device recording because the audit is read-only and Expo Web cannot establish native background outcomes.
- No broad external research; gaps are listed for later orchestration.
