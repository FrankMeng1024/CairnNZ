# Product-contract Regression Audit

## Contract change

Run’s mid-Activity Cairn action no longer creates a blank personal Cairn immediately. It opens the same full Plant flow used by Hike, carrying the exact active Activity identity. This is an intentional product-contract change, not an algorithm parameter change.

## Expected changes

- Run users can add title/note/visibility through full Plant.
- Fresh accepted Activity location skips directly to Plant content; stale/lost location enters bounded GPS lock/recovery.
- The action is allowed during GPS loss so Plant can explain and reacquire rather than silently do nothing.
- Simulator placement remains local-only and explicitly labeled QA.
- Placement accuracy, observation timestamp and provenance are locally durable.

## Preserved invariants

- The initiating owner, `clientActivityId` and `ownerGeneration` must still be current at commit time.
- Plant cannot mutate Activity route, distance, canonical point count or provider ownership.
- Exactly one durable Cairn is created for one accepted submit; double submit and owner/activity races remain coalesced or fail closed.
- Production marker HTTP payload remains on the deployed strict schema.
- Simulator Cairns never enter production outbox/API.
- Hike Plant behavior, standalone Plant, Friends/public eligibility, Memory rules and 30 m coverage semantics remain unchanged.
- GPS canonical acceptance, smoothing, gap creation, Mapbox selection and distance parameters remain unchanged.

## Regression evidence

- `runningQuickCairnHandler.test.tsx`: exact Run origin handoff, paused case, GPS-loss case, absent-identity fail-close and no silent `addMarker`.
- `plantActivityLinkage.test.tsx`: immutable accuracy/timestamp/provenance and Activity identity at full Plant submit.
- `useMarkerStore.fastAck.test.ts`: QA-local behavior, outbox durability, ACK fallback and immutable placement facts.
- `cairnIdentity.test.ts`: server hydration cannot erase local placement evidence.
- `simulatorContracts.test.ts`: full Plant owns GPS recovery and Running contains no legacy quick-plant path.
- Fresh actual-app run `candidate-run-plant-flow-13-final`: visible button → Plant → one local Cairn → same active Run with real basemap visible → Finish → cold reopen; zero marker API requests.
- Activity CORE 649/649 and GPS 428/428 pass.

## Web Mapbox regression surface

The second implementation change is Web-only Mapbox lifecycle stabilization. Audit coverage confirms:

- native RNMapbox adapter is untouched;
- shared worker prewarm and optional cache-trim suppression are isolated to `mapboxAdapter.web.tsx`; `reuseMaps` was explicitly rejected because returning from Plant could recycle a tile-less detached canvas;
- v3-only emissive paint is removed only for GL JS v2 Web layers;
- accepted screenshots require both route and real basemap features;
- repeated Activity/theme navigation, full training/holdout campaigns and three fresh-process replays report zero accepted runtime errors after the fix.
- Web Activity focus retains its already-loaded map and explicitly refreshes layout/repaint after returning from Plant; native still uses its existing fresh map key.

Private Mapbox GL JS `_setCacheLimits` is an acknowledged maintenance risk. It is optional-chained and Web-only. A future GL JS upgrade must re-run the multi-map stress and remove the workaround if the upstream dispatcher race is fixed.
