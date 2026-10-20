# Memory and encounter map audit

## Implemented authority flow

`Memory/current evidence → POST /api/cairn-memory/discover → server authorization and distance policy → retained revision(s) + presentation group in one transaction → client cairnPresentationStore → Memory encounter card → acquired detail/library`

The Memory map does not query undiscovered marker contents. It plots the authenticated retained library. Public retained coordinates are server-coarsened; exact author Public pins are not returned through this path.

## Dense marker changes

- Authorized retained features now include source audience, title/body preview, current content revision, and unread state.
- Cluster summaries aggregate Friends/Public/unread counts. Friends, Public, and mixed clusters have distinct theme-aware treatment.
- Single markers receive an audience halo while continuing to use the canonical marker component.
- Cluster leaves are paged in stable batches of 50 and deduplicated by marker id rather than truncated to one `getClusterLeaves(min(count, 1000))` call.
- Same-place selection lists show useful title/preview/source/version rather than identical generic rows.
- Pure-function coverage verifies exact-coordinate clusters at 20, 60, and 100 retained Cairns.

## Encounter behavior

- One 760 ms finite reveal per presentation token in the running process; Reduce Motion resolves immediately.
- One haptic per viewer/token/event, guarded in process.
- One card per presentation group, with `Open`/`Later`; no automatic map-camera change.
- New revisions use restrained update wording.
- The card is withheld while incompatible overlays are active, then resumes from durable presentation state.
- Server notification dedupe uses `kind + related presentation group id`; it does not enqueue one push per marker.

## Evidence boundary

The cluster and encounter logic is unit-tested and the encounter was rendered in actual Expo Web at 390×844. No Mapbox token was available in the isolated environment, so the capture shows the real fallback rather than a fabricated basemap. Real Mapbox + Fog at two zoom levels/bearings, Back camera retention, and native performance for 60/100 points are **NATIVE/MAPBOX PENDING**.

No undiscovered Public catalog, coordinate leak, or hidden map layer was added.
