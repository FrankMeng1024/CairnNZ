# Personal Cairn retrieval coverage

| Source | Included in All Cairns | Coverage | Offline behavior | Boundary |
|---|---|---|---|---|
| Durable local pending/failed creates | Yes | All retained current-owner local objects | Available after relaunch | Tombstoned objects excluded |
| Downloaded/cached owner history | Yes | All owner pages previously downloaded into the persisted marker projection | Available after relaunch | May be only part of remote history |
| New owner-history endpoint | Yes | Authenticated current owner's history, searched before pagination, stable recent-first cursor | Previously downloaded pages remain available | Requires the local backend patch to be deployed |
| Old backend without owner-history endpoint | Yes, by fallback | Local/downloaded projection only; the UI explicitly calls this partial history | Available | Does not claim that no remote match exists |
| Existing map-region query | Its already-owned cached results can merge by identity | Never used as proof of complete “All Cairns” history | Cached content remains | Region scope is not relabeled as global history |
| Friend/public/circle objects | No | Excluded | Excluded | This is an owner-only library |
| Deleted/tombstoned Cairns | No | Excluded from server merge, hydration, and acknowledgement | Excluded | Late responses cannot resurrect them |

## Search truth

- With the new backend endpoint deployed, online search covers the authenticated owner's full valid Cairn history before stable pagination.
- Until that endpoint is deployed, the client remains compatible with the old backend and searches only the available local/downloaded projection. The screen labels that coverage as incomplete and does not assert that a missing result does not exist remotely.
- Search never uses friend/public endpoints or a current map bounding box.
- Pages are bounded (`40` rows by default) and loaded through a stable cursor; the screen does not download unbounded history on every mount.

## Stable merge

Client/local/server identifiers are treated as aliases of one owner-scoped object. Merge uses stable identity, current-owner checks, tombstones, local pending priority, and updated-content priority. A fast acknowledgement therefore changes sync metadata without replacing the stable client identity or adding a second row.

