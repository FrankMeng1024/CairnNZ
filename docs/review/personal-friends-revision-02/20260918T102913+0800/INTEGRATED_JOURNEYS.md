# Integrated Personal and Friends journeys

## Personal

The local final candidate was exercised through normal store/handler suites rather than only page snapshots:

- Start/accepted point/Pause/Resume/Finish and cancel/duplicate-action boundaries: `useTrackingStore.test.ts` plus the CORE verification groups.
- Pre-Finish durable Memory and crash-before-Finish recovery: `M-LIVE-01`, `activityRecoveryMemory.test.ts`, `memoryDurabilityBoundary.test.ts`.
- Quick/full text-only Cairn, empty validity, linked Detail edit, owner library/reload: marker store and Cairn contract suites; 10 actual marker-store cases are included in the 56-case normal-store journey log.
- Historical Activity timing/average pace, Detail, and Activity-derived Route identity: CORE integration and backend Activity contracts.
- Genuine Route geometry edit, Apply versus Save, reload, and Hike/Run reference: actual Route/edit stores in `integrated-personal-store-journey-final.log`.
- Current production screens were then rendered in Expo Web for Home, Hike, Run, Plant, Activity Detail, owned Cairn Detail, All Cairns, Trails, Route Detail, and settings.

The source-wiring contract suite is supporting evidence only; it is not used as persistence or transaction authority. Real persistence/authorization authority comes from the actual store tests and isolated API/MySQL harness.

## Friends

The isolated review environment at `https://api.yiiling.cn/pf-review-o60` ran fresh A/B/C/D synthetic actors over real HTTPS and MySQL 8.0.45. It covered author policy, viewer selection/projection, private masks, prospective friend Cairn access, read-only Detail, Encounter idempotency, Route lease start/recovery/terminal behavior, revoke, unfriend/re-friend, block/unblock, non-transitivity, and legacy endpoint containment.

Two actual authorized responses were deliberately held at a transport barrier. In one case the author changed the resource and a newer revision was read first. In the other the author revoked access and a current 404 was observed before the old response was released. The actual client stores then use deferred transport in `friendMemoryAuthorizationOrdering.test.ts` and `friendContentAuthorizationCache.test.ts` to prove those superseded responses cannot republish or persist.

Expo Web used normal UI clicks for Personal/Combined/single-friend scopes, Memory sharing, friend profile, shared-content navigation, read-only Cairn/Route Detail, source removal, revoked content, unavailable content, and geometry retry. The visual API data is synthetic and intercepted; it is visual/interaction evidence, not database authority.

Browser reload/store recreation/durable adapter relaunch are distinguished in the tests. Native process death and physical background delivery remain unexecuted.

