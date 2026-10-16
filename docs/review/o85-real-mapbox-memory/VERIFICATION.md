# O85 verification record

Generated 2026-10-16 from client base
`71a1f3ab89460db3e55e59e8b24d11310d353089` (`origin/main`). Evidence classes
are kept separate; passing Web or provider integration is never represented as
native iPhone proof.

## Automated results

- `cd app && npm run verify:changed`: **PASS, 645/645** across continuity,
  cadence, background, gap, elevation, matching, telemetry, integration,
  Memory, journal recovery, offline sync, simulator, server and static gates.
- Focused O85 component/transaction set: **7 suites, 99 tests passed**.
- Wider Route/Memory regression: **26 ordinary suites, 283 tests passed**.
  The evidence-dependent integration was excluded from that count because it
  correctly fails closed without its required path.
- With `O84_FRIEND_FOG_EVIDENCE=$PWD/_review/o85-o84-input/result.json`, the
  isolated authorization-to-Mapbox integration: **1 suite, 1 test passed**;
  10 authorized cells became 90 source polygons.
- `git diff --check`: **PASS**.
- Scoped TypeScript inside the Activity gate: **PASS**.

## Real production Route and provider integration

`app/scripts/o85-real-route-mapbox-qa.mjs` performs a read-only production
query, obtains the production Mapbox credential only in the child environment,
calls real walking Map Matching/Directions, and persists neither the token nor
precise coordinates. It produced:

- `Test1` Route 92: saved 1,897.71 m; current matched 1,891.17 m, `Ok`.
- `Test2` Route 93: saved 1,163.87 m; current matched 1,162.98 m, `Ok`.
- `Test3` Route 94: saved 1,933.13 m; current matched 1,944.49 m, `Ok`.
- Activity closure: 198.88 m direct versus 1,528.71 m walking, 7.69×.
- Route 96: 2 vertices / 18.37 m; immutable session 2134: 197 canonical
  vertices / 281.58 m, source hash retained.

The packaged board and five screenshots use the real Mapbox basemap and actual
route geometry, with road/place labels intentionally suppressed to prevent
private location disclosure. Current matching is not the missing historical
provider response.

## Real-basemap Web UI and Fog

- Route editor QA: 360/390/430 in Day/Sunset/Night, every assertion passed,
  zero runtime errors. It covers location puck, compact rows, automatic manual
  Draw, `Mine & Friends`, camera invariants and repeated traversal display.
- Friends/Memory QA: **31 assertions passed**, zero runtime errors, 21 captures.
  The isolated disposable backend's exact authorized 5+5 cells traverse the
  production stores, `FogLayer`, web adapter and a live Mapbox style. Visible
  region queries find 4 and 1 friend features. Mine→Friends sampling observes
  zero solid fallback frames, and Mine→Friends replay restores friend layers.
- Responsive UI measurements cover 360/390/430 for F1 and 390 state transitions
  for M2/M4/F2.

These are mobile-size Expo Web results with real Mapbox rendering. Synthetic
Route gestures and the isolated Friend payload are explicitly not native
RNGH, native Mapbox, production Friend geography or physical-iPhone proof.

## Production Friend boundary

`app/scripts/o85-production-friend-fog-audit.mjs` is read only and persists
only hashes/counts. Both active full-history grants derive zero projection
cells. The selected source has zero delayed accepted rows. The other has nine
delayed accepted rows, but all are removed by required endpoint/private-place
masking and it is not selected. Verdict:
`NO_REAL_SELECTED_FRIEND_CELLS_AVAILABLE`.

M3 therefore remains a release blocker. The smallest valid next proof is for
an authorized selected friend to acquire exploration geographically outside
the protected endpoint radius, wait at least 30 minutes, verify the production
projection returns nonzero cells, then capture the same friend-only viewport
on Build 65 in Memory and Route `Mine & Friends`.

## Reproduction commands

```sh
cd /Users/mzm/Desktop/cairn/CairnNZ/app
npm run verify:changed

npm test -- --runInBand \
  src/screens/__tests__/orderedRouteEditorScreen.test.tsx \
  src/screens/__tests__/friendsMutationHandlers.test.tsx \
  src/features/memory/__tests__/fogReadinessAuthority.test.ts \
  src/features/memory/__tests__/memoryFriendPickModal.test.tsx \
  src/features/memory/__tests__/memoryScopeToggle.test.tsx \
  src/features/route/__tests__/routeEditTransactions.test.ts \
  src/features/route/__tests__/pointRouteIntent.test.ts --silent

O84_FRIEND_FOG_EVIDENCE="$PWD/_review/o85-o84-input/result.json" \
  npm test -- --runInBand \
  src/features/memory/__tests__/o84RealFriendFogRender.integration.test.tsx \
  --silent
```

The provider and production audits additionally require the already authorized
production SSH/EAS environment. Their scripts fail closed when credentials are
not available.
