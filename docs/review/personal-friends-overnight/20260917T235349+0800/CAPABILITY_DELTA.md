# Requirements and capability delta

| Area | Before this queue | O60 candidate |
|---|---|---|
| Memory evidence | Source labels could lose authority across persistence/replay | Durable source contract; QA/test isolation; historical unknown stays unknown |
| Cairn naming | Blank naming behavior diverged by surface | Shared nonpersisted `A moment here` presentation fallback |
| Quick Cairn | Existing local flow had mixed optional-content assumptions | Empty text-only create is valid, locally durable, acknowledges without ending Activity |
| Object audience | Legacy/public-era paths and mixed controls | Simple `Only me` / `Friends`; Public hidden and raw legacy reads fail closed |
| Memory sharing | No coherent prospective per-friend publication | Author policy creates server-owned asymmetric grant epochs and derived projections |
| Friend Memory views | Partial/legacy subscription model | Personal, combined selected, and genuine single-friend source views |
| Revocation/cache | No complete bounded authorization order | Immediate known-revoke purge; server-expiry max 24h; clock rollback and stale response fail closed |
| Friend Cairn | No server fact for legitimate discovery | Prospective idempotent Encounter from current accepted real canonical evidence; read-only viewer resource |
| Shared Route | Legacy circle/public reads lacked the frozen contract | Explicit Friends audience, read-only preview/use, online start authorization, Activity-only immutable recovery snapshot |
| Server data | No v1 grants/projections/masks/encounters/leases schema | Additive migration 037 with verifier and real MySQL rehearsal/deployment |
| Reviewability | No combined owner realm | Isolated HTTPS API/schema, two private synthetic identities, deterministic seeded state |

Unchanged/deferred: public/stranger discovery, billing, voice/turn-by-turn, Cairn media, App Store/native build work, and any claim of physical/NZ field validation.
