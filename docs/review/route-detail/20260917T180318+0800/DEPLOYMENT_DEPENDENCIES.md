# Deployment dependencies

No deployment, production migration, OTA publication, configuration change, or external service mutation occurred.

## New backend behavior

Deploy in this order after separate approval:

1. Rehearse and apply `backend/src/migrations/036_route_origin_identity.sql` to the intended non-production database first.
2. Deploy the matching backend model/API changes: origin fields, finalized-owner source validation, stable client identity, per-owner uniqueness, and client-identity delete/tombstone endpoint.
3. Verify create -> clear local extras/cache -> server reload -> edit -> reload -> source deletion in that environment.
4. Only then publish/load a client candidate if separately authorized.

The migration is additive but includes indexes, a foreign key, and a new tombstone table. It was not executed against production.

## Old-backend compatibility

- Route creation still falls back when the old API rejects the new identity/origin fields.
- The Route remains locally usable and independent.
- Detail labels the limitation: `Origin is saved on this device; server support is pending.`
- Old-backend provenance is not claimed durable and will not survive a server-only fresh-device reload.
- A legacy Route without stable client identity waits for remote delete acknowledgement; it is not locally hidden on failure.

## Prior-card dependencies still open

CARD-CAIRN-01’s owner-history endpoint and create-replay changes remain local/not deployed. They are required for the full grouped personal journey but were not modified, deployed, or reclassified by this card.

