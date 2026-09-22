# 04 — New Zealand beta and release readiness

## Release verdict

**HOLD for a new external NZ cohort.** The hold is based on current-system facts, not on unimplemented blueprint ambitions:

1. O56 and production backend disagree on account deletion and feedback.
2. Friend Memory production authorization/revocation is unsafe.
3. No physical-device evidence identifies O56 as loaded.
4. No current real-NZ field run validates this exact native build + OTA + backend combination.
5. App Store Connect/TestFlight state is unverified.

An isolated internal engineering exercise can continue only with non-production/throwaway accounts, no friend-fog privacy testing against real users, and explicit evidence labels. No location-sharing, Public Cairn, paid, or external TestFlight claim is ready.

## Cohort classification

| Cohort/use | Readiness | Reason |
|---|---|---|
| Local/internal source debugging | **PARTIAL / conditional** | Focused tests and simulator tooling exist; production simulator is disabled. Use isolated accounts and label simulator evidence. |
| Small trusted external TestFlight cohort | **NO / HOLD** | Release mismatch, no O56 device identity, TestFlight state unknown, feedback endpoint broken. |
| Friend/location-sharing pilot | **NO** | P0 subscription authorization and revoke defect; exact historical coordinates exposed. |
| Public Cairn/Encounter pilot | **NO** | Public publish unavailable, normal detail/interactions unreachable, no Encounter ledger or moderation operations. |
| Paid App Store launch | **NO** | RevenueCat key absent, products/dashboard unknown, no server entitlement/reconciliation, misleading paywall delivery. |

## Build, OTA, and store chain

Known:

- production EAS update O56 exists for runtime 0.2.6 and points at the audited local HEAD hash;
- native production iOS build 56 completed on 2026-08-05 and includes RevenueCat native code;
- all EAS profiles use `https://api.yiiling.cn`, so preview/development/production builds share the same backend/data host unless another external control intervenes;
- production simulator flag is false; preview/development true.

Unknown:

- whether build 56 was uploaded/processed in App Store Connect;
- whether it is in an internal/external TestFlight group, passed beta review, or is still within its test window;
- which devices/testers installed it;
- whether any device loaded O56 rather than an older/no OTA;
- whether rollback/update selection works on a physical device.

Apple documents a 90-day TestFlight window from upload and external beta review requirements, but these do not establish Cairn's dashboard state: [build statuses](https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses), [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers). Build 56's EAS date makes continued theoretical TestFlight eligibility plausible through early November 2026 if it was uploaded later and not expired; this is an inference and must not be presented as availability.

Minimum owner check: supply a redacted App Store Connect build/group/status screenshot or API export plus tester-install evidence; do not expose account identifiers or signing secrets.

## Release-contract blockers

| Journey | O56/current client | Running production | Consequence |
|---|---|---|---|
| Feedback | waits for acknowledged `/api/account/feedback` | endpoint/table absent | ordinary user receives failure/404; beta feedback loop broken |
| Account deletion | promises seven-day server restore | five-minute grace and minute sweep | materially false user-facing promise and data-loss risk |
| Data export | current client expects queued status and `download_url` | older export contract is deployed | likely contract drift; requires an isolated end-to-end check |
| RevenueCat | native wrapper/paywall; missing O56 public key | no entitlement API/webhook | purchase unavailable; claimed benefit cannot be granted |
| Friend Memory | selection assumes trigger-enforced friendship/cap | production trigger absent; fog skips relationship | unauthorized exact-history access and failed revocation |

The public health endpoint being green does not mitigate these semantic mismatches.

## Install/version observability

Normal users can see native app/build information in Settings/About and the Home O marker. They cannot normally see an EAS update ID. Existing device evidence is O52-era and records `ota_update_id:null`; it does not prove O56.

Required bounded proof on a physical iPhone:

```text
native version = 0.2.6
native build = 56
runtimeVersion = 0.2.6
Home marker = O56
Updates.updateId = 01a09c0e-993b-759b-95e8-084f1f45238f
backend release/schema identity = explicitly recorded
```

The final backend identity should not depend on an operator remembering which container was deployed. M0 should produce a release manifest/receipt that binds client update, native build, backend commit/image, and migration ledger.

## Field evidence and diagnostics

Current internal diagnostics can capture Activity quality and request counts, but production reachability is intentionally gated and telemetry scrubs exact coordinates/credentials. This is useful privacy behavior. It also means there is no current external-tester consent flow for bounded exact-location forensic capture, retention, deletion, and owner access.

Account export contains personal data but is not a diagnostic consent mechanism. Before asking external testers to provide detailed traces, define:

- what is collected, including whether exact route/location is included;
- an explicit opt-in and per-capture scope;
- retention/deletion/access owner;
- redaction before sharing;
- linkage to build/update/backend identity;
- incident handling and tester contact.

New Zealand's Privacy Commissioner describes collection, security, and disclosure principles, including the current IPP3A notification duty, and breach notification obligations. This audit is not legal advice; the exact-location authorization defect requires owner/privacy review. Sources: [privacy principles](https://www.privacy.org.nz/privacy-principles/), [privacy-breach notification](https://www.privacy.org.nz/responsibilities/privacy-breaches/notify-us/).

The review bundle contains a candidate NZ beta research brief. No testers were contacted and no invitations were sent. Historic field plans/findings are leads only; they must not be reused as present consent or as proof of O56 behavior.

## Offline/readiness boundary by journey

| Journey | Current offline fact | Release evidence |
|---|---|---|
| Activity record/save | Durable local recording/WAL/recovery and eventual sync; focused tests strong | no current O56 physical-device NZ validation |
| Cairn create | Durable user-scoped entity/outbox and ack reconciliation | no current device/offline field validation |
| Cairn edit/delete | local pending edit/delete supported; synced edit is online/rollback, delete has tombstone retry | mixed; no field proof |
| Route create | Durable local entity/outbox/cache; retries source-Activity sync race | no current device proof |
| Route edit/delete | cached; synced mutation requires server, failure behavior varies by operation | partial automated proof only |
| Memory | local point persistence/sync exists; source provenance not persisted | simulator contamination possible in non-production profiles |
| Maps | silent rough-NZ Mapbox warmup pack; no user-selected regions or completion/status UX | no device pack-size/offline coverage proof |
| Existing Route geometry | available offline only if cached/loaded on that device | no guarantees for uncached friend/server objects |

Offline behavior must be tested with a deliberate network transition matrix, not inferred from an `offline-first` comment.

## Minimum release acceptance before external beta

M0 acceptance should be binary and limited to current release truth:

1. Approved backend version and migration set are deployed, with artifact hashes and rollback recorded.
2. O56-compatible feedback returns a durable acknowledgement; export request/status/download works.
3. Account deletion UI, API deadline, cron, email, and restoration all agree on seven days.
4. Friend fog is either disabled for the cohort or server authorization/revocation is repaired and regression-proven with isolated accounts.
5. One physical device proves native build, runtime, exact OTA update ID, backend/schema identity, cold relaunch, and rollback behavior.
6. One short real NZ Activity proves start/background/pause/resume/save, Activity→personal Memory, offline/reconnect, and explicitly tagged real provenance.
7. App Store Connect/TestFlight build/group/review and feedback contact are verified. Apple requires beta test information including a feedback email: [test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information).
8. Incident owner, data rollback/restore owner, tester support path, and stop criteria are named.

This does not authorize a deployment. It is the minimum owner acceptance list for a later release decision.

## Six-level evidence summary

| Capability | Source | User reachable | Automated proof | Deployed match | Device loaded | Real field |
|---|---:|---:|---:|---:|---:|---:|
| Auth/onboarding | YES | YES | PARTIAL | PARTIAL | UNKNOWN | PARTIAL |
| Home/build marker | YES | YES | PARTIAL | YES | UNKNOWN | UNKNOWN |
| Hike/Run recording | YES | YES | YES | PARTIAL | UNKNOWN | PARTIAL |
| Feedback | YES | YES | YES | NO | UNKNOWN | NO |
| Export | YES | YES | PARTIAL | PARTIAL | UNKNOWN | NO |
| Account delete/restore | YES | YES | YES | NO | UNKNOWN | NO |
| Offline committed entities | YES | YES | YES | PARTIAL | UNKNOWN | UNKNOWN |
| Production diagnostics | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UNKNOWN | UNKNOWN |
| External TestFlight availability | UNKNOWN | UNKNOWN | NO | UNKNOWN | UNKNOWN | NO |
| Current O56 NZ field validation | YES (instrumentation) | YES | PARTIAL | PARTIAL | NO | NO |

## Stop condition

The fact audit ends here for product review. It does not approve M0 implementation, migration 035, backend deployment, O56 republish, TestFlight action, tester outreach, or production-data repair.
