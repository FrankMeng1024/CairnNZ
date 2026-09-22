# Mutation, offline, and origin results

| State/action | Candidate contract | Proof/result |
|---|---|---|
| Pending local create | Route and source identity are stored first under stable `client_route_id`; Detail/Trails can use it immediately | Store/offline tests pass; normal capture flow reaches Detail and Trails |
| Pending local rename/edit | Durable outbox payload is changed before visible accepted projection; newer local payload wins over a late acknowledgement | Automated proof passes |
| Synced rename/edit | Existing accepted Route remains until PUT acknowledgement; failure leaves editor/draft visible | Service/store proof passes; `ROUTE-VIS-012` exercises isolated 503 then retry |
| Duplicate create / response loss | `(user_id, client_route_id)` is unique; retry converges mutable fields on the same server Route | Backend round-trip proof passes |
| Pending delete | Owner-scoped client tombstone is committed before local removal; queued create is discarded; late acknowledgement triggers server cleanup and cannot resurrect locally | Store/backend proof passes |
| Legacy synced delete | With no stable client identity, client waits for DELETE acknowledgement and retains Route on failure | Service/store proof passes |
| Modern synced delete | Client tombstone wins locally; `DELETE /api/routes/client/:clientRouteId` reconciles remote state and remains retryable | Backend/store proof passes; deployment pending |
| Cross-account / late response | Owner ID and detail-request sequence are checked before applying payloads | Automated proof passes |
| Cached remote read failure | Valid cached/local Route remains usable; fetch failure does not become false absence | Automated proof passes |
| Activity source not uploaded yet | `SOURCE_ACTIVITY_NOT_FOUND` and `SOURCE_ACTIVITY_NOT_READY` remain retryable without allocating another identity | Automated proof passes |
| Deleted/unauthorized source | Permanent failure copy retains the local Route and does not offer a fake retry | Automated and fixture visual proof pass |
| Activity origin | Server resolves supplied source only within owner scope and only when finalized | Backend round-trip proof passes |
| Origin after source deletion | FK clears live numeric link; `creation_origin`, client Activity identity, and hashes remain on the independent Route | Backend round-trip proof passes |
| Later Route geometry edit | `geometry_edited_since_creation` becomes true; original source/current-creation hashes are not client-rewritable | Backend round-trip proof passes |
| Explicit Gap reconnect | Stored as `origin_gap_reconnected`; Detail calls it a planned connection; source Activity remains unchanged | Automated/visual proof passes; backend deployment pending |
| Active Activity reference | Geometry is deep-copied at explicit Start; later Route edits do not change the running Activity’s reference | Automated proof passes |

The backend proof executes the actual `Route` model transaction/query paths against a disposable in-memory SQL adapter, reloads the model, edits, reloads, simulates source deletion, and checks identity/tombstone behavior. It is not a production database, does not apply the migration, and is more than a source-string assertion. A staging/local MySQL migration rehearsal remains a deployment gate.

