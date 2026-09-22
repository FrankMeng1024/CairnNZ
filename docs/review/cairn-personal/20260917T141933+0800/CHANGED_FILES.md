# CARD-CAIRN-01 exact changed-file inventory

Run ID: `20260917T141933+0800`

This inventory is scoped to files authored or edited for CARD-CAIRN-01. The repository was already substantially dirty. Files marked **pre-existing dirty** were edited in place without resetting or reformatting unrelated work.

## Product and shared client source

| File | Baseline | CARD-CAIRN-01 change |
|---|---|---|
| `app/src/components/OtaBadge.tsx` | pre-existing dirty | Incremented the one candidate marker from `O57` to `O58` after gates passed. |
| `app/src/features/cairns/cairnIdentity.ts` | new | Owner-scoped identity keys, stable ID, matching, merge/deduplication, tombstone handling. |
| `app/src/features/memory/screens/MemoryScreen.tsx` | pre-existing dirty | Added the normal All Cairns entry outside map failure/loading boundaries. |
| `app/src/features/memory/services/mapboxAdapter.web.tsx` | pre-existing dirty | Prevented a missing/invalid public token from being treated as Web Mapbox availability. |
| `app/src/features/plant/services/noteEncoding.ts` | pre-existing dirty | Preserved legacy body-only content; explicit title/body encoding; shared display fallback. |
| `app/src/navigation/RootNavigator.tsx` | pre-existing dirty | Registered the All Cairns route and entry context. |
| `app/src/screens/AllCairnsScreen.tsx` | new | Added the owner-only personal Cairn library. |
| `app/src/screens/MarkerDetailScreen.tsx` | pre-existing dirty | Completed authoritative Own Cairn Detail, edit, delete, context, fallback, and navigation behavior. |
| `app/src/services/offlineEntity.ts` | pre-existing dirty | Added durable payload revisions and stale-acknowledgement protection. |
| `app/src/store/useMarkerStore.ts` | pre-existing dirty | Added library retrieval/coverage and truthful identity/mutation/reconciliation behavior. |

## Backend source (local only; not deployed)

| File | Baseline | CARD-CAIRN-01 change |
|---|---|---|
| `backend/src/routes/markers.js` | pre-existing dirty | Added authenticated owner-library route and safe create-replay content convergence. |
| `backend/src/services/ownedCairnLibrary.js` | new | Owner-scoped cursor, search, and pagination query service. |

## Tests

| File | Baseline | Coverage added |
|---|---|---|
| `app/__tests__/plantTitleBody.test.ts` | pre-existing dirty | Legacy and new title/body round trips. |
| `app/src/features/cairns/__tests__/cairnIdentity.test.ts` | new | Alias identity, stable merge, deduplication, owner/tombstone boundaries. |
| `app/src/features/cairns/__tests__/cairnPersonalContracts.test.ts` | new | Page/navigation, mutation, copy, and product-scope contracts. |
| `app/src/features/plant/services/__tests__/noteEncoding.test.ts` | new | Multiline, Unicode, empty, and legacy content. |
| `app/src/services/__tests__/offlineCommittedEntity.test.ts` | pre-existing dirty | Payload revision and stale acknowledgement behavior. |
| `app/src/store/__tests__/useMarkerStore.fastAck.test.ts` | new | Fast acknowledgement, pending edit, owner switch, tombstone/non-resurrection behavior. |
| `backend/src/services/__tests__/ownedCairnLibrary.test.js` | new | Owner-only history, auth source, search/pagination, cursor, immutable replay fields. |

## Audit and evidence files

Every file under `docs/review/cairn-personal/20260917T141933+0800/` is new for this run. The archive `MANIFEST.sha256` is the exact file-by-file inventory for reports, machine handoff, capture script, screenshots, boards, and raw QA output.

## Explicitly not changed for this card

- Activity Detail source, Route Detail, Route Planner, Plant creation layout, Trails IA, Memory map/Fog behavior, Friends/Public/Encounter, app/runtime/build versions, dependencies, migrations, production configuration, App Store settings, and OTA/deployment settings.

