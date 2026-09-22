# Frozen implementation decisions

- Personal Memory accepts only `activity_real`, `passive_real`, and legacy `historical_unknown` evidence. Simulator/test evidence lives in a separate QA realm and is excluded from ordinary Personal Memory and synchronization.
- A missing Cairn title is rendered as `A moment here`; the fallback is not persisted and never replaces title, note, creation time, location, or provenance.
- Quick Cairns may have empty title and note, save locally before acknowledgement, show `Cairn saved`, and leave the Activity running.
- Cairns and Routes default to `Only me`; their object visibility is independent of Memory-layer sharing.
- The author controls `Share new exploration with friends`. Every accepted friendship episode gets a fresh, server-owned grant epoch; no permission-request workflow exists.
- Shared Memory is prospective, completed-Activity-only, coarse and server-derived. Raw coordinates/timestamps/order/endpoints never cross the friend boundary.
- Start/end cells and cells intersecting an active protected place are suppressed with a minimum 250 m safety radius.
- Friend projection cache expires at most 24 hours after the server authorization time. Render, relaunch, request failure, and clock rollback cannot extend it. Known revocation purges immediately.
- Memory scope supports self, combined selected sources, and a genuine single-friend view with source identity preserved.
- Encounters are prospective, friend-only, server-verified facts. Map browsing, planned routes, shared fog, API/display activity, and simulator data cannot create them. Stationary valid observation is allowed.
- Non-owner Cairn/Profile/Route views are distinct read-only resources. Unauthorized, revoked, blocked, deleted, and non-existent objects are externally opaque.
- A borrowed Route may retain one immutable geometry/content snapshot only for the active Activity safety window; no broader revoked content survives.
- Public/stranger discovery and public controls are deferred and hidden.
- NZ weak-network, location-quality, map-unavailable, and timezone cases are deterministic fixtures only; no NZ field claim will be made.

