# 00 — Deployed baseline and evidence boundary

Audit window: 2026-09-15–16 (Asia/Shanghai)  
Audit mode: read-only fact audit; no implementation, migration, production write, deployment, OTA, App Store Connect change, or O-marker change was performed.

## Verdict

The currently published O56 JavaScript client and the running production backend do **not** implement one coherent release contract. O56 advertises seven-day account restoration and submits feedback to `/api/account/feedback`; the running backend still enforces the earlier five-minute deletion window and has neither that endpoint nor the `feedback_messages` table. This is a release-truth blocker independent of the proposed blueprint.

Separately, the production database is missing the `trg_memory_subscription_cap` trigger on which the API relies for both friendship authorization and the five-friend cap. That permits a directly authenticated caller to add arbitrary existing user IDs to `memory_subscriptions`; `/api/circle/fog` then returns those users' exact stored Memory points without rechecking friendship or block state. This is a deployed P0 authorization/privacy defect even though the aggregate production check found zero current subscription rows.

## Evidence vocabulary

Every capability in this bundle is evaluated independently at six levels:

1. **Current source** — code/schema/config exists in the audited dirty local tree.
2. **User reachable** — an ordinary production user has a normal UI/navigation path.
3. **Automated proof** — a focused automated test proves the material contract locally.
4. **Deployed match** — the deployed client/backend/database is shown to match the relevant source contract.
5. **Device loaded** — evidence identifies the exact native build and OTA loaded on a physical device.
6. **Real field** — the capability was exercised in a real outdoor/production-like field journey with attributable telemetry.

`YES`, `NO`, `PARTIAL`, and `UNKNOWN` are deliberately not collapsed. Source presence is not deployment; deployment is not device loading; device loading is not field validation.

## Repository snapshot

| Fact | Audited value | Evidence |
|---|---|---|
| Local repository | `/Users/mzm/Desktop/cairn/CairnNZ` | audit environment |
| Branch / HEAD | `master` / `12fa1cd0ef599e53a81cd30537ce761c5e2150ce` | `git rev-parse`, `git status` |
| Remote relationship | local HEAD equals `origin/master` | read-only Git inspection |
| HEAD subject/date | `052 hike/run`; 2026-09-12 23:05:35 +08:00 | `git show` |
| Dirty state at audit start | 158 entries: 0 staged, 102 unstaged, 56 untracked | porcelain snapshot; preserved |
| Client version/runtime | app `0.2.6`; runtime policy `appVersion` → `0.2.6` | `app/app.json:3`, `app/app.json:97` |
| iOS bundle ID | `com.yiiling.cairn` | `app/app.json` |
| EAS native version source | remote | `app/eas.json:4` |
| Current local Home marker | `O56` | `app/src/components/OtaBadge.tsx:347` |
| API host in all EAS profiles | `https://api.yiiling.cn` | `app/eas.json:32,49,62` |
| Simulator policy | production false; preview/development true | `app/eas.json` |

The requested authority file `CairnNZ_Project_Authority.md` is absent. The v0.9 blueprint and v0.9.1 supplement were therefore treated as candidate product direction, not current-system authority. Existing dirty changes—including audited Memory, Route, Settings, backend account, and untracked migration work—were not cleaned, staged, rewritten, or otherwise normalized.

## Published client baseline

Read-only EAS access established the newest production update as:

| Field | Value |
|---|---|
| Branch | `production` |
| Group | `9b3a3dcc-03b6-4300-a97b-317ee0a7441b` |
| Update ID | `01a09c0e-993b-759b-95e8-084f1f45238f` |
| Created | 2026-09-13T18:36:37.563Z |
| Runtime/platform | `0.2.6` / iOS |
| Message / source commit | `O56` / local HEAD hash `12fa1cd…` |
| Launch asset | Hermes bundle, 6,517,008 bytes, SHA-256 `b210b673d33f4f88229adc0b9fd9792fd27261425c76b128cb177c8f4bf0ae86` |

The bundle contains O56, the seven-day deletion copy, `/api/account/feedback`, `/api/account/export`, `memory_pro`, the NZ$5.99 fallback paywall copy, `/api/memory-subscriptions`, `/api/circle/fog`, `/api/circle/routes`, `/api/circle/markers`, and `/api/hide`. It contains the missing-key diagnostic `iap:api_key_missing` but no embedded `appl_…` RevenueCat iOS public key. It contains the current Trails “Find a Route”/`trails-routes-list` surface and not the older All Cairns UI.

The update was produced from a dirty worktree. EAS exposes the Git hash but not a complete dirty-source snapshot; string probes prove the listed release facts, not identity of every O56 module with the current local tree. The repository has no O56 publication receipt; the newest committed receipt found is O55. A current Settings review document that says O56 was merely a candidate is therefore **SUPERSEDED** by EAS evidence.

The newest finished production iOS store build is EAS build `362ce827-5dae-4b1b-9005-ff05c870c269`, app `0.2.6`, build `56`, created 2026-08-05 from commit `361ff837…`. That native source already included `react-native-purchases` and `iapService`. EAS build completion does not prove App Store Connect upload, TestFlight availability, tester installation, or device loading.

## Running production backend and database

The public health endpoint returned `status=ok`, service `cairn-backend`, version `0.1.0`, and database `ok`. Authorized read-only production inspection found:

| Layer | Observed state |
|---|---|
| Checkout | `/opt/githubRepos/Cairn`, `master`, commit `6c8e623f1b3b814be7fc67ca08f381d0f3895045`, dated 2026-09-10 |
| Tracked source | clean; 10 untracked operations/development artifacts |
| Container | running image `sha256:b7b0f029af695f3e30f7323e42866e568bbb4d65252c6cdb4775b0f7e0a4e181` |
| Artifact identity | all 95 tracked backend build inputs in `src`, `public`, and package manifests matched checkout hashes; 0 differing, 0 missing |
| Migration ledger | through `034`; local untracked `035` not deployed |
| Missing production objects | `feedback_messages`; `telemetry_sessions.owner_user_id`; unlocked-region FK; all Memory subscription triggers |
| Present production objects | `memory_subscriptions`; `users.memory_subscription_limit`; two subscription→user FKs; `routes.permission`; `marker_votes` |
| Encounter persistence | no Encounter table/object found |
| Current subscription aggregate | zero rows at observation time |

Production backend behavior is the older five-minute account restoration window with a one-minute deletion sweep. Current local source has a seven-day constant and a durable feedback contract, but that is only **FIXED LOCALLY** until an approved deployment and migration are independently proven. No deployment command or production mutation was issued by this audit.

## Local automated proof

Focused tests were run against the already-dirty local source without modifying tests:

| Suite | Result | Boundary |
|---|---|---|
| App Jest | 20 suites, 179 tests passed, 0 failed, 12.646 s | local unit/contract proof only; emitted two warnings for unknown `setupFilesAfterFramework` configuration |
| Backend Node tests | 3 files, 23 tests passed, 0 failed, 477.8 ms | local source/string contract proof only |

Coverage included Activity/Memory evidence and durability, fog and settings contracts, marker/route offline behavior, Trails, Friends, telemetry, RouteFollower, and stroke gates. It did not integrate against the production friend-authorization database state, RevenueCat/App Store Connect, a physical O56 device, or a real NZ walk. A repo-wide `verify:changed` was intentionally not substituted for targeted read-only audit proof because no Activity implementation change was made.

## Device and field boundary

The strongest physical-device artifact found is an older O52 handoff showing app `0.2.6`, native build `56`, but `ota_update_id:null`. Historical real-vs-simulator corpora are useful investigation evidence but do not show that O56 is loaded or that the current client/backend combination works in the field. Current O56 device-loaded state and current NZ real-field state are therefore **UNKNOWN**.

Minimum owner proof:

1. On one physical iPhone, capture Settings/About native version and build, Home `O56`, `Updates.updateId`, and `runtimeVersion` after cold relaunch/update.
2. In an isolated test account, prove feedback acknowledgement and account-deletion restoration deadline against the intended backend release.
3. Run a consented NZ walk and retain bounded Activity/Memory metrics with explicit `real` provenance; do not infer reality from route shape alone.

## Old findings reclassified

Old reports are leads, not authority. The current classifications are:

| Prior lead | Current classification | Current fact |
|---|---|---|
| O56 was not published | **SUPERSEDED** | EAS production update proves publication; device loading remains unknown. |
| Account deletion used five minutes | **FIXED LOCALLY** | Local source says seven days; production still runs five minutes. |
| Settings feedback/export migration absent | **FIXED LOCALLY** | Local migration 035/source/tests exist; production is still at 034 and lacks feedback. |
| Memory subscription friendship/cap trigger missing | **STILL PRESENT** | Trigger is absent in production; local migration 018 alone cannot repair an already-recorded ledger. |
| Unfriend/block revokes friend fog | **STILL PRESENT** as a defect | Neither path deletes subscriptions; fog does not recheck friendship/block. |
| Plant creates personal Memory evidence | **FIXED LOCALLY** | No current Plant caller of the evidence boundary; ordinary Cairn creation/deletion is separate from Memory. |
| Trails exposes Cairns/friend tabs | **SUPERSEDED** | Current/O56 Trails is Activities + Routes; this also leaves no All Cairns journal. |
| Route creation is backend-first only | **SUPERSEDED** | Current source has a user-scoped durable route outbox/cache. |
| Activity→Route provenance is durable | **STILL PRESENT** as a gap | Source Activity is validated at create time but not persisted in the route row. |
| Route following is active product behavior | **STILL PRESENT** as a gap | Engine/hook/tests exist, but there is no normal caller/setter. |
| Cairn create has no offline durability | **SUPERSEDED** | Create/outbox/ack/tombstone are durable; synced edit remains online-only. |
| Public Like/report/hide is usable | **STILL PRESENT** as a gap | APIs/components exist but ordinary public detail interaction paths are not wired. |
| Production IAP is operational | **STILL PRESENT** as a gap | Native SDK exists, but O56 has no RC public key and no server entitlement path. |
| Production debug simulator is normally reachable | **FIXED LOCALLY** | Production profile disables simulator and normal Settings lacks the old entry; current device proof remains unknown. |
| Route correction corridor is 100 m | **SUPERSEDED** | Current correction brush uses 250 m corridor and 50 m endpoint anchors; neither is server-side route provenance. |

## Minimum owner checks still UNVERIFIED

- App Store Connect: developer membership/entity/seller, build 56 upload and processing, TestFlight group/review/expiry, Paid Apps Agreement, tax/banking, product/subscription state, storefront and price.
- RevenueCat: project/app/API-key mapping, product/offering/entitlement attachment, sandbox/production mode, transfer behavior, webhook delivery.
- Mapbox: account contract, monthly MAU, Maps/Map Matching/Directions usage, offline storage, invoice/alerts and token restrictions.
- Infrastructure: current compute/database/backup/egress/email invoices and retention/restore evidence.
- Physical device: exact native build + OTA identity and current field exercise.

These absences are reported as `UNKNOWN`/`UNVERIFIED`; they were not filled with assumptions.
