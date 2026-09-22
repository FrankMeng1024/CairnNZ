# Shared cache and borrowed Route state tables

## Downloaded friend content cache

| Event | In-memory state | Durable state | Network/authority behavior |
|---|---|---|---|
| Online detail open | Publish only after current generation and detail authorization | Store viewer, owner, resource, content revision, authorization revision, original issue time, fixed expiry | Uses the actual detail endpoint |
| Offline relaunch before fixed expiry | Hydrate the already downloaded item | Original issue/expiry retained; read does not renew | Truthfully shows last-checked context; creates no content or Encounter |
| Expiry or clock rollback | Fail closed | Expired row is not renewed | Retry when online |
| Local Hide | Remove immediately | Hidden state persists and remote retry is queued | Remote failure is reported/retryable, not an unhandled rejection |
| Known revoke/block/unfriend/account switch | Invalidate before asynchronous completion can publish | Purge relevant owner/resource; unrelated own/other-source data remains | Late reads and queued writes are fenced |
| Authoritative 404 or changed revision | Purge/supersede stale detail | New revision only after authorized download | Old list payload is not permanent authority |

Maximum normal offline validity is 24 hours from the original authorization. Offline revocation cannot be known instantly and is not claimed.

## Borrowed Route lifecycle

| State/event | Permitted behavior | Forbidden behavior |
|---|---|---|
| Online start | Validate current access and issue/bind lease to viewer, resource/version, and client Activity identity | Possession of old geometry alone cannot start |
| Offline start | Use only a previously issued, unexpired, correctly scoped lease | No fresh offline authorization or expiry extension |
| Active outing | Persist immutable minimal name/geometry/distance/elevation safety reference | No author journal, description, waypoints, ownership transfer, or navigation activation |
| Author edit/revoke/delete during active outing | Existing bound Activity retains safety geometry | A new or unrelated Activity cannot reuse it |
| Recovery | Exact unfinished Activity may recover its own bound reference | Account B cannot see account A’s reference |
| Finish/discard | Clear local active exception at durable terminal boundary; queue idempotent backend end acknowledgement | Network failure cannot block Finish or restore the reference |
| Late start/GET after terminal | Generation/terminal fence rejects it | No resurrection after terminal cleanup |

The isolated API/MySQL harness verifies pre-start revoke denial, active safety after revoke, minimal snapshot fields, valid issued offline start, Activity binding, duplicate start/end idempotency, terminal database acknowledgement, and post-terminal denial.

