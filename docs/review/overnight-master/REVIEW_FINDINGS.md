# Focused independent review

Reviewer: available read-only subagent. Final result: **ACCEPT** at
`aa9b109857d727e093b183c7ddb8c94e1ae7ad4c`.

## First review HOLD and closure

1. Account deletion omitted new presentation/Route caches — fixed with exact
   owner purge and async generation fencing.
2. Cold cache could appear before current safety authority — fixed fail-closed;
   cache retains only ACK/outbox data until server authorization.
3. First Route Detail hydration could remain loading — fixed stable init key
   and current-store lookup.
4. Server accepted client-declared flat geometry — fixed ordered geometry
   authority and share-time revalidation.
5. Undo/Reset could allow a late provider response — fixed abort/operation ID
   invalidation.
6. Interval replacement lost prefix/suffix provenance — fixed ordered part
   splitting.
7. Draw deviation was one-way — fixed bidirectional checks and loop-collapse
   protection.

## Second review HOLD and closure

1. Direct authenticated A→B switch could retain A unread/coordinates and reuse
   an A refresh promise — fixed synchronous UI clear, generation change and
   separate B refresh; online, offline and delayed-A tests added.
2. Index-resampling could skip a far provider spur beyond 100 points — fixed by
   checking every source/candidate vertex against the opposite polyline and
   using density-normalized progress only for order. Hidden 2 km spur and
   501-point same-line counterexamples added.

## Additional medium closures

- Partial Route share retries now retain the same idempotency key while
  narrowing to failed recipients.
- Route distance is server-derived from ordered part edges, excludes declared
  unknown gaps and is used for create/update/delivery snapshots.
- Shared Route cache and Route planner drafts are account-scoped and purged.

## Final reviewer evidence

- App focused run: 5 suites / 93 tests PASS.
- Backend geometry/delivery: 12/12 PASS.
- Backend Route round-trip: 4/4 PASS.
- `git diff --check`: clean at reviewed commit.

This is source/deterministic test review, not native renderer, physical-device,
live-provider, performance-at-extremes or production verification.

