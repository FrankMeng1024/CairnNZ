# Security, privacy, and cross-branch boundary

## Closed blocker: legacy interaction endpoints

The legacy `community-state`, interaction nonce, and vote endpoints previously relied on group visibility/current friendship and could expose or mutate state outside the retained-acquisition authority.

O88 routes all three through `legacyCairnInteractionAuthorization`:

- owner access is explicit;
- a non-owner must hold the exact current retained Friends revision;
- being a current Friend without acquisition is insufficient;
- an acquired stale revision is insufficient for a newer live revision;
- Public, personal, removed, hidden, blocked, moderated, and withdrawn cases fail closed;
- current friendship is not re-required for an already legitimately retained exact revision.

Focused backend tests cover these positive and negative rules. The disposable MySQL replay covers account isolation, moderation, withdrawal, remove, identity, and immutable recipient history.

## Placement integrity

Client and backend now share an all-or-none provenance tuple:

- `placement_accuracy_m`
- `placement_captured_at`
- `placement_source` (`gps_window`, `watcher_recent`, `last_known`, or `activity`)
- `placement_sample_count`

The backend rejects partial tuples, accuracy outside 0–100 m, invalid/future timestamps, simulator provenance, invalid sample counts, and `activity` without Activity origin. Offline outbox and idempotent replay preserve the tuple. Legacy rows remain nullable and are not rewritten into false evidence.

This is provenance, not proof of physical truth: the server still depends on signed-in client observations and existing discovery evidence rules. O88 does not claim spoof resistance.

## Public privacy

- Public creation still uses the effective pilot/allowlist/review/location policy.
- Standalone Public remains blocked because it lacks eligible Activity origin.
- Public retained copies use bounded coarse coordinates.
- Notification payloads contain no coordinates/content/author.
- The Shanghai fixture channel is visible only when a field-verified, active, unexpired batch explicitly allowlists the reader. It does not change ordinary marker rules.

## Concurrent Hike/Run integration

The active primary worktree was observed on `codex/hike-run-quality-upgrade-20261020` with modifications in `PlantScreen.tsx`, `plantActivityContext.test.ts`, tracking stores, Activity maps, and route correction. O88 did not edit that worktree.

Expected future conflict areas:

1. `PlantScreen.tsx`: preserve O88 place-note/success/provenance while adopting main’s newest Activity location and lifecycle contract.
2. `plantActivityContext.test.ts`: retain both suites’ invariants.
3. tracking/background services: do not make O88 push readiness into a second location listener or replace main’s evidence authority.
4. navigation: retain notification account reauthorization while resolving main’s current root changes.
5. Run quick Cairn: Owner must choose whether to keep private empty one-tap behavior or open a full/compact place-note flow.

Integration order after explicit Owner approval: merge/rebase into a fresh integration branch, resolve Activity authority first, reapply O88 provenance adapter and UX second, run `npm run verify:changed`, then native Plant/Hike/Run resume telemetry. Do not choose changes by “ours/theirs” wholesale.
