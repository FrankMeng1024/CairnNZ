# Deployment compatibility

## Deployed alignment

Production and the owner-review realm run backend commit `9b92be3efef3a355d71491ec250cb6df62878a23` with migration ledger 037. This includes the coherent dependency chain for settings/account/feedback/export (035), Route origin/tombstones (036), and Personal/Friends provenance, grants, projections, masks, encounters, resource reads, and leases (037).

The deployed backend remains additive for existing personal clients. Old raw friend-Fog access fails closed, historical Public records remain stored but undiscoverable, and resource-specific Cairn/Route access does not incorrectly require a Memory grant. A new client against a backend without Friends endpoints renders unavailable/denied states rather than manufacturing authority.

Seven-day account deletion remains the API and worker contract. The repaired production sweep uses a server constant for the bounded SQL LIMIT; final logs show zero hard deletions and no prepared-statement error.

## Owner candidate dependencies

- Client source marker O60; Expo app/runtime version 0.2.6 (`runtimeVersion.policy = appVersion`). No native dependency or version changed.
- Manual owner-review publication must use the existing production iOS runtime compatibility and set the public API base to `https://api.yiiling.cn/pf-review-o60` for the review candidate.
- The public Mapbox token must come from the established EAS environment; it was not exposed or copied into this archive.
- The owner's installed build/runtime was not queried and must be checked before publication.

## Remaining gaps

The review target and backend are ready. Remaining evidence is native/owner execution only: installed runtime/build match, native map and safe-area/keyboard/larger-text review, GPS/background and physical Encounter checks. An OTA is prepared, not uploaded, and no device is claimed to contain O60.
