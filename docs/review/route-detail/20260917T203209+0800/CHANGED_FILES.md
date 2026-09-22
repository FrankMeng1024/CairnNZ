# Exact revision-02 source/test inventory

This inventory is attributable to the task-start snapshot in `baseline/` and `/tmp/cairn-route-rev02-20260917T203209+0800/source`. `TASK_SCOPED.patch` compares these files to that snapshot rather than to the older dirty Git HEAD. Current hashes are in `TOUCHED_FILE_HASHES.sha256`.

## Modified from correction baseline

1. `app/src/services/routeService.ts` — structured delete outcomes, bounded mutation timeout, unknown-outcome errors.
2. `app/src/services/routeTombstones.ts` — pending cleanup attempt/error truth separated from confirmed remote deletion.
3. `app/src/store/useRouteStore.ts` — deletion fallback/reconciliation, owner/object mutation epochs, stale read/list/cache protection.
4. `app/src/screens/RouteEditorScreen.tsx` — save coordination and Back behavior while saving; durable draft retained.
5. `app/src/screens/MapHistoryScreen.tsx` — raw vertex primary metric removed; shared action renamed `Use Route`.
6. `app/src/features/route/__tests__/routeContracts.test.ts` — affected UI/product contract assertions.
7. `app/src/services/__tests__/routeService.contract.test.ts` — delete capability/identity/failure regressions.
8. `app/src/store/__tests__/useRouteStore.offline.test.ts` — stale read/list/cache, deletion, geometry G0/G1, owner, retry, and non-resurrection regressions.
9. `backend/src/routes/routes.js` — identity-bound structured delete response contracts.
10. `backend/src/migrations/036_route_origin_identity.sql` — removed unsafe hard-coded database selection before any known deployment.

## New source/test support

11. `app/src/features/route/routeEditorSaveCoordinator.ts` — small screen-used save/leave coordinator.
12. `app/src/features/route/__tests__/routeEditorSaveCoordinator.test.ts` — handler-level save/leave timing regressions.
13. `backend/scripts/verify-migration-036.sh` — SELECT-only migration postcondition verifier.
14. `backend/src/routes/__tests__/fixtures/route-origin-pre036.sql` — disposable legitimate pre-036 MySQL fixture.
15. `backend/src/routes/__tests__/routeOriginMySql.integration.js` — guarded real-MySQL model/API/transaction integration.

## Review-only artifacts

All new review-only files are confined to `docs/review/route-detail/20260917T203209+0800/`. The exact archive file list and SHA-256 of every packaged payload file are in `PACKAGE_MANIFEST.json`; `MANIFEST.sha256` provides the line-oriented verification set.

No dependency, native app version, runtime version, build number, or O-marker source was changed in revision 02. No unrelated file was intentionally modified by this task.

