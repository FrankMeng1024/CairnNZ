# Exact changed-file inventory

## Product and focused-test files changed by CARD-ROUTE-01

- `app/src/components/Icon.tsx`
- `app/src/components/OtaBadge.tsx`
- `app/src/components/map/EditOverlayV274.tsx`
- `app/src/features/route/routeContracts.ts` (new)
- `app/src/features/route/__tests__/routeContracts.test.ts` (new)
- `app/src/features/trails/__tests__/trailsScreenContracts.test.ts`
- `app/src/screens/HikingScreen.tsx`
- `app/src/screens/MapHistoryScreen.tsx`
- `app/src/screens/RouteEditorScreen.tsx`
- `app/src/screens/RunningScreen.tsx`
- `app/src/services/offlineEntity.ts`
- `app/src/services/routeOfflineEntities.ts`
- `app/src/services/routeService.ts`
- `app/src/services/routeTombstones.ts` (new)
- `app/src/services/__tests__/routeService.contract.test.ts` (new)
- `app/src/services/routing/corridor/PolylineSampler.ts`
- `app/src/store/useRouteStore.ts`
- `app/src/store/__tests__/runPreviewFinally.test.ts`
- `app/src/store/__tests__/useRouteStore.offline.test.ts`
- `backend/src/middleware/schemas.js`
- `backend/src/migrations/036_route_origin_identity.sql` (new)
- `backend/src/models/Route.js`
- `backend/src/routes/routes.js`
- `backend/src/routes/__tests__/freeActivityContracts.test.js`
- `backend/src/routes/__tests__/routeOriginRoundTrip.test.js` (new)

`TASK_SCOPED.patch` contains 24 exact byte-baseline/HEAD-to-candidate diffs. `app/src/features/trails/__tests__/trailsScreenContracts.test.ts` lived in a pre-existing untracked directory at task start and was not included in the anticipated byte-copy set; its task-start existence is proven by `baseline/git-status-before.txt`, but an exact before byte image is unavailable. Its full final source is therefore included under `test-source/` and this limitation is explicit rather than presenting the file as newly created.

## Review/evidence artifacts created by this card

Everything under `docs/review/route-detail/20260917T180318+0800/`, including the baseline snapshot, reports, patch, focused test-source copies, test results, screenshots, boards, capture script/results, manifests, and hashes.

## Explicitly unchanged

- Native app version, runtime version, build number, dependencies, environment files, production configuration, App Store settings, and all unrelated dirty files.
- No source file from CARD-AD-01 or CARD-CAIRN-01 was reverted; shared additions were made against their current state.

