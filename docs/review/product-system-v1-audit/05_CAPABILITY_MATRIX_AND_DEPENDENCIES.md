# 05 — Capability matrix and dependency plan

The canonical row-level matrix is [`CAPABILITY_MATRIX.csv`](./CAPABILITY_MATRIX.csv). It uses only `YES`, `NO`, `PARTIAL`, or `UNKNOWN` in the six evidence columns. `current_owner` names the code/data authority today, not a future organizational owner.

## Cross-cutting conclusions

- **Release truth is the first dependency.** Current O56, backend, and schema are not one release.
- **Personal evidence and display data must remain separate.** Personal Memory/Activity evidence is self-owned; friend/public/simulated/planned geometry is not.
- **An API is not a user capability.** Friend Routes/Cairns, Like/report/hide, Route following, and RevenueCat all have lower-layer source without a complete reachable/deployed product path.
- **Database constraints cannot be the sole request authorization.** Production proves that a migration ledger can say “applied” while a critical trigger is absent.
- **No current device/field claim closes the chain.** Exact O56 loading and real NZ validation remain unknown/no.

## Blueprint fit versus decisions

Strong fit with current facts:

- personal Memory remains after ordinary Activity/Cairn deletion;
- unfriend/revoke should remove only the former friend's contribution while preserving self/other overlap;
- Self/Friends/Public can be equal legitimate permission values without requiring a public feed/search;
- simulated, friend, planned, and display geometry must not count as personal real evidence;
- Activity and Route are distinct objects;
- All Cairns should expose existing personal objects before public discovery;
- Encounter eligibility, presentation, opening, and deliberate interaction need distinct states;
- paid entitlement should be server-authoritative and reconciled.

Product decisions still required:

- friend-owner grant model, grant start/history, re-friend semantics, exact/coarsened geometry, sensitive zones, retention and offline TTL;
- Encounter thresholds, anonymity, author notification and moderation SLA;
- Route copied/reference semantics, versioning, walked/planned segment vocabulary and privacy trimming;
- the paid benefit, free cap, price, legal entity/storefront, entitlement transfer/refund behavior;
- whether and how Public creation is allowed and who operates moderation.

The audit intentionally does not choose these policies.

## Dependency modules

### M0 — Trustworthy release baseline

**Journey:** owner/tester can identify native build + exact OTA + backend/schema; feedback/export work; deletion promise is truthful.

**Reuse:** Settings About, Home O marker, OtaBadge, health checks, EAS release data, backend deploy runbook, current local Settings/account work.

**Missing dependencies:** one release manifest/receipt; approved backend/client compatibility; migration state; explicit update ID diagnostics; rollback; isolated preview/production data policy.

**Impact/scope:** client + backend + operations; medium implementation/release risk because the tree is dirty and production lags. No work is authorized by this audit.

**Acceptance:** exact IDs/hashes; feedback acknowledgement; export download; seven-day deletion end to end; friend fog disabled or repaired; physical-device cold-launch/rollback proof.

**Blocks:** M1–M5 release claims.

### M1 — Personal Cairn journal

**Journey:** create offline → find in All Cairns → search/filter → open the same own detail → edit/delete with explicit sync state.

**Reuse:** marker store/outbox/client Cairn identity/tombstones, MarkerDetail, current Trails shell/search components.

**Missing dependencies:** reachable All Cairns index and stable routing; list/search/detail contract; synced-mutation UX. Archive can be deferred if the first slice does not promise it.

**Impact/scope:** mostly client; medium. It can be designed independently but should not be released before M0.

**Acceptance:** every created own Cairn is findable after relaunch/offline/reconnect; one object identity across list/map/detail; deletion cannot resurrect.

### M2 — Authorized friend layers

**Journey:** owner grants → viewer selects/displays → overlap keeps provenance → unsubscribe/unfriend/block/owner revoke/delete removes only that source → relaunch/offline cache respects the latest authorization.

**Reuse:** friend relationships, subscription selection UI, per-friend RAM buckets, fog renderer, circle endpoints.

**Missing dependencies:** owner grant schema/API; server-side relationship/block check on every authorization-sensitive path; corrective migration; entitlement/grant version; cache purge/TTL; sensitive-place/coarsening decisions; regression suite.

**Impact/scope:** schema + backend + client + privacy operations; large and security-critical.

**Acceptance:** required 10-state matrix in report 01, direct API abuse tests, concurrent revoke/read tests, offline/relaunch tests, no exact-location response after revocation.

### M3 — Encounter and Public Cairns

**Journey:** eligible nearby object → presented → opened → explicit Thanks/report/hide → moderation disposition, each with defined privacy/retention.

**Reuse:** public bbox query, pins/sheets, nonce/vote/report APIs, hide storage, block relations.

**Missing dependencies:** Encounter schema/API/reconciliation; normal public detail; interaction reachability; Public authoring policy; block/public filters; moderation queue, owner, SLA/appeal; abuse analytics.

**Impact/scope:** schema + backend + client + operations; large. Blocked by M0, M1 and relevant M2 privacy decisions.

**Acceptance:** event-state invariants, duplicate/offline reconciliation, distance/privacy tests, moderation drill, blocked-user/public behavior, author receives no implicit viewer location.

### M4 — Trustworthy Routes

**Journey:** Activity → immutable source/version + walked/planned segments → edit creates lineage → route-use snapshot → new Activity relationship → safe friend copy/reference/revocation.

**Reuse:** route outbox/cache/editor, source Activity transactional validation, LocalRouteExtras, current overlay and dormant follower after a product decision.

**Missing dependencies:** persistent source/version/segment schema; route-use snapshot/link; copy/reference identity; endpoint privacy trimming; server validation; migration/export support.

**Impact/scope:** schema + backend + client; large. Blocked by M0 and product decisions; not blocked on Public launch.

**Acceptance:** fresh-device round trip retains provenance; Activity deletion does not corrupt Route; edits never rewrite origin; planned segments never create personal Memory; shared/copy revoke policy is testable.

### M5 — Paid entitlement

**Journey:** view truthful offering → StoreKit purchase/restore → server receives idempotent lifecycle event → effective capability changes → renew/expire/refund/account-switch reconciles.

**Reuse:** RevenueCat native SDK/wrapper, stable Cairn app-user ID, paywall shell.

**Missing dependencies:** ASC/RC setup and key; truthful benefit/copy and privacy/terms links; backend webhook/App Store event ledger; signed/idempotent processing; entitlement storage/enforcement; sandbox/prod separation; refund/expiry recovery.

**Impact/scope:** App Store Connect + RevenueCat + backend + schema + client + support; large. Blocked by M0 and, if the benefit is friend layers, by M2.

**Acceptance:** sandbox purchase, six TestFlight accelerated renewals as appropriate, expiry/refund/restore/account switch, replayed webhooks, dashboard/server/device convergence, free-tier bypass closed.

## First implementable slice after explicit approval

Recommend **M0 release-truth closure only** as the first bounded slice: bind a single client update, native build, backend artifact, and migration set; make feedback/export/deletion contracts agree; prove the result on one physical device. This is not a recommendation to deploy from the current dirty tree. It requires a separate implementation/release authorization and a fresh preflight under `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`.

After M0, M1 (personal All Cairns) is the smallest product slice with high user value and fewer privacy dependencies. M2–M5 should not be parallelized as independent UI work because they share authorization, schema, and release-contract files.

## Collision map for future work

High-conflict files/areas that should be baselined before parallel edits:

- `app/src/screens/SettingsScreen.tsx`, `app/src/components/OtaBadge.tsx`, backend `routes/account.js`, `routes/auth.js`, migrations;
- `MemoryScreen.tsx`, `useMemoryStore.ts`, `useFriendMemoryStore.ts`, `useMemorySubscriptionsStore.ts`, `circle.js`, `memory-subscriptions.js`, `friends.js`;
- `useMarkerStore.ts`, marker routes/interactions, detail sheets;
- `useRouteStore.ts`, `RouteEditorScreen.tsx`, `useRouteEditStore.ts`, backend Route model/routes;
- RevenueCat wrapper/paywall plus any new entitlement schema/webhook.

The repository was already materially dirty in many of these areas. Future implementation must first attribute and preserve that work; this audit did not resolve ownership by overwriting it.
