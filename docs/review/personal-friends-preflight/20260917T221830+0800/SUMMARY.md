# Personal Journal / Friends overnight readiness preflight

Run ID: `20260917T221830+0800`  
Repository: `/Users/mzm/Desktop/cairn/CairnNZ`  
Mode: read-only product/source/environment preflight; no product implementation, deployment, migration, OTA, or external service action was performed.

## Verdict

The Personal Journal implementation is a credible overnight workstream built on the O57 Activity, O58 personal Cairn, and corrected O59 Route candidates. The remaining personal work is concentrated in Memory: durable evidence provenance, simulator/test isolation, honest place reflection, and scoped three-theme/state completion. It does not require a new journal or timeline platform.

The Friends Collaboration implementation is technically feasible, but its execution contract is not yet frozen. The current system has friend lifecycle operations and a viewer-selected Memory layer, but it does **not** have an author grant, a safe derived projection, a revocation/version contract, a bounded shared-data cache, authoritative non-owner detail roles, or an Encounter fact. The current `/api/circle/fog` contract returns exact point/time rows after checking only `memory_subscriptions`; it is not an acceptable foundation for the proposed product.

The full combined scope is therefore **conditional**, not ready for an unattended claim of completion. Local implementation can begin only after the five product choices below are frozen. Native/device acceptance cannot be completed on this Mac because Xcode/iOS Simulator tooling is unavailable, and an isolated owner-install backend target does not yet exist.

## Current baseline and attribution

- Branch and source base: `master` at `12fa1cd0ef599e53a81cd30537ce761c5e2150ce`, matching `origin/master` at preflight start.
- Candidate marker: `O59` in `app/src/components/OtaBadge.tsx`; it was not changed.
- Working tree: intentionally dirty; 481 status entries at preflight start, comprising 112 tracked modifications and 369 untracked paths, with no unmerged index entries. Current card work is largely newer than Git HEAD, so HEAD alone is not the product baseline.
- Route revision 02 package: `/Users/mzm/Desktop/cairn_route_detail_02.zip`, SHA-256 `1fbd78ce5718e98cd093d6dd22721514e99de85c594661261cbaa8de2ee0ee63`. Its 15 touched-file hashes match the current worktree. The ambiguous-delete, same-owner stale-read, real-MySQL origin, geometry-edit, save-in-flight, deletion, metric, and `Use Route` corrections are present and attributable.
- No competing Cairn API, Expo, Playwright, or disposable-MySQL process was running at the initial check. There were no unmerged files. The dirty shared stores/navigation/backend files remain the material collision risk; use one primary writer and capture a task-start patch.
- Previous automated evidence remains attributable to the exact card sources where hashes match. It proves local implementation behavior, not deployment, device loading, native rendering, field behavior, or owner acceptance.

Authoritative inputs reused:

- `docs/review/ui-requirements-baseline/20260916T131638+0800/`
- `docs/review/activity-detail/20260916T164608+0800/`
- `docs/review/cairn-personal/20260917T141933+0800/`
- `docs/review/route-detail/20260917T203209+0800/`
- `docs/review/product-system-v1-audit/01_MEMORY_FRIENDS_PERMISSIONS.md`
- `docs/review/product-system-v1-audit/02_CAIRN_ENCOUNTERS_ROUTE_TRUST.md`
- `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, and `docs/VISUAL_ASSET_MANIFEST.json`

Historical three-tab Trails, “Leave a mark” Plant, and older Hike/Run captures are not current references.

## Personal Journal readiness

### Already proven locally

- Hike/Run creates durable local Activity truth before Detail depends on network (`RQ-ACT-*`, `RQ-ACTD-*`).
- Activity Detail uses one object identity from Finish and Trails, preserves chosen Final geometry and true gaps, supports explicit linked-Cairn navigation, and has truthful rename/delete/Save as Route handlers.
- Own Cairn Detail and All Cairns use stable owner-scoped identity, pending-create edits, tombstones, owner-only retrieval, and a normal Memory entry outside map/GPS loading (`RQ-CAIRN-003` through `RQ-CAIRN-006`).
- Corrected Route Detail/Edit/Use supports independent geometry, draft/save/cancel behavior, origin persistence in real MySQL, Trails reopening, and Hike/Run pre-start handoff (`RQ-ROUTE-001` through `RQ-ROUTE-007`).
- O54 and O55 keep canonical/Final/Raw GPS/Clean Path responsibilities separate. None of this is native-device or owner acceptance.

### Remaining bounded work

1. **Memory evidence provenance — `NEW_SHARED_CONTRACT`.** `useMemoryStore.ts` persists a flat `VisitedPoint` without source; `recordMemoryEvidence.ts` receives `activity | passive | cairn | reconciliation`, but `recordPoint` drops it. `PassiveMemoryRecorder.tsx` can consume the authorized O55 simulator and record it as passive evidence. Add a minimal provenance contract that separates real Activity/passive evidence, Cairn evidence, simulator/test evidence, and historical unknown. Preserve unknown history as unknown; do not infer presence or Activity provenance from shape or proximity.
2. **Simulator/test isolation — `SMALL_EXTENSION` once provenance exists.** Synthetic evidence must be excluded from personal Memory and every friend projection while remaining usable in disposable test accounts. Do not change O55 path-generation algorithms.
3. **Honest place reflection — `EXISTING_BUT_INCOMPLETE`.** The backend already derives `first_unlocked_at`, `last_visit_ts`, and `point_count` in `backend/src/lib/attributeMemoryPoints.js`, but `backend/src/routes/hierarchy.js` does not expose them to the client. Expose defensible first/last recorded-evidence context. Do not call `point_count` “visits” and do not claim verified repeated presence.
4. **Personal Memory UI/state completion — `SMALL_EXTENSION`.** Preserve the current map/hierarchy and All Cairns entry. Replace local hard-coded hierarchy roles, clarify map/permission/offline/unknown-provenance states, and verify Day/Sunset/Night. Do not build a photo/voice/AI timeline.
5. **End-to-end integration — `SMALL_EXTENSION`.** Re-run the personal journey through actual handlers with synthetic data, including genuine Route geometry edits, failure/retry/duplicate taps, reload, deletion independence, offline/reconnect, and Raw GPS versus Clean Path truth.

## Friends Collaboration readiness

### Reusable foundations

- `useFriendStore.ts`, `FriendsScreen.tsx`, and `backend/src/routes/friends.js` implement request, accept/decline, cancel, remove, block/unblock, list, and profile primitives.
- `MemoryScopeToggle`, `MemoryFriendPickModal`, `useMemorySubscriptionsStore`, and `useFriendMemoryStore` provide a viewer-selected self/friends display shell.
- `/api/circle/markers` and `/api/circle/routes` show that owner-scoped non-owned reads can be modelled, and current personal Route/Cairn identity and snapshot boundaries are reusable.
- Account reset hooks exist. All Cairns remains owner-only, and friend points are not written into `useMemoryStore`, both of which must be preserved.
- The accepted Home/Auth/Friends visual structures and Product-DNA tokens are reusable; Friends structure should be extended, not redesigned.

### Missing contracts that block an honest first version

1. **Author grant.** Friendship and viewer selection are not publication consent. Add an owner-to-viewer grant with active/revoked state, effective/history scope, authorization version, and projection version.
2. **Derived display projection.** Replace exact point/time sharing with a server-derived per-source projection. Current `GET /api/circle/fog` returns up to 20,000 exact `lat/lng/ts` rows and checks only `memory_subscriptions`.
3. **Request-time authorization and bypass closure.** Every friend Memory/Cairn/Route read must check current friendship, block state, author grant, object permission, and account validity. The legacy circle endpoints must not bypass normal UI restrictions.
4. **Revocation and cache ordering.** Unfriend/block currently remove friendship rows but do not revoke `memory_subscriptions`. Friend Memory requests have no grant revision or same-owner stale-response guard. Add transactional revocation, versioned responses, account/source scoped cache rules, and delayed-response rejection.
5. **Source-preserving views.** Add self, self-plus-selected-friends, and single-friend views without flattening source identity. Preserve A/B/C overlap and never merge friend evidence into personal exploration.
6. **Read-only non-owner surfaces.** Add normally reachable, permission-checked Cairn and Route detail roles. A non-owner cannot edit/delete the original. A permitted Route use must snapshot an authorized reference and not transfer ownership or Memory.
7. **Prospective Encounter, if friend Cairn discovery is included.** There is no current Encounter schema/API/client. Presence-gated friend Cairns require a minimal server-issued fact from canonical real evidence. Map panning, planned geometry, simulator evidence, an API response, or viewing content must never create it.

## Minimum friend Encounter dependency

The smallest coherent v1 Encounter is prospective and friend-only:

- stable viewer, owner, Cairn, and canonical evidence/Activity identity;
- server-created `encountered_at`, grant version, and idempotency key;
- eligibility only from newly synchronized real Activity/passive evidence while authorization is current;
- simulator/test and historical-unknown evidence excluded;
- no author notification merely from encountering or viewing;
- offline devices do not discover new Cairns until server verification;
- explicit Route invitation/preparation remains a distinct permission path and is not an Encounter.

If this contract is not approved, remove friend Cairn discovery—not all friend collaboration—from the first version. Do not reveal all friend Cairns through shared Fog.

## Environment readiness

- **Disposable MySQL/API: PASS (bounded smoke).** A unique MySQL 8.0.44 container/database and test-only API were started with `DISABLE_CRON=1`; migration 036 applied; two synthetic `.invalid` users authenticated in isolated sessions and received HTTP 200 from `/api/routes`. The exact disposable container and volume were removed. No production/shared database was touched.
- **Full Friends schema bootstrap: BLOCKED as a one-command harness.** `docker/init.sql` is old, migration 018 contains `USE cairn`, and the migration runner has fixed database-name assumptions. Create a targeted legitimate Friends fixture or repair the test-only runner as overnight checkpoint 1; do not point it at an existing database.
- **Concurrent browser sessions: PASS.** Playwright 1.62 is installed; its bundled Chromium is absent, but system Chrome 150 works. Two isolated browser contexts retained separate A/B cookies. Normal handler/navigation automation is feasible with an explicit executable path.
- **Native iOS simulator: BLOCKED.** Only Command Line Tools are active; `xcodebuild` requires full Xcode and `simctl`/`xctrace` are unavailable.
- **Map evidence: PARTIAL.** Existing Web Mapbox evidence is not native proof; current personal card evidence includes accurate map-unavailable/fallback captures. A blank Expo fallback cannot validate native Mapbox.
- **Startup isolation: AVAILABLE WITH REQUIRED CONTROLS.** Use `DISABLE_CRON=1`, a disposable DB/API, explicit local API URL, disabled/intercepted telemetry/push/geocoding/background writers, and disposable accounts. EAS development/preview profiles point to `https://api.yiiling.cn` and are not isolated.
- **O55 simulation: SOURCE-REACHABLE, DATA-ISOLATION GAP.** The test/internal capability is gated by `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED`; until provenance is fixed, use disposable accounts only.
- **Owner installation: NOT READY AS ISOLATED REVIEW.** Manual EAS/OTA mechanics exist, but current profiles target production and there is no isolated HTTPS review backend. Deployment and OTA remain separately authorized actions.

## Five owner decisions required before unattended Friends implementation

1. **History scope:** approve the recommended prospective-per-friend grant from its effective time, with no retrospective sharing of unknown historical evidence.
2. **Projection and sensitive-place policy:** approve a server-derived coarse cell/region layer with no raw points/timestamps and sensitive places excluded by default; choose/approve the product resolution.
3. **Offline shared-cache rule:** approve the recommended last-authorized derived cache for at most 24 hours with “last checked” UI, account-switch purge, online-revocation purge, and no new shared data offline—or require no offline shared cache.
4. **Single-friend display semantics:** approve a true friend-only view with explicit source identity, while self remains a separate selectable scope; self-plus-friends uses source-preserving overlap rather than one flattened union.
5. **Encounter scope:** approve prospective real-presence-only friend Cairn encounters with no automatic author notification and a separate explicit Route permission path; otherwise exclude friend Cairn discovery from v1.

## Recommended uninterrupted sequence

1. Freeze decisions, snapshot the dirty baseline, and build the disposable A/B/C/D MySQL/API/browser harness. Re-run only attribution-critical personal gates.
2. Add Memory provenance/test isolation and the bounded personal reflection/API/UI completion. Deliver a personal checkpoint independently.
3. Add the server-authoritative grant, derived projection, transactional revocation, authorization versions, and secure legacy endpoint behavior.
4. Add source-preserving Memory scopes, read-only friend Cairn/Route roles, permitted Route reference snapshots, and—if approved—the minimal Encounter.
5. Integrate scoped Day/Sunset/Night and recoverable states into current structures without redesigning frozen pages.
6. Run the finite acceptance matrix with real local MySQL/API and A/B/C/D sessions, adversarial delayed responses, offline/reconnect, and actual browser handlers.
7. Produce separate personal/friend readiness verdicts, exact deployment order/rollback, and grouped owner evidence. Native/device checks remain a later explicit gate.

Use one primary code writer. Read-only inspection, fixture preparation, and test observation may run independently, but do not permit concurrent writes to shared Memory/friend stores, navigation, migrations, or authorization routes.

## Deployment dependencies

The owner-review backend must be a coherent, explicitly approved set. It must include the local O58 owned-Cairn history/create-replay contract, O59 migration 036 and Route origin/delete responses, the new Memory provenance/reflection and Friends authorization migrations/APIs, and compatibility for existing account/feedback/export behavior. Current local source does not mean any of those backend changes are deployed.

Known release mismatches remain separate: production was previously recorded through migration 034; local feedback/deletion migration 035, Cairn owner-history changes, and Route origin migration 036 are not assumed deployed. Current EAS profiles target production. No deployment, OTA, migration, invitation, or production mutation was performed in this preflight.

## Scope conclusion

- **Personal Journal:** executable as a bounded overnight implementation, with native/device acceptance deferred and its O58/O59 backend prerequisites kept explicit.
- **Friends Collaboration:** executable only after the five decisions are frozen and checkpoint 1 proves the real local Friends schema/harness. The missing authorization/projection/Encounter work is substantive; it is not a visual-only integration.
- **Combined first version:** not yet ready to be described as an unconditional unattended completion contract. It can become ready without another whole-app audit once the listed decisions and harness checkpoint are resolved.

Detailed gaps and work packages are in `SCOPE_AND_GAPS.md`; state coverage is in `UI_STATE_INVENTORY.json`; executable cases are in `ACCEPTANCE_MATRIX.json`; source/environment attribution is in `HANDOFF.json`.
